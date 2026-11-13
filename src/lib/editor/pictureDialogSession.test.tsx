// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NoteDocumentProvider, NoteEditorView, type HnnDocument, type NoteDocumentProviderProps } from "../index"
import { DocumentSession } from "./documentSession"
import type { PictureUploadResult } from "./types"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001"
]
const initialDocument: HnnDocument = {
  schemaVersion: 1,
  data: {
    type: "doc",
    content: ids.map((nodeId, index) => ({
      type: "paragraph",
      attrs: { nodeId },
      content: [{ type: "text", text: index === 0 ? "a" : "b" }]
    }))
  }
}
const file = () => new File([
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
], "photo.png", { type: "image/png" })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

type TestNode = { type: string; content?: Array<{ text?: string }> }
function nodes(document: HnnDocument | undefined): TestNode[] {
  return (document?.data["content"] ?? []) as TestNode[]
}

afterEach(cleanup)

function mount(upload: NonNullable<NoteDocumentProviderProps["onPictureUpload"]>) {
  const changes: HnnDocument[] = []
  const props: NoteDocumentProviderProps = {
    documentId: "A",
    loadKey: 1,
    initialDocument,
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onSave: vi.fn(() => Promise.resolve()),
    onChange: (snapshot) => { changes.push(snapshot) },
    onPictureUpload: upload,
    children: <><NoteEditorView viewId="a" /><NoteEditorView viewId="b" /></>
  }
  const view = render(<NoteDocumentProvider {...props} />)
  const pane = (id: string) => view.container.querySelector<HTMLElement>(`[data-view-id="${id}"]`)!
  const openMenu = (id: string, index: number) => {
    const root = pane(id)
    fireEvent.click(root.querySelectorAll<HTMLElement>("[data-drag-handle]")[index]!)
  }
  const openDialog = (id: string, index: number) => {
    const root = pane(id)
    openMenu(id, index)
    fireEvent.click(within(root).getByText("下一行"))
    fireEvent.click(within(root).getByText("图像"))
  }
  const confirm = async () => {
    const dialog = within(document.body).getByRole("dialog", { name: "插入图像" })
    fireEvent.change(dialog.querySelector("input[type='file']")!, { target: { files: [file()] } })
    const button = within(dialog).getByRole<HTMLButtonElement>("button", { name: "确认插入" })
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
  }
  return { ...view, changes, pane, openMenu, openDialog, confirm }
}

describe("共享会话图像模态框", () => {
  it("目标块跨视图移动后仍按 nodeId 插入，成功一次撤销同步且第二个模态框受控", async () => {
    const pending = deferred<PictureUploadResult>()
    const upload = vi.fn(() => pending.promise)
    const view = mount(upload)
    view.openDialog("a", 0)
    expect(within(document.body).getByRole("dialog", { name: "插入图像" })).toBeDefined()

    view.openMenu("b", 0)
    fireEvent.click(within(view.pane("b")).getByText("下移"))
    expect(Array.from(view.pane("b").querySelectorAll(".tiptap p"), (node) => node.textContent)).toEqual(["b", "a"])

    view.openMenu("b", 1)
    fireEvent.click(within(view.pane("b")).getByText("下一行"))
    expect(within(view.pane("b")).getByText("图像")).toHaveProperty("disabled", true)
    fireEvent.keyDown(view.pane("b").querySelector(".hn-editor-menu")!, { key: "Escape" })

    await view.confirm()
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    pending.resolve({ src: "hamster_note_data/images/0123456789abcdef0123456789abcdef.png" })
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: "插入图像" })).toBeNull())
    const inserted = view.changes.at(-1)
    expect(nodes(inserted).map((node) => node.type)).toEqual(["paragraph", "paragraph", "picture"])
    expect(nodes(inserted).map((node) => node.content?.[0]?.text)).toEqual(["b", "a", undefined])

    fireEvent.click(within(view.pane("b")).getByLabelText("撤销"))
    const undone = view.changes.at(-1)
    expect(nodes(undone).every((node) => node.type === "paragraph")).toBe(true)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it("关闭在途上传会 abort，迟到成功不写正文；卸载也清理对话框", async () => {
    const pending = deferred<PictureUploadResult>()
    let signal: AbortSignal | undefined
    const upload = vi.fn((_file: File, context: { signal: AbortSignal }) => {
      signal = context.signal
      return pending.promise
    })
    const view = mount(upload)
    view.openDialog("a", 0)
    await view.confirm()
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    fireEvent.click(within(document.body).getByRole("button", { name: "关闭图像对话框" }))
    expect(signal?.aborted).toBe(true)
    pending.resolve({ src: "https://cdn.example.test/late.png" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.changes).toEqual([])
    expect(view.container.querySelector("[data-hnn-node='picture']")).toBeNull()

    view.openDialog("a", 0)
    view.unmount()
    expect(within(document.body).queryByRole("dialog", { name: "插入图像" })).toBeNull()
  })
})

describe("DocumentSession 图像目标与离开门禁", () => {
  it.each(["move", "delete"])("公开宿主快照在模态等待时 %s 目标：保留 session 并按 nodeId 确认或拒绝", async (action) => {
    const upload = vi.fn(() => Promise.resolve({ src: "hamster_note_data/images/0123456789abcdef0123456789abcdef.png" }))
    const changes = vi.fn()
    const session = new DocumentSession({ documentId: "A", loadKey: 1, initialDocument,
      initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
      onSave: async () => {}, onChange: changes, onPictureUpload: upload })
    const a = session.attachView("a")
    try {
      expect(session.openPictureDialog("a", ids[0]!, document.createElement("button"))).toBe(true)
      const content = initialDocument.data["content"] as unknown[]
      const updated = { schemaVersion: 1, data: { type: "doc", content: action === "move" ? [content[1], content[0]] : [content[1]] } }
      expect(session.controller.applyHostDocument!({ expectedSessionId: session.identity.sessionId, document: updated }).kind).toBe("applied")
      expect(changes).not.toHaveBeenCalled()
      expect(session.pictureDialogForView("a")).not.toBeNull()
      const ticket = session.confirmPictureDialog("a", file())
      if (action === "delete") { expect(ticket).toBeNull(); expect(upload).not.toHaveBeenCalled() }
      else {
        expect(ticket).toBeTruthy()
        await waitFor(() => expect(a.editor.state.doc.childCount).toBe(3))
        expect(a.editor.state.doc.child(0).textContent).toBe("b")
        expect(a.editor.state.doc.child(1).textContent).toBe("a")
        expect(a.editor.state.doc.child(2).type.name).toBe("picture")
      }
    } finally { session.dispose() }
  })

  it("删除目标后拒绝确认；模态期间禁止并行草稿和 owner 离开", () => {
    const upload = vi.fn()
    const session = new DocumentSession({
      documentId: "A",
      loadKey: 1,
      initialDocument,
      initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
      onSave: vi.fn(() => Promise.resolve()),
      onChange: vi.fn(),
      onPictureUpload: upload
    })
    session.attachView("a")
    const b = session.attachView("b")
    const anchor = document.createElement("button")
    expect(session.openPictureDialog("a", ids[0]!, anchor)).toBe(true)
    expect(session.openPictureDialog("b", ids[0]!, anchor)).toBe(false)
    expect(session.beginDraft("b", "card")).toBe(false)
    expect(session.controller.canDetachView("a", { expectedSessionId: session.identity.sessionId })).toMatchObject({ kind: "blocked" })

    session.dispatch("b", b.editor.state.tr.delete(0, b.editor.state.doc.firstChild!.nodeSize))
    expect(session.confirmPictureDialog("a", file())).toBeNull()
    expect(upload).not.toHaveBeenCalled()
    session.closePictureDialog("a")
    session.dispose()
  })
})
