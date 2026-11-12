// @vitest-environment jsdom
import { createRef } from "react"
import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController, type NoteDocumentProviderProps } from "../index"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { decodeHnn, type HnnDocument } from "../hnn/codec"

afterEach(cleanup)
it("M1.9 Provider synchronizes checkbox/conversion/history, freeze, failed save/retry and reopening", async () => {
  const initialDocument = { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content: [{ type: "taskList", content: [
    { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "共享任务" }] }] }
  ] }] }) }
  const controllerRef = createRef<NoteDocumentController>()
  const onChange = vi.fn<NoteDocumentProviderProps["onChange"]>()
  let saved: HnnDocument | undefined
  const onSave = vi.fn<NoteDocumentProviderProps["onSave"]>().mockRejectedValueOnce(new Error("disk failure"))
    .mockImplementation(payload => { saved = payload.document; return Promise.resolve() })
  const mounted = render(<NoteDocumentProvider documentId="tasks" loadKey={1} initialDocument={initialDocument}
    initialHostSnapshot={{ changeId: 0, value: { title: "title", summary: "summary" } }}
    controllerRef={controllerRef} onChange={onChange} onSave={onSave}>
    <NoteEditorView viewId="a" /><NoteEditorView viewId="b" />
  </NoteDocumentProvider>)
  const pane = (id: string) => mounted.container.querySelector<HTMLElement>(`[data-view-id="${id}"]`)!
  const checkbox = (id: string) => pane(id).querySelector<HTMLInputElement>('input[type="checkbox"]')!
  const peer = pane("b").querySelector<HTMLElement>(".tiptap")!
  peer.focus()
  const focus = document.activeElement
  fireEvent.click(checkbox("a"))
  expect(checkbox("b").checked).toBe(true)
  expect(document.activeElement).toBe(focus)
  fireEvent.click(within(pane("b")).getByLabelText("撤销"))
  expect(checkbox("a").checked).toBe(false)
  fireEvent.click(within(pane("a")).getByLabelText("重做"))
  expect(checkbox("b").checked).toBe(true)
  const controller = controllerRef.current!
  const expectedSessionId = controller.getState().identity!.sessionId
  await act(async () => {
    const lease = await controller.setInputFrozen(true, { expectedSessionId, requestId: "freeze" })
    if (!("leaseId" in lease)) throw new Error("missing freeze lease")
    const calls = onChange.mock.calls.length
    fireEvent.click(checkbox("a"))
    expect(onChange).toHaveBeenCalledTimes(calls)
    expect(checkbox("a").checked).toBe(true)
    await controller.setInputFrozen(false, { expectedSessionId, requestId: "freeze", leaseId: lease.leaseId })
  })
  // Use the public view's block menu: whole-container conversion, shared history.
  const handle = pane("a").querySelector<HTMLElement>(".hn-editor-block-handle")!
  fireEvent.keyDown(handle, { key: "Enter" })
  fireEvent.click(within(document.body).getByRole("menuitem", { name: /^转换为$/ }))
  fireEvent.click(within(document.body).getByRole("menuitem", { name: /^转换为有序列表$/ }))
  expect(pane("a").querySelector("ol")).not.toBeNull()
  expect(pane("b").querySelector("ol")).not.toBeNull()
  fireEvent.click(within(pane("b")).getByLabelText("撤销"))
  expect(checkbox("a").checked).toBe(true)
  expect(checkbox("b").checked).toBe(true)
  await act(async () => {
    const result = controller.requestSave({ expectedSessionId, reason: "host-save" })
    expect(result.kind).toBe("pending")
    if (result.kind === "pending") expect((await result.completion).kind).toBe("failure")
  })
  expect(controller.getState().dirty.body).toBe(true)
  await act(async () => {
    const retry = controller.requestSave({ expectedSessionId, reason: "host-retry" })
    if (retry.kind === "pending") expect((await retry.completion).kind).toBe("saved")
  })
  expect(controller.getState().dirty.body).toBe(false)
  expect(saved).toBeDefined()
  expect(decodeHnn(saved).firstChild!.firstChild!.attrs["checked"]).toBe(true)
  mounted.unmount()
  const reopened = render(<NoteDocumentProvider documentId="tasks" loadKey={2} initialDocument={saved}
    initialHostSnapshot={{ changeId: 0, value: { title: "title", summary: "summary" } }} onChange={() => {}} onSave={async () => {}}>
    <NoteEditorView viewId="reopened" />
  </NoteDocumentProvider>)
  expect(reopened.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
})
