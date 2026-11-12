// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"
import { createEditorSession, type EditorSession } from "./session"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { listOrdinal } from "../hnn/listNumbering"
import { convertList, indentList } from "./listCommands"
import { decodeHnn, encodeHnn } from "../hnn/codec"
import { exportMarkdown, importMarkdown } from "../hnn/markdown"

const sessions: EditorSession[] = []
afterEach(() => { sessions.splice(0).forEach(s => s.destroy()); document.body.replaceChildren() })
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] })
const item = (text: string, extra: object[] = []) => ({ type: "listItem", content: [p(text), ...extra] })
const ol = (items: object[], start = 1, type: string | null = null) => ({ type: "orderedList", attrs: { start, type }, content: items })
function make(content: object[]) {
  const s = createEditorSession({ documentId: "numbering", loadKey: 1,
    initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content }) } })
  sessions.push(s); document.body.append(s.editor.view.dom)
  return s
}
function select(s: EditorSession, text: string) {
  s.editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) s.editor.commands.setTextSelection(pos + 1) })
}
const styles = (s: EditorSession) => Array.from(s.editor.view.dom.querySelectorAll("ol"), n => n.getAttribute("data-hnn-list-style"))
const markers = (s: EditorSession) => Array.from(s.editor.view.dom.querySelectorAll("li[data-hnn-marker]"), n => n.getAttribute("data-hnn-marker"))

it("1.11 derives five levels 1/a/i/1/a without changing serialized data, dirty or history", () => {
  let nested = ol([item("five")])
  for (const text of ["four", "three", "two", "one"]) nested = ol([item(text, [nested])])
  const s = make([nested])
  const before = encodeHnn(s.editor.state.doc)
  expect(styles(s)).toEqual(["1", "a", "i", "1", "a"])
  expect(markers(s)).toEqual(["1", "a", "i", "1", "a"])
  expect(s.state.dirty).toBe(false)
  expect(s.undo()).toBe(false)
  expect(encodeHnn(s.editor.state.doc)).toEqual(before)
  expect(decodeHnn(before).toJSON()).toEqual(s.editor.state.doc.toJSON())
  expect(JSON.stringify(before)).not.toContain("hnn-marker")
})
it.each(["bulletList", "taskList"])("1.11 counts %s ancestors but ignores blockquote and respects explicit types", type => {
  const s = make([{ type: "blockquote", content: [{ type, content: [{ type: type === "taskList" ? "taskItem" : "listItem",
    ...(type === "taskList" ? { attrs: { checked: true } } : {}), content: [p("outer"), ol([item("inner")]), ol([item("explicit")], 4, "I")] }] }] }])
  expect(styles(s)).toEqual(["a", "I"])
  expect(markers(s)).toEqual(["a", "IV"])
  expect(s.state.dirty).toBe(false)
})
it.each([[26, "a", "z"], [27, "a", "aa"], [28, "a", "ab"], [52, "a", "az"], [53, "a", "ba"],
  [4, "i", "iv"], [9, "i", "ix"], [3999, "i", "mmmcmxcix"], [4000, "i", "4000"], [27, "A", "AA"]] as const)(
  "1.11 formats integer %i with style %s as %s", (value, style, result) => expect(listOrdinal(value, style)).toBe(result))
it("1.12 preserves 5/1/7 integers and e/a/g in second-level split conversions with exact undo/redo", () => {
  const s = make([ol([item("parent", [ol([item("first"), item("second"), item("third")], 5)])])])
  select(s, "second")
  const before = s.editor.state.doc
  expect(convertList(s.editor, "bulletList")).toBe(true)
  expect(convertList(s.editor, "orderedList")).toBe(true)
  const children = s.editor.state.doc.firstChild!.firstChild!
  expect([children.child(1), children.child(2), children.child(3)].map(n => n.attrs["start"] as unknown)).toEqual([5, 1, 7])
  expect(markers(s)).toEqual(["1", "e", "a", "g"])
  const after = s.editor.state.doc
  expect(s.undo()).toBe(true); expect(s.undo()).toBe(true)
  expect(s.editor.state.doc.eq(before)).toBe(true)
  expect(s.redo()).toBe(true); expect(s.redo()).toBe(true)
  expect(s.editor.state.doc.eq(after)).toBe(true)
})
it.each([false, true])("1.12 indent uses new start=1 or existing start+index; existing=%s and source tail stays 7", existing => {
  const s = make([ol([item("parent", existing ? [ol([item("child1"), item("child2")], 3)] : []), item("move", [ol([item("descendant")])]), item("tail")], 5)])
  select(s, "move")
  const before = s.editor.state.doc
  const moved = before.firstChild!.child(1)
  expect(indentList(s.editor, false)).toBe(true)
  const doc = s.editor.state.doc, target = doc.firstChild!.firstChild!.lastChild!
  expect(target.attrs["start"]).toBe(existing ? 3 : 1)
  expect(target.lastChild!.eq(moved)).toBe(true)
  expect(doc.lastChild!.attrs["start"]).toBe(7)
  expect(styles(s)).toEqual(["1", "a", "i", "1"])
  expect(markers(s)).toContain(existing ? "e" : "a")
  const after = s.editor.state.doc
  expect(s.undo()).toBe(true); expect(s.editor.state.doc.eq(before)).toBe(true)
  expect(s.redo()).toBe(true); expect(s.editor.state.doc.eq(after)).toBe(true)
})
it("1.12 lift preserves unmoved tail 7 and subtree IDs while descendant styles follow the new depth", () => {
  const s = make([ol([item("parent", [ol([item("first"), item("move", [ol([item("descendant")])]), item("tail")], 5)]), item("outer-tail")], 3)])
  select(s, "move")
  const before = s.editor.state.doc
  const descendant = before.firstChild!.firstChild!.lastChild!.child(1).lastChild!.firstChild!
  expect(indentList(s.editor, true)).toBe(true)
  let tailStart: unknown, descendantId: unknown
  s.editor.state.doc.descendants(node => {
    if (node.type.name === "orderedList" && node.firstChild!.firstChild!.textContent === "tail") tailStart = node.attrs["start"]
    if (node.type.name === "listItem" && node.firstChild!.textContent === "descendant") descendantId = node.attrs["nodeId"]
  })
  expect(tailStart).toBe(7)
  expect(descendantId).toBe(descendant.attrs["nodeId"])
  expect(markers(s)).toContain("g")
  const after = s.editor.state.doc
  expect(s.undo()).toBe(true); expect(s.editor.state.doc.eq(before)).toBe(true)
  expect(s.redo()).toBe(true); expect(s.editor.state.doc.eq(after)).toBe(true)
})
it("1.16 exports integer Markdown and reloads the same starts/types rather than alphabetic body text", () => {
  const s = make([ol([item("parent", [ol([item("child")], 5)])]), ol([item("explicit")], 9, "I")])
  const output = exportMarkdown(encodeHnn(s.editor.state.doc))
  expect(output.markdown).not.toContain("e. child")
  expect(output.markdown).toContain("hamster-note-json-b64")
  const simple = make([ol([item("decimal")], 5)])
  expect(exportMarkdown(encodeHnn(simple.editor.state.doc)).markdown).toContain("5.")
  const imported = importMarkdown(output.markdown)
  if (!("document" in imported)) throw new Error("missing import")
  const roundtrip = decodeHnn(imported.document)
  expect(roundtrip.firstChild!.firstChild!.lastChild!.attrs["start"]).toBe(5)
  expect(roundtrip.lastChild!.attrs["type"]).toBe("I")
})
