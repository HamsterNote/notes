// @vitest-environment jsdom
import { createRef } from "react"
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi, type Mock } from "vitest"
import {
  NoteDocumentProvider,
  NoteEditorView,
  type NoteDocumentController,
  type NoteDocumentProviderProps,
  type NoteFileRequest,
  type NoteFileRequestResult,
  type NotePaneToolbarLayout,
  type NoteToolbarFile
} from "../index"

afterEach(cleanup)

const initialDocument = {
  schemaVersion: 1,
  data: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" }, content: [{ type: "text", text: "正文" }] }] }
}
const files: readonly NoteToolbarFile[] = [
  { key: "/local/a.hnn", storageId: "local", path: "a.hnn", displayName: "A.hnn", resolvedFormat: "hnn" },
  { key: "/remote/a.hnn", storageId: "remote", path: "a.hnn", displayName: "A.hnn", resolvedFormat: "hnn" }
]
const bottom = (insets = { top: 0, bottom: 0, left: 0, right: 0 }): NotePaneToolbarLayout =>
  ({ edge: "bottom", insets, headerContentInset: 0 })

function mount(children: NoteDocumentProviderProps["children"],
  onSelectFile: (request: NoteFileRequest) => Promise<NoteFileRequestResult> = vi.fn(() => Promise.resolve({ status: "success" as const })),
  onRequestRemove: (request: NoteFileRequest) => Promise<NoteFileRequestResult> = vi.fn(() => Promise.resolve({ status: "success" as const }))) {
  const controllerRef = createRef<NoteDocumentController>()
  const props: NoteDocumentProviderProps = {
    documentId: "A", loadKey: 1, initialDocument,
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onSave: vi.fn(() => Promise.resolve()), onChange: vi.fn(), controllerRef, children
  }
  const rendered = render(<NoteDocumentProvider {...props} />)
  const view = (id: string) => rendered.container.querySelector(`[data-view-id="${id}"]`) as HTMLElement
  return { ...rendered, view, onSelectFile, onRequestRemove }
}

describe("notes per-view toolbar", () => {
  it("places the file entry after redo and routes selection to the initiating pane", async () => {
    const onSelectFile: Mock<(request: NoteFileRequest) => Promise<NoteFileRequestResult>> =
      vi.fn(() => Promise.resolve({ status: "success" as const }))
    const h = mount(<NoteEditorView viewId="a" paneId="a" files={files} currentFileKey={files[0]!.key}
      onSelectFile={onSelectFile} layout={bottom()} />, onSelectFile)
    const view = h.view("a")
    const order = Array.from(view.querySelectorAll('[role="toolbar"] button'))
      .map(button => button.getAttribute("aria-label") ?? button.textContent)
    expect(order.slice(0, 4)).toEqual(["撤销", "重做", "文件", "保存"])
    expect(within(view).queryByLabelText("文件")).not.toBeNull()

    fireEvent.click(within(view).getByLabelText("文件"))
    const menu = within(document.body).getByRole("menu", { name: "文件列表" })
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /remote · a\.hnn/ }))
    await waitFor(() => expect(onSelectFile).toHaveBeenCalledOnce())
    expect(onSelectFile.mock.calls[0]![0]).toMatchObject({ fileKey: files[1]!.key, paneId: "a" })
    expect(onSelectFile.mock.calls[0]![0].requestId).toBeTruthy()
  })

  it("hides without injected files, disables while busy and never removes the last item", () => {
    const single = mount(<NoteEditorView viewId="a" paneId="a" files={[files[0]!]} currentFileKey={files[0]!.key}
      onSelectFile={() => Promise.resolve({ status: "success" })} onRequestRemove={() => Promise.resolve({ status: "success" })} layout={bottom()} />)
    const view = single.view("a")
    fireEvent.click(within(view).getByLabelText("文件"))
    const remove = within(document.body).getByRole("menuitem", { name: /移除/ })
    expect(remove.hasAttribute("disabled")).toBe(true)
    single.unmount()

    const busy = mount(<NoteEditorView viewId="a" paneId="a" files={files} busy layout={bottom()} />)
    expect(within(busy.view("a")).getByLabelText("文件").hasAttribute("disabled")).toBe(true)
    busy.unmount()

    const legacy = mount(<NoteEditorView viewId="a" paneId="a" layout={bottom()} />)
    expect(within(legacy.view("a")).queryByLabelText("文件")).toBeNull()
  })

  it("gives the top toolbar the effective safe area once and reserves content space", async () => {
    const h = mount(<NoteEditorView viewId="a" paneId="a" files={files} currentFileKey={files[0]!.key}
      layout={{ edge: "top", insets: { top: 24, bottom: 34, left: 0, right: 0 }, headerContentInset: 44 }} />)
    const view = h.view("a")
    const shell = view.querySelector('[role="region"]') as HTMLElement
    expect(shell.getAttribute("data-toolbar-edge")).toBe("top")
    expect(shell.style.top).toBe("60px")
    expect(shell.style.bottom).toBe("")
    const content = view.firstElementChild as HTMLElement
    await waitFor(() => expect(content.style.paddingTop).toBe("60px"))
    expect(content.style.paddingBottom).toBe("0px")
  })

  it("anchors bottom and top panes independently and keeps the document mounted across direction changes", () => {
    const initialChildren = <>
      <NoteEditorView key="a" viewId="a" paneId="a" files={files} currentFileKey={files[0]!.key}
        layout={{ edge: "top", insets: { top: 0, bottom: 0, left: 0, right: 0 }, headerContentInset: 0 }} />
      <NoteEditorView key="b" viewId="b" paneId="b" files={files} currentFileKey={files[0]!.key}
        layout={{ edge: "bottom", insets: { top: 0, bottom: 34, left: 0, right: 0 }, headerContentInset: 0 }} />
    </>
    const h = mount(initialChildren)
    const topShell = h.view("a").querySelector('[role="region"]') as HTMLElement
    const bottomShell = h.view("b").querySelector('[role="region"]') as HTMLElement
    expect(topShell.getAttribute("data-toolbar-edge")).toBe("top")
    expect(topShell.style.top).toBe("16px")
    expect(bottomShell.getAttribute("data-toolbar-edge")).toBe("bottom")
    expect(bottomShell.style.bottom).toBe("50px")

    const editorA = h.view("a").querySelector(".tiptap")
    const editorB = h.view("b").querySelector(".tiptap")
    h.rerender(<NoteDocumentProvider documentId="A" loadKey={1} initialDocument={initialDocument}
      initialHostSnapshot={{ changeId: 0, value: { title: "", summary: "" } }}
      onSave={vi.fn(() => Promise.resolve())} onChange={vi.fn()}>
      <NoteEditorView key="a" viewId="a" paneId="a" files={files} currentFileKey={files[1]!.key} layout={bottom()} />
      <NoteEditorView key="b" viewId="b" paneId="b" files={files} currentFileKey={files[1]!.key}
        layout={{ edge: "bottom", insets: { top: 0, bottom: 34, left: 0, right: 0 }, headerContentInset: 0 }} />
    </NoteDocumentProvider>)
    expect(h.view("a").querySelector(".tiptap")).toBe(editorA)
    expect(h.view("b").querySelector(".tiptap")).toBe(editorB)
  })
})
