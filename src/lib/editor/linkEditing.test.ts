// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { fireEvent, within } from "@testing-library/dom"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { Editor } from "@tiptap/core"
import { DocumentSession } from "./documentSession"
import { commitLink, openLinkEditor, resolveLinkTarget } from "./linkEditing"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import { decodeHnn, encodeHnn } from "../hnn/codec"
import { exportMarkdown, importMarkdown } from "../hnn/markdown"
import { HNN_LIMITS } from "../hnn/limits"

const sessions: DocumentSession[] = []
afterEach(() => { sessions.splice(0).forEach(s => s.dispose()); document.body.replaceChildren(); vi.restoreAllMocks() })
const text = (value: string, marks: object[] = []) => ({ type: "text", text: value, ...(marks.length ? { marks } : {}) })
const paragraph = (content = [text("仓鼠笔记")]) => ({ type: "paragraph", content })
const link = (href = "https://example.com") => ({ type: "link", attrs: { href } })
function make(content: object[] = [paragraph()]) {
  const onChange = vi.fn()
  const options = { documentId: "links", loadKey: 1,
    initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content }) },
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } }, onChange, onSave: vi.fn<(payload: { document: unknown }) => Promise<void>>(() => Promise.resolve()) }
  const session = new DocumentSession(options)
  sessions.push(session)
  const a = session.attachView("a").editor, b = session.attachView("b").editor
  document.body.append(a.view.dom, b.view.dom)
  let selected = false
  a.state.doc.descendants((node, pos) => { if (!selected && node.isTextblock) { selected = true; a.commands.setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 }); return false } })
  return { session, a, b, options, onChange }
}
function target(editor: Editor) {
  const result = resolveLinkTarget(editor)
  expect(result).not.toBeNull()
  return result!
}
function dialog(editor: Editor) {
  const anchor = document.createElement("button")
  document.body.append(anchor)
  expect(openLinkEditor(editor, anchor, () => {})).not.toBeNull()
  return within(within(document.body).getByRole("dialog", { name: "配置链接" }))
}

it.each(["http://example.com", "https://example.com", "mailto:hi@example.com", "hnmagic://resource/123", "  https://example.com  "])(
  "1.15 permits %s, shares one history event and saves/reopens text+href", async href => {
    const h = make(), { a, b, session } = h
    const before = a.state.doc
    expect(commitLink(a, target(a), "官网", href)).toEqual({ ok: true })
    const after = a.state.doc
    expect(after.textContent).toBe("官网")
    expect(after.firstChild!.firstChild!.marks[0]!.attrs["href"]).toBe(href.trim())
    expect(b.state.doc.eq(after)).toBe(true)
    expect(session.resourceUsage().undoEvents).toBe(1)
    expect(session.history("b", false)).toBe(true); expect(a.state.doc.eq(before)).toBe(true)
    expect(session.history("a", true)).toBe(true); expect(b.state.doc.eq(after)).toBe(true)
    const save = session.controller.requestSave({ expectedSessionId: session.identity.sessionId, reason: "host-save" })
    if (save.kind !== "pending") throw new Error("missing save")
    expect((await save.completion).kind).toBe("saved")
    const saved = h.options.onSave.mock.calls[0]![0]
    expect(saved).toEqual(expect.objectContaining({ document: encodeHnn(after) }))
    expect(decodeHnn(encodeHnn(after)).toJSON()).toEqual(after.toJSON())
    const reopened = new DocumentSession({ ...h.options, loadKey: 2, initialDocument: encodeHnn(after) })
    sessions.push(reopened)
    expect(reopened.attachView("reopened").editor.state.doc.eq(after)).toBe(true)
  })
it.each(["", "  ", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "tel:123", "/relative", "example.com",
  "https://example.com/\n", "https://example.com/\u200b", "https://example.com/\ud800", "\thttps://example.com", "https://example.com\u00a0"])(
  "1.15 rejects URL %j atomically", href => {
    const { a, b, session, onChange } = make()
    const before = a.state.doc
    expect(commitLink(a, target(a), "title", href).ok).toBe(false)
    expect(a.state.doc.eq(before)).toBe(true); expect(b.state.doc.eq(before)).toBe(true)
    expect(session.resourceUsage().undoEvents).toBe(0)
    expect(session.getState().dirty.body).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
it.each(["", " \t "])("1.15 rejects empty title %j", title => {
  const { a } = make(), before = a.state.doc
  expect(commitLink(a, target(a), title, "https://example.com").ok).toBe(false)
  expect(a.state.doc.eq(before)).toBe(true)
})
it("1.14 preserves separate marks unchanged, keeps only shared marks on replacement, and removes just link", () => {
  const { a, b, session } = make([paragraph([text("仓鼠", [{ type: "bold" }, { type: "italic" }]), text("笔记", [{ type: "bold" }])])])
  expect(commitLink(a, target(a), "仓鼠笔记", "https://example.com").ok).toBe(true)
  expect(a.state.doc.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(["link", "bold", "italic"])
  a.commands.setTextSelection({ from: 2, to: 3 })
  const expanded = target(a)
  expect(expanded).toMatchObject({ from: 1, to: 5, title: "仓鼠笔记" })
  expect(commitLink(a, expanded, "官网", "https://example.org").ok).toBe(true)
  expect(a.state.doc.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(["link", "bold"])
  a.commands.setTextSelection(2)
  const linked = a.state.doc
  expect(commitLink(a, target(a), "ignored", "", false, true).ok).toBe(true)
  expect(a.state.doc.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(["bold"])
  expect(session.history("b", false)).toBe(true)
  expect(a.state.doc.eq(linked)).toBe(true); expect(b.state.doc.eq(linked)).toBe(true)
})
it.each([
  [paragraph([text("x", [link()]), text("y")])],
  [paragraph([text("x", [link()]), text("y", [link("https://other.com")])])],
  [paragraph([text("x", [{ type: "code" }])])],
  [{ type: "codeBlock", attrs: { language: "text", filename: "untitled.txt" }, content: [text("x")] }],
  [{ type: "paragraph", content: [text("x"), { type: "hardBreak" }, text("y")] }],
  [{ type: "paragraph", content: [text("x"), { type: "inlineFormula", attrs: { latex: "x" } }, text("y")] }]
].map(content => ({ content })))("1.14 rejects mixed, code and atom targets %#", ({ content }) => {
  const { a } = make(content)
  expect(resolveLinkTarget(a)).toBeNull()
})
it("1.14 rejects cross-block targets and accepts collapsed cursor within one link", () => {
  const { a } = make([paragraph([text("abc", [link()])]), paragraph()])
  a.commands.setTextSelection(2)
  expect(target(a)).toMatchObject({ from: 1, to: 4, title: "abc" })
  a.commands.setTextSelection({ from: 2, to: a.state.doc.content.size - 1 })
  expect(resolveLinkTarget(a)).toBeNull()
})
it.each(["取消", "Escape", "outside"])("1.14 %s cancels, labels/default title/Tab are accessible and no history changes", action => {
  const { a, session } = make(), before = a.state.doc
  const ui = dialog(a)
  const title = ui.getByLabelText<HTMLInputElement>("链接标题"), url = ui.getByLabelText("URL")
  expect(title.value).toBe("仓鼠笔记")
  expect(document.activeElement).toBe(title)
  fireEvent.keyDown(title, { key: "Tab" }); expect(document.activeElement).toBe(url)
  fireEvent.keyDown(url, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(title)
  expect(ui.getByText(/修改标题会移除/)).toBeDefined()
  if (action === "取消") fireEvent.click(ui.getByText(action))
  else if (action === "Escape") fireEvent.keyDown(title, { key: "Escape" })
  else fireEvent.pointerDown(document.body)
  expect(within(document.body).queryByRole("dialog")).toBeNull()
  expect(a.state.doc.eq(before)).toBe(true)
  expect(session.resourceUsage().undoEvents).toBe(0)
  if (action !== "outside") expect(a.view.hasFocus()).toBe(true)
})
it("1.15 rejects any document transaction even after undo, but permits pure selection/focus changes", () => {
  const { a, b, session } = make()
  const ui = dialog(a)
  fireEvent.input(ui.getByLabelText("URL"), { target: { value: "https://example.com" } })
  b.commands.insertContent("changed")
  expect(session.history("b", false)).toBe(true)
  const before = a.state.doc
  fireEvent.click(ui.getByText("保存"))
  expect(ui.getByRole("alert").textContent).toContain("重新选择")
  expect(a.state.doc.eq(before)).toBe(true)
  fireEvent.click(ui.getByText("取消"))
  a.commands.setTextSelection({ from: 1, to: 5 })
  const fresh = dialog(a)
  a.commands.setTextSelection(2)
  fireEvent.input(fresh.getByLabelText("URL"), { target: { value: "https://example.com" } })
  fireEvent.click(fresh.getByText("保存"))
  expect(within(document.body).queryByRole("dialog")).toBeNull()
  expect(a.state.doc.firstChild!.firstChild!.marks[0]!.type.name).toBe("link")
})
it("1.15 filter rejection, budget, freeze, composition and disposal preserve data and never report false success", async () => {
  const { a, b, session } = make()
  const original = a.state.doc, captured = target(a)
  const key = new PluginKey("reject-link")
  a.registerPlugin(new Plugin({ key, filterTransaction: tr => !tr.docChanged }))
  const ui = dialog(a)
  fireEvent.input(ui.getByLabelText("链接标题"), { target: { value: "官网" } })
  fireEvent.input(ui.getByLabelText("URL"), { target: { value: "https://example.com" } })
  fireEvent.click(ui.getByText("保存"))
  expect(ui.getByRole("alert").textContent).toContain("未保存")
  expect(ui.getByLabelText<HTMLInputElement>("链接标题").value).toBe("官网")
  a.unregisterPlugin(key)
  expect(commitLink(a, captured, "x".repeat(HNN_LIMITS.maxAttrBytes + 1), "https://example.com").ok).toBe(false)
  const expectedSessionId = session.identity.sessionId
  const lease = await session.controller.setInputFrozen(true, { expectedSessionId, requestId: "link" })
  expect(commitLink(a, captured, "官网", "https://example.com").ok).toBe(false)
  if (!("leaseId" in lease)) throw new Error("missing lease")
  await session.controller.setInputFrozen(false, { expectedSessionId, requestId: "link", leaseId: lease.leaseId })
  Object.defineProperty(a.view, "composing", { configurable: true, value: true })
  expect(commitLink(a, captured, "官网", "https://example.com").ok).toBe(false)
  Object.defineProperty(a.view, "composing", { configurable: true, value: false })
  expect(a.state.doc.eq(original)).toBe(true); expect(b.state.doc.eq(original)).toBe(true)
  expect(session.resourceUsage().undoEvents).toBe(0)
  fireEvent.click(ui.getByText("保存"))
  expect(a.state.doc.textContent).toBe("官网")
  expect(b.state.doc.eq(a.state.doc)).toBe(true)
  expect(commitLink(b, captured, "wrong view", "https://example.com").ok).toBe(false)
  session.dispose()
  expect(within(document.body).queryByRole("dialog")).toBeNull()
  expect(commitLink(a, captured, "old session", "https://example.com").ok).toBe(false)
})
it("1.16 link text with brackets and parentheses inside a quote survives GFM/HNN, dangerous URLs diagnose", () => {
  const { a } = make([{ type: "blockquote", content: [paragraph()] }, { type: "orderedList", attrs: { start: 5, type: null }, content: [
    { type: "listItem", content: [paragraph([text("outer")]), { type: "orderedList", attrs: { start: 27, type: null }, content: [
      { type: "listItem", content: [paragraph([text("nested")])] }
    ] }] }
  ] }])
  a.commands.setTextSelection({ from: 2, to: 6 })
  expect(commitLink(a, target(a), "[官网](站点)", "https://example.com/path(a)").ok).toBe(true)
  const output = exportMarkdown(encodeHnn(a.state.doc))
  expect(output.markdown).toContain("> ")
  const imported = importMarkdown(output.markdown)
  if (!("document" in imported)) throw new Error("missing import")
  const doc = decodeHnn(imported.document)
  expect(doc.firstChild!.textContent).toBe("[官网](站点)")
  expect(doc.lastChild!.attrs["start"]).toBe(5)
  expect(doc.lastChild!.firstChild!.lastChild!.attrs["start"]).toBe(27)
  expect(doc.firstChild!.firstChild!.firstChild!.marks[0]!.attrs["href"]).toBe("https://example.com/path(a)")
  const unsafe = importMarkdown("[visible](javascript:alert%281%29)")
  expect(unsafe.diagnostics.length).toBeGreaterThan(0)
  if (!("document" in unsafe)) throw new Error("missing readable import")
  expect(decodeHnn(unsafe.document).textContent).toContain("visible")
  expect(JSON.stringify(unsafe.document)).not.toContain('"type":"link"')
})
