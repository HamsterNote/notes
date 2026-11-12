// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import { DocumentSession } from "./documentSession"
import { HnnDataDrawer } from "./HnnDataDrawer"
import { enterList, LIST_TYPES } from "./listCommands"
import { decodeHnn, type HnnDocument } from "../hnn/codec"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { HNN_LIMITS } from "../hnn/limits"
import { HNN_CARD_EMPTY_DATA } from "../hnn/cardPayload"
import { HNN_DRAWING_EMPTY_DATA } from "../hnn/drawingPayload"

// The painting library's pointer/canvas engine has its own tests. Emit one real,
// valid stroke here to exercise the drawer -> NodeView -> shared session path.
vi.mock("@hamster-note/painting", async importOriginal => ({
  ...await importOriginal<typeof import("@hamster-note/painting")>(),
  DrawingSurface: ({ onChange }: { onChange: (value: object) => void }) => <button onClick={() => onChange({
    schemaVersion: 2, strokes: [{ schemaVersion: 2, id: "stroke-1", points: [{ x: 10, y: 20, pressure: 0.5 }],
      strokeColor: "#112233", strokeWidth: 2, tool: "pen" }]
  })}>draw test stroke</button>
}))

const sessions: DocumentSession[] = []
afterEach(() => { cleanup(); sessions.splice(0).forEach(session => session.dispose()); document.body.replaceChildren() })

function mount(kind: "card" | "drawing", listType = "taskList") {
  const empty = kind === "card" ? HNN_CARD_EMPTY_DATA : HNN_DRAWING_EMPTY_DATA
  const initialDocument = { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content: [
    { type: listType, ...(listType === "orderedList" ? { attrs: { start: 1 } } : {}), content: [{ type: listType === "taskList" ? "taskItem" : "listItem",
      ...(listType === "taskList" ? { attrs: { checked: true } } : {}),
      content: [{ type: "paragraph", content: [{ type: "text", text: "keep list" }] }] }] },
    { type: kind, attrs: { data: empty } }
  ] }) }
  let saved: HnnDocument | undefined
  const onChange = vi.fn(), onSave = vi.fn((payload: { document: HnnDocument }) => { saved = payload.document; return Promise.resolve() })
  const options = { documentId: "draft-with-list", loadKey: 1, initialDocument,
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } }, onChange, onSave }
  const session = new DocumentSession(options)
  sessions.push(session)
  const a = session.attachView("a"), b = session.attachView("b")
  document.body.append(a.editor.view.dom, b.editor.view.dom)
  render(<HnnDataDrawer editor={a.editor} theme="light" coordinator={{
    read: () => session.readDraft("a"), write: value => session.writeDraft("a", value),
    open: value => session.beginDraft("a", value), canInput: () => session.draftInputAllowed(),
    change: () => session.updateDraft("editing", true), validating: () => session.updateDraft("validating", false),
    invalid: () => session.updateDraft("invalid", false), commit: callback => session.commitDraft(callback),
    close: () => session.endDraft()
  }} />)
  const openAndEdit = () => {
    fireEvent.click(a.editor.view.dom.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!)
    const dialog = within(document.body).getByRole("dialog")
    fireEvent.click(within(dialog).getByText(kind === "card" ? "添加卡片" : "draw test stroke"))
    return dialog
  }
  return { session, a, b, onChange, onSave, options, empty, openAndEdit, saved: () => saved }
}

it.each(LIST_TYPES.flatMap(({ type }) => (["card", "drawing"] as const).map(kind => ({ type, kind }))))(
  "$kind draft alongside $type commits once while body stays locked, synchronizes peers, undoes/redoes and survives save/reopen",
  async ({ kind, type }) => {
    const h = mount(kind, type), { session, a, b } = h
    const before = a.editor.state.doc, list = before.firstChild!
    const dialog = h.openAndEdit()
    expect(a.editor.view.editable).toBe(false)
    expect(b.editor.view.editable).toBe(false)
    // A drawer owns the input: ordinary body transactions remain forbidden.
    a.editor.view.dispatch(a.editor.state.tr.insertText("blocked", 3))
    expect(a.editor.state.doc.eq(before)).toBe(true)
    expect(h.onChange).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByText("完成"))
    expect(h.onChange).toHaveBeenCalledTimes(1)
    expect(session.getState().draft.phase).toBe("none")
    expect(within(document.body).queryByRole("dialog")).toBeNull()
    const after = a.editor.state.doc
    expect(after.lastChild!.attrs["data"]).not.toBe(h.empty)
    expect(after.firstChild!.eq(list)).toBe(true)
    expect(b.editor.state.doc.eq(after)).toBe(true)
    expect(session.resourceUsage().undoEvents).toBe(1)
    expect(session.history("b", false)).toBe(true)
    expect(a.editor.state.doc.eq(before)).toBe(true)
    expect(b.editor.state.doc.eq(before)).toBe(true)
    expect(session.history("a", true)).toBe(true)
    expect(a.editor.state.doc.eq(after)).toBe(true)
    expect(b.editor.state.doc.eq(after)).toBe(true)
    await act(async () => {
      const save = session.controller.requestSave({ expectedSessionId: session.identity.sessionId, reason: "host-save" })
      expect(save.kind).toBe("pending")
      if (save.kind === "pending") expect((await save.completion).kind).toBe("saved")
    })
    expect(h.onSave).toHaveBeenCalledTimes(1)
    expect(decodeHnn(h.saved()).eq(after)).toBe(true)
    const reopened = new DocumentSession({ ...h.options, loadKey: 2, initialDocument: h.saved() })
    sessions.push(reopened)
    expect(reopened.attachView("reopened").editor.state.doc.eq(after)).toBe(true)
  }
)

it.each(["card", "drawing"] as const)("%s rejected transaction reports failure and retains the drawer draft for retry", kind => {
  const h = mount(kind), { session, a, b } = h
  const before = a.editor.state.doc
  const key = new PluginKey("reject-draft")
  a.editor.registerPlugin(new Plugin({ key, filterTransaction: tr => !tr.docChanged }))
  const dialog = h.openAndEdit()
  fireEvent.click(within(dialog).getByText("完成"))
  expect(within(document.body).getByRole("dialog")).toBe(dialog)
  expect(within(dialog).getByRole("alert").textContent).toContain("未保存更改")
  expect(session.getState().draft).toMatchObject({ phase: "invalid", changed: true })
  expect(a.editor.state.doc.eq(before)).toBe(true)
  expect(b.editor.state.doc.eq(before)).toBe(true)
  expect(session.resourceUsage().undoEvents).toBe(0)
  expect(h.onChange).not.toHaveBeenCalled()
  a.editor.unregisterPlugin(key)
  fireEvent.click(within(dialog).getByText("完成"))
  expect(h.onChange).toHaveBeenCalledTimes(1)
  expect(a.editor.state.doc.lastChild!.attrs["data"]).not.toBe(h.empty)
  expect(b.editor.state.doc.eq(a.editor.state.doc)).toBe(true)
  expect(session.getState().draft.phase).toBe("none")
})

it.each(["card", "drawing"] as const)("%s draft authorization retains strict list budget and freeze rejection", async kind => {
  const h = mount(kind), { session, a, b } = h
  h.openAndEdit()
  const before = a.editor.state.doc
  // Bypass drawer preflight deliberately: the list transaction filter must still
  // enforce codec budgets during the session-authorized commit window.
  expect(session.commitDraft(() => session.dispatch("a", a.editor.state.tr.insertText("x".repeat(HNN_LIMITS.maxAttrBytes + 1), 3)))).toBe(false)
  expect(a.editor.state.doc.eq(before)).toBe(true)
  expect(b.editor.state.doc.eq(before)).toBe(true)
  const expectedSessionId = session.identity.sessionId
  await act(async () => {
    const lease = await session.controller.setInputFrozen(true, { expectedSessionId, requestId: "freeze-draft" })
    expect(lease.kind).toBe("applied")
    const commit = vi.fn(() => session.dispatch("a", a.editor.state.tr.insertText("forbidden", 3)))
    expect(session.commitDraft(commit)).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    if (!("leaseId" in lease)) throw new Error("missing lease")
    await session.controller.setInputFrozen(false, { expectedSessionId, requestId: "freeze-draft", leaseId: lease.leaseId })
  })
  expect(a.editor.state.doc.eq(before)).toBe(true)
  expect(b.editor.state.doc.eq(before)).toBe(true)
  expect(h.onChange).not.toHaveBeenCalled()
  expect(session.resourceUsage().undoEvents).toBe(0)
})

it.each(["forward", "backward"])("Enter replacing a %s selection of all list text preserves both views through shared undo/redo", direction => {
  const session = new DocumentSession({ documentId: "list-selection", loadKey: 1,
    initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content: [
      { type: "taskList", content: ["", "abcdef"].map(text => ({ type: "taskItem", attrs: { checked: true }, content: [
        { type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }
      ] })) }
    ] }) }, initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } }, onSave: async () => {}, onChange: () => {}
  })
  sessions.push(session)
  const a = session.attachView("a").editor, b = session.attachView("b").editor
  // Both views retain their own selection. A replicated split must not trigger
  // Tiptap's generic full-document deletion cleanup in either view.
  for (const editor of [a, b]) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,
    direction === "forward" ? 3 : 13, direction === "forward" ? 13 : 3)))
  const before = a.state.doc
  expect(enterList(a)).toBe(true)
  const after = a.state.doc
  expect(after.childCount).toBe(1)
  expect(after.firstChild!.type.name).toBe("taskList")
  expect(after.firstChild!.childCount).toBe(2)
  expect(after.textContent).toBe("")
  expect(b.state.doc.eq(after)).toBe(true)
  expect(session.history("b", false)).toBe(true)
  expect(a.state.doc.eq(before)).toBe(true)
  expect(b.state.doc.eq(before)).toBe(true)
  expect(session.history("a", true)).toBe(true)
  expect(a.state.doc.eq(after)).toBe(true)
  expect(b.state.doc.eq(after)).toBe(true)
})
