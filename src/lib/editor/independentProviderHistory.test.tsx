// @vitest-environment jsdom
import { createRef } from "react"
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { NoteDocumentProvider, NoteEditorView, type HnnDocument, type NoteDocumentController } from "../index"

afterEach(cleanup)
const ids = ["123e4567-e89b-42d3-a456-426614174000", "123e4567-e89b-42d3-a456-426614174001"]
const initial: HnnDocument = { schemaVersion: 1, data: { type: "doc", content: ids.map((nodeId, i) => ({
  type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text: i ? "B" : "A" }]
})) } }
const src = "hamster_note_data/images/0123456789abcdef0123456789abcdef.png"

/** A synchronous reference host, not WebBase's bridge or an iframe simulation.
 * Both SDK Providers and every editing transaction use the real implementation.
 */
function mount(theme: "light" | "dark") {
  const refs = [createRef<NoteDocumentController>(), createRef<NoteDocumentController>()]
  const snapshots = [initial]
  let cursor = 0
  const changes = vi.fn((value: HnnDocument, source: number) => {
    snapshots.splice(cursor + 1); snapshots.push(value); cursor++
    refs.forEach((ref, index) => {
      if (index !== source) expect(ref.current!.applyHostDocument!({ expectedSessionId: ref.current!.getState().identity!.sessionId, document: value }).kind).toBe("applied")
    })
  })
  const history = vi.fn((direction: "undo" | "redo") => {
    cursor = Math.max(0, Math.min(snapshots.length - 1, cursor + (direction === "undo" ? -1 : 1)))
    refs.forEach(ref => expect(ref.current!.applyHostDocument!({ expectedSessionId: ref.current!.getState().identity!.sessionId, document: snapshots[cursor] }).kind).toBe("applied"))
    return true
  })
  const upload = vi.fn(() => Promise.resolve({ src }))
  const view = render(<>{refs.map((ref, index) => <NoteDocumentProvider key={index} documentId="shared" loadKey={1}
    initialDocument={initial} initialHostSnapshot={{ changeId: 0, value: { title: "", summary: "" } }}
    controllerRef={ref} onChange={value => changes(value, index)} onSave={() => Promise.resolve()}
    onHistoryRequest={direction => history(direction)} onPictureUpload={upload}>
    <NoteEditorView viewId={String(index)} theme={theme} />
  </NoteDocumentProvider>)}</>)
  const pane = (index: number) => view.container.querySelector<HTMLElement>(`[data-view-id="${index}"]`)!
  const area = (index: number) => pane(index).querySelector<HTMLElement>(".hn-editor-content")!
  const open = () => {
    fireEvent.click(pane(0).querySelector("[data-drag-handle]")!)
    fireEvent.click(within(pane(0)).getByText("下一行"))
    fireEvent.click(within(pane(0)).getByText("图像"))
    const dialog = within(document.body).getByRole("dialog", { name: "插入图像" })
    fireEvent.change(dialog.querySelector("input[type=file]")!, { target: { files: [new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])], "p.png", { type: "image/png" })] } })
    return dialog
  }
  const controllers = refs.map(ref => ref.current!)
  const sessionIds = controllers.map(c => c.getState().identity!.sessionId)
  const assertStable = () => refs.forEach((ref, i) => {
    expect(ref.current).toBe(controllers[i])
    expect(ref.current!.getState().identity!.sessionId).toBe(sessionIds[i])
  })
  expect(sessionIds[0]).not.toBe(sessionIds[1])
  return { ...view, refs, pane, area, open, changes, history, upload, assertStable }
}

for (const theme of ["light", "dark"] as const) {
  it(`${theme}: independent Providers preserve the pending dialog when a peer moves its target; peer undo/redo uses host history`, async () => {
    const h = mount(theme), dialog = h.open()
    fireEvent.click(h.pane(1).querySelector("[data-drag-handle]")!)
    fireEvent.click(within(h.pane(1)).getByText("下移"))
    expect([...h.area(0).querySelectorAll("p")].map(p => p.textContent)).toEqual(["B", "A"])
    expect(within(document.body).getByRole("dialog", { name: "插入图像" })).toBe(dialog)
    h.assertStable()
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "确认插入" })).toHaveProperty("disabled", false))
    fireEvent.click(within(dialog).getByRole("button", { name: "确认插入" }))
    await waitFor(() => expect(h.area(0).lastElementChild?.getAttribute("data-hnn-node")).toBe("picture"))
    expect(h.area(1).querySelectorAll("[data-hnn-node=picture]")).toHaveLength(1)
    fireEvent.click(within(h.pane(1)).getByRole("button", { name: "撤销" }))
    expect(h.history).toHaveBeenLastCalledWith("undo")
    expect(h.area(0).querySelectorAll("[data-hnn-node=picture]")).toHaveLength(0)
    expect(h.area(1).querySelectorAll("[data-hnn-node=picture]")).toHaveLength(0)
    // Keyboard history crosses the independent Provider boundary as well.
    fireEvent.keyDown(h.area(0), { key: "z", ctrlKey: true, shiftKey: true })
    expect(h.area(1).querySelectorAll("[data-hnn-node=picture]")).toHaveLength(1)
    expect(h.upload).toHaveBeenCalledTimes(1)
    h.assertStable()
  })

  it(`${theme}: accepted host deletion preserves the independent Provider's dialog and rejects its deleted target`, async () => {
    const h = mount(theme), dialog = h.open()
    const controller = h.refs[1]!.current!
    // A host-accepted peer deletion, through the public API; no private session access.
    act(() => {
      const value: HnnDocument = { schemaVersion: 1, data: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: ids[1] }, content: [{ type: "text", text: "B" }] }] } }
      expect(controller.applyHostDocument!({ expectedSessionId: controller.getState().identity!.sessionId, document: value }).kind).toBe("applied")
      const primary = h.refs[0]!.current!
      expect(primary.applyHostDocument!({ expectedSessionId: primary.getState().identity!.sessionId, document: value }).kind).toBe("applied")
    })
    expect([...h.area(0).querySelectorAll("p")].map(p => p.textContent)).toEqual(["B"])
    expect(within(document.body).getByRole("dialog", { name: "插入图像" })).toBe(dialog)
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "确认插入" })).toHaveProperty("disabled", false))
    fireEvent.click(within(dialog).getByRole("button", { name: "确认插入" }))
    expect(h.upload).not.toHaveBeenCalled()
    expect(h.changes).not.toHaveBeenCalled()
    expect(h.area(0).querySelectorAll("[data-hnn-node=picture]")).toHaveLength(0)
    h.assertStable()
  })
}
