// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent } from "@testing-library/dom"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import type { Editor } from "@tiptap/core"
import { createEditorSession, type EditorSession } from "./session"
import { DocumentSession } from "./documentSession"
import { decodeHnn, encodeHnn } from "../hnn/codec"
import { exportMarkdown, importMarkdown } from "../hnn/markdown"
import { installHnnBudgetEncoder } from "../hnn/budgetedTransaction"
import { textFormatState, toggleTextFormat } from "./textFormatting"

const ids = [0, 1, 2].map(i => `123e4567-e89b-42d3-a456-42661417400${i}`)
const initialDocument = { schemaVersion: 1, data: { type: "doc", content: ["alpha beta", "second", "third"].map((text, i) => ({
  type: "paragraph", attrs: { nodeId: ids[i] }, content: [{ type: "text", text }]
})) } }
let width = 390
let change: EventTarget
const sessions: EditorSession[] = []
const shared: DocumentSession[] = []
function resize(value: number) { width = value; change.dispatchEvent(new Event("change")) }
function make(doc: unknown = initialDocument) {
  const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: doc })
  sessions.push(session)
  mount(session.editor)
  return session
}
function mount(editor: Editor) {
  const shell = document.createElement("div")
  shell.className = "hn-editor"
  document.body.appendChild(shell)
  shell.appendChild(editor.view.dom)
  editor.view.focus()
}
function select(editor: Editor, from: number, to = from) {
  editor.view.focus()
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
}
function toolbar() { return document.querySelector<HTMLElement>('.hn-editor-interaction-toolbar:not([hidden])') }
function button(label: string) {
  const result = Array.from(toolbar()!.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === label)
  expect(result, label).toBeDefined()
  return result!
}
beforeEach(() => {
  width = 390
  change = new EventTarget()
  vi.stubGlobal("matchMedia", vi.fn(() => ({ get matches() { return width <= 840 },
    addEventListener: change.addEventListener.bind(change), removeEventListener: change.removeEventListener.bind(change) })))
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(20, this.classList.contains("hn-editor-interaction-toolbar") ? 0 : 120, 280, this.tagName === "P" ? 30 : 44)
  })
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(25, 125, 80, 20))
})
afterEach(() => {
  for (const s of sessions.splice(0)) s.destroy()
  for (const s of shared.splice(0)) s.dispose()
  document.body.replaceChildren()
  installHnnBudgetEncoder(encodeHnn)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe("per-view text toolbars", () => {
  it("shows seven Chinese buttons without stealing focus; expands commands in the same surface", () => {
    const { editor } = make()
    select(editor, 1)
    expect(Array.from(toolbar()!.querySelectorAll("button"), b => b.textContent)).toEqual(["转换为", "插入", "加粗", "斜体", "下划线", "上移", "下移"])
    expect(editor.view.hasFocus()).toBe(true)
    expect(button("上移").disabled).toBe(true)
    fireEvent.click(button("转换为"))
    expect(button("正文").disabled).toBe(true)
    fireEvent.click(button("标题 1"))
    expect(editor.state.doc.firstChild?.type.name).toBe("heading")
    expect(editor.state.doc.firstChild?.attrs["nodeId"]).toBe(ids[0])
    fireEvent.click(button("插入"))
    expect(button("图片").disabled).toBe(true)
    expect(button("图片").getAttribute("aria-description")).toContain("上传")
    select(editor, editor.state.doc.content.size - 1)
    expect(button("下移").disabled).toBe(true)
  })
  it("supports stored marks at a cursor, mixed ranges, full-range removal and codec/clipboard round trips", () => {
    const { editor } = make()
    select(editor, 1)
    fireEvent.click(button("下划线"))
    expect(editor.state.storedMarks?.map(m => m.type.name)).toEqual(["underline"])
    editor.commands.insertContent("U")
    expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe("underline")
    select(editor, 1, 6)
    for (const label of ["加粗", "斜体", "下划线"]) fireEvent.click(button(label))
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(6)
    expect(button("下划线").getAttribute("aria-pressed")).toBe("true")
    const encoded = encodeHnn(editor.state.doc)
    expect(encodeHnn(decodeHnn(encoded))).toEqual(encoded)
    expect(editor.getHTML()).toContain("<u>")
    expect(editor.state.doc.firstChild?.firstChild?.marks.map(m => m.type.name)).toEqual(expect.arrayContaining(["bold", "italic", "underline"]))
    fireEvent.click(button("加粗"))
    expect(editor.state.doc.rangeHasMark(1, 6, editor.schema.marks["bold"]!)).toBe(false)
    fireEvent.click(button("转换为"))
    expect(button("代码块").disabled).toBe(true)
    const exported = exportMarkdown(encoded)
    expect(exported.markdown).toContain("hamster-note-json-b64")
    const imported = importMarkdown(exported.markdown)
    const withoutIds = (value: unknown): unknown => JSON.parse(JSON.stringify(value), (key, item: unknown) => key === "nodeId" ? undefined : item)
    expect(withoutIds("document" in imported && imported.document)).toEqual(withoutIds(encoded))
  })
  it("adds marks over mixed whitespace without stripping an existing inline code mark", () => {
    const { editor } = make()
    select(editor, 1, 6)
    toggleTextFormat(editor, "bold")
    select(editor, 1, 7)
    expect(textFormatState(editor, "bold").pressed).toBe(false)
    toggleTextFormat(editor, "bold")
    expect(textFormatState(editor, "bold").pressed).toBe(true)
    editor.commands.setTextSelection({ from: 7, to: 11 })
    editor.commands.toggleCode()
    select(editor, 7, 11)
    expect(textFormatState(editor, "bold").disabled).toBe(true)
    expect(toggleTextFormat(editor, "bold")).toBe(false)
    expect(editor.state.doc.rangeHasMark(7, 11, editor.schema.marks["code"]!)).toBe(true)
  })
  it("a replaced session cannot execute an old toolbar callback", () => {
    const old = make()
    select(old.editor, 1, 4)
    const stale = button("下划线")
    old.destroy()
    const next = make()
    select(next.editor, 1, 4)
    const doc = next.editor.state.doc
    fireEvent.click(stale)
    expect(next.editor.state.doc).toBe(doc)
    expect(document.querySelectorAll('.hn-editor-interaction-toolbar')).toHaveLength(1)
  })
  it("keeps old HNN readable; budget failure makes no transaction or selection/history change", () => {
    const session = make()
    const { editor } = session
    select(editor, 1, 5)
    const state = editor.state
    installHnnBudgetEncoder(() => { throw new Error("budget") })
    expect(toggleTextFormat(editor, "underline")).toBe(false)
    expect(editor.state).toBe(state)
    expect(session.undo()).toBe(false)
    expect(decodeHnn(initialDocument).textContent).toBe("alpha betasecondthird")
  })
  it("uses 840/841 inclusive layout, closes invalid selection kinds and code/IME contexts", () => {
    const { editor } = make()
    select(editor, 1)
    resize(840)
    expect(button("转换为")).toBeDefined()
    resize(841)
    expect(toolbar()).toBeNull()
    select(editor, 1, 6)
    expect(Array.from(toolbar()!.querySelectorAll("button"), b => b.textContent)).toEqual(["加粗", "斜体", "下划线"])
    editor.commands.setNodeSelection(0)
    expect(toolbar()).toBeNull()
    resize(390)
    expect(button("加粗").disabled).toBe(true)
    select(editor, 1, 4)
    fireEvent.compositionStart(editor.view.dom)
    expect(toolbar()).toBeNull()
    fireEvent.compositionEnd(editor.view.dom)
    select(editor, 2, 4)
    expect(toolbar()).not.toBeNull()
    editor.commands.setNode("codeBlock")
    select(editor, 1, 4)
    expect(textFormatState(editor, "bold").disabled).toBe(true)
    resize(1000)
    expect(toolbar()).toBeNull()
  })
  it("delays desktop mouse selection until pointerup; keyboard selection displays immediately", async () => {
    resize(1000)
    const { editor } = make()
    const event = new Event("pointerdown", { bubbles: true })
    Object.assign(event, { pointerType: "mouse" })
    editor.view.dom.dispatchEvent(event)
    select(editor, 1, 4)
    expect(toolbar()).toBeNull()
    fireEvent.pointerUp(document)
    await new Promise(resolve => window.requestAnimationFrame(resolve))
    expect(toolbar()).not.toBeNull()
    select(editor, 2)
    expect(toolbar()).toBeNull()
    select(editor, 2, 5)
    expect(toolbar()).not.toBeNull()
  })
  it("preserves selection on click, suppresses Escape reopen, supports keyboard focus and external dismissal", () => {
    const { editor } = make()
    select(editor, 1, 5)
    const bold = button("加粗")
    expect(fireEvent.mouseDown(bold)).toBe(false)
    bold.focus()
    fireEvent.keyDown(bold, { key: "End" })
    expect(document.activeElement?.textContent).toBe("下移")
    fireEvent.keyDown(document.activeElement!, { key: "Home" })
    expect(document.activeElement?.textContent).toBe("转换为")
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" })
    expect(document.activeElement?.textContent).toBe("插入")
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" })
    expect(document.activeElement?.textContent).toBe("转换为")
    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    expect(toolbar()).toBeNull()
    expect(editor.view.hasFocus()).toBe(true)
    editor.view.dispatch(editor.state.tr.setMeta("noop", true))
    expect(toolbar()).toBeNull()
    select(editor, 2, 5)
    expect(toolbar()).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(toolbar()).toBeNull()
    fireEvent.pointerDown(editor.view.dom)
    editor.view.dispatch(editor.state.tr.setMeta("same-cursor-focus", true))
    expect(toolbar()).not.toBeNull()
    select(editor, 3, 5)
    const stale = button("加粗")
    editor.commands.deleteRange({ from: 1, to: 7 })
    const doc = editor.state.doc
    fireEvent.click(stale)
    expect(editor.state.doc).toBe(doc)
    editor.setEditable(false)
    expect(toolbar()).toBeNull()
  })
  it("clamps 320px geometry, flips above, closes invisible anchors and cleans up on dispose", () => {
    const session = make()
    select(session.editor, 1)
    Object.defineProperty(window, "visualViewport", { configurable: true, value: Object.assign(new EventTarget(), {
      offsetLeft: 0, offsetTop: 0, width: 320, height: 200
    }) })
    session.editor.view.dispatch(session.editor.state.tr.setMeta("layout", true))
    expect(toolbar()!.style.maxWidth).toBe("304px")
    expect(toolbar()!.dataset["placement"]).toBe("above")
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 2000, 280, 30))
    session.editor.view.dispatch(session.editor.state.tr.setMeta("layout", true))
    expect(toolbar()).toBeNull()
    session.destroy()
    expect(document.querySelector(".hn-editor-interaction-toolbar")).toBeNull()
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined })
  })
  it("atom and cell selections disable mobile formatting", () => {
    const { editor } = make({ schemaVersion: 1, data: { type: "doc", content: [
      { type: "formula", attrs: { nodeId: ids[0], latex: "x" } },
      { type: "table", attrs: { nodeId: ids[1] }, content: [{ type: "tableRow", attrs: { nodeId: ids[2] }, content: [
        { type: "tableCell", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174003", colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [
          { type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174004" }, content: [{ type: "text", text: "cell" }] }
        ] }
      ] }] }
    ] } })
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)))
    expect(button("下划线").disabled).toBe(true)
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, editor.state.doc.firstChild!.nodeSize + 2)))
    expect(button("加粗").disabled).toBe(true)
    resize(841)
    expect(toolbar()).toBeNull()
  })
  it("shares formatting and reorder history across views, freezes and rejects detached callbacks without focus theft", async () => {
    const session = new DocumentSession({ documentId: "shared", loadKey: 1, initialDocument,
      initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } }, onSave: async () => {}, onChange: () => {} })
    shared.push(session)
    const a = session.attachView("a").editor, b = session.attachView("b").editor
    mount(a); mount(b)
    select(a, 1, 5)
    fireEvent.click(button("下划线"))
    expect(b.state.doc.eq(a.state.doc)).toBe(true)
    expect(a.view.hasFocus()).toBe(true)
    expect(session.history("b", false)).toBe(true)
    expect(a.state.doc.rangeHasMark(1, 5, a.schema.marks["underline"]!)).toBe(false)
    session.history("b", true)
    select(a, 1)
    fireEvent.click(button("下移"))
    expect(a.state.doc.firstChild?.textContent).toBe("second")
    session.history("b", false)
    expect(a.state.doc.firstChild?.textContent).toBe("alpha beta")
    select(a, 2, 4)
    const stale = button("加粗")
    const freeze = await session.controller.setInputFrozen(true, { expectedSessionId: session.identity.sessionId, requestId: "R" })
    expect(freeze.kind).toBe("applied")
    expect(toolbar()).toBeNull()
    const doc = b.state.doc
    fireEvent.click(stale)
    expect(b.state.doc).toBe(doc)
    session.detachView("a", session.views.get("a")!)
    fireEvent.click(stale)
    expect(b.state.doc).toBe(doc)
  })
})
