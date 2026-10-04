// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { encodeHnn, type HnnDocument } from "../hnn/codec"
import { exportMarkdown } from "../hnn/markdown"
import { NoteEditor } from "./NoteEditor"
import { EditorSession } from "./session"
import type {
  EditorSessionOptions,
  NoteSave,
  PictureUploadHandler,
  PictureUploadRequest,
  PictureUploadResult
} from "./types"
import type { MarkdownExportProps } from "./MarkdownExport"

/**
 * 6.7 / 7.3 / 7.6 编辑器最终接线的集成测试：全部经由内部 NoteEditor 真实渲染，
 * 会话为真实 EditorSession（仅包装记录创建序列），断言控件只消费 session 暴露的
 * 权威状态、回调契约与切换隔离语义。
 */
const createdSessions = vi.hoisted(() => [] as EditorSession[])
const createdOptions = vi.hoisted(() => [] as EditorSessionOptions[])

vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>()
  return {
    ...actual,
    createEditorSession(options: EditorSessionOptions) {
      createdOptions.push(options)
      const session = actual.createEditorSession(options)
      createdSessions.push(session)
      return session
    }
  }
})

// Drawer/诊断面板以 portal 渲染进 document.body；显式清理避免跨用例残留。
afterEach(() => cleanup())

const ids = {
  a: "123e4567-e89b-42d3-a456-426614174000",
  b: "123e4567-e89b-42d3-a456-426614174001",
  c: "123e4567-e89b-42d3-a456-426614174002"
}

function paragraphsDocument(...texts: string[]): HnnDocument {
  const nodeIds = [ids.a, ids.b, ids.c]
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: texts.map((text, index) => ({
        type: "paragraph",
        attrs: { nodeId: nodeIds[index] },
        content: [{ type: "text", text }]
      }))
    }
  }
}

/** codeBlock 使用保留围栏名 math：Markdown 导出必走降级并产生诊断（7.6 确认路径）。 */
function degradedDocument(text: string): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { nodeId: ids.a, language: "math", filename: "untitled" },
          content: [{ type: "text", text }]
        }
      ]
    }
  }
}

function imageFile(name = "photo.png", type = "image/png"): File {
  return new File([new Uint8Array(4)], name, { type })
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function latestSession(): EditorSession {
  const session = createdSessions.at(-1)
  if (!session) throw new Error("会话未创建")
  return session
}

/** 上传进度列表（控件侧）；占位 decoration 与列表文案刻意分开断言，避免双匹配。 */
function uploadList(container: HTMLElement): HTMLElement {
  const list = container.querySelector(".hn-editor-uploads__list")
  if (!list) throw new Error("上传列表未渲染")
  return list as HTMLElement
}

function placeholderCount(container: HTMLElement): number {
  return container.querySelectorAll(".hn-editor-picture-upload").length
}

function replaceText(session: EditorSession, text: string): void {
  const { state, view } = session.editor
  view.dispatch(state.tr.insertText(text, 1, state.doc.content.size - 1))
}

function dropEventWithFiles(files: File[], clientX = 10, clientY = 10): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: { files, items: [], types: ["Files"], getData: () => "", dropEffect: "none", effectAllowed: "all" }
  })
  Object.defineProperty(event, "clientX", { value: clientX })
  Object.defineProperty(event, "clientY", { value: clientY })
  return event
}

function pasteEventWithFiles(files: File[]): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      types: ["Files"],
      getData: () => ""
    }
  })
  return event
}

/** 6.5 桌面拖拽事件 stub：与 blockReorder.test.ts 同一 jsdom 范式。 */
function reorderDataTransfer() {
  const store = new Map<string, string>()
  return {
    types: [] as string[],
    setData(type: string, value: string) {
      store.set(type, value)
      if (!this.types.includes(type)) this.types.push(type)
    },
    getData: (type: string) => store.get(type) ?? "",
    setDragImage: () => undefined,
    effectAllowed: "all",
    dropEffect: "move",
    files: [] as File[]
  }
}

function dragEvent(type: string, init: { dataTransfer?: unknown; clientY?: number } = {}): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX: 0, clientY: init.clientY ?? 0, dataTransfer: init.dataTransfer })
  return event
}

type RenderProps = Partial<Parameters<typeof NoteEditor>[0]>

function renderEditor(overrides: RenderProps = {}) {
  const props: Parameters<typeof NoteEditor>[0] = {
    documentId: "A",
    loadKey: "v1",
    initialDocument: paragraphsDocument("hello"),
    ...overrides
  }
  return { ...render(<NoteEditor {...props} />), props }
}

beforeEach(() => {
  createdSessions.splice(0)
  createdOptions.splice(0)
})

describe("7.3 保存状态接线", () => {
  it("初始已保存；编辑后显脏；点击保存以真实 CAS context 调用 onSave，成功后回到已保存", async () => {
    const savedSnapshots: HnnDocument[] = []
    const contexts: Array<{ documentId: string; baseRevision?: string }> = []
    const pending = deferred<{ kind: "saved"; revision?: string }>()
    const onSave: NoteSave = (snapshot, context) => {
      savedSnapshots.push(snapshot)
      contexts.push({ documentId: context.documentId, ...(context.baseRevision === undefined ? {} : { baseRevision: context.baseRevision }) })
      return pending.promise
    }
    const view = renderEditor({ onSave, initialRevision: "r1" })
    try {
      expect(within(view.container).getByText("已保存")).toBeDefined()

      replaceText(latestSession(), "draft")
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())

      fireEvent.click(within(view.container).getByText("保存"))
      await waitFor(() => expect(within(view.container).getByText("正在保存…")).toBeDefined())
      expect(savedSnapshots).toHaveLength(1)
      // 快照是 HNN（默认保存永远是 HNN），CAS context 携带 documentId 与 baseRevision。
      expect(savedSnapshots[0]?.schemaVersion).toBe(1)
      expect(JSON.stringify(savedSnapshots[0])).toContain("draft")
      expect(contexts[0]).toEqual({ documentId: "A", baseRevision: "r1" })

      pending.resolve({ kind: "saved", revision: "r2" })
      await waitFor(() => expect(within(view.container).getByText("已保存")).toBeDefined())
    } finally {
      view.unmount()
    }
  })

  it("保存期间持续编辑：成功后仍按真实 baseline 显示未保存修改", async () => {
    const pending = deferred<{ kind: "saved" }>()
    const view = renderEditor({ onSave: () => pending.promise })
    try {
      const session = latestSession()
      replaceText(session, "one")
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())

      fireEvent.click(within(view.container).getByText("保存"))
      await waitFor(() => expect(within(view.container).getByText("正在保存…")).toBeDefined())
      // 保存中继续编辑：当次 baseline 是保存触发时捕获的 doc，新编辑必须仍为脏。
      replaceText(session, "two")
      pending.resolve({ kind: "saved" })
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())
      expect(session.state.dirty).toBe(true)
    } finally {
      view.unmount()
    }
  })

  it("保存单飞：saving 中按钮禁用，onSave 只收到一次调用", async () => {
    const pending = deferred<{ kind: "saved" }>()
    const onSave = vi.fn(() => pending.promise)
    const view = renderEditor({ onSave })
    try {
      replaceText(latestSession(), "draft")
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())
      fireEvent.click(within(view.container).getByText("保存"))
      await waitFor(() => expect(within(view.container).getByText("保存中…")).toBeDefined())
      const busyButton = within(view.container).getByText("保存中…")
      expect(busyButton).toHaveProperty("disabled", true)
      fireEvent.click(busyButton)
      expect(onSave).toHaveBeenCalledTimes(1)
      pending.resolve({ kind: "saved" })
      await waitFor(() => expect(within(view.container).getByText("已保存")).toBeDefined())
    } finally {
      view.unmount()
    }
  })

  it("reject（含 reject(undefined)）呈现保存失败而非已保存，可显式重试", async () => {
    let attempt = 0
    const attempts: Array<ReturnType<typeof deferred<{ kind: "saved" }>>> = []
    const onSave = vi.fn(() => {
      attempt += 1
      const next = deferred<{ kind: "saved" }>()
      attempts.push(next)
      return next.promise
    })
    const view = renderEditor({ onSave })
    try {
      replaceText(latestSession(), "draft")
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())

      fireEvent.click(within(view.container).getByText("保存"))
      attempts[0]!.reject(undefined)
      await waitFor(() => expect(within(view.container).getByText(/保存失败/)).toBeDefined())
      // 失败绝不呈现为已保存。
      expect(within(view.container).queryByText("已保存")).toBeNull()
      expect(attempt).toBe(1)

      fireEvent.click(within(view.container).getByText("重试保存"))
      await waitFor(() => expect(within(view.container).getByText("正在保存…")).toBeDefined())
      expect(attempt).toBe(2)
      attempts[1]!.resolve({ kind: "saved" })
      await waitFor(() => expect(within(view.container).getByText("已保存")).toBeDefined())
    } finally {
      view.unmount()
    }
  })

  it("conflict 结果呈现冲突而非已保存，文档保持本地修改", async () => {
    const pending = deferred<{ kind: "conflict" }>()
    const view = renderEditor({ onSave: () => pending.promise })
    try {
      const session = latestSession()
      replaceText(session, "local edits")
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())
      fireEvent.click(within(view.container).getByText("保存"))
      pending.resolve({ kind: "conflict" })
      await waitFor(() => expect(within(view.container).getByText(/检测到保存冲突/)).toBeDefined())
      expect(within(view.container).queryByText("已保存")).toBeNull()
      expect(session.editor.getText()).toBe("local edits")
    } finally {
      view.unmount()
    }
  })

  it("切换会话隔离：A 的在途保存陈旧 settle 不回写 B，B 呈现自己的已保存", async () => {
    const pendingA = deferred<{ kind: "saved" }>()
    const onSaveA = vi.fn(() => pendingA.promise)
    const view = render(
      <NoteEditor documentId="A" loadKey="v1" initialDocument={paragraphsDocument("A text")} onSave={onSaveA} />
    )
    try {
      const sessionA = latestSession()
      replaceText(sessionA, "A draft")
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())
      fireEvent.click(within(view.container).getByText("保存"))
      await waitFor(() => expect(within(view.container).getByText("正在保存…")).toBeDefined())

      view.rerender(<NoteEditor documentId="B" loadKey="v1" initialDocument={paragraphsDocument("B text")} />)
      const sessionB = latestSession()
      expect(sessionB).not.toBe(sessionA)
      await waitFor(() => expect(within(view.container).getByText("已保存")).toBeDefined())
      expect(within(view.container).queryByText(/正在保存/)).toBeNull()

      // A 的保存迟到 settle：旧会话已销毁，结果在库内丢弃，B 的呈现与文档不受影响。
      pendingA.resolve({ kind: "saved" })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(within(view.container).getByText("已保存")).toBeDefined()
      expect(sessionB.editor.getText()).toBe("B text")
      expect(sessionB.state.dirty).toBe(false)
    } finally {
      view.unmount()
    }
  })
})

describe("6.7 图片上传接线", () => {
  it("未提供 onPictureUpload：不呈现 picker 与 file input（保持无上传入口语义）", () => {
    const view = renderEditor()
    try {
      expect(within(view.container).queryByText("插入图片")).toBeNull()
      expect(view.container.querySelector("input[type='file']")).toBeNull()
      expect(latestSession().pictureUpload).toBeUndefined()
    } finally {
      view.unmount()
    }
  })

  it("显式 picker：accept=image/* multiple；选择文件后以上传契约调用宿主并成功写入 picture", async () => {
    const pending = deferred<PictureUploadResult>()
    const upload = vi.fn<PictureUploadHandler>(() => pending.promise)
    const view = renderEditor({ onPictureUpload: upload })
    try {
      const input = view.container.querySelector("input[type='file']") as HTMLInputElement
      expect(input).not.toBeNull()
      expect(input.getAttribute("accept")).toBe("image/*")
      expect(input.multiple).toBe(true)

      fireEvent.click(within(view.container).getByText("插入图片"))
      fireEvent.change(input, { target: { files: [imageFile()] } })
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
      const [file, request] = upload.mock.calls[0] as unknown as [File, PictureUploadRequest]
      expect(file.name).toBe("photo.png")
      expect(request.attempt).toBe(1)
      expect(request.signal).toBeInstanceOf(AbortSignal)
      await waitFor(() => expect(within(uploadList(view.container)).getByText(/第 1 次尝试/)).toBeDefined())

      // 上传中快照不含任何占位痕迹（uploadId/文件名只存在于内存桥）。
      const during = JSON.stringify(encodeHnn(latestSession().editor.state.doc))
      expect(during).not.toContain(request.uploadId)
      expect(during).not.toContain("photo.png")

      pending.resolve({ src: "https://example.com/a.png", alt: "示意" })
      await waitFor(() => {
        const serialized = JSON.stringify(encodeHnn(latestSession().editor.state.doc))
        expect(serialized).toContain("https://example.com/a.png")
      })
      // 成功恰一个 picture 节点、uploadId 不进 HNN、占位与上传列表都清空。
      const snapshot = encodeHnn(latestSession().editor.state.doc)
      expect(JSON.stringify(snapshot)).not.toContain(request.uploadId)
      expect(view.container.querySelector(".hn-editor-uploads__list")).toBeNull()
      expect(placeholderCount(view.container)).toBe(0)
      expect(latestSession().state.dirty).toBe(true)
    } finally {
      view.unmount()
    }
  })

  it("失败可重试（同 uploadId、attempt 递增）并可取消；resolve(undefined) 也按失败处理", async () => {
    const attempts: Array<ReturnType<typeof deferred<PictureUploadResult>>> = []
    const upload = vi.fn<PictureUploadHandler>(() => {
      const next = deferred<PictureUploadResult>()
      attempts.push(next)
      return next.promise
    })
    const view = renderEditor({ onPictureUpload: upload })
    try {
      const input = view.container.querySelector("input[type='file']") as HTMLInputElement
      fireEvent.change(input, { target: { files: [imageFile()] } })
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
      const firstRequest = (upload.mock.calls[0] as unknown as [File, PictureUploadRequest])[1]

      // 宿主 resolve(undefined)：不呈成功，落为失败。
      attempts[0]!.resolve(undefined as unknown as PictureUploadResult)
      await waitFor(() => expect(within(uploadList(view.container)).getByText(/上传失败/)).toBeDefined())
      expect(JSON.stringify(encodeHnn(latestSession().editor.state.doc))).not.toContain("picture")

      fireEvent.click(within(uploadList(view.container)).getByLabelText("重试上传 photo.png"))
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
      const secondRequest = (upload.mock.calls[1] as unknown as [File, PictureUploadRequest])[1]
      expect(secondRequest.uploadId).toBe(firstRequest.uploadId)
      expect(secondRequest.attempt).toBe(2)

      attempts[1]!.reject(new Error("网络错误"))
      await waitFor(() => expect(within(uploadList(view.container)).getByText(/上传失败/)).toBeDefined())
      expect(within(uploadList(view.container)).getByText(/网络错误/)).toBeDefined()
      fireEvent.click(within(uploadList(view.container)).getByLabelText("取消上传 photo.png"))
      // 取消后列表与占位整体清空，picture 始终未写入。
      await waitFor(() => expect(view.container.querySelector(".hn-editor-uploads__list")).toBeNull())
      expect(placeholderCount(view.container)).toBe(0)
      expect(latestSession().pictureUpload?.getState().items).toEqual([])
    } finally {
      view.unmount()
    }
  })

  it("粘贴图片文件入队上传；Markdown/HNN 等非图片文件一律不入队", async () => {
    const upload = vi.fn<PictureUploadHandler>(() => deferred<PictureUploadResult>().promise)
    const view = renderEditor({ onPictureUpload: upload })
    try {
      const editable = view.container.querySelector(".tiptap") as HTMLElement
      fireEvent(editable, pasteEventWithFiles([imageFile("pasted.png")]))
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))

      fireEvent(editable, pasteEventWithFiles([
        new File(["# t"], "note.md", { type: "text/markdown" }),
        new File(["{}"], "note.hnn", { type: "application/json" })
      ]))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(upload).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
    }
  })

  it("图片文件 drop 只入队一次且不改动文档；Markdown/HNN drop 不入队", async () => {
    const upload = vi.fn<PictureUploadHandler>(() => deferred<PictureUploadResult>().promise)
    const view = renderEditor({ initialDocument: paragraphsDocument("a", "b"), onPictureUpload: upload })
    try {
      const session = latestSession()
      session.editor.view.posAtCoords = vi.fn(() => ({ pos: 2, inside: -1 }))
      const before = JSON.stringify(encodeHnn(session.editor.state.doc))

      const editable = view.container.querySelector(".tiptap") as HTMLElement
      editable.dispatchEvent(dropEventWithFiles([imageFile("dropped.png")]))
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
      // 占位是 decoration：文档本身零改动（无 PM 原生插入、无重排双写）。
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).toBe(before)
      expect(within(uploadList(view.container)).getByText(/第 1 次尝试/)).toBeDefined()

      editable.dispatchEvent(dropEventWithFiles([
        new File(["# t"], "note.md", { type: "text/markdown" }),
        new File(["{}"], "note.hnn", { type: "application/json" })
      ]))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(upload).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).toBe(before)
    } finally {
      view.unmount()
    }
  })

  it("6.5 重排手势 drop 不触发上传，上传 drop 不触发重排：drop 所有权互斥", async () => {
    const upload = vi.fn<PictureUploadHandler>(() => deferred<PictureUploadResult>().promise)
    // 块矩形存到测试局部 Map：避免给 spy 挂载自定义属性（类型安全）。
    const blockRects = new Map<Element, { top: number; bottom: number }>()
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const rect = blockRects.get(this)
        return {
          top: rect?.top ?? 0,
          bottom: rect?.bottom ?? 0,
          left: 0,
          right: 100,
          width: 100,
          height: (rect?.bottom ?? 0) - (rect?.top ?? 0),
          x: 0,
          y: rect?.top ?? 0,
          toJSON: () => ({})
        }
      })
    const view = renderEditor({ initialDocument: paragraphsDocument("a", "b"), onPictureUpload: upload })
    try {
      const session = latestSession()
      const editable = view.container.querySelector(".tiptap") as HTMLElement
      const blocks = [...editable.children].filter((el) => !el.hasAttribute("data-drag-handle"))
      blockRects.set(blocks[0]!, { top: 0, bottom: 100 })
      blockRects.set(blocks[1]!, { top: 100, bottom: 200 })

      // 完整 6.5 桌面手势：dragstart(handle a) → dragover(b 下半) → drop(b)。
      const handles = editable.querySelectorAll("[data-drag-handle]")
      const dataTransfer = reorderDataTransfer()
      handles[0]!.dispatchEvent(dragEvent("dragstart", { dataTransfer }))
      blocks[1]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 160 }))
      blocks[1]!.dispatchEvent(dragEvent("drop", { dataTransfer, clientY: 160 }))

      // 重排提交、上传零调用：6.5 独占它的 MIME drop。
      const order = [...session.editor.state.doc.children].map((child) => child.textContent)
      expect(order).toEqual(["b", "a"])
      expect(upload).not.toHaveBeenCalled()

      // 反向：图片 drop 只走上传，不产生第二次重排。
      session.editor.view.posAtCoords = vi.fn(() => ({ pos: 2, inside: -1 }))
      editable.dispatchEvent(dropEventWithFiles([imageFile()]))
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
      const orderAfter = [...session.editor.state.doc.children].map((child) => child.textContent)
      expect(orderAfter).toEqual(["b", "a"])
    } finally {
      view.unmount()
      rectSpy.mockRestore()
    }
  })

  it("切换会话中止在途上传：signal aborted，陈旧结果绝不写入新会话", async () => {
    const pendingA = deferred<PictureUploadResult>()
    const uploadA = vi.fn<PictureUploadHandler>(() => pendingA.promise)
    const view = render(
      <NoteEditor documentId="A" loadKey="v1" initialDocument={paragraphsDocument("A")} onPictureUpload={uploadA} />
    )
    try {
      const sessionA = latestSession()
      const input = view.container.querySelector("input[type='file']") as HTMLInputElement
      fireEvent.change(input, { target: { files: [imageFile()] } })
      await waitFor(() => expect(uploadA).toHaveBeenCalledTimes(1))
      const request = (uploadA.mock.calls[0] as unknown as [File, PictureUploadRequest])[1]

      view.rerender(<NoteEditor documentId="B" loadKey="v1" initialDocument={paragraphsDocument("B")} />)
      const sessionB = latestSession()
      expect(sessionB).not.toBe(sessionA)
      expect(request.signal.aborted).toBe(true)

      pendingA.resolve({ src: "https://example.com/stale.png" })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(JSON.stringify(encodeHnn(sessionB.editor.state.doc))).not.toContain("stale.png")
      expect(sessionB.editor.getText()).toBe("B")
      expect(within(view.container).queryByText(/上传中/)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it("同 key 更新上传 callback：不重建会话，未来请求用新 handler", async () => {
    const uploadFirst = vi.fn<PictureUploadHandler>(() => deferred<PictureUploadResult>().promise)
    const uploadSecond = vi.fn<PictureUploadHandler>(() => deferred<PictureUploadResult>().promise)
    const props = { documentId: "A", loadKey: "v1", initialDocument: paragraphsDocument("x") }
    const view = render(<NoteEditor {...props} onPictureUpload={uploadFirst} />)
    try {
      // 同 key 换 callback：会话不重建，运行期调用读取最新已提交 callback。
      view.rerender(<NoteEditor {...props} onPictureUpload={uploadSecond} />)
      expect(createdSessions).toHaveLength(1)
      const input = view.container.querySelector("input[type='file']") as HTMLInputElement
      fireEvent.change(input, { target: { files: [imageFile()] } })
      await waitFor(() => expect(uploadSecond).toHaveBeenCalledTimes(1))
      expect(uploadFirst).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it("同 key 新增上传 callback 立即启用：editor/doc/历史/baseline 不动；移除即 abort 清理，同 session 可重启", async () => {
    const upload = vi.fn<PictureUploadHandler>(() => deferred<PictureUploadResult>().promise)
    const props = { documentId: "B", loadKey: "v1", initialDocument: paragraphsDocument("y") }
    const view = render(<NoteEditor {...props} />)
    try {
      const session = latestSession()
      expect(view.container.querySelector("input[type='file']")).toBeNull()
      replaceText(session, "draft")
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())

      // 新增 callback：picker 即刻可用，且会话/editor/文档/历史/baseline 全部保留。
      view.rerender(<NoteEditor {...props} onPictureUpload={upload} />)
      await waitFor(() => expect(within(view.container).getByText("插入图片")).toBeDefined())
      expect(createdSessions).toHaveLength(1)
      expect(latestSession()).toBe(session)
      expect(session.editor.getText()).toBe("draft")
      expect(session.state.dirty).toBe(true)

      // 入队一个 pending 上传后移除 callback：入口与列表消失、在途 abort、stale 不写。
      const pendingUpload = deferred<PictureUploadResult>()
      upload.mockImplementation(() => pendingUpload.promise)
      const input = view.container.querySelector("input[type='file']") as HTMLInputElement
      fireEvent.change(input, { target: { files: [imageFile()] } })
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
      const request = (upload.mock.calls[0] as unknown as [File, PictureUploadRequest])[1]

      view.rerender(<NoteEditor {...props} />)
      await waitFor(() => expect(within(view.container).queryByText("插入图片")).toBeNull())
      expect(view.container.querySelector(".hn-editor-uploads__list")).toBeNull()
      expect(placeholderCount(view.container)).toBe(0)
      expect(request.signal.aborted).toBe(true)
      expect(createdSessions).toHaveLength(1)
      pendingUpload.resolve({ src: "https://example.com/stale.png" })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).not.toContain("stale.png")

      // doc/历史/baseline 全程未动：一步 undo 回到初始文本并回到非脏。
      expect(session.editor.getText()).toBe("draft")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("y")
      expect(session.state.dirty).toBe(false)

      // 再添加：同一 session 重启上传能力。
      view.rerender(<NoteEditor {...props} onPictureUpload={upload} />)
      await waitFor(() => expect(within(view.container).getByText("插入图片")).toBeDefined())
      expect(createdSessions).toHaveLength(1)
      const input2 = view.container.querySelector("input[type='file']") as HTMLInputElement
      fireEvent.change(input2, { target: { files: [imageFile("again.png")] } })
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    } finally {
      view.unmount()
    }
  })

  it("失败项在 callback 移除时受控清理：retry 入口消失，不再触达宿主", async () => {
    const pending = deferred<PictureUploadResult>()
    const upload = vi.fn<PictureUploadHandler>(() => pending.promise)
    const props = { documentId: "C", loadKey: "v1", initialDocument: paragraphsDocument("z") }
    const view = render(<NoteEditor {...props} onPictureUpload={upload} />)
    try {
      const input = view.container.querySelector("input[type='file']") as HTMLInputElement
      fireEvent.change(input, { target: { files: [imageFile()] } })
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
      pending.reject(new Error("网络错误"))
      await waitFor(() => expect(within(uploadList(view.container)).getByText(/上传失败/)).toBeDefined())

      view.rerender(<NoteEditor {...props} />)
      await waitFor(() => expect(view.container.querySelector(".hn-editor-uploads__list")).toBeNull())
      expect(within(view.container).queryByText("插入图片")).toBeNull()
      expect(within(view.container).queryByLabelText(/重试上传/)).toBeNull()
      expect(upload).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
    }
  })

  it("无效新 key 保留旧 session 与旧上传 callback：候选 callback 不被调用", async () => {
    const uploadA = vi.fn<PictureUploadHandler>(() => deferred<PictureUploadResult>().promise)
    const uploadB = vi.fn<PictureUploadHandler>(() => deferred<PictureUploadResult>().promise)
    const errors: string[] = []
    const view = render(
      <NoteEditor documentId="A" loadKey="v1" initialDocument={paragraphsDocument("A")} onPictureUpload={uploadA} />
    )
    try {
      const sessionA = latestSession()
      view.rerender(
        <NoteEditor
          documentId="B"
          loadKey="v1"
          initialDocument={{ schemaVersion: 1, data: { type: "doc", content: [{ type: "unknown" }] } }}
          onPictureUpload={uploadB}
          onInitialLoadError={(_error, context) => errors.push(context.documentId)}
        />
      )
      expect(errors).toEqual(["B"])
      expect(latestSession()).toBe(sessionA)

      const input = view.container.querySelector("input[type='file']") as HTMLInputElement
      fireEvent.change(input, { target: { files: [imageFile()] } })
      await waitFor(() => expect(uploadA).toHaveBeenCalledTimes(1))
      expect(uploadB).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
})

describe("7.6 Markdown 导出接线", () => {
  it("未提供 onExportMarkdown 不呈现导出入口；默认保存仍只有 HNN", () => {
    const view = renderEditor()
    try {
      expect(within(view.container).queryByText("导出 Markdown")).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it("无诊断文档：显式点击直接写出当次快照，文档/baseline 不受影响", async () => {
    const exported: string[] = []
    const pending = deferred<void>()
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>((result) => {
      exported.push(result.markdown)
      return pending.promise
    })
    const view = renderEditor({ onExportMarkdown: onExport })
    try {
      const session = latestSession()
      const before = JSON.stringify(encodeHnn(session.editor.state.doc))
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      expect(onExport).toHaveBeenCalledTimes(1)
      expect(exported[0]).toContain("hello")
      await waitFor(() => expect(within(view.container).getByText("正在导出…")).toBeDefined())
      pending.resolve()
      await waitFor(() => expect(within(view.container).getByText("导出完成")).toBeDefined())
      // 导出不触碰文档与保存 baseline。
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).toBe(before)
      expect(session.state.dirty).toBe(false)
      expect(within(view.container).getByText("已保存")).toBeDefined()
    } finally {
      view.unmount()
    }
  })

  it("有诊断时等待确认：取消零回调且既有内容/baseline/history 不变", async () => {
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>()
    const view = renderEditor({ initialDocument: degradedDocument("不是公式"), onExportMarkdown: onExport })
    try {
      const session = latestSession()
      const before = JSON.stringify(encodeHnn(session.editor.state.doc))
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      // 诊断 Drawer 打开（portal 在 body），未确认前绝不调用 onExport。
      const dialog = await within(document.body).findByRole("dialog")
      expect(onExport).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByText("取消"))
      await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull())
      expect(onExport).not.toHaveBeenCalled()
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).toBe(before)
      expect(session.state.dirty).toBe(false)
      expect(session.undo()).toBe(false)
    } finally {
      view.unmount()
    }
  })

  it("确认写出的始终是点击时诊断的那份结果：等待期间的编辑不混入", async () => {
    const exported: string[] = []
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>((result) => {
      exported.push(result.markdown)
    })
    const view = renderEditor({ initialDocument: degradedDocument("原始"), onExportMarkdown: onExport })
    try {
      const session = latestSession()
      // 降级导出是 b64 围栏（不含可读文本），用 codec 期望快照比对身份。
      const expectedAtClick = exportMarkdown(encodeHnn(session.editor.state.doc)).markdown
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      const dialog = await within(document.body).findByRole("dialog")
      // Drawer 打开期间继续编辑：确认导出的仍是点击时捕获并诊断的结果。
      replaceText(session, "后加的编辑")
      const expectedAfterEdit = exportMarkdown(encodeHnn(session.editor.state.doc)).markdown
      expect(expectedAfterEdit).not.toBe(expectedAtClick)
      fireEvent.click(within(dialog).getByText("确认导出"))
      await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
      expect(exported[0]).toBe(expectedAtClick)
      expect(exported[0]).not.toBe(expectedAfterEdit)
      // 编辑本身仍是正常未保存修改。
      expect(session.state.dirty).toBe(true)
    } finally {
      view.unmount()
    }
  })

  it("reject（含 reject(undefined)）呈现导出失败而非完成", async () => {
    const pending = deferred<void>()
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>(() => pending.promise)
    const view = renderEditor({ onExportMarkdown: onExport })
    try {
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      expect(onExport).toHaveBeenCalledTimes(1)
      pending.reject(undefined)
      await waitFor(() => expect(within(view.container).getByText(/导出失败/)).toBeDefined())
      expect(within(view.container).queryByText("导出完成")).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it("会话切换：A 的待确认诊断随 remount 丢弃，B 使用自己的快照", async () => {
    const exported: string[] = []
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>((result) => {
      exported.push(result.markdown)
    })
    const view = render(
      <NoteEditor documentId="A" loadKey="v1" initialDocument={degradedDocument("A 内容")} onExportMarkdown={onExport} />
    )
    try {
      const sessionA = latestSession()
      const markdownA = exportMarkdown(encodeHnn(sessionA.editor.state.doc)).markdown
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      await within(document.body).findByRole("dialog")
      // 切换会话：A 的 Drawer/待确认状态整体丢弃。
      view.rerender(
        <NoteEditor documentId="B" loadKey="v1" initialDocument={degradedDocument("B 内容")} onExportMarkdown={onExport} />
      )
      await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull())
      expect(onExport).not.toHaveBeenCalled()

      const sessionB = latestSession()
      expect(sessionB).not.toBe(sessionA)
      const markdownB = exportMarkdown(encodeHnn(sessionB.editor.state.doc)).markdown
      expect(markdownB).not.toBe(markdownA)

      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      const dialog = await within(document.body).findByRole("dialog")
      fireEvent.click(within(dialog).getByText("确认导出"))
      await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
      expect(exported[0]).toBe(markdownB)
    } finally {
      view.unmount()
    }
  })

  it("invalid 新 key 且移除 export callback：旧待确认诊断与 dialog 保留，旧 callback 仍可确认", async () => {
    const exported: string[] = []
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>((result) => {
      exported.push(result.markdown)
    })
    const errors: string[] = []
    const view = render(
      <NoteEditor documentId="A" loadKey="v1" initialDocument={degradedDocument("A 内容")} onExportMarkdown={onExport} />
    )
    try {
      const sessionA = latestSession()
      const markdownA = exportMarkdown(encodeHnn(sessionA.editor.state.doc)).markdown
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      await within(document.body).findByRole("dialog")

      // invalid 新 key 且不带 export callback：未接受候选不能刷新能力状态，旧会话、
      // 旧 MarkdownExport（含已打开的诊断 Drawer）与旧 callback 全部原样保留。
      view.rerender(
        <NoteEditor
          documentId="B"
          loadKey="v1"
          initialDocument={{ schemaVersion: 1, data: { type: "doc", content: [{ type: "unknown" }] } }}
          onInitialLoadError={(_error, context) => errors.push(context.documentId)}
        />
      )
      expect(errors).toEqual(["B"])
      expect(latestSession()).toBe(sessionA)
      const dialog = within(document.body).getByRole("dialog")
      fireEvent.click(within(dialog).getByText("确认导出"))
      await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
      expect(exported[0]).toBe(markdownA)
    } finally {
      view.unmount()
    }
  })

  it("invalid 新 key 携带 export callback：旧无导出的会话不出现伪造入口", () => {
    const errors: string[] = []
    const view = render(<NoteEditor documentId="A" loadKey="v1" initialDocument={paragraphsDocument("a")} />)
    try {
      expect(within(view.container).queryByText("导出 Markdown")).toBeNull()
      view.rerender(
        <NoteEditor
          documentId="B"
          loadKey="v1"
          initialDocument={{ schemaVersion: 1, data: { type: "doc", content: [{ type: "unknown" }] } }}
          onExportMarkdown={() => undefined}
          onInitialLoadError={(_error, context) => errors.push(context.documentId)}
        />
      )
      expect(errors).toEqual(["B"])
      // 能力状态未被未接受候选刷新：入口保持不存在，而非造出一个调用即失败的假按钮。
      expect(within(view.container).queryByText("导出 Markdown")).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it("同 key 移除 export callback：入口安全消失，在途导出 abort，迟到 settle 不显示成功", async () => {
    const pending = deferred<void>()
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>(() => pending.promise)
    const props = { documentId: "A", loadKey: "v1", initialDocument: paragraphsDocument("hello") }
    const view = render(<NoteEditor {...props} onExportMarkdown={onExport} />)
    try {
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      await waitFor(() => expect(within(view.container).getByText("正在导出…")).toBeDefined())
      const context = (onExport.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }])[1]

      view.rerender(<NoteEditor {...props} />)
      await waitFor(() => expect(within(view.container).queryByText("导出 Markdown")).toBeNull())
      expect(within(view.container).queryByText("正在导出…")).toBeNull()
      expect(context.signal.aborted).toBe(true)

      // 宿主忽略 abort 迟到 settle：组件已卸载，绝不回写成功/失败 UI。
      pending.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(within(view.container).queryByText("导出完成")).toBeNull()
      expect(within(view.container).queryByText(/导出失败/)).toBeNull()
      expect(onExport).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
    }
  })

  it("同 key 更新 export callback 安全应用：新点击使用新 callback", async () => {
    const first = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>()
    const second = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>()
    const props = { documentId: "A", loadKey: "v1", initialDocument: paragraphsDocument("hello") }
    const view = render(<NoteEditor {...props} onExportMarkdown={first} />)
    try {
      view.rerender(<NoteEditor {...props} onExportMarkdown={second} />)
      expect(createdSessions).toHaveLength(1)
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      await waitFor(() => expect(second).toHaveBeenCalledTimes(1))
      expect(first).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
})
