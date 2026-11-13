// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { fireEvent } from "@testing-library/dom"
import { createEditorSession, type EditorSession } from "./session"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { SLASH_TARGETS, slashConversionCandidate } from "./slashCommands"
import { commitBudgetedTransaction } from "../hnn/budgetedTransaction"
import { encodeHnn } from "../hnn/codec"
import { HNN_LIMITS } from "../hnn/limits"

const sessions: EditorSession[] = []
afterEach(() => { sessions.splice(0).forEach(s => s.destroy()); vi.restoreAllMocks(); document.body.replaceChildren() })
const p = (text = "") => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) })
function make(content: object[] = [p("正文")]) {
  const s = createEditorSession({ documentId: "slash", loadKey: 1,
    initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content }) } })
  sessions.push(s)
  document.body.append(s.editor.view.dom)
  vi.spyOn(s.editor.view, "coordsAtPos").mockReturnValue({ left: 10, right: 10, top: 10, bottom: 30 })
  return s
}
function input(s: EditorSession, text = "/") {
  const { view, state } = s.editor, { from, to } = state.selection
  return view.someProp("handleTextInput", h => h(view, from, to, text, () => state.tr.insertText(text, from, to)))
}
function key(s: EditorSession, key: string) {
  return s.editor.view.someProp("handleKeyDown", h => h(s.editor.view, new KeyboardEvent("keydown", { key })))
}
const menu = () => document.querySelector('[role="listbox"]')
it("only nine conversions; keyboard skips current type, consumes slash atomically and undo restores it", () => {
  const s = make()
  expect(input(s)).toBe(true)
  expect(menu()!.querySelectorAll('[role="option"]')).toHaveLength(9)
  expect(menu()!.querySelector('[aria-selected="true"]')!.textContent).toBe("标题 1")
  expect(key(s, "ArrowDown")).toBe(true)
  expect(menu()!.querySelector('[aria-selected="true"]')!.textContent).toBe("标题 2")
  const before = s.editor.state.doc
  expect(key(s, "Enter")).toBe(true)
  expect(menu()).toBeNull()
  const after = s.editor.state.doc
  expect(after.firstChild!.type.name).toBe("heading")
  expect(after.firstChild!.attrs["level"]).toBe(2)
  expect(after.textContent).toBe("正文")
  expect(s.editor.state.selection.$from.parentOffset).toBe(0)
  expect(s.undo()).toBe(true)
  expect(s.editor.state.doc.eq(before)).toBe(true)
  expect(s.redo()).toBe(true)
  expect(s.editor.state.doc.eq(after)).toBe(true)
})
it.each(SLASH_TARGETS.filter(t => t.type !== "paragraph"))("converts to $label preserving line identity and text", target => {
  const s = make()
  input(s)
  const before = s.editor.state.doc
  const tr = slashConversionCandidate(s.editor, target)
  expect(tr).not.toBeNull()
  expect(commitBudgetedTransaction(s.editor, tr!)).toBe(true)
  expect(s.editor.state.doc.firstChild!.type.name).toBe(target.type)
  expect(s.editor.state.doc.textContent).toBe("正文")
  expect(() => encodeHnn(s.editor.state.doc)).not.toThrow()
  expect(s.undo()).toBe(true)
  expect(s.editor.state.doc.eq(before)).toBe(true)
})
it.each([1, 2])("no trigger at nonzero logical offset %s", offset => {
  const s = make([p("a b")])
  s.editor.commands.setTextSelection(1 + offset)
  expect(input(s)).not.toBe(true)
  expect(menu()).toBeNull()
})
it("no trigger in code, on load, for nonempty selection, composition or paste", () => {
  const s = make([p("/loaded")])
  expect(menu()).toBeNull()
  s.editor.commands.setTextSelection({ from: 1, to: 3 })
  expect(input(s)).not.toBe(true)
  s.editor.commands.setTextSelection(1)
  fireEvent.compositionStart(s.editor.view.dom)
  expect(input(s)).not.toBe(true)
  fireEvent.compositionEnd(s.editor.view.dom)
  s.editor.commands.setContent({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "code" }] }] })
  expect(input(s)).not.toBe(true)
})
it("escape and further input leave slash literal; external change, caret leaving line and readonly clear menu", () => {
  const s = make([p(), p("next")])
  input(s)
  const before = s.editor.state.doc
  key(s, "Escape")
  expect(menu()).toBeNull()
  expect(s.editor.state.doc).toBe(before)
  s.editor.commands.setTextSelection(1)
  input(s)
  input(s, "x")
  expect(menu()).toBeNull()
  s.editor.commands.setTextSelection(1)
  input(s)
  s.editor.commands.insertContent("changed")
  expect(menu()).toBeNull()
  s.editor.commands.setTextSelection(1)
  input(s)
  s.editor.commands.setTextSelection(s.editor.state.doc.firstChild!.nodeSize + 1)
  expect(menu()).toBeNull()
  s.editor.commands.setTextSelection(1)
  input(s)
  s.editor.setEditable(false)
  expect(menu()).toBeNull()
})
it("nested quote and table line conversions do not convert other lines or containers", () => {
  const s = make([{ type: "blockquote", content: [p("first"), p("second")] }])
  input(s)
  key(s, "Enter")
  expect(s.editor.state.doc.firstChild!.type.name).toBe("blockquote")
  expect(s.editor.state.doc.firstChild!.firstChild!.type.name).toBe("heading")
  expect(s.editor.state.doc.firstChild!.lastChild!.type.name).toBe("paragraph")
  expect(s.editor.state.doc.textContent).toBe("firstsecond")
})
it("list first paragraph disables invalid headings and preserves peer items on list conversion", () => {
  const s = make([{ type: "orderedList", attrs: { start: 3 }, content: [
    { type: "listItem", content: [p("a")] }, { type: "listItem", content: [p("b")] }
  ] }])
  input(s)
  const heading = Array.from(menu()!.querySelectorAll("button")).find(b => b.textContent === "标题 1")!
  expect(heading.disabled).toBe(true)
  const target = SLASH_TARGETS.find(t => t.type === "taskList")!
  const tr = slashConversionCandidate(s.editor, target)
  expect(tr).not.toBeNull()
  commitBudgetedTransaction(s.editor, tr!)
  const doc = s.editor.state.doc
  expect(doc.childCount).toBe(2)
  expect(doc.child(0).type.name).toBe("taskList")
  expect(doc.child(1).attrs["start"]).toBe(4)
  expect(doc.child(1).textContent).toBe("b")
})
it("code conversion refuses marks and preserves slash; Home/End navigate and mouse does not require focus", () => {
  const s = make()
  s.editor.commands.selectAll()
  s.editor.commands.setBold()
  s.editor.commands.setTextSelection(1)
  input(s)
  const before = s.editor.state.doc
  expect(slashConversionCandidate(s.editor, SLASH_TARGETS.find(t => t.type === "codeBlock")!)).toBeNull()
  expect(s.editor.state.doc).toBe(before)
  key(s, "End")
  expect(menu()!.querySelector('[aria-selected="true"]')!.textContent).toBe("待办列表")
  key(s, "Home")
  expect(menu()!.querySelector('[aria-selected="true"]')!.textContent).toBe("标题 1")
  fireEvent.click(menu()!.querySelector('[aria-selected="true"]')!)
  expect(s.editor.state.doc.firstChild!.type.name).toBe("heading")
})

it("an offscreen anchor or IME closes the menu", () => {
  const s = make()
  input(s)
  fireEvent.compositionStart(s.editor.view.dom)
  expect(menu()).toBeNull()
  fireEvent.compositionEnd(s.editor.view.dom)
  s.editor.commands.setTextSelection(1)
  input(s)
  vi.spyOn(s.editor.view, "coordsAtPos").mockReturnValue({ left: 10, right: 10, top: -100, bottom: -80 })
  fireEvent.scroll(window)
  expect(menu()).toBeNull()
})
it("a legal table line converts without changing peer cells; code marks cannot be discarded", () => {
  const s = make([{ type: "table", content: [{ type: "tableRow", content: [
    { type: "tableCell", content: [p("first")] }, { type: "tableCell", content: [p("peer")] }
  ] }] }])
  input(s)
  const before = s.editor.state.doc
  const tr = slashConversionCandidate(s.editor, SLASH_TARGETS.find(t => t.type === "blockquote")!)
  expect(tr).not.toBeNull()
  commitBudgetedTransaction(s.editor, tr!)
  const cells = s.editor.state.doc.firstChild!.firstChild!
  expect(cells.firstChild!.firstChild!.type.name).toBe("blockquote")
  expect(cells.lastChild!.textContent).toBe("peer")
  s.undo()
  expect(s.editor.state.doc.eq(before)).toBe(true)
})


it("depth budget disables wrapping without consuming slash or altering history", () => {
  let block: object = p("text")
  for (let i = 0; i < HNN_LIMITS.maxDepth - 3; i++) block = { type: "blockquote", content: [block] }
  const s = make([block])
  input(s)
  const before = s.editor.state.doc
  expect(slashConversionCandidate(s.editor, SLASH_TARGETS.find(t => t.type === "blockquote")!)).toBeNull()
  expect(s.editor.state.doc).toBe(before)
  expect(s.editor.state.doc.textContent).toBe("/text")
  expect(s.undo()).toBe(true)
  expect(s.editor.state.doc.textContent).toBe("text")
})

it("a detached old menu callback cannot execute a newly opened conversion", () => {
  const s = make()
  input(s)
  const oldButton = menu()!.querySelector<HTMLButtonElement>('button:not(:disabled)')!
  key(s, "Escape")
  s.editor.commands.setTextSelection(1)
  input(s)
  const before = s.editor.state.doc
  oldButton.click()
  expect(s.editor.state.doc).toBe(before)
  expect(menu()).not.toBeNull()
})
