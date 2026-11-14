// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { DocumentSession } from "./documentSession"
import { createEditorSession, type EditorSession } from "./session"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { encodeHnn, type HnnDocument } from "../hnn/codec"

const sessions: EditorSession[] = []
function make(type = "taskList", onSave?: Parameters<typeof createEditorSession>[0]["onSave"]) {
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "First" }] }
  const content = type === "paragraph" ? [paragraph] : [{ type, attrs: type === "orderedList" ? { start: 1 } : {}, content: [{
    type: type === "taskList" ? "taskItem" : "listItem", attrs: type === "taskList" ? { checked: false } : {}, content: [paragraph]
  }] }]
  const session = createEditorSession({ documentId: "enter", loadKey: 1, ...(onSave ? { onSave } : {}),
    initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content }) } })
  sessions.push(session)
  document.body.append(session.editor.view.dom)
  session.editor.view.focus()
  return session
}
function key(session: EditorSession, name = "Enter", options: KeyboardEventInit = {}) {
  session.editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
    key: name, code: name, keyCode: name === "Enter" ? 13 : 35,
    bubbles: true, cancelable: true, ...options
  }))
}
function nativeRange(session: EditorSession, anchor: number, head = anchor) {
  const text = session.editor.view.dom.querySelector("p")!.firstChild!
  document.getSelection()!.setBaseAndExtent(text, anchor, text, head)
}
function delayedEnd(session: EditorSession, start = 3) {
  session.editor.commands.setTextSelection({ from: start, to: start + 5 })
  expect(session.editor.state.selection.toJSON()).toMatchObject({ anchor: start, head: start + 5 })
  key(session, "End")
  // jsdom has no End default action. Replay only its DOM selection effect,
  // synchronously, before the queued selectionchange can reach ProseMirror.
  nativeRange(session, 5)
  expect(document.getSelection()!.anchorOffset).toBe(5)
  expect(session.editor.state.selection.empty).toBe(false)
}
function lines(session: EditorSession) {
  const texts: string[] = []
  session.editor.state.doc.descendants(node => { if (node.isTextblock) texts.push(node.textContent) })
  return texts
}
afterEach(() => {
  sessions.splice(0).forEach(session => session.destroy())
  document.body.replaceChildren()
  document.getSelection()?.removeAllRanges()
})

describe("Enter selection ownership", () => {
  it.each(["taskList", "bulletList", "orderedList"])("preserves First in %s when native End precedes selectionchange", type => {
    const session = make(type)
    delayedEnd(session)
    key(session)
    expect(lines(session)).toEqual(["First", ""])
    expect(session.editor.state.doc.firstChild!.childCount).toBe(2)
  })

  it("synchronizes a delayed native range, including its direction, before replacing it", () => {
    const session = make()
    session.editor.commands.setTextSelection(8)
    nativeRange(session, 4, 1)
    key(session)
    expect(lines(session)).toEqual(["F", "t"])
    expect(session.undo()).toBe(true)
    expect(session.editor.state.selection.toJSON()).toMatchObject({ anchor: 7, head: 4 })
  })

  it("preserves pending native End across an unrelated metadata-only transaction", () => {
    const session = make()
    delayedEnd(session)
    const before = session.editor.state.doc
    session.editor.view.dispatch(session.editor.state.tr.setMeta("unrelated", true))
    expect(session.editor.state.doc).toBe(before)
    expect(session.editor.state.selection.toJSON()).toMatchObject({ anchor: 3, head: 8 })
    expect(document.getSelection()!.isCollapsed).toBe(true)
    expect(document.getSelection()!.anchorOffset).toBe(5)
    key(session)
    expect(lines(session)).toEqual(["First", ""])
  })

  it("honors a newer explicit model selection instead of the earlier native End", () => {
    const session = make()
    delayedEnd(session)
    session.editor.commands.setTextSelection({ from: 3, to: 8 })
    key(session)
    expect(lines(session)).toEqual(["", ""])
  })

  it("keeps normal list splitting and selected-text replacement", () => {
    const session = make()
    session.editor.commands.setTextSelection(5)
    key(session)
    expect(lines(session)).toEqual(["Fi", "rst"])
    expect(session.undo()).toBe(true)
    session.editor.commands.setTextSelection({ from: 4, to: 7 })
    key(session)
    expect(lines(session)).toEqual(["F", "t"])
  })

  it.each([{ isComposing: true }, { keyCode: 229 }])("does not take selection ownership during IME %j", options => {
    const session = make()
    delayedEnd(session)
    const state = session.editor.state
    key(session, "Enter", options)
    expect(session.editor.state).toBe(state)
  })

  it("does not import an external selection or change a readonly editor", () => {
    const session = make()
    delayedEnd(session)
    session.editor.setEditable(false)
    const state = session.editor.state
    key(session)
    expect(session.editor.state).toBe(state)
    session.editor.setEditable(true)
    const outside = document.createElement("p")
    outside.textContent = "outside"
    document.body.append(outside)
    document.getSelection()!.setBaseAndExtent(outside.firstChild!, 0, outside.firstChild!, 3)
    key(session)
    // The model selection still owns Enter: no outside text is imported.
    expect(lines(session)).toEqual(["", ""])
  })

  it("uses the delayed native cursor for ordinary paragraph Enter too", () => {
    const session = make("paragraph")
    delayedEnd(session, 1)
    key(session)
    expect(lines(session)).toEqual(["First", ""])
  })

  it("undoes and redoes Enter once, and saves/reopens the preserved text", async () => {
    let saved: HnnDocument | undefined
    const session = make("taskList", document => { saved = document; return Promise.resolve({ kind: "saved" }) })
    const before = session.editor.state.doc
    delayedEnd(session)
    key(session)
    expect(lines(session)).toEqual(["First", ""])
    const after = session.editor.state.doc
    expect(session.undo()).toBe(true)
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(session.undo()).toBe(false)
    expect(session.redo()).toBe(true)
    expect(session.editor.state.doc.eq(after)).toBe(true)
    await expect(session.save()).resolves.toEqual({ kind: "saved" })
    expect(saved).toEqual(encodeHnn(after))
    const reopened = createEditorSession({ documentId: "enter", loadKey: 2, initialDocument: saved! })
    sessions.push(reopened)
    expect(lines(reopened)).toEqual(["First", ""])
  })
})

it.each([false, true])("review: equal model command, subsequent native End=%s", (subsequentEnd) => {
 const session = new DocumentSession({
  documentId: "review", loadKey: 1,
  initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content: [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] }] }] }) },
  initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
  onSave: async () => {}, onChange: () => {}
 })
 const { editor } = session.attachView("a")
 document.body.append(editor.view.dom); editor.view.focus()
 const key = (name = "Enter") => editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: name, code: name, keyCode: name === "Enter" ? 13 : 35, bubbles: true, cancelable: true }))
 const move = () => document.getSelection()!.setBaseAndExtent(editor.view.dom.querySelector("p")!.firstChild!, 5, editor.view.dom.querySelector("p")!.firstChild!, 5)
 try {
  editor.commands.setTextSelection({ from: 3, to: 8 })
  key("End"); move()
  editor.commands.setTextSelection({ from: 3, to: 8 })
  expect(document.getSelection()!.toString()).toBe("First")
  if (subsequentEnd) { key("End"); move() }
  expect(editor.state.selection.toJSON()).toMatchObject({ anchor: 3, head: 8 })
  key()
  const texts: string[] = []
  editor.state.doc.descendants(n => { if (n.isTextblock) texts.push(n.textContent) })
  expect(texts).toEqual(subsequentEnd ? ["First", ""] : ["", ""])
 } finally { session.dispose(); document.body.replaceChildren() }
})
