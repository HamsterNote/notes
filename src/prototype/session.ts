import { baseKeymap } from "@tiptap/pm/commands"
import { closeHistory, history, redo, undo } from "@tiptap/pm/history"
import { keydownHandler, keymap } from "@tiptap/pm/keymap"
import type { Node as PmNode } from "@tiptap/pm/model"
import {
  EditorState,
  type SelectionBookmark,
  type Transaction
} from "@tiptap/pm/state"
import { Mapping } from "@tiptap/pm/transform"
import { EditorView } from "@tiptap/pm/view"
import { decodeHnn, encodeHnn, type HnnDocument } from "../lib/hnn/codec"
import { hnnSchema } from "../lib/hnn/schema"
import { createHnnNodeIdPlugin } from "../lib/hnn/nodeId"
import { prepareCardPayloadCandidate } from "../lib/hnn/cardPayload"
import { prepareDrawingPayloadCandidate } from "../lib/hnn/drawingPayload"
import type {
  Controller,
  DraftState,
  FreezeResult,
  HostSnapshot,
  Identity,
  PublicState,
  SaveContext,
  SavePayload,
  SaveReason,
  SaveRequest,
  SaveTerminal
} from "./types"

type Options = {
  documentId: string
  loadKey: string | number
  initialDocument: unknown
  initialHostSnapshot: HostSnapshot
  onSave(payload: SavePayload, context: SaveContext): Promise<void>
  onChange?(document: HnnDocument, identity: Identity): void
  undoPolicy?: PublicState["undoPolicy"]
}
type Draft = {
  state: Exclude<DraftState, { phase: "none" }>
  nodeId: string
  data: string
  bookmark: SelectionBookmark
  anchor: HTMLElement | null
}
type ViewRecord = { view: EditorView; instanceId: string }
type Insertion = {
  sessionId: string
  viewId: string
  instanceId: string
  epoch: number
  position: number
}

function validHost(input: unknown): input is HostSnapshot {
  if (!input || typeof input !== "object") return false
  const snapshot = input as HostSnapshot
  return (
    Object.keys(snapshot).every(
      (key) => key === "changeId" || key === "value"
    ) &&
    Number.isSafeInteger(snapshot.changeId) &&
    snapshot.changeId >= 0 &&
    !!snapshot.value &&
    typeof snapshot.value === "object" &&
    Object.keys(snapshot.value).every(
      (key) => key === "title" || key === "summary"
    ) &&
    typeof snapshot.value.title === "string" &&
    typeof snapshot.value.summary === "string"
  )
}

/** 隔离研究内核；不从库入口导出，不是现有 EditorSession 的兼容替代品。 */
export class PrototypeSession {
  readonly identity: Identity
  readonly controller: Controller
  readonly views = new Map<string, ViewRecord>()
  private doc!: PmNode
  private baseline!: PmNode
  private host: HostSnapshot
  private hostBaseline: HostSnapshot
  private encodingError: unknown
  private error: unknown
  private lifecycle: PublicState["lifecycle"] = "ready"
  private listeners = new Set<(state: PublicState) => void>()
  private pending: Extract<SaveRequest, { kind: "pending" }> | undefined
  private failure: Extract<SaveTerminal, { kind: "failure" }> | undefined
  private writeAbort: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private leases = new Set<string>()
  private freezeRequests = new Map<string, string | null>()
  private freezing = false
  private pendingAcquires = 0
  private freezeQueue: Promise<unknown> = Promise.resolve()
  private draft: Draft | undefined
  private epoch = 0
  private mappings: Mapping[] = []
  private insertions = new Set<Insertion>()
  private sharedHistory: EditorState | undefined
  private lastEditView: string | undefined

  constructor(private options: Options) {
    this.identity = {
      documentId: options.documentId,
      loadKey: options.loadKey,
      sessionId: crypto.randomUUID()
    }
    this.host = structuredClone(options.initialHostSnapshot)
    this.hostBaseline = structuredClone(this.host)
    try {
      if (!validHost(this.host)) throw new Error("Invalid host snapshot")
      if (
        typeof options.loadKey === "number" &&
        !Number.isFinite(options.loadKey)
      )
        throw new Error("Invalid loadKey")
      this.doc = decodeHnn(options.initialDocument)
      this.baseline = this.doc
      if (options.undoPolicy === "shared")
        this.sharedHistory = EditorState.create({
          schema: hnnSchema,
          doc: this.doc,
          plugins: [history(), keymap(baseKeymap), createHnnNodeIdPlugin()]
        })
    } catch (error) {
      this.lifecycle = "load-error"
      this.error = error
    }
    this.controller = {
      getState: () => this.getState(),
      subscribe: (listener) => {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
      updateHostSnapshot: (snapshot, context) =>
        this.updateHost(snapshot, context.expectedSessionId),
      requestSave: (input) =>
        this.requestSave(input.reason, input.expectedSessionId),
      setInputFrozen: (frozen, context) => {
        const { expectedSessionId, requestId } = context
        const leaseId = "leaseId" in context ? context.leaseId : undefined
        // 入队即阻止替换；每个请求自行清理，不能清掉后来排队的门禁。
        if (frozen) this.pendingAcquires += 1
        const result = this.freezeQueue
          .then(() =>
            this.freeze(frozen, expectedSessionId, requestId, leaseId)
          )
          .finally(() => {
            if (frozen) this.pendingAcquires -= 1
          })
        this.freezeQueue = result.catch(() => undefined)
        return result
      },
      canDetachView: (viewId, context) =>
        this.canDetach(viewId, context.expectedSessionId)
    }
  }

  getState(): PublicState {
    const blocked = this.encodingError !== undefined || this.draft !== undefined
    const body = this.lifecycle === "ready" && !this.doc.eq(this.baseline)
    const host =
      this.host.value.title !== this.hostBaseline.value.title ||
      this.host.value.summary !== this.hostBaseline.value.summary
    return {
      lifecycle: this.lifecycle,
      identity: this.lifecycle === "ready" ? { ...this.identity } : null,
      encoding: this.encodingError === undefined ? "valid" : "error",
      dirty: { body, host },
      save: blocked
        ? "blocked"
        : this.pending
          ? "pending"
          : this.failure
            ? "failure"
            : body || host
              ? "dirty"
              : "clean",
      inputFrozen: this.leases.size > 0,
      undoPolicy: this.options.undoPolicy ?? "view-local-baseline",
      draft: this.draft ? { ...this.draft.state } : { phase: "none" },
      views: [...this.views.keys()].map((viewId) => ({
        viewId,
        owner: viewId === this.draft?.state.ownerViewId,
        canDetach: viewId !== this.draft?.state.ownerViewId
      })),
      ...(this.error === undefined ? {} : { error: this.error })
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getState())
      } catch {
        /* 观察者不能中断模型提交。 */
      }
    }
  }

  attachView(viewId: string, element: HTMLElement): EditorView {
    if (this.lifecycle !== "ready" || this.views.has(viewId))
      throw new Error("View is not attachable")
    const view = new EditorView(element, {
      state:
        this.sharedHistory ??
        EditorState.create({
          schema: hnnSchema,
          doc: this.doc,
          plugins: [history(), keymap(baseKeymap), createHnnNodeIdPlugin()]
        }),
      handleKeyDown: keydownHandler({
        "Mod-z": () => this.undo(viewId),
        "Mod-Shift-z": () => this.redo(viewId),
        "Mod-y": () => this.redo(viewId)
      }),
      attributes: {
        role: "textbox",
        "aria-label": `笔记内容编辑区 ${viewId}`,
        "aria-multiline": "true",
        class: "hn-editor-content"
      },
      editable: () => !this.getState().inputFrozen && !this.draft,
      dispatchTransaction: (transaction) => {
        this.dispatch(viewId, transaction)
      }
    })
    this.views.set(viewId, { view, instanceId: crypto.randomUUID() })
    this.notify()
    return view
  }

  detachView(viewId: string): boolean {
    if (this.canDetach(viewId, this.identity.sessionId).kind !== "allowed")
      return false
    this.views.get(viewId)?.view.destroy()
    this.views.delete(viewId)
    if (this.sharedHistory) this.lastEditView = undefined
    for (const insertion of this.insertions)
      if (insertion.viewId === viewId) this.insertions.delete(insertion)
    this.notify()
    return true
  }

  private canDetach(
    viewId: string,
    sessionId: string
  ): ReturnType<Controller["canDetachView"]> {
    const identity = { sessionId: this.identity.sessionId }
    if (sessionId !== this.identity.sessionId)
      return { ...identity, kind: "noop", reason: "stale" }
    if (this.lifecycle !== "ready")
      return { ...identity, kind: "noop", reason: "not-ready" }
    if (!this.views.has(viewId))
      return { ...identity, kind: "noop", reason: "unknown-view" }
    if (this.draft?.state.ownerViewId === viewId)
      return { ...identity, kind: "blocked", reason: "draft-owner" }
    return { ...identity, kind: "allowed" }
  }

  dispatch(
    viewId: string,
    transaction: Transaction,
    completingDraft = false
  ): boolean {
    const record = this.views.get(viewId)
    if (
      !record ||
      this.lifecycle !== "ready" ||
      this.leases.size > 0 ||
      (this.draft && !completingDraft)
    )
      return false
    if (transaction.before !== record.view.state.doc) {
      this.error = new Error("Stale transaction rejected")
      this.notify()
      return false
    }
    if (
      this.sharedHistory &&
      transaction.docChanged &&
      this.lastEditView !== viewId
    )
      closeHistory(transaction)
    const sourceState = this.sharedHistory
      ? this.sharedHistory.apply(
          this.sharedHistory.tr
            .setSelection(record.view.state.selection)
            .setStoredMarks(record.view.state.storedMarks)
            .setMeta("addToHistory", false)
        )
      : record.view.state
    const applied = sourceState.applyTransaction(transaction)
    const transactions = applied.transactions
    record.view.updateState(applied.state)
    this.doc = applied.state.doc
    const mapping = new Mapping()
    for (const item of transactions) mapping.appendMapping(item.mapping)
    if (this.sharedHistory) this.sharedHistory = applied.state
    for (const [peerId, peer] of this.views) {
      if (peerId === viewId) continue
      if (this.sharedHistory) {
        // 各 view 投影共享 history，只映射自身选区；不复制快照或独立重放历史。
        const selection = peer.view.state.selection
          .getBookmark()
          .map(mapping)
          .resolve(applied.state.doc)
        peer.view.updateState(
          applied.state.apply(
            applied.state.tr
              .setSelection(selection)
              .setStoredMarks(peer.view.state.storedMarks)
              .setMeta("addToHistory", false)
          )
        )
        continue
      }
      let remote = peer.view.state.tr
      for (const item of transactions)
        for (const step of item.steps) remote = remote.step(step)
      // 实验反例：不入 peer history 仍不能保护重叠范围内的 peer 编辑，见 local-undo 失败测试。
      remote.setMeta("addToHistory", false)
      peer.view.updateState(peer.view.state.apply(remote))
    }
    if (transactions.some((item) => item.docChanged)) {
      this.lastEditView = viewId
      this.mappings.push(mapping)
      this.epoch += 1
      try {
        const snapshot = encodeHnn(this.doc)
        this.encodingError = undefined
        this.error = undefined
        try {
          this.options.onChange?.(snapshot, { ...this.identity })
        } catch {
          /* 通知失败不回退文档。 */
        }
      } catch (error) {
        this.encodingError = error
        this.error = error
      }
      this.schedule()
    }
    this.notify()
    return true
  }

  undo(viewId: string): boolean {
    if (
      this.freezing ||
      this.leases.size ||
      this.draft ||
      this.lifecycle !== "ready"
    )
      return false
    const view = this.views.get(viewId)?.view
    return (
      !!view &&
      undo(view.state, (transaction) => {
        this.dispatch(viewId, transaction)
      })
    )
  }

  redo(viewId: string): boolean {
    if (
      this.freezing ||
      this.leases.size ||
      this.draft ||
      this.lifecycle !== "ready"
    )
      return false
    const view = this.views.get(viewId)?.view
    return (
      !!view &&
      redo(view.state, (transaction) => {
        this.dispatch(viewId, transaction)
      })
    )
  }

  private schedule(): void {
    clearTimeout(this.timer)
    if (this.failure || this.lifecycle !== "ready") return
    this.timer = setTimeout(
      () => this.requestSave("autosave", this.identity.sessionId),
      600
    )
  }

  private updateHost(
    snapshot: HostSnapshot,
    sessionId: string
  ): ReturnType<Controller["updateHostSnapshot"]> {
    const identity = { sessionId: this.identity.sessionId }
    if (sessionId !== this.identity.sessionId)
      return { ...identity, kind: "noop", reason: "stale" }
    if (this.lifecycle !== "ready")
      return { ...identity, kind: "blocked", reason: "not-ready" }
    if (this.leases.size || this.freezing)
      return { ...identity, kind: "blocked", reason: "input-frozen" }
    if (!validHost(snapshot))
      return { ...identity, kind: "failure", reason: "invalid-snapshot" }
    const same =
      snapshot.value.title === this.host.value.title &&
      snapshot.value.summary === this.host.value.summary
    if (snapshot.changeId === this.host.changeId && same)
      return { ...identity, kind: "noop", reason: "unchanged" }
    if (snapshot.changeId <= this.host.changeId)
      return { ...identity, kind: "failure", reason: "non-monotonic-change-id" }
    this.host = structuredClone(snapshot)
    this.schedule()
    this.notify()
    return { ...identity, kind: "accepted", changeId: snapshot.changeId }
  }

  private guard(): SaveTerminal | undefined {
    const sessionId = this.identity.sessionId
    if (this.lifecycle === "disposed")
      return { kind: "abort", sessionId, cause: "disposed" }
    if (this.lifecycle !== "ready")
      return { kind: "noop", sessionId: null, cause: "not-ready" }
    if (this.encodingError !== undefined)
      return { kind: "blocked", sessionId, cause: "encoding-error" }
    if (this.draft) return { kind: "blocked", sessionId, cause: "draft-open" }
    return undefined
  }

  private requestSave(
    reason: SaveReason,
    expectedSessionId: string
  ): SaveRequest {
    clearTimeout(this.timer)
    const sessionId = this.identity.sessionId
    if (expectedSessionId !== sessionId)
      return { kind: "noop", sessionId, cause: "stale" }
    const blocked = this.guard()
    if (blocked) return blocked
    if (this.pending) return this.pending
    if (reason === "autosave" && this.failure) return this.failure
    const state = this.getState()
    if (!state.dirty.body && !state.dirty.host)
      return { kind: "clean", sessionId }
    const operationId = crypto.randomUUID()
    this.failure = undefined
    const completion = Promise.resolve()
      .then(() => this.drain(reason, operationId))
      .then((result) => {
        this.pending = undefined
        if (result.kind === "failure") this.failure = result
        this.notify()
        return result
      })
    this.pending = { kind: "pending", sessionId, operationId, completion }
    this.notify()
    return this.pending
  }

  private async drain(
    reason: SaveReason,
    operationId: string
  ): Promise<SaveTerminal> {
    const sessionId = this.identity.sessionId
    let writesCompleted = 0
    while (true) {
      const blocked = this.guard()
      if (blocked) return blocked
      const state = this.getState()
      if (!state.dirty.body && !state.dirty.host)
        return { kind: "saved", sessionId, operationId, writesCompleted }
      const capturedDoc = this.doc
      const capturedHost = structuredClone(this.host)
      const abort = new AbortController()
      this.writeAbort = abort
      try {
        const cancelled = new Promise<"abort">((resolve) =>
          abort.signal.addEventListener("abort", () => resolve("abort"), {
            once: true
          })
        )
        const written = Promise.resolve(
          this.options.onSave(
            {
              document: encodeHnn(capturedDoc),
              hostSnapshot: structuredClone(capturedHost)
            },
            {
              identity: { ...this.identity },
              operationId,
              reason,
              signal: abort.signal
            }
          )
        ).then(() => "written" as const)
        if ((await Promise.race([written, cancelled])) === "abort")
          return { kind: "abort", sessionId, cause: "disposed" }
        if (this.lifecycle !== "ready")
          return { kind: "abort", sessionId, cause: "disposed" }
        this.baseline = capturedDoc
        this.hostBaseline = capturedHost
        this.error = undefined
        writesCompleted += 1
      } catch (error) {
        if (this.lifecycle === "disposed")
          return { kind: "abort", sessionId, cause: "disposed" }
        this.error = error
        return { kind: "failure", sessionId, operationId, error }
      } finally {
        this.writeAbort = undefined
      }
    }
  }

  private async freeze(
    frozen: boolean,
    sessionId: string,
    requestId: string,
    leaseId?: string
  ): Promise<FreezeResult> {
    const identity = this.lifecycle === "ready" ? { ...this.identity } : null
    const result = { identity, requestId }
    if (sessionId !== this.identity.sessionId)
      return { ...result, kind: "noop", reason: "stale" }
    if (this.lifecycle === "disposed")
      return { ...result, kind: "abort", reason: "disposed" }
    if (this.lifecycle !== "ready")
      return { ...result, kind: "noop", reason: "not-ready" }
    if (
      typeof requestId !== "string" ||
      !requestId.trim() ||
      requestId.length > 128
    )
      return {
        ...result,
        kind: "failure",
        reason: "invalid-request",
        error: new Error("Invalid freeze requestId")
      }
    const ownedLease = this.freezeRequests.get(requestId)
    if (!frozen) {
      if (!leaseId || ownedLease !== leaseId || !this.leases.delete(leaseId))
        return { ...result, kind: "noop", reason: "stale-lease" }
      this.freezeRequests.set(requestId, null)
      this.refreshEditable()
      if (this.getState().lifecycle === "disposed")
        return { ...result, kind: "abort", reason: "disposed", identity: null }
      return {
        ...result,
        kind: "applied",
        action: "released",
        leaseId,
        inputFrozen: this.leases.size > 0
      }
    }
    if (ownedLease === null)
      return { ...result, kind: "noop", reason: "request-ended" }
    if (ownedLease)
      return {
        ...result,
        kind: "noop",
        reason: "already-owned",
        leaseId: ownedLease,
        inputFrozen: true
      }
    this.freezing = true
    try {
      for (const { view } of this.views.values())
        if (view.hasFocus()) view.dom.blur()
      // 让真实 DOM composition/MutationObserver 提交；无法确认则显式失败，保留原视图。
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (this.getState().lifecycle === "disposed")
        return { ...result, kind: "abort", reason: "disposed", identity: null }
      if ([...this.views.values()].some(({ view }) => view.composing)) {
        return {
          kind: "failure",
          reason: "composition-commit",
          error: new Error("Composition still pending"),
          ...result
        }
      }
      if (this.insertions.size > 0)
        return {
          kind: "failure",
          reason: "pending-edit",
          error: new Error("Async edit still pending"),
          ...result
        }
      const nextLease = crypto.randomUUID()
      this.leases.add(nextLease)
      this.freezeRequests.set(requestId, nextLease)
      this.refreshEditable()
      if (this.getState().lifecycle === "disposed")
        return { ...result, kind: "abort", reason: "disposed", identity: null }
      return {
        ...result,
        kind: "applied",
        action: "acquired",
        leaseId: nextLease,
        inputFrozen: true
      }
    } catch (error) {
      return { ...result, kind: "failure", reason: "other", error }
    } finally {
      this.freezing = false
    }
  }

  private refreshEditable(): void {
    for (const { view } of this.views.values())
      view.setProps({ editable: () => !this.leases.size && !this.draft })
    this.notify()
  }

  beginDraft(viewId: string, nodeId: string): boolean {
    const record = this.views.get(viewId)
    const found = this.findNode(nodeId)
    if (
      !record ||
      !found ||
      this.draft ||
      this.leases.size ||
      this.freezing ||
      this.lifecycle !== "ready"
    )
      return false
    const kind = found.node.type.name
    if (kind !== "card" && kind !== "drawing") return false
    this.draft = {
      state: {
        phase: "editing",
        draftId: crypto.randomUUID(),
        kind,
        ownerViewId: viewId,
        changed: false
      },
      nodeId,
      data: String(found.node.attrs["data"]),
      bookmark: record.view.state.selection.getBookmark(),
      anchor:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    }
    this.refreshEditable()
    return true
  }

  getDraftData(): string {
    return this.draft?.data ?? ""
  }

  changeDraft(data: string): void {
    if (!this.draft || this.leases.size || this.freezing) return
    this.draft.data = data
    this.draft.state.changed = true
    this.draft.state.phase = "editing"
    this.notify()
  }

  completeDraft(): boolean {
    const draft = this.draft
    if (!draft || this.leases.size || this.freezing) return false
    draft.state.phase = "validating"
    this.notify()
    try {
      const parsed: unknown = JSON.parse(draft.data)
      const candidate =
        draft.state.kind === "card"
          ? prepareCardPayloadCandidate(parsed)
          : prepareDrawingPayloadCandidate(parsed)
      if (!candidate.result.ok) throw new Error(candidate.result.error.message)
      const found = this.findNode(draft.nodeId)
      const owner = this.views.get(draft.state.ownerViewId)
      if (!found || !owner) throw new Error("Draft owner or node missing")
      const transaction = closeHistory(
        owner.view.state.tr.setNodeMarkup(found.position, undefined, {
          ...found.node.attrs,
          data: candidate.result.value
        })
      )
      encodeHnn(transaction.doc)
      if (!this.dispatch(draft.state.ownerViewId, transaction, true))
        throw new Error("Draft commit rejected")
      this.finishDraft(draft)
      return true
    } catch (error) {
      draft.state.phase = "invalid"
      this.error = error
      this.notify()
      return false
    }
  }

  cancelDraft(): void {
    if (this.draft && !this.leases.size && !this.freezing)
      this.finishDraft(this.draft)
  }

  private finishDraft(draft: Draft): void {
    this.draft = undefined
    const owner = this.views.get(draft.state.ownerViewId)?.view
    if (owner) {
      owner.updateState(
        owner.state.apply(
          owner.state.tr.setSelection(draft.bookmark.resolve(owner.state.doc))
        )
      )
      owner.dispatch(closeHistory(owner.state.tr))
      if (draft.anchor?.isConnected) draft.anchor.focus()
      else owner.focus()
    }
    this.refreshEditable()
  }

  private findNode(
    nodeId: string
  ): { node: PmNode; position: number } | undefined {
    if (this.lifecycle !== "ready") return undefined
    let found: { node: PmNode; position: number } | undefined
    this.doc.descendants((node, position) => {
      if (node.attrs["nodeId"] === nodeId) found = { node, position }
    })
    return found
  }

  captureInsertion(viewId: string): Insertion | undefined {
    const record = this.views.get(viewId)
    if (
      !record ||
      this.lifecycle !== "ready" ||
      this.leases.size ||
      this.freezing ||
      this.draft
    )
      return undefined
    const insertion = {
      viewId,
      instanceId: record.instanceId,
      sessionId: this.identity.sessionId,
      epoch: this.epoch,
      position: record.view.state.selection.from
    }
    this.insertions.add(insertion)
    return insertion
  }

  resolveInsertion(insertion: Insertion, text: string): boolean {
    if (!this.insertions.delete(insertion)) return false
    const record = this.views.get(insertion.viewId)
    if (
      !record ||
      record.instanceId !== insertion.instanceId ||
      this.identity.sessionId !== insertion.sessionId ||
      this.lifecycle !== "ready" ||
      this.leases.size ||
      this.draft
    )
      return false
    const mapping = new Mapping()
    for (const change of this.mappings.slice(insertion.epoch))
      mapping.appendMapping(change)
    const result = mapping.mapResult(insertion.position, 1)
    if (result.deleted) return false
    return this.dispatch(
      insertion.viewId,
      record.view.state.tr.insertText(text, result.pos)
    )
  }

  canReplace(): boolean {
    return (
      !this.leases.size &&
      !this.freezing &&
      !this.pendingAcquires &&
      !this.draft &&
      !this.getState().dirty.body &&
      !this.getState().dirty.host &&
      !this.pending
    )
  }

  dispose(): void {
    if (this.lifecycle === "disposed") return
    this.lifecycle = "disposed"
    this.leases.clear()
    this.freezeRequests.clear()
    this.sharedHistory = undefined
    clearTimeout(this.timer)
    this.writeAbort?.abort()
    for (const { view } of this.views.values()) view.destroy()
    this.views.clear()
    this.insertions.clear()
    this.notify()
    this.listeners.clear()
  }
}
