// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createEditorSession, type EditorSession } from "./session"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { encodeHnn, type HnnDocument } from "../hnn/codec"

const sessions: EditorSession[] = []
function make(type = "taskList", onSave?: Parameters<typeof createEditorSession>[0]["onSave"]) {
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "First" }] }
  const content = type === "paragraph" ? [paragraph] : [{ type, attrs: type === "orderedList" ? { start: 1 } : {}, content: [{
    type: type === "taskList" ? "taskItem" : "listItem", attrs: type === "taskList" ? { checked: false } : {}, content: [paragraph]
  }] }]
  const session = createEditorSession({ documentId: "enter", loadKey: 1, onSave,
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

  it("uses the delayed native cursor for ordinary paragraph Enter too", () => {
    const session = make("paragraph")
    delayedEnd(session, 1)
    key(session)
    expect(lines(session)).toEqual(["First", ""])
  })

  it("undoes and redoes Enter once, and saves/reopens the preserved text", async () => {
    let saved: HnnDocument | undefined
    const session = make("taskList", async document => { saved = document; return { status: "saved" } })
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
    await session.save()
    expect(saved).toEqual(encodeHnn(after))
    const reopened = createEditorSession({ documentId: "enter", loadKey: 2, initialDocument: saved! })
    sessions.push(reopened)
    expect(lines(reopened)).toEqual(["First", ""])
  })
})
