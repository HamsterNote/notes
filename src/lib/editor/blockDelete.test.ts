// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"
import { openBlockDelete } from "./blockDelete"
import { DocumentSession } from "./documentSession"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { reorderTopLevelBlock } from "./blockReorder"
import { encodeHnn } from "../hnn/codec"

const sessions: DocumentSession[] = []
afterEach(() => { sessions.splice(0).forEach(s => s.dispose()); document.body.replaceChildren() })
function make() {
  const session = new DocumentSession({ documentId: "delete", loadKey: 1, initialDocument: {
    schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content: [
      { type: "blockquote", attrs: { author: "张三" }, content: [
        { type: "paragraph", content: [{ type: "text", text: "body", marks: [{ type: "bold" }] }] }
      ] },
      { type: "picture", attrs: { src: "hamster_note_data/images/0123456789abcdef0123456789abcdef.png", alt: "pic" } }
    ] })
  }, initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
  onChange() {}, onSave: async () => {} })
  sessions.push(session)
  const a = session.attachView("a").editor, b = session.attachView("b").editor
  const root = document.createElement("div")
  root.className = "hn-editor"
  const anchor = document.createElement("button")
  root.append(a.view.dom, b.view.dom, anchor); document.body.append(root)
  const nodeId = String(a.state.doc.firstChild!.attrs["nodeId"])
  return { session, a, b, root, anchor, nodeId }
}
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')!
const confirm = () => Array.from(dialog().querySelectorAll("button")).find(b => b.textContent === "确认删除")!
it.each(["edit", "move", "delete"] as const)("remote %s expires an open confirmation without adding a history event", action => {
  const h = make()
  openBlockDelete(h.a, h.nodeId, h.anchor)
  if (action === "edit") h.b.commands.insertContent("remote")
  if (action === "move") reorderTopLevelBlock(h.b.view, 0, 2)
  if (action === "delete") h.b.view.dispatch(h.b.state.tr.delete(0, h.b.state.doc.firstChild!.nodeSize))
  const doc = h.a.state.doc, count = h.session.resourceUsage().undoEvents
  expect(confirm().disabled).toBe(true)
  expect(dialog().textContent).toContain("内容已变化，请重新打开")
  confirm().click()
  expect(h.a.state.doc).toBe(doc)
  expect(h.session.resourceUsage().undoEvents).toBe(count)
})
it("selection changes allow confirmation; exact subtree undo/redo replicates once; resources are untouched", () => {
  const h = make(), before = encodeHnn(h.a.state.doc)
  openBlockDelete(h.a, h.nodeId, h.anchor)
  h.a.commands.setTextSelection(3)
  expect(confirm().disabled).toBe(false)
  confirm().click()
  expect(h.a.state.doc.firstChild!.type.name).toBe("picture")
  expect(h.a.state.doc.eq(h.b.state.doc)).toBe(true)
  expect(h.session.resourceUsage().undoEvents).toBe(1)
  expect(h.session.history("b", false)).toBe(true)
  expect(encodeHnn(h.a.state.doc)).toEqual(before)
  expect(h.session.history("a", true)).toBe(true)
  expect(h.a.state.doc.firstChild!.type.name).toBe("picture")
})
it("freeze closes the confirmation and session disposal removes it", async () => {
  const h = make()
  openBlockDelete(h.a, h.nodeId, h.anchor)
  await h.session.controller.setInputFrozen(true, { expectedSessionId: h.session.identity.sessionId, requestId: "delete" })
  await Promise.resolve()
  expect(dialog()).toBeNull()
  h.session.dispose()
  expect(dialog()).toBeNull()
})
