// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"
import { fireEvent } from "@testing-library/dom"
import { createEditorSession, type EditorSession } from "./session"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
const sessions: EditorSession[] = []
afterEach(() => { sessions.splice(0).forEach(s => s.destroy()); document.body.replaceChildren() })
function make() {
  const s = createEditorSession({ documentId: "keys", loadKey: 1, initialDocument: { schemaVersion: 1,
    data: normalizeInitialHnnContent({ type: "doc", content: [{ type: "paragraph" }] }) } })
  sessions.push(s); document.body.append(s.editor.view.dom); s.editor.view.focus()
  return s
}
it.each(["ctrlKey", "metaKey"] as const)("standalone %s undo/redo and uppercase Z match toolbar and consume empty stack", modifier => {
  const s = make(), dom = s.editor.view.dom
  expect(fireEvent.keyDown(dom, { key: "z", [modifier]: true })).toBe(false)
  s.editor.commands.insertContent("text")
  expect(fireEvent.keyDown(dom, { key: "z", [modifier]: true })).toBe(false)
  expect(s.editor.state.doc.textContent).toBe("")
  expect(fireEvent.keyDown(dom, { key: "Z", shiftKey: true, [modifier]: true })).toBe(false)
  expect(s.editor.state.doc.textContent).toBe("text")
  s.undo()
  fireEvent.keyDown(dom, { key: "y", [modifier]: true })
  expect(s.editor.state.doc.textContent).toBe("text")
})
it("standalone IME, 229, Alt, readonly and external input do not consume body undo", () => {
  const s = make(), dom = s.editor.view.dom
  s.editor.commands.insertContent("text")
  for (const props of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }]) {
    expect(fireEvent.keyDown(dom, { key: "z", ctrlKey: true, ...props })).toBe(true)
    expect(s.editor.state.doc.textContent).toBe("text")
  }
  fireEvent.compositionStart(dom)
  expect(fireEvent.keyDown(dom, { key: "z", ctrlKey: true })).toBe(true)
  fireEvent.compositionEnd(dom)
  s.editor.setEditable(false)
  expect(fireEvent.keyDown(dom, { key: "z", ctrlKey: true })).toBe(true)
  expect(s.editor.state.doc.textContent).toBe("text")
})
