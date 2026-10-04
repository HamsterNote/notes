import type { Editor } from "@tiptap/core"
import { closeHistory } from "@tiptap/pm/history"
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { encodeHnn } from "../hnn/codec"
import { HNN_LIMITS } from "../hnn/limits"
import { createHnnNodeId } from "../hnn/nodeId"
import { jsonStringBytes, utf8Bytes } from "../hnn/stringBytes"
import { isSafeHnnUrl } from "../hnn/urlPolicy"
import type { PictureUploadHandler, PictureUploadItem, PictureUploadResult, PictureUploadState } from "./types"

/**
 * D8 只图片上传的 headless 核心。与视觉/宿主接线完全解耦：
 * - 占位为 `Decoration.widget`（state-only），上传状态、File、uploadId、attempt 永不进入 HNN；
 * - 每个文件一个稳定 uploadId，attempt 从 1 起、retry 只递增；每次尝试独立 AbortSignal；
 * - 成功以一个 transaction 插入真实 picture 并以 closeHistory 隔离前后输入；
 * - 坐标失败不 fallback 0；内部拖拽（view.dragging/moved）不重复上传；
 * - installer.destroy() 后即使宿主忽略 abort，陈旧结果也在库内被丢弃。
 */

const uploadKey = new PluginKey<UploadPluginState>("pictureUpload")

type UploadStatus = "uploading" | "failed"

interface UploadRecord {
  readonly uploadId: string
  readonly file: File
  attempt: number
  status: UploadStatus
  error: unknown
  controller: AbortController
  token: symbol
  readonly dom: HTMLElement
  active: boolean
}

interface UploadPluginState {
  readonly decorations: DecorationSet
}

type UploadMeta =
  | Readonly<{ kind: "add"; uploadId: string; pos: number; dom: HTMLElement }>
  | Readonly<{ kind: "remove"; uploadId: string }>

export interface PictureUploadOptions {
  /** 宿主图片上传回调：库只传文件与 { uploadId, attempt, signal }。 */
  readonly upload: PictureUploadHandler
  /** 可选单文件字节上限；超限立即失败，不调用宿主。 */
  readonly maxFileBytes?: number
  /** 状态变化回调（等价于 subscribe 的便捷入口）。 */
  readonly onStateChange?: (state: PictureUploadState) => void
}

export interface PictureUploadInstaller {
  /**
   * 显式插入入口：picker/paste/drop 都调用它。position 缺省取当前选区；返回本次
   * 入队的 uploadId 列表（无法确定合法插入位置时返回空数组，绝不 fallback 0）。
   */
  enqueue(files: Iterable<File>, position?: number): readonly string[]
  /** 失败后以相同 uploadId、递增 attempt 重试。 */
  retry(uploadId: string): boolean
  /** 取消进行中或失败的上传并移除对应占位。 */
  cancel(uploadId: string): boolean
  getState(): PictureUploadState
  subscribe(listener: (state: PictureUploadState) => void): () => void
  /** 卸载：abort 全部上传、注销插件并丢弃一切陈旧结果。 */
  destroy(): void
}

/** 图片 src 渲染策略：http/https 且在 codec URL 白名单内。 */
function isSafePictureSrc(value: unknown): value is string {
  return typeof value === "string" && /^https?:/i.test(value) && isSafeHnnUrl(value)
}

function srcWithinBudget(src: string): boolean {
  return utf8Bytes(src) <= HNN_LIMITS.maxAttrBytes && jsonStringBytes(src) <= HNN_LIMITS.maxAttrBytes
}

function altWithinBudget(alt: string): boolean {
  return alt.trim().length > 0 && utf8Bytes(alt) <= HNN_LIMITS.maxLabelBytes && jsonStringBytes(alt) <= HNN_LIMITS.maxAttrBytes
}

function imageFiles(list: FileList | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter((file) => file.type.startsWith("image/"))
}

/**
 * 把任意位置规范化为可插入 block 级 picture 的合法位置：优先插入到光标所在顶层
 * 内容块之后；`canReplace` 不通过则返回 null（调用方不得回退到 0）。
 */
function blockInsertPosition(doc: ProseMirrorNode, raw: number): number | null {
  if (!Number.isFinite(raw)) return null
  const pictureType = doc.type.schema.nodes["picture"]
  if (!pictureType) return null
  const pos = Math.min(Math.max(0, Math.trunc(raw)), doc.content.size)
  const $pos = doc.resolve(pos)
  const target = $pos.depth >= 1 ? $pos.after(1) : pos
  const candidate = pictureType.create({ src: "https://example.invalid/", alt: "image" })
  const index = doc.resolve(target).index(0)
  return doc.canReplace(index, index, Fragment.from(candidate)) ? target : null
}

function renderPlaceholder(dom: HTMLElement, record: UploadRecord): void {
  dom.className = "hn-editor-picture-upload"
  dom.setAttribute("contenteditable", "false")
  dom.setAttribute("data-hn-upload-id", record.uploadId)
  dom.setAttribute("data-hn-upload-status", record.status)
  dom.setAttribute("data-hn-upload-attempt", String(record.attempt))
  dom.setAttribute("role", "status")
  dom.textContent = record.status === "uploading" ? "图片上传中…" : "图片上传失败"
}

export function installPictureUpload(editor: Editor, options: PictureUploadOptions): PictureUploadInstaller {
  const records = new Map<string, UploadRecord>()
  const listeners = new Set<(state: PictureUploadState) => void>()
  let destroyed = false

  const getState = (): PictureUploadState => ({
    // 文件、uploadId、attempt 只存在于内存桥；绝无内容进入文档/HNN。
    items: [...records.values()].map<PictureUploadItem>((record) => ({
      uploadId: record.uploadId,
      fileName: record.file.name,
      attempt: record.attempt,
      status: record.status,
      ...(record.error === undefined ? {} : { error: record.error })
    }))
  })

  const notify = (): void => {
    if (destroyed) return
    const state = getState()
    options.onStateChange?.(state)
    for (const listener of listeners) listener(state)
  }

  /**
   * 插件 apply（DecorationSet.map 的 onRemove）里触发的通知必须延后到 dispatch 返回之后，
   * 否则 React subscriber 若同步再调用 installer/editor 会重入 dispatch。
   */
  let notifyScheduled = false
  const scheduleNotify = (): void => {
    if (destroyed || notifyScheduled) return
    notifyScheduled = true
    queueMicrotask(() => {
      notifyScheduled = false
      notify()
    })
  }

  const decorationPosition = (uploadId: string): number | null => {
    const pluginState = uploadKey.getState(editor.state)
    if (!pluginState) return null
    const span = pluginState.decorations.find(undefined, undefined, (spec) => (spec as { uploadId?: string }).uploadId === uploadId)[0]
    return span ? span.from : null
  }

  const dispatchDecorationMeta = (meta: UploadMeta): void => {
    if (destroyed || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(uploadKey, meta))
  }

  const dropRecord = (record: UploadRecord): void => {
    record.active = false
    records.delete(record.uploadId)
  }

  const handleFailure = (record: UploadRecord, token: symbol, error: unknown): void => {
    if (destroyed || editor.isDestroyed || !record.active || record.token !== token) return
    record.status = "failed"
    record.error = error
    renderPlaceholder(record.dom, record)
    notify()
  }

  const complete = (record: UploadRecord, token: symbol, src: string, alt: string): void => {
    if (destroyed || editor.isDestroyed || !record.active || record.token !== token) return
    const position = decorationPosition(record.uploadId)
    const pictureType = editor.state.doc.type.schema.nodes["picture"]
    if (position === null || !pictureType) {
      handleFailure(record, token, new Error("图片占位锚点已不存在"))
      return
    }
    const node = pictureType.create({ nodeId: createHnnNodeId(), src, alt })
    const tr = editor.state.tr.insert(position, node)
    closeHistory(tr)
    tr.setMeta(uploadKey, { kind: "remove", uploadId: record.uploadId })
    // 严格预算/结构预检必须无副作用：只校验 tr.doc，绝不 applyTransaction（否则会执行
    // plugin apply/onRemove 副作用，在预算拒绝前 abort/删除其它 upload 或触发 notify）。
    try {
      encodeHnn(tr.doc)
    } catch (error) {
      handleFailure(record, token, error)
      return
    }
    dropRecord(record)
    editor.view.dispatch(tr)
    // closeHistory 只隔离前序；再补一条空 close 事务，令紧随其后的输入独立成历史步。
    editor.view.dispatch(closeHistory(editor.state.tr))
    notify()
  }

  const handleSuccess = (record: UploadRecord, token: symbol, result: PictureUploadResult | undefined): void => {
    if (destroyed || editor.isDestroyed || !record.active || record.token !== token) return
    const src = result?.src
    if (!isSafePictureSrc(src) || !srcWithinBudget(src)) {
      handleFailure(record, token, new Error("宿主返回的图片地址不安全或超出预算"))
      return
    }
    const hostAlt = result?.alt
    const fallbackAlt = record.file.name.trim() !== "" ? record.file.name.trim() : "图片"
    const alt = typeof hostAlt === "string" && hostAlt.trim() !== "" ? hostAlt.trim() : fallbackAlt
    if (!altWithinBudget(alt)) {
      handleFailure(record, token, new Error("图片描述超出预算"))
      return
    }
    complete(record, token, src, alt)
  }

  const startUpload = (record: UploadRecord): void => {
    if (destroyed || editor.isDestroyed || !record.active) return
    const controller = new AbortController()
    const token = Symbol(record.uploadId)
    record.controller = controller
    record.token = token
    record.status = "uploading"
    record.error = undefined
    renderPlaceholder(record.dom, record)
    notify()
    let promise: Promise<PictureUploadResult>
    try {
      promise = options.upload(record.file, { uploadId: record.uploadId, attempt: record.attempt, signal: controller.signal })
    } catch (error) {
      handleFailure(record, token, error)
      return
    }
    Promise.resolve(promise).then(
      (result) => handleSuccess(record, token, result),
      (error) => handleFailure(record, token, error)
    )
  }

  const enqueueAt = (files: File[], position: number | null): string[] => {
    if (destroyed || editor.isDestroyed) return []
    const target = position === null ? null : blockInsertPosition(editor.state.doc, position)
    if (target === null) return []
    const uploadIds: string[] = []
    for (const file of files) {
      if (options.maxFileBytes !== undefined && file.size > options.maxFileBytes) {
        const uploadId = createHnnNodeId()
        const dom = document.createElement("div")
        const record: UploadRecord = { uploadId, file, attempt: 1, status: "failed", error: new Error("图片文件超出大小上限"), controller: new AbortController(), token: Symbol(uploadId), dom, active: true }
        renderPlaceholder(dom, record)
        records.set(uploadId, record)
        dispatchDecorationMeta({ kind: "add", uploadId, pos: target, dom })
        uploadIds.push(uploadId)
        notify()
        continue
      }
      const uploadId = createHnnNodeId()
      const dom = document.createElement("div")
      const record: UploadRecord = { uploadId, file, attempt: 1, status: "uploading", error: undefined, controller: new AbortController(), token: Symbol(uploadId), dom, active: true }
      renderPlaceholder(dom, record)
      records.set(uploadId, record)
      dispatchDecorationMeta({ kind: "add", uploadId, pos: target, dom })
      uploadIds.push(uploadId)
      startUpload(record)
    }
    return uploadIds
  }

  const enqueue = (files: Iterable<File>, position?: number): readonly string[] => {
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"))
    if (list.length === 0) return []
    const raw = position ?? editor.state.selection.from
    return enqueueAt(list, raw)
  }

  const onDecorationRemoved = (spec: unknown): void => {
    const uploadId = (spec as { uploadId?: string }).uploadId
    if (typeof uploadId !== "string") return
    const record = records.get(uploadId)
    if (!record || !record.active) return
    // 用户编辑删除了占位锚点：无论 uploading 还是 failed，都清理记录，避免留下
    // 不可定位的失败项或绕过锚点的 retry。
    record.active = false
    record.controller.abort()
    records.delete(uploadId)
    // 此处处于 plugin apply 内，通知必须延后以免 subscriber 重入 dispatch。
    scheduleNotify()
  }

  type WidgetSpec = NonNullable<Parameters<typeof Decoration.widget>[2]> & { uploadId: string }

  const plugin = new Plugin<UploadPluginState>({
    key: uploadKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty }),
      apply: (tr, value) => {
        let decorations = value.decorations
        if (tr.docChanged) {
          decorations = decorations.map(tr.mapping, tr.doc, { onRemove: onDecorationRemoved })
        }
        const meta = tr.getMeta(uploadKey) as UploadMeta | undefined
        if (meta?.kind === "add") {
          const widgetSpec: WidgetSpec = { side: 1, key: meta.uploadId, uploadId: meta.uploadId }
          decorations = decorations.add(tr.doc, [Decoration.widget(meta.pos, meta.dom, widgetSpec)])
        } else if (meta?.kind === "remove") {
          const spans = decorations.find(undefined, undefined, (spec) => (spec as { uploadId?: string }).uploadId === meta.uploadId)
          if (spans.length > 0) decorations = decorations.remove(spans)
        }
        return { decorations }
      }
    },
    props: {
      decorations: (state) => uploadKey.getState(state)?.decorations ?? null,
      handlePaste: (_view, event) => {
        if (destroyed) return false
        const files = imageFiles(event.clipboardData?.files)
        if (files.length === 0) return false
        // 图片粘贴：消费这次粘贴（阻止默认插入），只入队上传。
        const ids = enqueueAt(files, editor.state.selection.from)
        return ids.length > 0
      },
      handleDrop: (view, event, _slice, moved) => {
        if (destroyed) return false
        // 内部拖拽（view.dragging）或移动（moved）一律交给 PM，绝不重复上传造成双写；
        // moved 在按住 copy 修饰键时为 false，因此必须同时检查 view.dragging。
        if (moved || view.dragging) return false
        const files = imageFiles(event.dataTransfer?.files)
        if (files.length === 0) return false
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        // 坐标失败：不 fallback 0，放弃本次插入。
        if (!at) return false
        const ids = enqueueAt(files, at.pos)
        return ids.length > 0
      },
      handleDOMEvents: {
        drop: (view, event) => {
          if (destroyed) return false
          // 内部拖拽（含 copy 修饰键 moved=false）必须放行给 PM 重排，绝不兜底吞掉。
          if (view.dragging) return false
          if (imageFiles(event.dataTransfer?.files).length === 0) return false
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
          // 仅在坐标失败、PM 不会进入 handleDrop 时兜底阻止浏览器导航；
          // 成功路径交回 handleDrop，避免 preventDefault 使 runCustomHandler 吞掉 PM 自身 drop 处理。
          if (!at) {
            event.preventDefault()
            return true
          }
          return false
        }
      }
    }
  })
  editor.registerPlugin(plugin)

  const retry = (uploadId: string): boolean => {
    const record = records.get(uploadId)
    if (!record || !record.active || record.status === "uploading") return false
    // 超限文件不可重试：retry 必须重新校验限制，绝不因此绕过 maxFileBytes 调用宿主。
    if (options.maxFileBytes !== undefined && record.file.size > options.maxFileBytes) return false
    record.attempt += 1
    startUpload(record)
    return true
  }

  const cancel = (uploadId: string): boolean => {
    const record = records.get(uploadId)
    if (!record) return false
    record.active = false
    record.controller.abort()
    records.delete(uploadId)
    dispatchDecorationMeta({ kind: "remove", uploadId })
    notify()
    return true
  }

  const subscribe = (listener: (state: PictureUploadState) => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    for (const record of records.values()) {
      record.active = false
      record.controller.abort()
    }
    records.clear()
    listeners.clear()
    try {
      // 编辑器可能已随会话销毁；此时注销为无操作。
      editor.unregisterPlugin(uploadKey)
    } catch {
      // ignore
    }
  }

  return { enqueue, retry, cancel, getState, subscribe, destroy }
}


