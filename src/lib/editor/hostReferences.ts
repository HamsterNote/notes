import type { Editor } from "@tiptap/core"
import { closeHistory } from "@tiptap/pm/history"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { TextSelection } from "@tiptap/pm/state"
import { encodeHnn } from "../hnn/codec"
import { HNN_LIMITS } from "../hnn/limits"
import { createHnnNodeId } from "../hnn/nodeId"
import { jsonStringBytes, utf8Bytes } from "../hnn/stringBytes"
import type {
  HostCandidateKind,
  HostCandidateProvider,
  HostCandidateState,
  HostReferenceActivate,
  HostReferenceCandidate,
  HostReferenceKind,
  HostReferenceResolve,
  HostReferenceResolution,
  HostReferenceResolutionEntry,
  HostReferenceState
} from "./types"
/**
 * D11 宿主引用（mention/resource/externalItem）的 headless 核心，与视觉完全解耦：
 * - 候选只保存 { resourceId, name }；选择后以单个 transaction 插入 schema 内的 inline ref，
 *   文档只持久 resourceId/name，绝不写入解析结果；
 * - resolve 为运行时只读映射（loading/resolved/missing/error），供 designer 渲染占位，
 *   本模块不编辑 DOM、不自行导航；
 * - 每个请求独立 AbortSignal 与不可复用 token；destroy 后即使宿主忽略 abort，陈旧结果也丢弃；
 * - 候选快速改 query 时，旧请求的结果不会覆盖新状态。
 */

const REFERENCE_KINDS: readonly HostReferenceKind[] = ["mention", "resource", "externalItem"]
const CANDIDATE_KINDS: readonly HostCandidateKind[] = ["mention", "resource"]

const IDLE_CANDIDATE_STATE: HostCandidateState = Object.freeze({ kind: null, query: "", status: "idle", items: [] })

export interface HostReferenceInsertRange {
  from: number
  to: number
}

export interface HostReferenceOptions {
  readonly documentId: string
  /** 候选查询：kind 仅 mention/resource。缺省时受控 empty，不破坏文档。 */
  readonly candidates?: HostCandidateProvider
  /** 激活宿主引用：库只调用回调，绝不自行 navigate。 */
  readonly activate?: HostReferenceActivate
  /** 运行时解析：缺省时受控 missing，不破坏文档。 */
  readonly resolve?: HostReferenceResolve
  readonly onCandidateStateChange?: (state: HostCandidateState) => void
  readonly onReferenceStateChange?: (state: HostReferenceState) => void
}

export interface HostReferenceInstaller {
  /** 仅在宿主提供激活回调时暴露链接/键盘语义；该能力属于内部接线，不进入 HNN。 */
  readonly hasActivate: boolean
  /** 发起候选查询；同 kind/query 的旧请求会被 abort，旧结果不会覆盖。 */
  requestCandidates(kind: HostCandidateKind, query: string): void
  /** 取消候选查询并回到 idle。 */
  cancelCandidates(): void
  getCandidateState(): HostCandidateState
  subscribeCandidates(listener: (state: HostCandidateState) => void): () => void
  /**
   * 以单个 transaction 在当前 TextSelection 或给定 range 插入合法 inline ref；
   * marks 为空、nodeId 新生成、整文档预算前置校验、closeHistory 保证唯一历史步。
   * 仅持久 resourceId/name；失败返回 false 且不产生任何文档/历史变化。
   */
  selectCandidate(kind: HostCandidateKind, candidate: HostReferenceCandidate, range?: HostReferenceInsertRange): boolean
  /** 调用宿主 activate；不自行导航，不修改文档。 */
  activate(reference: { kind: HostReferenceKind; resourceId: string; name: string }): void
  getReferenceState(): HostReferenceState
  subscribeReferences(listener: (state: HostReferenceState) => void): () => void
  destroy(): void
}

function isReferenceKind(value: string): value is HostReferenceKind {
  return (REFERENCE_KINDS as readonly string[]).includes(value)
}

function isCandidateKind(value: string): value is HostCandidateKind {
  return (CANDIDATE_KINDS as readonly string[]).includes(value)
}

function withinBudget(value: string, maxBytes: number): boolean {
  return value.trim().length > 0 && utf8Bytes(value) <= maxBytes && jsonStringBytes(value) <= HNN_LIMITS.maxAttrBytes
}

function candidateWithinBudget(candidate: HostReferenceCandidate): boolean {
  return typeof candidate.resourceId === "string" && typeof candidate.name === "string"
    && withinBudget(candidate.resourceId, HNN_LIMITS.maxIdentifierBytes)
    && withinBudget(candidate.name, HNN_LIMITS.maxLabelBytes)
}

/** 规范化候选：只保留最小 { resourceId, name }，按 resourceId 去重，拒绝越权字段。 */
function normalizeCandidates(items: unknown): HostReferenceCandidate[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const result: HostReferenceCandidate[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const candidate = item as { resourceId?: unknown; name?: unknown }
    if (typeof candidate.resourceId !== "string" || typeof candidate.name !== "string") continue
    if (!candidateWithinBudget(candidate as HostReferenceCandidate)) continue
    if (seen.has(candidate.resourceId)) continue
    seen.add(candidate.resourceId)
    result.push({ resourceId: candidate.resourceId, name: candidate.name })
  }
  return result
}

function referenceKey(kind: HostReferenceKind, resourceId: string): string {
  return `${kind}\u0000${resourceId}`
}

/** 按 kind+resourceId 去重扫描文档内全部宿主引用。 */
function collectReferences(doc: ProseMirrorNode): Map<string, { kind: HostReferenceKind; resourceId: string; name: string }> {
  const found = new Map<string, { kind: HostReferenceKind; resourceId: string; name: string }>()
  doc.descendants((node) => {
    const kind = node.type.name
    if (!isReferenceKind(kind)) return
    const resourceId: unknown = node.attrs["resourceId"]
    if (typeof resourceId !== "string" || resourceId.trim() === "") return
    const name = typeof node.attrs["name"] === "string" ? node.attrs["name"] : ""
    const key = referenceKey(kind, resourceId)
    if (!found.has(key)) found.set(key, { kind, resourceId, name })
  })
  return found
}

interface ResolutionEntry {
  readonly kind: HostReferenceKind
  readonly resourceId: string
  name: string
  status: "loading" | "resolved" | "missing" | "error"
  label: string | undefined
  description: string | undefined
  error?: unknown
  token: symbol
  controller: AbortController
  active: boolean
}

export function installHostReferences(editor: Editor, options: HostReferenceOptions): HostReferenceInstaller {
  const { documentId } = options
  let destroyed = false

  // ===== 候选查询状态（UI 订阅） =====
  const candidateListeners = new Set<(state: HostCandidateState) => void>()
  let candidateState: HostCandidateState = IDLE_CANDIDATE_STATE
  let candidateToken: symbol | null = null
  let candidateController: AbortController | null = null

  const notifyCandidates = (): void => {
    if (destroyed) return
    options.onCandidateStateChange?.(candidateState)
    for (const listener of candidateListeners) listener(candidateState)
  }
  const setCandidateState = (next: HostCandidateState): void => { candidateState = next; notifyCandidates() }

  const requestCandidates = (kind: HostCandidateKind, query: string): void => {
    if (destroyed || editor.isDestroyed) return
    if (!isCandidateKind(kind)) return
    candidateController?.abort()
    const token = Symbol("host-candidates")
    candidateToken = token
    const controller = new AbortController()
    candidateController = controller
    const provider = options.candidates
    // 无回调时受控 empty，不产生请求也不破坏文档。
    if (!provider) { setCandidateState({ kind, query, status: "empty", items: [] }); return }
    setCandidateState({ kind, query, status: "loading", items: [] })
    // setCandidateState 会同步通知 subscriber；其可能 cancel/destroy/发起新 query。
    // 调用旧 provider 前必须重新校验，避免在已作废的请求上继续调用宿主。
    if (destroyed || editor.isDestroyed || candidateToken !== token || controller.signal.aborted) return
    let result: readonly HostReferenceCandidate[] | Promise<readonly HostReferenceCandidate[]>
    try {
      result = provider(kind, query, { documentId, signal: controller.signal })
    } catch (error) {
      if (!destroyed && candidateToken === token) setCandidateState({ kind, query, status: "error", items: [], error })
      return
    }
    Promise.resolve(result).then(
      (items) => {
        if (destroyed || candidateToken !== token) return
        const normalized = normalizeCandidates(items)
        setCandidateState({ kind, query, status: normalized.length === 0 ? "empty" : "ready", items: normalized })
      },
      (error) => { if (destroyed || candidateToken !== token) return; setCandidateState({ kind, query, status: "error", items: [], error }) }
    )
  }

  const cancelCandidates = (): void => {
    candidateController?.abort()
    candidateController = null
    candidateToken = null
    setCandidateState(IDLE_CANDIDATE_STATE)
  }

  const subscribeCandidates = (listener: (state: HostCandidateState) => void): (() => void) => {
    candidateListeners.add(listener)
    return () => candidateListeners.delete(listener)
  }

  // ===== 文档内引用的运行时解析状态 =====
  const referenceListeners = new Set<(state: HostReferenceState) => void>()
  const resolutionEntries = new Map<string, ResolutionEntry>()
  let referencesNotifyScheduled = false

  const getReferenceState = (): HostReferenceState => {
    const entries = [...resolutionEntries.values()].map<HostReferenceResolutionEntry>((entry) => ({
      kind: entry.kind,
      resourceId: entry.resourceId,
      status: entry.status,
      ...(entry.label === undefined ? {} : { label: entry.label }),
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.error === undefined ? {} : { error: entry.error })
    }))
    // 稳定顺序，便于 UI/测试比较。
    entries.sort((a, b) => (a.kind === b.kind ? (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0) : a.kind < b.kind ? -1 : 1))
    return { entries }
  }

  const notifyReferences = (): void => {
    if (destroyed) return
    const state = getReferenceState()
    options.onReferenceStateChange?.(state)
    for (const listener of referenceListeners) listener(state)
  }

  // 解析状态由 editor transaction（dispatch 之后）驱动；延后通知避免 subscriber 重入 dispatch。
  const scheduleReferencesNotify = (): void => {
    if (destroyed || referencesNotifyScheduled) return
    referencesNotifyScheduled = true
    queueMicrotask(() => { referencesNotifyScheduled = false; notifyReferences() })
  }

  const startResolve = (entry: ResolutionEntry): void => {
    const resolver = options.resolve
    // 无回调时受控 missing，不破坏文档。
    if (!resolver) { entry.status = "missing"; entry.error = undefined; return }
    const token = Symbol("host-resolve")
    entry.token = token
    entry.status = "loading"
    entry.error = undefined
    const controller = new AbortController()
    entry.controller = controller
    let result: HostReferenceResolution | null | Promise<HostReferenceResolution | null>
    try {
      result = resolver({ kind: entry.kind, resourceId: entry.resourceId }, { documentId, signal: controller.signal })
    } catch (error) {
      entry.status = "error"
      entry.error = error
      return
    }
    Promise.resolve(result).then(
      (resolution) => {
        if (destroyed || !entry.active || entry.token !== token) return
        if (resolution === null || resolution === undefined) {
          entry.status = "missing"; entry.label = undefined; entry.description = undefined; scheduleReferencesNotify(); return
        }
        const label: unknown = resolution.label
        if (typeof label !== "string" || label.trim() === "") {
          entry.status = "error"; entry.error = new Error("宿主解析结果缺少有效 label"); scheduleReferencesNotify(); return
        }
        const description: unknown = resolution.description
        entry.status = "resolved"; entry.label = label; entry.description = typeof description === "string" ? description : undefined; scheduleReferencesNotify()
      },
      (error) => { if (destroyed || !entry.active || entry.token !== token) return; entry.status = "error"; entry.error = error; scheduleReferencesNotify() }
    )
  }

  const syncReferences = (): void => {
    const current = collectReferences(editor.state.doc)
    // 文档中已删除的引用：abort 并清理，绝不留下陈旧解析请求。
    for (const [key, entry] of resolutionEntries) {
      if (!current.has(key)) { entry.active = false; entry.controller.abort(); resolutionEntries.delete(key) }
    }
    // 新增引用：按 kind+id 去重后发起解析；已存在的仅刷新展示 name。
    for (const [key, reference] of current) {
      const existing = resolutionEntries.get(key)
      if (existing) { existing.name = reference.name; continue }
      const entry: ResolutionEntry = { kind: reference.kind, resourceId: reference.resourceId, name: reference.name, status: "loading", label: undefined, description: undefined, token: Symbol("host-resolve"), controller: new AbortController(), active: true }
      resolutionEntries.set(key, entry)
      startResolve(entry)
    }
    scheduleReferencesNotify()
  }

  const handleTransaction = (): void => { if (!destroyed) syncReferences() }

  const subscribeReferences = (listener: (state: HostReferenceState) => void): (() => void) => {
    referenceListeners.add(listener)
    return () => referenceListeners.delete(listener)
  }

  // ===== 选择候选插入 inline ref =====
  const activations = new Set<AbortController>()

  const selectCandidate = (kind: HostCandidateKind, candidate: HostReferenceCandidate, range?: HostReferenceInsertRange): boolean => {
    if (destroyed || editor.isDestroyed) return false
    if (!isCandidateKind(kind)) return false
    if (!candidateWithinBudget(candidate)) return false
    const nodeType = editor.state.schema.nodes[kind]
    if (!nodeType) return false
    const doc = editor.state.doc
    let from: number
    let to: number
    if (range) {
      from = range.from
      to = range.to
    } else {
      const selection = editor.state.selection
      // 接口契约：无显式 range 时必须是 TextSelection；NodeSelection/CellSelection 受控 false。
      if (!(selection instanceof TextSelection)) return false
      from = selection.from
      to = selection.to
    }
    const size = doc.content.size
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > size) return false
    const $from = doc.resolve(from)
    const $to = doc.resolve(to)
    // 必须落在同一 inline textblock 内；跨块/顶层范围一律拒绝，避免 replaceRangeWith 拟合
    // 静默吞节点或破坏其它块。
    if (!$from.parent.inlineContent || $from.parent !== $to.parent) return false
    // schema 中 mention/resource 的 marks 为 ""，create 后 marks 必为空。
    const node = nodeType.create({ nodeId: createHnnNodeId(), resourceId: candidate.resourceId, name: candidate.name })
    if (node.marks.length > 0) return false
    const tr = editor.state.tr
    try {
      if (from === to) tr.insert(from, node)
      else tr.replaceRangeWith(from, to, node)
    } catch {
      return false
    }
    // 必须实际插入目标 inline 节点；不接受拟合/静默吞节点或空变更。
    if (tr.doc.nodeAt(from)?.type !== nodeType) return false
    if (tr.doc.eq(doc)) return false
    // closeHistory：插入独立成一个 undo step。
    closeHistory(tr)
    // 无副作用整文档预算/结构前置校验；失败绝不 dispatch。
    try {
      encodeHnn(tr.doc)
    } catch {
      return false
    }
    editor.view.dispatch(tr)
    // closeHistory 只隔离前序；再补一条空 close 事务，令紧随输入独立成历史步。
    editor.view.dispatch(closeHistory(editor.state.tr))
    return true
  }

  const activate = (reference: { kind: HostReferenceKind; resourceId: string; name: string }): void => {
    if (destroyed || editor.isDestroyed) return
    if (!isReferenceKind(reference.kind)) return
    const activator = options.activate
    // 无回调时不产生动作，也绝不自行 navigate/修改文档。
    if (!activator) return
    const controller = new AbortController()
    activations.add(controller)
    let result: void | Promise<void>
    try {
      result = activator({ kind: reference.kind, resourceId: reference.resourceId, name: reference.name }, { documentId, signal: controller.signal })
    } catch {
      activations.delete(controller)
      return
    }
    Promise.resolve(result).then(
      () => { activations.delete(controller) },
      () => { activations.delete(controller) }
    )
  }

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    candidateController?.abort()
    candidateController = null
    candidateToken = null
    for (const entry of resolutionEntries.values()) { entry.active = false; entry.controller.abort() }
    resolutionEntries.clear()
    for (const controller of activations) controller.abort()
    activations.clear()
    candidateListeners.clear()
    referenceListeners.clear()
    editor.off("transaction", handleTransaction)
    editor.off("destroy", handleEditorDestroy)
  }

  const handleEditorDestroy = (): void => { destroy() }

  editor.on("transaction", handleTransaction)
  editor.on("destroy", handleEditorDestroy)
  syncReferences()

  return {
    hasActivate: typeof options.activate === "function",
    requestCandidates,
    cancelCandidates,
    getCandidateState: () => candidateState,
    subscribeCandidates,
    selectCandidate,
    activate,
    getReferenceState,
    subscribeReferences,
    destroy
  }
}


