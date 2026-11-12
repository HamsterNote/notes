// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { EditorState, TextSelection } from "@tiptap/pm/state"
import { Schema } from "@tiptap/pm/model"
import type { Editor } from "@tiptap/core"
import { createEditorSession, type EditorSession } from "./session"
import { convertList, enterList, indentList, LIST_TYPES, listConversionCandidate, resolveListTarget, toggleTask } from "./listCommands"
import { encodeHnn } from "../hnn/codec"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { getBlockCommands } from "./blockMenu"
import { HNN_LIMITS } from "../hnn/limits"
import { hnnRuntimeSchema } from "../hnn/extensions"

const p = (text = "", extra: object[] = []) => ({ type: "paragraph", ...(text || extra.length ? { content: [
  ...(text ? [{ type: "text", text, marks: [{ type: "bold" }] }] : []), ...extra
] } : {}) })
const item = (text: string, type = "bulletList", rest: object[] = [], checked = true) => ({
  type: type === "taskList" ? "taskItem" : "listItem", attrs: type === "taskList" ? { checked } : {}, content: [p(text), ...rest]
})
const list = (type: string, content = [item("one", type), item("two", type), item("three", type)], attrs = {}) => ({ type, attrs: { ...(type === "orderedList" ? { start: 1 } : {}), ...attrs }, content })
const sessions: EditorSession[] = []
function make(content: object[]) {
  const session = createEditorSession({ documentId: "lists", loadKey: 1,
    initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content }) } })
  sessions.push(session)
  document.body.append(session.editor.view.dom)
  return session
}
function pos(editor: Editor, text: string) {
  let result = -1
  editor.state.doc.descendants((node, at) => { if (node.isTextblock && node.textContent === text) result = at + 1 })
  if (result < 0) throw new Error(`missing paragraph ${text}`)
  return result
}
function select(editor: Editor, text: string, end?: string) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos(editor, text), end ? pos(editor, end) + 1 : undefined)))
}
const types = (editor: Editor) => Array.from({ length: editor.state.doc.childCount }, (_, i) => editor.state.doc.child(i).type.name)
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); document.body.replaceChildren() })

describe("M1.1 list targets", () => {
  it("resolves one cursor item, partial contiguous range and a half-open endpoint, leaving other items unchanged", () => {
    const { editor } = make([list("orderedList", undefined, { start: 5 })])
    select(editor, "two")
    expect(resolveListTarget(editor)).toMatchObject({ first: 1, end: 2 })
    editor.commands.setTextSelection({ from: pos(editor, "one") + 1, to: pos(editor, "three") })
    expect(resolveListTarget(editor)).toMatchObject({ first: 0, end: 2 })
    const untouched = editor.state.doc.firstChild!.child(2)
    expect(convertList(editor, "taskList")).toBe(true)
    expect(editor.state.doc.lastChild!.firstChild!.eq(untouched)).toBe(true)
  })
  it("rejects cross-level/cross-container/mixed/atom selections; block target ignores residual cursor", () => {
    const { editor } = make([list("bulletList", [item("parent", "bulletList", [list("taskList", [item("child", "taskList")])]), item("sibling")]), list("bulletList", [item("other")]), p("plain")])
    for (const [from, to] of [["parent", "child"], ["sibling", "other"], ["other", "plain"]]) {
      select(editor, from!, to)
      const state = editor.state
      expect(resolveListTarget(editor)).toBeNull()
      expect(convertList(editor, "orderedList")).toBe(false)
      expect(editor.state).toBe(state)
    }
    select(editor, "plain")
    expect(resolveListTarget(editor, 0)).toMatchObject({ first: 0, end: 2 })
    expect(convertList(editor, "orderedList", 0)).toBe(true)
    expect(types(editor)).toEqual(["orderedList", "bulletList", "paragraph"])
    editor.commands.setNodeSelection(0)
    expect(resolveListTarget(editor)).toBeNull()
  })
})

describe("M1.2 six conversions and paragraph creation", () => {
  for (const { type } of LIST_TYPES) {
    it(`creates ${type} from consecutive paragraphs without changing inline content/selection`, () => {
      const { editor } = make([p("one", [{ type: "mention", attrs: { resourceId: "ref", name: "引用" } }]), p("two"), p("three")])
      const first = editor.state.doc.firstChild!
      select(editor, "one", "two")
      expect(convertList(editor, type)).toBe(true)
      expect(editor.state.doc.firstChild!.childCount).toBe(2)
      expect(editor.state.doc.firstChild!.firstChild!.firstChild!.eq(first)).toBe(true)
      expect(editor.state.selection.$from.parent.textContent).toBe("one")
      expect(editor.state.selection.$to.parent.textContent).toBe("two")
      expect(editor.state.doc.lastChild!.textContent).toBe("three")
      expect(() => encodeHnn(editor.state.doc)).not.toThrow()
    })
    for (const { type: destination } of LIST_TYPES) {
      it(`${type} -> ${destination} preserves IDs, marks, refs, multiple paragraphs and mixed descendants`, () => {
        const child = list("taskList", [item("child", "taskList")])
        const { editor } = make([list(type, [item("parent", type, [p("second", [{ type: "mention", attrs: { resourceId: "ref", name: "引用" } }]), child, list("orderedList", [item("number")], { start: 8 })])])])
        select(editor, "parent")
        const original = editor.state.doc
        const content = original.firstChild!.firstChild!.content
        expect(convertList(editor, destination)).toBe(type !== destination)
        if (type === destination) expect(editor.state.doc).toBe(original)
        expect(editor.state.doc.firstChild!.firstChild!.content.eq(content)).toBe(true)
        expect(editor.state.doc.firstChild!.firstChild!.attrs["nodeId"]).toBe(original.firstChild!.firstChild!.attrs["nodeId"])
        expect(editor.state.doc.firstChild!.firstChild!.child(2).firstChild!.attrs["checked"]).toBe(true)
        if (destination === "taskList") expect(editor.state.doc.firstChild!.firstChild!.attrs["checked"]).toBe(type === destination)
        else expect(editor.state.doc.firstChild!.firstChild!.attrs).not.toHaveProperty("checked")
        expect(() => encodeHnn(editor.state.doc)).not.toThrow()
      })
    }
  }
})

describe("M1.3 numbering and history", () => {
  it("splits 5/6/7 into 5/bullet/7, converts back to separate 5/1/7 without joining", () => {
    const { editor } = make([list("orderedList", undefined, { start: 5, type: "A" })])
    select(editor, "two")
    expect(convertList(editor, "bulletList")).toBe(true)
    expect(types(editor)).toEqual(["orderedList", "bulletList", "orderedList"])
    expect(editor.state.doc.firstChild!.attrs).toMatchObject({ start: 5, type: "A" })
    expect(editor.state.doc.lastChild!.attrs).toMatchObject({ start: 7, type: "A" })
    expect(convertList(editor, "orderedList")).toBe(true)
    expect(Array.from({ length: 3 }, (_, i) => editor.state.doc.child(i).attrs["start"] as unknown)).toEqual([5, 1, 7])
    expect(editor.state.doc.child(1).attrs["type"]).toBeNull()
    expect(() => encodeHnn(editor.state.doc)).not.toThrow()
  })
  it("clears checked on exit, reinitializes false and undo/redo restores true and child state", () => {
    const session = make([list("taskList", [item("parent", "taskList", [list("taskList", [item("child", "taskList")])])])])
    const { editor } = session
    select(editor, "parent")
    const original = editor.state.doc
    expect(convertList(editor, "bulletList")).toBe(true)
    expect(convertList(editor, "taskList")).toBe(true)
    expect(editor.state.doc.firstChild!.firstChild!.attrs["checked"]).toBe(false)
    expect(session.undo()).toBe(true)
    expect(editor.state.doc.firstChild!.firstChild!.attrs).not.toHaveProperty("checked")
    expect(session.undo()).toBe(true)
    expect(editor.state.doc.eq(original)).toBe(true)
    expect(session.redo()).toBe(true)
  })
})

describe("M1.4 explicit block menu and lossless unwrapping", () => {
  it("rejects unwrap when the parent cannot accept paragraphs, without changing state", () => {
    // Exercise the structural preflight against a constrained parent; this is
    // a private test schema, not a host extension/schema injection feature.
    const schema = new Schema({ nodes: hnnRuntimeSchema.spec.nodes.update("blockquote", {
      ...hnnRuntimeSchema.nodes["blockquote"]!.spec, content: "bulletList+"
    }), marks: hnnRuntimeSchema.spec.marks })
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "blockquote", content: [list("bulletList")] }] })
    const state = EditorState.create({ doc })
    const editor = { isDestroyed: false, view: { editable: true, composing: false }, state, schema } as unknown as Editor
    expect(listConversionCandidate(editor, "paragraph", 1)).toBeNull()
    expect(editor.state).toBe(state)
  })
  it("block menu targets all direct items; unwrap preserves children and marks", () => {
    const { editor } = make([list("bulletList", [item("parent", "bulletList", [list("taskList", [item("child", "taskList")])]), item("sibling")])])
    select(editor, "child")
    const commands = getBlockCommands(editor, () => 0, { canUploadPicture: () => false, enqueuePictures: () => [] })!
    expect(commands.indentItems[0]).toMatchObject({ label: "缩进", disabled: true })
    expect(commands.indentItems[1]).toMatchObject({ label: "反缩进", disabled: false })
    const entry = commands.conversionItems.find(entry => entry !== "divider" && entry.label === "转换为正文")
    expect(entry && entry !== "divider" && entry.description).toBeUndefined()
    if (entry && entry !== "divider") entry.onActivate!()
    expect(types(editor)).toEqual(["paragraph", "taskList", "paragraph"])
    expect(editor.state.doc.firstChild!.firstChild!.marks[0]!.type.name).toBe("bold")
    expect(editor.state.doc.child(1).firstChild!.attrs["checked"]).toBe(true)
  })
  it("unwraps a nested list while preserving the legal parent item", () => {
    // A valid taskItem allows a paragraph followed by a nested list; unwrapping
    // preserves that paragraph and all descendants, rather than flattening them.
    const { editor } = make([list("taskList", [item("parent", "taskList", [list("bulletList", [item("child")])])])])
    select(editor, "child")
    expect(convertList(editor, "paragraph")).toBe(true)
    expect(editor.state.doc.firstChild!.firstChild!.childCount).toBe(2)
  })
})

describe("M1.5 keyboard structure", () => {
  it("splits a completed task in the middle without inheriting checked=true", () => {
    const session = make([list("taskList", [item("done", "taskList")])])
    const { editor } = session
    editor.commands.setTextSelection(pos(editor, "done") + 2)
    expect(enterList(editor)).toBe(true)
    const result = editor.state.doc.firstChild!
    expect(result.firstChild!.textContent).toBe("do")
    expect(result.firstChild!.attrs["checked"]).toBe(true)
    expect(result.lastChild!.textContent).toBe("ne")
    expect(result.lastChild!.attrs["checked"]).toBe(false)
    expect(session.undo()).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(1)
    expect(editor.state.doc.firstChild!.firstChild!.attrs["checked"]).toBe(true)
  })
  it("Enter on completed task creates unchecked sibling; empty Enter exits, each action undoes once", () => {
    const session = make([list("taskList", [item("done", "taskList")])])
    const { editor } = session
    editor.commands.setTextSelection(pos(editor, "done") + 4)
    const before = editor.state.doc
    expect(enterList(editor)).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(2)
    expect(editor.state.doc.firstChild!.firstChild!.attrs["checked"]).toBe(true)
    expect(editor.state.doc.firstChild!.lastChild!.attrs["checked"]).toBe(false)
    expect(enterList(editor)).toBe(true)
    expect(types(editor)).toEqual(["taskList", "paragraph"])
    expect(session.undo()).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(2)
    expect(session.undo()).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  })
  it("indent/lift moves the entire mixed subtree; no previous item is a no-op", () => {
    const session = make([list("taskList", [item("first", "taskList"), item("move", "taskList", [list("orderedList", [item("nested")], { start: 8 })])])])
    const { editor } = session
    select(editor, "first")
    const initial = editor.state
    expect(indentList(editor, false)).toBe(false)
    expect(editor.state).toBe(initial)
    select(editor, "move")
    const subtree = editor.state.doc.firstChild!.child(1)
    expect(indentList(editor, false)).toBe(true)
    expect(editor.state.doc.firstChild!.firstChild!.lastChild!.firstChild!.eq(subtree)).toBe(true)
    expect(indentList(editor, true)).toBe(true)
    expect(editor.state.doc.firstChild!.child(1).eq(subtree)).toBe(true)
    expect(session.undo()).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(1)
  })
  it("empty nested Enter lifts one level", () => {
    const { editor } = make([list("bulletList", [item("parent", "bulletList", [list("bulletList", [item("")])])])])
    select(editor, "")
    expect(enterList(editor)).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(2)
    expect(editor.state.doc.firstChild!.lastChild!.firstChild!.textContent).toBe("")
  })
  it.each(["taskList", "orderedList"])("lifting %s out of a different list preserves type, state, trailing content and numbering", type => {
    const session = make([list("bulletList", [item("parent", "bulletList", [list(type, [item("lift", type), item("tail", type)], type === "orderedList" ? { start: 5 } : {}), p("after")]), item("sibling")])])
    const { editor } = session
    select(editor, "lift")
    const before = editor.state.doc
    expect(indentList(editor, true)).toBe(true)
    expect(types(editor)).toEqual(["bulletList", type, "bulletList"])
    const promoted = editor.state.doc.child(1)
    expect(promoted.firstChild!.firstChild!.textContent).toBe("lift")
    expect(promoted.firstChild!.lastChild!.textContent).toBe("after")
    expect(promoted.firstChild!.child(1).textContent).toBe("tail")
    if (type === "taskList") expect(promoted.firstChild!.attrs["checked"]).toBe(true)
    else expect(promoted.attrs["start"]).toBe(5)
    expect(() => encodeHnn(editor.state.doc)).not.toThrow()
    expect(session.undo()).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  })
  it("lifts a list inside a quote as a local unwrap, preserving ordered suffix numbering", () => {
    const { editor } = make([{ type: "blockquote", content: [list("orderedList", undefined, { start: 5 })] }])
    select(editor, "two")
    expect(indentList(editor, true)).toBe(true)
    const quote = editor.state.doc.firstChild!
    expect(quote.childCount).toBe(3)
    expect(quote.child(0).attrs["start"]).toBe(5)
    expect(quote.child(1).type.name).toBe("paragraph")
    expect(quote.child(2).attrs["start"]).toBe(7)
  })
})

describe("M1.6/1.7 guarded checkbox and commands", () => {
  it("native checkbox changes only itself and undo is isolated", () => {
    const session = make([list("taskList", [item("parent", "taskList", [list("taskList", [item("child", "taskList")])])])])
    const checkbox = session.editor.view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.getAttribute("aria-label")).toContain("parent")
    checkbox.click()
    expect(session.editor.state.doc.firstChild!.firstChild!.attrs["checked"]).toBe(false)
    expect(session.editor.state.doc.firstChild!.firstChild!.lastChild!.firstChild!.attrs["checked"]).toBe(true)
    expect(session.undo()).toBe(true)
    expect(checkbox.checked).toBe(true)
  })
  for (const mode of ["readonly", "composition"]) it(`${mode} blocks checkbox/menu/Enter/indent with zero history`, () => {
    const session = make([list("taskList")])
    const { editor } = session
    select(editor, "two")
    if (mode === "readonly") editor.setEditable(false)
    else Object.defineProperty(editor.view, "composing", { configurable: true, value: true })
    const state = editor.state
    expect(convertList(editor, "bulletList")).toBe(false)
    expect(enterList(editor)).toBe(false)
    expect(indentList(editor, false)).toBe(false)
    expect(toggleTask(editor, 1)).toBe(false)
    editor.view.dom.querySelector<HTMLInputElement>("input")!.click()
    expect(editor.state).toBe(state)
    expect(session.state.dirty).toBe(false)
    expect(session.undo()).toBe(false)
  })
  it("512-node boundary rejects wrapping without selection/history/dirty changes", () => {
    const session = make(Array.from({ length: 255 }, (_, i) => p(`p${i}`))) // doc + 255*2 = 511
    const { editor } = session
    select(editor, "p0")
    const state = editor.state
    expect(convertList(editor, "taskList")).toBe(false)
    expect(editor.state).toBe(state)
    expect(session.state.dirty).toBe(false)
    expect(session.undo()).toBe(false)
  })
  it("32-layer boundary rejects wrapping at the deepest paragraph", () => {
    let deep: object = p("deep")
    for (let i = 0; i < 29; i++) deep = { type: "blockquote", content: [deep] }
    const session = make([deep])
    select(session.editor, "deep")
    const state = session.editor.state
    expect(convertList(session.editor, "orderedList")).toBe(false)
    expect(session.editor.state).toBe(state)
    expect(session.undo()).toBe(false)
  })
  it("512 KiB boundary rejects both list wrapping and a checkbox that adds one byte", () => {
    // Fill valid short text nodes to an exact shell budget, rather than mocking the encoder.
    const nodes = Array.from({ length: 65 }, () => p("x"))
    const raw = normalizeInitialHnnContent({ type: "doc", content: nodes })
    const shell = { schemaVersion: 1, data: raw }
    const size = () => new TextEncoder().encode(JSON.stringify(shell)).length
    const strings = (raw["content"] as { content: { text: string }[] }[]).map(node => node.content[0]!)
    let remaining = HNN_LIMITS.maxShellBytes - size() - 50
    for (const text of strings) {
      const count = Math.min(remaining, 8000)
      text.text += "a".repeat(count)
      remaining -= count
    }
    expect(remaining).toBe(0)
    const session = createEditorSession({ documentId: "bytes", loadKey: 1, initialDocument: shell })
    sessions.push(session)
    const before = session.editor.state
    expect(convertList(session.editor, "taskList")).toBe(false)
    expect(session.editor.state).toBe(before)
    expect(session.undo()).toBe(false)

    const taskRaw = normalizeInitialHnnContent({ type: "doc", content: [list("taskList", [item("checked", "taskList")]), ...nodes] })
    const taskShell = { schemaVersion: 1, data: taskRaw }
    const taskStrings = (taskRaw["content"] as { content: { text: string }[] }[]).slice(1).map(node => node.content[0]!)
    let fill = HNN_LIMITS.maxShellBytes - new TextEncoder().encode(JSON.stringify(taskShell)).length
    for (const text of taskStrings) {
      const count = Math.min(fill, 8000)
      text.text += "b".repeat(count); fill -= count
    }
    expect(fill).toBe(0)
    const exact = createEditorSession({ documentId: "exact", loadKey: 1, initialDocument: taskShell })
    sessions.push(exact)
    const state = exact.editor.state
    expect(toggleTask(exact.editor, 1)).toBe(false) // true -> false grows JSON by one byte
    expect(exact.editor.state).toBe(state)
    expect(exact.state.dirty).toBe(false)
    expect(exact.undo()).toBe(false)
  })
})
