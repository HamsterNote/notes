import { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { encodeHnn, decodeHnn, type HnnDocument } from "../hnn/codec"
import { createHnnEditorExtensions } from "../hnn/extensions"
import type { EditorSessionOptions, EditorSessionState, NoteSaveResult } from "./types"

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

  constructor(options: EditorSessionOptions) {
    // 不持有调用方 options 对象，避免构造后外部突变改变这次会话的 CAS 语义。
    const { documentId, loadKey, initialDocument, initialRevision, onSave, onChange } = options
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
      onUpdate: () => this.#handleUpdate()
    })
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
    this.#listeners.clear()
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
