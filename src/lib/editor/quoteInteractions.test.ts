// @vitest-environment jsdom
import type { Editor } from "@tiptap/core"
import { afterEach, expect, it } from "vitest"
import { fireEvent } from "@testing-library/dom"
import { createEditorSession, type EditorSession } from "./session"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { commitBudgetedTransaction } from "../hnn/budgetedTransaction"
import { HNN_LIMITS } from "../hnn/limits"
import { encodeHnn } from "../hnn/codec"
import { DocumentSession } from "./documentSession"

const sessions: EditorSession[] = []
afterEach(() => { sessions.splice(0).forEach(s => s.destroy()); document.body.replaceChildren() })
const p = (text = "", marks: object[] = []) => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text, ...(marks.length ? { marks } : {}) }] } : {}) })
function make(content: object[] = [p()]) {
  const s = createEditorSession({ documentId: "quotes", loadKey: 1,
    initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content }) } })
  sessions.push(s); document.body.append(s.editor.view.dom)
  return s
}
function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection, view = editor.view
  const handled = view.someProp("handleTextInput", handler => handler(view, from, to, text, () => view.state.tr.insertText(text, from, to)))
  if (!handled) commitBudgetedTransaction(editor, editor.state.tr.insertText(text, from, to))
}
function enter(editor: Editor, shiftKey = false) {
  return editor.view.someProp("handleKeyDown", handler => handler(editor.view, new KeyboardEvent("keydown", { key: "Enter", shiftKey })))
}

it("1.13 bare > stays literal; > space consumes only prefix, retaining tail, marks, paragraph ID and undo text", () => {
  const s = make([p("tail", [{ type: "bold" }])]), { editor } = s
  const id: unknown = editor.state.doc.firstChild!.attrs["nodeId"]
  editor.commands.setTextSelection(1)
  type(editor, ">")
  expect(editor.state.doc.firstChild!.type.name).toBe("paragraph")
  type(editor, " ")
  const quote = editor.state.doc.firstChild!
  expect(quote.type.name).toBe("blockquote")
  expect(quote.attrs["author"]).toBeNull()
  expect(quote.firstChild!.attrs["nodeId"]).toBe(id)
  expect(quote.textContent).toBe("tail")
  expect(quote.firstChild!.firstChild!.marks[0]!.type.name).toBe("bold")
  expect(editor.state.selection.$from.parentOffset).toBe(0)
  expect(s.undo()).toBe(true)
  expect(editor.state.doc.firstChild!.type.name).toBe("paragraph")
  expect(editor.state.doc.textContent).toBe("> tail")
  expect(s.redo()).toBe(true)
  expect(editor.state.doc.firstChild!.eq(quote)).toBe(true)
})
it("nested quote Enter exits the whole contiguous chain, Shift+Enter stays inside", () => {
  const s = make(), { editor } = s
  type(editor, ">"); type(editor, " ")
  type(editor, ">"); type(editor, " ")
  type(editor, "body")
  expect(enter(editor, true)).toBe(true)
  expect(editor.state.selection.$from.parent.lastChild!.type.name).toBe("hardBreak")
  type(editor, "next")
  const before = editor.state.doc
  expect(enter(editor)).toBe(true)
  expect(editor.state.doc.childCount).toBe(2)
  expect(editor.state.doc.lastChild!.type.name).toBe("paragraph")
  expect(editor.state.selection.$from.depth).toBe(1)
  expect(s.undo()).toBe(true)
  expect(editor.state.doc.eq(before)).toBe(true)
  expect(s.redo()).toBe(true)
  expect(editor.state.doc.lastChild!.type.name).toBe("paragraph")
})
it.each([0, 1, 2])("quote exit at offset %s retains text, marks, author and exact undo", offset => {
  const s = make([{ type: "blockquote", attrs: { author: "Ada" }, content: [p("甲乙", [{ type: "bold" }]), p("丙")] }])
  s.editor.commands.setTextSelection(2 + offset)
  const before = s.editor.state.doc
  expect(enter(s.editor)).toBe(true)
  const doc = s.editor.state.doc
  expect(doc.textContent).toBe("甲乙丙")
  expect(doc.child(offset ? 1 : 0).type.name).toBe("paragraph")
  expect(doc.child(offset ? 1 : 0).textContent).toBe("甲乙".slice(offset))
  expect(s.editor.state.selection.$from.parentOffset).toBe(0)
  expect(() => encodeHnn(doc)).not.toThrow()
  expect(s.undo()).toBe(true)
  expect(s.editor.state.doc.eq(before)).toBe(true)
  expect(s.redo()).toBe(true)
  expect(s.editor.state.doc.eq(doc)).toBe(true)
})
it("1.13 undoing exit from an empty quote restores its exact wrapper and author", () => {
  const s = make([{ type: "blockquote", attrs: { author: "author" }, content: [p()] }])
  const before = s.editor.state.doc
  expect(enter(s.editor)).toBe(true)
  expect(s.editor.state.doc.firstChild!.type.name).toBe("paragraph")
  expect(s.undo()).toBe(true)
  expect(s.editor.state.doc.eq(before)).toBe(true)
})
it.each([
  { type: "paragraph", text: "x >" }, { type: "paragraph", text: "\\>" },
  { type: "codeBlock", text: ">" }, { type: "heading", text: ">" },
  { type: "bulletList", text: ">" }, { type: "taskList", text: ">" }
])("1.13 excludes $type context containing $text", ({ type: kind, text }) => {
  const block = kind.endsWith("List") ? { type: kind, content: [{ type: kind === "taskList" ? "taskItem" : "listItem",
    ...(kind === "taskList" ? { attrs: { checked: false } } : {}), content: [p(text)] }] }
    : { ...p(text), type: kind, ...(kind === "heading" ? { attrs: { level: 2 } } : kind === "codeBlock" ? { attrs: { language: "text", filename: "untitled.txt" } } : {}) }
  const s = make([block])
  s.editor.commands.setTextSelection(s.editor.state.selection.from + text.length)
  type(s.editor, " ")
  expect(s.editor.state.doc.textContent).toBe(text + " ")
  expect(s.editor.view.dom.querySelector("blockquote")).toBeNull()
})
it("1.13 ignores nonempty selection and composition, rejects readonly without history", () => {
  const s = make([p(">x")]), { editor } = s
  editor.commands.setTextSelection({ from: 2, to: 3 })
  type(editor, " ")
  expect(editor.state.doc.firstChild!.type.name).toBe("paragraph")
  fireEvent.compositionStart(editor.view.dom)
  editor.commands.setTextSelection(2)
  type(editor, " ")
  expect(editor.state.doc.firstChild!.type.name).toBe("paragraph")
  fireEvent.compositionEnd(editor.view.dom)
  editor.setEditable(false)
  const before = editor.state
  type(editor, " ")
  expect(editor.state).toBe(before)
})
it("1.13 depth budget failure retains literal prefix, tail and original wrapping", () => {
  let block: object = p(">tail")
  for (let i = 0; i < HNN_LIMITS.maxDepth - 3; i++) block = { type: "blockquote", content: [block] }
  const s = make([block]), { editor } = s
  editor.commands.setTextSelection(editor.state.selection.from + 1)
  type(editor, " ")
  expect(editor.state.doc.textContent).toBe("> tail")
  expect(editor.view.dom.querySelectorAll("blockquote")).toHaveLength(HNN_LIMITS.maxDepth - 3)
  expect(() => encodeHnn(editor.state.doc)).not.toThrow()
})

it("1.13 list Enter inside a quote splits the item and resets checked instead of splitting its paragraph", () => {
  const s = make([{ type: "blockquote", attrs: { author: "author" }, content: [{ type: "taskList", content: [
    { type: "taskItem", attrs: { checked: true }, content: [p("body")] }
  ] }] }])
  s.editor.commands.setTextSelection(s.editor.state.selection.from + 4)
  expect(enter(s.editor)).toBe(true)
  const quote = s.editor.state.doc.firstChild!, list = quote.firstChild!
  expect(quote.attrs["author"]).toBe("author")
  expect(list.childCount).toBe(2)
  expect(list.firstChild!.attrs["checked"]).toBe(true)
  expect(list.lastChild!.attrs["checked"]).toBe(false)
})
it("1.13 full node budget retains literal > space without adding a quote", () => {
  const s = make([p(">tail"), ...Array.from({ length: 509 }, () => p())])
  s.editor.commands.setTextSelection(2)
  type(s.editor, " ")
  expect(s.editor.state.doc.firstChild!.textContent).toBe("> tail")
  expect(s.editor.view.dom.querySelector("blockquote")).toBeNull()
  expect(() => encodeHnn(s.editor.state.doc)).not.toThrow()
}, 20000)
it("1.13 shell budget rejects wrapping atomically while literal input fits", () => {
  const raw = normalizeInitialHnnContent({ type: "doc", content: [p(">tail"), ...Array.from({ length: 65 }, () => p("x"))] })
  const shell = { schemaVersion: 1, data: raw }
  let remaining = HNN_LIMITS.maxShellBytes - new TextEncoder().encode(JSON.stringify(shell)).length - 40
  for (const node of (raw["content"] as { content: { text: string }[] }[]).slice(1)) {
    const count = Math.min(remaining, 8000)
    node.content[0]!.text += "a".repeat(count); remaining -= count
  }
  expect(remaining).toBe(0)
  const s = createEditorSession({ documentId: "shell", loadKey: 1, initialDocument: shell })
  sessions.push(s)
  s.editor.commands.setTextSelection(2)
  type(s.editor, " ")
  expect(s.editor.state.doc.firstChild!.textContent).toBe("> tail")
  expect(s.editor.state.doc.firstChild!.type.name).toBe("paragraph")
  expect(() => encodeHnn(s.editor.state.doc)).not.toThrow()
})
it("1.13 freeze blocks the shortcut and Enter; shared quote history and author survive save/reopen", async () => {
  const initialDocument = { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content: [p(">tail")] }) }
  let saved = initialDocument
  const session = new DocumentSession({ documentId: "shared-quote", loadKey: 1, initialDocument,
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onChange: () => {},
    onSave: payload => { saved = payload.document; return Promise.resolve() } })
  try {
    const a = session.attachView("a").editor, b = session.attachView("b").editor
    a.commands.setTextSelection(2)
    const expectedSessionId = session.identity.sessionId
    const lease = await session.controller.setInputFrozen(true, { expectedSessionId, requestId: "quote" })
    const before = a.state
    type(a, " ")
    expect(a.state).toBe(before)
    expect(session.resourceUsage().undoEvents).toBe(0)
    if (!("leaseId" in lease)) throw new Error("missing lease")
    await session.controller.setInputFrozen(false, { expectedSessionId, requestId: "quote", leaseId: lease.leaseId })
    type(a, " ")
    expect(a.state.doc.firstChild!.type.name).toBe("blockquote")
    expect(b.state.doc.eq(a.state.doc)).toBe(true)
    expect(session.history("b", false)).toBe(true)
    expect(a.state.doc.firstChild!.textContent).toBe("> tail")
    expect(session.history("a", true)).toBe(true)
    const frozen = await session.controller.setInputFrozen(true, { expectedSessionId, requestId: "enter" })
    const quoted = a.state
    expect(enter(a)).toBe(true); expect(a.state).toBe(quoted)
    if (!("leaseId" in frozen)) throw new Error("missing lease")
    await session.controller.setInputFrozen(false, { expectedSessionId, requestId: "enter", leaseId: frozen.leaseId })
    const result = session.controller.requestSave({ expectedSessionId, reason: "host-save" })
    if (result.kind !== "pending") throw new Error("missing save")
    expect((await result.completion).kind).toBe("saved")
    const reopened = createEditorSession({ documentId: "shared-quote", loadKey: 2, initialDocument: saved })
    sessions.push(reopened)
    expect(encodeHnn(reopened.editor.state.doc)).toEqual(saved)
  } finally { session.dispose() }
})

it("same-line selection exits atomically, while cross-line selection keeps generic replacement", () => {
  const s = make([{ type: "blockquote", content: [p("abcd"), p("tail")] }])
  s.editor.commands.setTextSelection({ from: 3, to: 5 })
  const before = s.editor.state.doc
  enter(s.editor)
  expect(s.editor.state.doc.child(0).textContent).toBe("a")
  expect(s.editor.state.doc.child(1).textContent).toBe("d")
  expect(s.editor.state.doc.child(2).textContent).toBe("tail")
  s.undo()
  expect(s.editor.state.doc.eq(before)).toBe(true)
  s.editor.commands.setTextSelection({ from: 3, to: 9 })
  enter(s.editor)
  expect(s.editor.state.doc.firstChild!.type.name).toBe("blockquote")
})
it("Enter stays within a table cell, supports headings and keeps inline atoms", () => {
  const s = make([{ type: "table", content: [{ type: "tableRow", content: [
    { type: "tableCell", content: [{ type: "blockquote", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "head" }, { type: "hardBreak" }, { type: "text", text: "tail" }] }
    ] }] }
  ] }] }])
  s.editor.commands.setTextSelection(s.editor.state.selection.from + 2)
  const before = s.editor.state.doc
  enter(s.editor)
  const cell = s.editor.state.doc.firstChild!.firstChild!.firstChild!
  expect(cell.childCount).toBe(2)
  expect(cell.child(1).type.name).toBe("paragraph")
  expect(cell.child(1).child(1).type.name).toBe("hardBreak")
  expect(s.editor.state.selection.$from.node(3).type.name).toBe("tableCell")
  s.undo()
  expect(s.editor.state.doc.eq(before)).toBe(true)
})
it.each([{ isComposing: true }, { keyCode: 229 }])("Enter ignores composition %j", options => {
  const s = make([{ type: "blockquote", content: [p("body")] }])
  const before = s.editor.state
  s.editor.view.someProp("handleKeyDown", h => h(s.editor.view, new KeyboardEvent("keydown", { key: "Enter", ...options })))
  expect(s.editor.state).toBe(before)
})
it("node budget rejects quote splitting without changing selection or history", () => {
  const s = make([{ type: "blockquote", content: [p("甲乙"), p("丙")] }, ...Array.from({ length: 505 }, () => p())])
  s.editor.commands.setTextSelection(3)
  const before = s.editor.state
  enter(s.editor)
  expect(s.editor.state).toBe(before)
  expect(s.undo()).toBe(false)
}, 20000)
