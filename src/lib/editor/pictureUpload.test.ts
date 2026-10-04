// @vitest-environment jsdom
/**
 * 6.7（局部）headless 图片上传核心验收：只覆盖 installer 行为，不涉及 UI/视觉接线。
 * 通过内部 createEditorSession 安装 installer 并显式销毁，验证占位、状态、事务、
 * undo 边界、重试/取消、陈旧结果丢弃与安全预算。
 */
import { Slice } from "@tiptap/pm/model"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { afterEach, describe, expect, it, vi } from "vitest"
import { encodeHnn } from "../hnn/codec"
import { installPictureUpload, type PictureUploadInstaller } from "./pictureUpload"
import { createEditorSession } from "./session"
import type { PictureUploadState } from "./types"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003"
] as const

type Session = ReturnType<typeof createEditorSession>

function documentWith(content: unknown[]) {
  return { schemaVersion: 1 as const, data: { type: "doc", content } }
}

function paragraph(nodeId: string, text: string) {
  return { type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] }
}

function textSession(text = "base") {
  return createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith([paragraph(ids[0], text)]) })
}

/** 恰好达到 maxNodes(512) 的规范文档：doc1 + 250×(paragraph+text)=500 + 11 hardBreak = 512；再插 picture 即超限。 */
function nearNodeLimitSession(): Session {
  const nodeId = (index: number) => `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`
  const content: unknown[] = []
  for (let index = 0; index < 250; index += 1) {
    const children: unknown[] = [{ type: "text", text: `p${index}` }]
    if (index < 11) children.push({ type: "hardBreak", attrs: { nodeId: nodeId(1000 + index) } })
    content.push({ type: "paragraph", attrs: { nodeId: nodeId(index) }, content: children })
  }
  return createEditorSession({ documentId: "A", loadKey: 42, initialDocument: documentWith(content) })
}

function imageFile(name = "photo.png", type = "image/png", bytes = 4): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 每个用例结束后统一回收，避免 RTL/jsdom 残留监听影响后续断言。 */
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function mount(text = "base"): { session: Session; installer: PictureUploadInstaller; upload: ReturnType<typeof vi.fn> } {
  const session = textSession(text)
  const upload = vi.fn()
  const installer = installPictureUpload(session.editor, { upload })
  cleanups.push(() => { installer.destroy(); session.destroy() })
  return { session, installer, upload }
}

function placeholders(session: Session): HTMLElement[] {
  return Array.from(session.editor.view.dom.querySelectorAll<HTMLElement>(".hn-editor-picture-upload"))
}

function pictureNodes(session: Session): Array<{ nodeId: string; src: string; alt: string }> {
  const found: Array<{ nodeId: string; src: string; alt: string }> = []
  session.editor.state.doc.descendants((node) => {
    if (node.type.name === "picture") found.push({ nodeId: node.attrs["nodeId"] as string, src: node.attrs["src"] as string, alt: node.attrs["alt"] as string })
  })
  return found
}

function lastState(installer: PictureUploadInstaller): PictureUploadState {
  return installer.getState()
}

function appendText(session: Session, text: string): void {
  const position = session.editor.state.doc.content.size - 1
  session.editor.view.dispatch(session.editor.state.tr.insertText(text, position))
}

function clipboardEventWithFiles(files: File[]): ClipboardEvent {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent
  const store = new Map<string, string>()
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      types: ["Files"],
      getData: (name: string) => store.get(name) ?? "",
      setData: (name: string, value: string) => store.set(name, value),
      clearData: () => store.clear()
    }
  })
  return event
}

function dropEvent(files: File[], clientX = 0, clientY = 0, modifiers: { ctrlKey?: boolean; altKey?: boolean } = {}): DragEvent {
  const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, "dataTransfer", {
    value: { files, items: [], types: ["Files"], getData: () => "", dropEffect: "none", effectAllowed: "all" }
  })
  Object.defineProperty(event, "clientX", { value: clientX })
  Object.defineProperty(event, "clientY", { value: clientY })
  // 同时置 ctrlKey/altKey：dragCopyModifier 依平台为 ctrlKey 或 altKey，两者都置可让 moved=false。
  Object.defineProperty(event, "ctrlKey", { value: modifiers.ctrlKey ?? false })
  Object.defineProperty(event, "altKey", { value: modifiers.altKey ?? false })
  return event
}

describe("6.7 picture upload installer（headless 核心）", () => {
  it("占位为 Decoration.widget：状态/文件/uploadId/attempt 只进内存桥，不进入 HNN", () => {
    const { session, installer, upload } = mount("base")
    upload.mockReturnValue(deferred<{ src: string }>().promise)

    const cursor = TextSelection.create(session.editor.state.doc, 2)
    session.editor.view.dispatch(session.editor.state.tr.setSelection(cursor))
    const [uploadId] = installer.enqueue([imageFile()])

    expect(uploadId).toBeDefined()
    expect(upload).toHaveBeenCalledTimes(1)
    const [file, request] = upload.mock.calls[0] as [File, { uploadId: string; attempt: number; signal: AbortSignal }]
    expect(file.name).toBe("photo.png")
    expect(request.uploadId).toBe(uploadId)
    expect(request.attempt).toBe(1)

    const nodes = placeholders(session)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.getAttribute("data-hn-upload-id")).toBe(uploadId)
    expect(nodes[0]?.getAttribute("data-hn-upload-status")).toBe("uploading")
    expect(nodes[0]?.getAttribute("data-hn-upload-attempt")).toBe("1")

    // 文档尚未插入 picture；快照不含任何上传临时态。
    expect(pictureNodes(session)).toHaveLength(0)
    const hnn = JSON.stringify(encodeHnn(session.editor.state.doc))
    expect(hnn).not.toContain(uploadId!)
    expect(hnn).not.toContain("photo.png")
  })

  it("成功后仅一个 doc transaction 写入 picture，且 undo 隔离前后输入", async () => {
    const { session, installer, upload } = mount("base")
    const pending = deferred<{ src: string; alt?: string }>()
    upload.mockReturnValue(pending.promise)

    appendText(session, " pre")
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const [uploadId] = installer.enqueue([imageFile()])

    let changed = 0
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged) changed += 1 }
    session.editor.on("transaction", onTransaction)
    pending.resolve({ src: "https://cdn.test/a.png", alt: "A" })
    await flush()
    session.editor.off("transaction", onTransaction)

    expect(changed).toBe(1)
    const pictures = pictureNodes(session)
    expect(pictures).toHaveLength(1)
    expect(pictures[0]).toMatchObject({ src: "https://cdn.test/a.png", alt: "A" })
    expect(pictures[0]?.nodeId).toBeTruthy()
    expect(placeholders(session)).toHaveLength(0)
    expect(lastState(installer).items).toHaveLength(0)
    expect(JSON.stringify(encodeHnn(session.editor.state.doc))).not.toContain(uploadId!)

    // 粘贴后的相邻输入独立成步：undo1 撤输入，undo2 撤图片，undo3 撤 pre。
    appendText(session, " post")
    expect(session.undo()).toBe(true)
    expect(pictureNodes(session)).toHaveLength(1)
    expect(session.editor.getText()).not.toContain("post")
    expect(session.undo()).toBe(true)
    expect(pictureNodes(session)).toHaveLength(0)
    expect(session.editor.getText()).toContain("pre")
    expect(session.undo()).toBe(true)
    expect(session.editor.getText()).not.toContain("pre")
  })

  it("锚点随编辑映射：前序输入插入后，picture 落在映射后的位置", async () => {
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith([paragraph(ids[0], "one"), paragraph(ids[1], "two")]) })
    const upload = vi.fn()
    const installer = installPictureUpload(session.editor, { upload })
    cleanups.push(() => { installer.destroy(); session.destroy() })
    const pending = deferred<{ src: string }>()
    upload.mockReturnValue(pending.promise)

    // 光标在 p1 内 → 目标为 p1 之后（位置 5）。
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    installer.enqueue([imageFile()])
    // 在占位之前插入字符，占位应被映射到新位置（6），而非停留在旧位置。
    session.editor.view.dispatch(session.editor.state.tr.insertText("X", 1))

    pending.resolve({ src: "https://cdn.test/mapped.png" })
    await flush()

    const order: string[] = []
    session.editor.state.doc.forEach((node) => order.push(node.type.name))
    expect(order).toEqual(["paragraph", "picture", "paragraph"])
    expect(session.editor.state.doc.firstChild?.textContent).toBe("Xone")
    expect(pictureNodes(session).map((node) => node.src)).toEqual(["https://cdn.test/mapped.png"])
  })

  it("retry 保持 uploadId 不变、attempt 递增，且每次尝试使用独立 AbortSignal", async () => {
    const { session, installer, upload } = mount("base")
    const first = deferred<{ src: string }>()
    const second = deferred<{ src: string; alt?: string }>()
    upload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const [uploadId] = installer.enqueue([imageFile()])
    const firstRequest = (upload.mock.calls[0] as [File, { uploadId: string; attempt: number; signal: AbortSignal }])[1]

    first.reject(new Error("boom"))
    await flush()
    expect(lastState(installer).items[0]).toMatchObject({ uploadId, attempt: 1, status: "failed" })
    expect(placeholders(session)[0]?.getAttribute("data-hn-upload-status")).toBe("failed")

    expect(installer.retry(uploadId!)).toBe(true)
    expect(upload).toHaveBeenCalledTimes(2)
    const secondRequest = (upload.mock.calls[1] as [File, { uploadId: string; attempt: number; signal: AbortSignal }])[1]
    expect(secondRequest.uploadId).toBe(uploadId)
    expect(secondRequest.attempt).toBe(2)
    expect(secondRequest.signal).not.toBe(firstRequest.signal)

    second.resolve({ src: "https://cdn.test/retry.png" })
    await flush()
    expect(pictureNodes(session).map((node) => node.src)).toEqual(["https://cdn.test/retry.png"])
  })

  it("cancel 中止上传、移除占位且宿主随后返回也不写入文档", async () => {
    const { session, installer, upload } = mount("base")
    const pending = deferred<{ src: string }>()
    upload.mockReturnValue(pending.promise)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const [uploadId] = installer.enqueue([imageFile()])
    const request = (upload.mock.calls[0] as [File, { signal: AbortSignal }])[1]
    const before = session.editor.state.doc

    expect(installer.cancel(uploadId!)).toBe(true)
    expect(request.signal.aborted).toBe(true)
    expect(placeholders(session)).toHaveLength(0)
    expect(lastState(installer).items).toHaveLength(0)
    expect(session.editor.state.doc.eq(before)).toBe(true)

    pending.resolve({ src: "https://cdn.test/late.png" })
    await flush()
    expect(pictureNodes(session)).toHaveLength(0)
  })
})

describe("6.7 picture upload installer：失败/取消/陈旧与坐标边界", () => {
  it("destroy 后即使宿主忽略 abort，陈旧结果也被丢弃且不写文档", async () => {
    const { session, installer, upload } = mount("base")
    const pending = deferred<{ src: string }>()
    // 该 promise 刻意忽略 signal，模拟不响应取消的宿主。
    upload.mockReturnValue(pending.promise)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    installer.enqueue([imageFile()])
    const request = (upload.mock.calls[0] as [File, { signal: AbortSignal }])[1]
    const before = session.editor.state.doc

    installer.destroy()
    expect(request.signal.aborted).toBe(true)
    pending.resolve({ src: "https://cdn.test/late.png" })
    await flush()

    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(pictureNodes(session)).toHaveLength(0)
  })

  it("不安全协议或超预算的宿主返回不写坏文档，占位保持可重试的失败态", async () => {
    const { session, installer, upload } = mount("base")
    const pending = deferred<{ src: string }>()
    upload.mockReturnValue(pending.promise)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    installer.enqueue([imageFile()])
    const before = session.editor.state.doc

    pending.resolve({ src: "javascript:alert(1)" })
    await flush()

    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(pictureNodes(session)).toHaveLength(0)
    expect(lastState(installer).items[0]?.status).toBe("failed")
    expect(placeholders(session)[0]?.getAttribute("data-hn-upload-status")).toBe("failed")
    // 仍可重试：再次调用宿主。
    const retry = deferred<{ src: string; alt?: string }>()
    upload.mockReturnValueOnce(retry.promise)
    const uploadId = lastState(installer).items[0]!.uploadId
    expect(installer.retry(uploadId)).toBe(true)
    retry.resolve({ src: "https://cdn.test/ok.png" })
    await flush()
    expect(pictureNodes(session).map((node) => node.src)).toEqual(["https://cdn.test/ok.png"])
  })

  it("超预算的宿主 src 不写坏文档且保持失败态", async () => {
    const { session, installer, upload } = mount("base")
    const pending = deferred<{ src: string }>()
    upload.mockReturnValue(pending.promise)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    installer.enqueue([imageFile()])
    const before = session.editor.state.doc

    pending.resolve({ src: `https://cdn.test/${"a".repeat(9000)}` })
    await flush()

    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(pictureNodes(session)).toHaveLength(0)
    expect(lastState(installer).items[0]?.status).toBe("failed")
  })

  it("maxFileBytes 超限立即失败且不调用宿主", () => {
    const session = textSession("base")
    const upload = vi.fn()
    const installer = installPictureUpload(session.editor, { upload, maxFileBytes: 3 })
    cleanups.push(() => { installer.destroy(); session.destroy() })

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const [uploadId] = installer.enqueue([imageFile("big.png", "image/png", 16)])

    expect(upload).not.toHaveBeenCalled()
    expect(lastState(installer).items[0]).toMatchObject({ uploadId, status: "failed" })
    expect(placeholders(session)[0]?.getAttribute("data-hn-upload-status")).toBe("failed")
    expect(pictureNodes(session)).toHaveLength(0)
  })

  it("用户编辑删除占位锚点时中止上传并清理", async () => {
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith([paragraph(ids[0], "one"), paragraph(ids[1], "two")]) })
    const upload = vi.fn()
    const installer = installPictureUpload(session.editor, { upload })
    cleanups.push(() => { installer.destroy(); session.destroy() })
    const pending = deferred<{ src: string }>()
    upload.mockReturnValue(pending.promise)

    // 光标在 p1 内 → 目标为 p1 之后（跨块边界 5）。
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    installer.enqueue([imageFile()])
    const request = (upload.mock.calls[0] as [File, { signal: AbortSignal }])[1]
    expect(placeholders(session)).toHaveLength(1)

    // 删除跨越占位位置的区间：占位被映射删除，触发 onRemove 清理。
    session.editor.view.dispatch(session.editor.state.tr.delete(2, 7))
    expect(request.signal.aborted).toBe(true)
    expect(placeholders(session)).toHaveLength(0)
    expect(lastState(installer).items).toHaveLength(0)

    pending.resolve({ src: "https://cdn.test/orphan.png" })
    await flush()
    expect(pictureNodes(session)).toHaveLength(0)
  })

  it("非图片文件（Markdown/HNN）一律不读取、不入队", () => {
    const { session, installer, upload } = mount("base")
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const md = new File(["# title"], "note.md", { type: "text/markdown" })
    const json = new File(["{}"], "note.hnn", { type: "application/json" })
    expect(installer.enqueue([md, json])).toEqual([])
    expect(upload).not.toHaveBeenCalled()
    expect(placeholders(session)).toHaveLength(0)
  })
})

describe("6.7 picture upload installer：paste / drop 拦截", () => {
  it("粘贴图片文件被消费并入队，不插入文档且与原生 clipboard 兼容", () => {
    const { session, installer, upload } = mount("base")
    const pending = deferred<{ src: string }>()
    upload.mockReturnValue(pending.promise)
    const before = session.editor.state.doc

    const event = clipboardEventWithFiles([imageFile()])
    session.editor.view.dom.dispatchEvent(event)

    expect(upload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(placeholders(session)).toHaveLength(1)
    expect(lastState(installer).items).toHaveLength(1)
  })

  it("拖入图片文件按 posAtCoords 入队；坐标失败或内部拖拽均不入队、不 fallback 0", () => {
    const first = mount("base")
    first.session.editor.view.posAtCoords = vi.fn(() => ({ pos: 2, inside: -1 }))
    const before = first.session.editor.state.doc
    first.session.editor.view.dom.dispatchEvent(dropEvent([imageFile()], 10, 10))
    expect(first.upload).toHaveBeenCalledTimes(1)
    expect(first.session.editor.state.doc.eq(before)).toBe(true)
    expect(placeholders(first.session)).toHaveLength(1)

    // 坐标失败：PM 自身在 posAtCoords 返回 null 时不调用 handleDrop，绝不插入 0 位置。
    const second = mount("base")
    second.session.editor.view.posAtCoords = vi.fn(() => null)
    const beforeSecond = second.session.editor.state.doc
    second.session.editor.view.dom.dispatchEvent(dropEvent([imageFile()], 10, 10))
    expect(second.upload).not.toHaveBeenCalled()
    expect(second.session.editor.state.doc.eq(beforeSecond)).toBe(true)
    expect(placeholders(second.session)).toHaveLength(0)

    // 内部拖拽（view.dragging/moved）：不重复上传，交给 PM 移动，避免双写。
    const third = mount("base")
    third.session.editor.view.posAtCoords = vi.fn(() => ({ pos: 2, inside: -1 }))
    Object.defineProperty(third.session.editor.view, "dragging", {
      value: { slice: Slice.empty, move: true, node: null },
      writable: true,
      configurable: true
    })
    const beforeThird = third.session.editor.state.doc
    third.session.editor.view.dom.dispatchEvent(dropEvent([imageFile()], 10, 10))
    expect(third.upload).not.toHaveBeenCalled()
    expect(third.session.editor.state.doc.eq(beforeThird)).toBe(true)
  })

  it("内部原子拖拽不产生上传占位（NodeSelection 路径保持原生）", () => {
    const session = createEditorSession({
      documentId: "A", loadKey: 1,
      initialDocument: documentWith([{ type: "picture", attrs: { nodeId: ids[0], src: "https://cdn.test/existing.png", alt: "E" } }])
    })
    const upload = vi.fn()
    const installer = installPictureUpload(session.editor, { upload })
    cleanups.push(() => { installer.destroy(); session.destroy() })

    session.editor.view.dispatch(session.editor.state.tr.setSelection(NodeSelection.create(session.editor.state.doc, 0)))
    expect(upload).not.toHaveBeenCalled()
    expect(placeholders(session)).toHaveLength(0)
  })
})

describe("6.7 picture upload installer：审查修复回归", () => {
  it("内部 copy 拖拽（moved=false 但 view.dragging 存在）不上传；坐标失败也不吞掉重排", () => {
    const copy = mount("base")
    copy.session.editor.view.posAtCoords = vi.fn(() => ({ pos: 2, inside: -1 }))
    Object.defineProperty(copy.session.editor.view, "dragging", {
      value: { slice: Slice.empty, move: true, node: null },
      writable: true,
      configurable: true
    })
    const beforeCopy = copy.session.editor.state.doc
    // copy 修饰键令 PM 的 moved=false，但 view.dragging 非空：仍必须拒绝上传。
    copy.session.editor.view.dom.dispatchEvent(dropEvent([imageFile()], 10, 10, { ctrlKey: true, altKey: true }))
    expect(copy.upload).not.toHaveBeenCalled()
    expect(copy.session.editor.state.doc.eq(beforeCopy)).toBe(true)

    // 内部拖拽 + 坐标失败：不得 preventDefault 吞掉 PM 的重排路径。
    const swallow = mount("base")
    swallow.session.editor.view.posAtCoords = vi.fn(() => null)
    Object.defineProperty(swallow.session.editor.view, "dragging", {
      value: { slice: Slice.empty, move: true, node: null },
      writable: true,
      configurable: true
    })
    const event = dropEvent([imageFile()], 10, 10, { ctrlKey: true, altKey: true })
    swallow.session.editor.view.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(swallow.upload).not.toHaveBeenCalled()
  })

  it("预算预检（节点上限）拒绝时不 dispatch、不影响其它 pending upload", async () => {
    const session = nearNodeLimitSession()
    const upload = vi.fn()
    const installer = installPictureUpload(session.editor, { upload })
    cleanups.push(() => { installer.destroy(); session.destroy() })
    const first = deferred<{ src: string }>()
    const second = deferred<{ src: string }>()
    upload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const [firstId, secondId] = installer.enqueue([imageFile("a.png"), imageFile("b.png")])
    const before = session.editor.state.doc

    first.resolve({ src: "https://cdn.test/a.png" })
    await flush()

    // A 预检失败：文档不变、不写坏文档；B 完全不受影响（无副作用预检）。
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(pictureNodes(session)).toHaveLength(0)
    const state = lastState(installer)
    const failedItem = state.items.find((item) => item.uploadId === firstId)
    expect(failedItem?.status).toBe("failed")
    // 证明拒绝来自整文档预算预检（节点总数上限），而非其它早退路径。
    expect(String((failedItem?.error as Error)?.message)).toContain("节点总数超过")
    expect(state.items.find((item) => item.uploadId === secondId)?.status).toBe("uploading")
    const secondRequest = (upload.mock.calls[1] as [File, { signal: AbortSignal }])[1]
    expect(secondRequest.signal.aborted).toBe(false)
    expect(placeholders(session)).toHaveLength(2)
  })

  it("failed 占位的锚点被删除时同样清理记录，retry 不再可用", async () => {
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith([paragraph(ids[0], "one"), paragraph(ids[1], "two")]) })
    const upload = vi.fn()
    const installer = installPictureUpload(session.editor, { upload })
    cleanups.push(() => { installer.destroy(); session.destroy() })
    const pending = deferred<{ src: string }>()
    upload.mockReturnValue(pending.promise)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const [uploadId] = installer.enqueue([imageFile()])
    pending.reject(new Error("boom"))
    await flush()
    expect(lastState(installer).items[0]?.status).toBe("failed")

    session.editor.view.dispatch(session.editor.state.tr.delete(2, 7))
    await flush()
    expect(placeholders(session)).toHaveLength(0)
    expect(lastState(installer).items).toHaveLength(0)
    expect(installer.retry(uploadId!)).toBe(false)
  })

  it("超限文件 retry 重新校验限额，绝不调用宿主", () => {
    const session = textSession("base")
    const upload = vi.fn()
    const installer = installPictureUpload(session.editor, { upload, maxFileBytes: 3 })
    cleanups.push(() => { installer.destroy(); session.destroy() })

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const [uploadId] = installer.enqueue([imageFile("big.png", "image/png", 16)])

    expect(upload).not.toHaveBeenCalled()
    expect(installer.retry(uploadId!)).toBe(false)
    expect(upload).not.toHaveBeenCalled()
    expect(lastState(installer).items[0]?.status).toBe("failed")
  })

  it("同位置多个 pending 相邻插入：位置合法、ID 唯一、各自一次 undo", async () => {
    const { session, installer, upload } = mount("base")
    const first = deferred<{ src: string }>()
    const second = deferred<{ src: string }>()
    upload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const uploadIds = installer.enqueue([imageFile("a.png"), imageFile("b.png")])
    expect(uploadIds).toHaveLength(2)

    first.resolve({ src: "https://cdn.test/a.png" })
    await flush()
    expect(pictureNodes(session)).toHaveLength(1)
    expect(placeholders(session)).toHaveLength(1)

    second.resolve({ src: "https://cdn.test/b.png" })
    await flush()
    const pictures = pictureNodes(session)
    expect(pictures).toHaveLength(2)
    expect(new Set(pictures.map((node) => node.nodeId)).size).toBe(2)
    expect(pictures.map((node) => node.src).sort()).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"])
    expect(placeholders(session)).toHaveLength(0)
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
    expect(session.editor.state.doc.firstChild?.type.name).toBe("paragraph")

    // 每次插入各自一个历史步：undo1 撤后一个，undo2 撤前一个。
    expect(session.undo()).toBe(true)
    expect(pictureNodes(session)).toHaveLength(1)
    expect(session.undo()).toBe(true)
    expect(pictureNodes(session)).toHaveLength(0)
  })

  it("占位删除通知延后到 plugin apply 之外，subscriber 重入 dispatch 安全", async () => {
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith([paragraph(ids[0], "one"), paragraph(ids[1], "two")]) })
    const upload = vi.fn(() => deferred<{ src: string }>().promise)
    const installer = installPictureUpload(session.editor, { upload })
    cleanups.push(() => { installer.destroy(); session.destroy() })

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    installer.enqueue([imageFile()])

    let reentered = false
    installer.subscribe(() => {
      if (reentered) return
      reentered = true
      // 若通知发生在 plugin apply 内，这里的同步 dispatch 会重入 apply。
      session.editor.view.dispatch(session.editor.state.tr.insertText("z", 1))
    })
    session.editor.view.dispatch(session.editor.state.tr.delete(2, 7))
    await flush()

    expect(reentered).toBe(true)
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
  })
})

