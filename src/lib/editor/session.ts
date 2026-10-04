import { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { encodeHnn, decodeHnn, type HnnDocument } from "../hnn/codec"
import { createHnnEditorExtensions } from "../hnn/extensions"
import { installBlockReorder } from "./blockReorder"
import { openBlockMenu } from "./blockMenu"
import { installHostReferences, type HostReferenceInstaller } from "./hostReferences"
import { installHnnClipboardHistoryBoundary } from "./nativeClipboard"
import { installPictureUpload, type PictureUploadInstaller } from "./pictureUpload"
import type {
  EditorSessionOptions,
  EditorSessionState,
  HostCandidateProvider,
  HostReferenceActivate,
  HostReferenceResolve,
  NoteSaveResult,
  PictureUploadHandler
} from "./types"

/** 宿主引用三回调能力集合（任务 7.2）：仅会话内部配置使用，不进入 7.1 前的公开面。 */
export type HostReferenceCapability = Readonly<{
  candidates?: HostCandidateProvider
  activate?: HostReferenceActivate
  resolve?: HostReferenceResolve
}>

type Listener = () => void

type PendingSave = {
  token: symbol
  controller: AbortController
  promise: Promise<NoteSaveResult | undefined>
}

function assertValidLoadKey(loadKey: string | number): void {
  if (typeof loadKey === "number" && !Number.isFinite(loadKey)) {
    throw new TypeError("loadKey 数字必须是有限值")
  }
}

/**
 * 单次已验证装载的私有编辑会话。ProseMirror Node 是不可变持久数据结构，因此捕获的
 * 文档既可安全作为保存快照的源，也可作为保存 baseline，不会被后续 transaction 改写。
 */
export class EditorSession {
  readonly editor: Editor

  #documentId: string
  #onSave: EditorSessionOptions["onSave"]
  #onChange: EditorSessionOptions["onChange"]
  #baseline: ProseMirrorNode
  #revision: string | undefined
  #phase: EditorSessionState["status"] = "idle"
  #phaseError: unknown
  #encodingError: unknown
  #destroyed = false
  #pending: PendingSave | undefined
  #listeners = new Set<Listener>()
  #removeClipboardHistoryBoundary: (() => void) | undefined
  #removeBlockReorder: (() => void) | undefined
  #pictureUpload: PictureUploadInstaller | undefined
  // 上传 handler 独立成字段：installer 闭包运行期读取，同 key 更新 callback 时未来请求
  // 用新 handler，在途请求的 uploadId/signal 不受影响。
  #pictureUploadHandler: PictureUploadHandler | undefined
  #hostReferences: HostReferenceInstaller | undefined
  // 引用三 callback 独立成字段：candidates/resolve 经 installer 闭包运行期读取，纯
  // fn→fn（三 presence 全不变）只影响未来请求，在途候选/解析/激活全部稳定；任一
  // presence 变化保守重建 installer（activate 决定 readonly hasActivate 只是原因之一，
  // 已 settle 条目与在途请求同样绑定旧能力）。activate 只按真实能力传参，绝不伪造。
  #hostReferenceCandidates: HostCandidateProvider | undefined
  #hostReferenceActivate: HostReferenceActivate | undefined
  #hostReferenceResolve: HostReferenceResolve | undefined

  constructor(options: EditorSessionOptions) {
    // 不持有调用方 options 对象，避免构造后外部突变改变这次会话的 CAS 语义。
    const { documentId, loadKey, initialDocument, initialRevision, onSave, onChange, onPictureUpload } = options
    const { onReferenceCandidates, onReferenceActivate, onReferenceResolve } = options
    assertValidLoadKey(loadKey)
    this.#documentId = documentId
    this.#onSave = onSave
    this.#onChange = onChange
    // 必须先解码：失败时不创建 Editor，更不能创建可保存的兜底文档。
    const decodedDocument = decodeHnn(initialDocument)
    this.editor = new Editor({
      extensions: createHnnEditorExtensions(),
      // codec schema 与会话 schema 分别构造；必须用 JSON 跨 schema 重新物化 document。
      content: decodedDocument.toJSON() as unknown as Record<string, unknown>,
      enableContentCheck: true,
      // 编辑根节点只补充可访问性与样式钩子，不改变文档、selection 或保存语义。
      editorProps: {
        attributes: {
          class: "hn-editor-content",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": "笔记内容编辑区"
        }
      },
      onUpdate: () => this.#handleUpdate()
    })
    this.#removeClipboardHistoryBoundary = installHnnClipboardHistoryBoundary(this.editor)
    // 顶层块重排只挂 widget decoration 与手势监听，不改变初始文档与历史。
    // openMenu 注入块操作菜单（DESIGN.md §9/D9）：手柄点击/键盘激活打开，
    // 图片能力经闭包运行期读取 #pictureUpload——configurePictureUpload 增删
    // handler 后菜单可用性即时联动，重排插件与 editor 实例都不重建。
    this.#removeBlockReorder = installBlockReorder(this.editor, {
      openMenu: (anchor, getPos, onClosed) => {
        const handle = openBlockMenu({
          editor: this.editor,
          anchor,
          getPos,
          capabilities: {
            canUploadPicture: () => this.#pictureUpload !== undefined,
            enqueuePictures: (files, position) => this.#pictureUpload?.enqueue(files, position) ?? []
          },
          onClosed
        })
        return handle ? (restoreFocus?: boolean) => handle.close(restoreFocus) : undefined
      }
    })
    // 初始即带上传回调的会话直接安装（任务 6.7）；构造后同 key 新增/更新/移除回调由
    // configurePictureUpload 驱动。与重排的 drop 所有权互斥：重排只认领自定义 MIME 的
    // 手势 drop，上传只认领携带图片文件的外部 drop（且内部拖拽一律放行），不会双写。
    this.#pictureUploadHandler = onPictureUpload
    if (onPictureUpload) this.#installPictureUpload()
    // 宿主引用（任务 7.2）：三回调全无不安装（无任何候选/激活/解析入口与请求）；
    // 初始即有能力的会话直接安装，构造后同 key 变化由 configureHostReferences 驱动。
    this.#hostReferenceCandidates = onReferenceCandidates
    this.#hostReferenceActivate = onReferenceActivate
    this.#hostReferenceResolve = onReferenceResolve
    if (this.#hostReferenceCapable()) this.#installHostReferences()
    this.#baseline = this.editor.state.doc
    this.#revision = initialRevision
  }

  get state(): EditorSessionState {
    const error = this.#encodingError ?? (this.#phase === "error" ? this.#phaseError : undefined)
    return {
      dirty: !this.editor.state.doc.eq(this.#baseline),
      status: this.#encodingError === undefined ? this.#phase : "error",
      ...(error === undefined ? {} : { error })
    }
  }

  get revision(): string | undefined {
    return this.#revision
  }

  /**
   * 图片上传 installer（任务 6.7）。仅供 NoteEditor 内部控件消费：7.1 之前
   * EditorSession 不公开，此访问器也不构成公开 API；当前未启用上传（构造未提供
   * 或 configurePictureUpload 已移除回调）时为 undefined，控件据此不呈现上传入口。
   */
  get pictureUpload(): PictureUploadInstaller | undefined {
    return this.#pictureUpload
  }

  /** 只增安装上传插件：不动 doc/selection/history/baseline，editor 实例保持不变。 */
  #installPictureUpload(): void {
    this.#pictureUpload = installPictureUpload(this.editor, {
      upload: (file, request) => {
        // 运行期读取当前 handler 字段：同 key 更新 callback 后，只有未来 startUpload
        // 用新 handler；在途请求的 uploadId/attempt/signal 保持稳定。
        const handler = this.#pictureUploadHandler
        if (!handler) return Promise.reject(new Error("当前会话未启用图片上传"))
        return handler(file, request)
      }
    })
  }

  /**
   * 内部上传能力配置（任务 6.7）：仅 NoteEditor 在同 key 已提交 callback 变化时调用，
   * 不属于 7.1 之前的公开面。callback 不是 initial-only 输入：
   * - undefined → fn：只增安装上传插件（picker/粘贴/拖入即刻可用），不重建 editor，
   *   doc/selection/history/baseline 全部保留；
   * - fn → undefined：禁止一切新入队，abort 全部在途上传、清空上传状态并注销插件，
   *   宿主即使忽略 abort，stale 结果也在库内丢弃、绝不写入；
   * - fn1 → fn2：仅未来请求使用新 handler，在途 uploadId/signal 稳定；
   * - 移除后再次添加在同一 session 上重新安装（可重启）。
   */
  configurePictureUpload(handler: PictureUploadHandler | undefined): void {
    if (this.#destroyed) return
    if (handler === this.#pictureUploadHandler) return
    this.#pictureUploadHandler = handler
    if (!handler) {
      this.#pictureUpload?.destroy()
      this.#pictureUpload = undefined
      return
    }
    // 已有 installer：字段已更新，未来 startUpload 自然读取新 handler，无需重装。
    if (!this.#pictureUpload) this.#installPictureUpload()
  }

  /**
   * 宿主引用 installer（任务 7.2）。仅供 NoteEditor 内部控件消费：7.1 之前
   * EditorSession 不公开，此访问器也不构成公开 API；三回调全无（或已全部移除）时
   * 为 undefined，控件据此不挂载候选/激活/解析界面。
   */
  get hostReferences(): HostReferenceInstaller | undefined {
    return this.#hostReferences
  }

  /** 引用能力是否存在：三回调全无则完全不安装（无候选/激活/解析入口与任何请求）。 */
  #hostReferenceCapable(): boolean {
    return this.#hostReferenceCandidates !== undefined
      || this.#hostReferenceActivate !== undefined
      || this.#hostReferenceResolve !== undefined
  }

  /**
   * 只增安装引用核心：不重建 editor，不动 doc/selection/history/baseline。
   * candidates/resolve 经闭包运行期读字段（缺省受控 empty/missing，与核心无回调语义
   * 一致）；activate 只按真实能力传参——有真实回调才传该键（hasActivate 才为 true），
   * 绝不传恒真 wrapper 伪造链接语义。documentId 取会话构造时捕获值，与当前可能已
   * 失效的宿主 props 无关。
   */
  #installHostReferences(): void {
    const activate = this.#hostReferenceActivate
    this.#hostReferences = installHostReferences(this.editor, {
      documentId: this.#documentId,
      candidates: (kind, query, context) => this.#hostReferenceCandidates?.(kind, query, context) ?? [],
      resolve: (reference, context) => this.#hostReferenceResolve?.(reference, context) ?? null,
      ...(activate === undefined
        ? {}
        : { activate: (reference, context) => this.#hostReferenceActivate?.(reference, context) })
    })
  }

  /**
   * 内部宿主引用能力配置（任务 7.2）：仅 NoteEditor 在同 key 已提交 callback 变化时
   * 调用，不属于 7.1 之前的公开面。callback 不是 initial-only 输入：
   * - 全无 → 任一：只增安装（候选触发/解析/激活即刻可用），不重建 editor，
   *   doc/selection/history/baseline 全部保留；
   * - 任一 → 全无：abort 全部在途候选/解析/激活并注销，宿主即使忽略 abort，stale
   *   结果也在核心内丢弃、绝不写入；
   * - 纯 fn → fn（candidates/activate/resolve 三个 presence 全部不变）：仅未来请求
   *   使用新 handler，在途候选/解析/激活全部稳定，installer 不重建、不打断；
   * - 任一 presence 变化（含 candidates/resolve 单独增删）：保守重建 installer，
   *   abort 全部在途请求并重新扫描合法 doc。原因不止 activate 决定 install 期捕获的
   *   readonly hasActivate：已 settle 的 missing/resolved 条目与在途请求都绑定旧
   *   能力——不重建则 resolve none→fn 时既有引用永久 missing、fn→none 时旧 pending
   *   仍落地 resolved，candidates fn→none 时旧 pending 仍可 ready/插入。重建后
   *   闭包 wrapper 按新字段受控 empty/missing 或调新回调，既有引用即刻按新能力
   *   重新解析/呈现；文档内容、selection、history、baseline 均不受影响。
   */
  configureHostReferences(options: HostReferenceCapability): void {
    if (this.#destroyed) return
    // 先捕获三回调各自的 presence：这是比 fn 身份更强的语义边界。
    const hadCandidates = this.#hostReferenceCandidates !== undefined
    const hadActivate = this.#hostReferenceActivate !== undefined
    const hadResolve = this.#hostReferenceResolve !== undefined
    this.#hostReferenceCandidates = options.candidates
    this.#hostReferenceActivate = options.activate
    this.#hostReferenceResolve = options.resolve
    if (!this.#hostReferenceCapable()) {
      this.#hostReferences?.destroy()
      this.#hostReferences = undefined
      return
    }
    if (!this.#hostReferences) {
      this.#installHostReferences()
      return
    }
    // 三个 presence 全部不变的纯 fn→fn：字段已更新，未来请求自然走新 handler，
    // installer 不重建、在途请求全部稳定。
    const presenceUnchanged =
      hadCandidates === (this.#hostReferenceCandidates !== undefined) &&
      hadActivate === (this.#hostReferenceActivate !== undefined) &&
      hadResolve === (this.#hostReferenceResolve !== undefined)
    if (presenceUnchanged) return
    // 任一 presence 变化：保守重建（abort 在途 + install 时重扫合法 doc）。
    this.#hostReferences.destroy()
    this.#installHostReferences()
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  undo(): boolean {
    return this.editor.commands.undo()
  }

  redo(): boolean {
    return this.editor.commands.redo()
  }

  save(): Promise<NoteSaveResult | undefined> {
    if (this.#pending) return this.#pending.promise
    if (this.#destroyed) return Promise.resolve(undefined)
    if (!this.#onSave) {
      this.#phase = "error"
      this.#phaseError = new Error("未提供 onSave，不能保存文档")
      this.#notify()
      return Promise.resolve(undefined)
    }

    const document = this.editor.state.doc
    let snapshot: HnnDocument
    try {
      snapshot = encodeHnn(document)
    } catch (error) {
      this.#setEncodingError(error)
      return Promise.resolve(undefined)
    }
    const controller = new AbortController()
    const operationToken = Symbol("editor-save")
    const context = {
      documentId: this.#documentId,
      signal: controller.signal,
      ...(this.#revision === undefined ? {} : { baseRevision: this.#revision })
    }

    const pending: PendingSave = {
      token: operationToken,
      controller,
      promise: Promise.resolve(undefined)
    }
    this.#pending = pending
    this.#phase = "saving"
    this.#phaseError = undefined
    this.#notify()
    // 必须先登记 token：宿主回调可同步抛错，且该错误仍须属于当前会话的保存失败。
    const promise = this.#runSave(pending, snapshot, document, context)
    pending.promise = promise
    return promise
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#pending?.controller.abort()
    // 先 abort 全部在途上传并注销上传插件：宿主即使忽略 abort，陈旧结果也由
    // installer 在库内丢弃，绝不写入后续会话（D8 切换中止策略与保存一致）。
    this.#pictureUpload?.destroy()
    // 同样先 abort 全部在途候选/解析/激活并注销引用核心：stale 结果在核心内丢弃，
    // 绝不回写后续会话（D11 切换中止策略与保存/上传一致）。
    this.#hostReferences?.destroy()
    this.#listeners.clear()
    this.#removeClipboardHistoryBoundary?.()
    // 先取消进行中的拖拽手势与 document 监听，再销毁视图。
    this.#removeBlockReorder?.()
    this.editor.destroy()
  }

  #handleUpdate(): void {
    if (this.#destroyed) return
    let snapshot: HnnDocument
    try {
      snapshot = encodeHnn(this.editor.state.doc)
    } catch (error) {
      this.#setEncodingError(error)
      return
    }
    // 编码恢复只清除编码错误，绝不吞掉在途保存、冲突或宿主保存失败的底层 phase。
    this.#encodingError = undefined
    try {
      this.#onChange?.(snapshot)
    } catch {
      // 宿主通知失败不得中断 ProseMirror dispatch 或破坏会话状态。
    }
    this.#notify()
  }

  async #runSave(
    pending: PendingSave,
    snapshot: HnnDocument,
    document: ProseMirrorNode,
    context: { documentId: string; baseRevision?: string; signal: AbortSignal }
  ): Promise<NoteSaveResult | undefined> {
    try {
      const result = await this.#onSave!(snapshot, context)
      if (!this.#isCurrent(pending)) return undefined
      this.#pending = undefined
      if (result.kind === "saved") {
        // 只能使用这次请求捕获的文档，不能误把保存期间的新编辑标为已保存。
        this.#baseline = document
        this.#revision = result.revision
        this.#phase = "idle"
        this.#phaseError = undefined
      } else {
        // 冲突绝不改变 doc、baseline、selection 或 history。
        this.#phase = "conflict"
      }
      this.#notify()
      return result
    } catch (error) {
      if (!this.#isCurrent(pending)) return undefined
      this.#pending = undefined
      this.#phase = "error"
      this.#phaseError = error
      this.#notify()
      return undefined
    } finally {
      if (this.#isCurrent(pending)) this.#pending = undefined
    }
  }

  #isCurrent(pending: PendingSave): boolean {
    return !this.#destroyed && this.#pending?.token === pending.token
  }

  #setEncodingError(error: unknown): void {
    this.#encodingError = error
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

export function createEditorSession(options: EditorSessionOptions): EditorSession {
  return new EditorSession(options)
}
