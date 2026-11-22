// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom"
import { afterEach, expect, it, vi } from "vitest"
import type { Editor } from "@tiptap/core"
import { DocumentSession } from "./documentSession"
import { normalizeInitialHnnContent } from "../hnn/nodeId"
import type { HostReferenceActivate } from "./types"

const sessions: DocumentSession[] = []
afterEach(() => {
  sessions.splice(0).forEach(session => session.dispose())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const text = (value: string, marks: object[] = []) => ({
  type: "text", text: value, ...(marks.length ? { marks } : {})
})
const paragraph = (content: object[]) => ({ type: "paragraph", content })
const link = (href: string, extra: object[] = []) => [
  { type: "link", attrs: { href } }, ...extra
]

function make(content: object[], options: {
  onReferenceActivate?: HostReferenceActivate
  onExternalLinkActivate?: (href: string) => void
} = {}) {
  const session = new DocumentSession({
    documentId: "link-blocks", loadKey: 1,
    initialDocument: { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content }) },
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onChange: vi.fn(),
    onSave: vi.fn<(payload: { document: unknown }) => Promise<void>>(() => Promise.resolve()),
    ...options
  })
  sessions.push(session)
  const a = session.attachView("a").editor
  const b = session.attachView("b").editor
  document.body.append(a.view.dom, b.view.dom)
  return { session, a, b }
}

function anchor(editor: Editor): HTMLAnchorElement {
  const result = editor.view.dom.querySelector("a[href]")
  if (!(result instanceof HTMLAnchorElement)) throw new Error("missing link anchor")
  return result
}

function open(editor: Editor) {
  fireEvent.click(anchor(editor))
  return within(document.body).getByRole("dialog", { name: "链接操作" })
}

it("混合格式内部链接只能整块编辑，URL 在表单和提交层均锁定，undo/redo 与 peer 同步", () => {
  const href = "hnmagic://note/42"
  const activate = vi.fn<HostReferenceActivate>()
  const { session, a, b } = make([paragraph([
    text("前"), text("链", link(href)), text("接", link(href, [{ type: "bold" }])), text("后")
  ])], { onReferenceActivate: activate })
  const before = a.state.doc
  const popover = open(a)
  expect(activate).not.toHaveBeenCalled()
  fireEvent.click(within(popover).getByRole("button", { name: "编辑" }))
  const dialog = within(document.body).getByRole("dialog", { name: "配置链接" })
  const url = within(dialog).getByLabelText<HTMLInputElement>("URL")
  expect(url.readOnly).toBe(true)
  expect(url.value).toBe(href)
  fireEvent.input(url, { target: { value: "hnmagic://note/tampered" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }))
  expect(within(dialog).getByRole("alert").textContent).toContain("不可修改")
  expect(a.state.doc.eq(before)).toBe(true)
  fireEvent.input(url, { target: { value: href } })
  fireEvent.input(within(dialog).getByLabelText("链接标题"), { target: { value: "新标题" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }))
  expect(a.state.doc.textContent).toBe("前新标题后")
  expect(a.state.doc.textBetween(2, 5)).toBe("新标题")
  expect(b.state.doc.eq(a.state.doc)).toBe(true)
  const edited = a.state.doc
  expect(session.history("a", false)).toBe(true)
  expect(a.state.doc.eq(before)).toBe(true)
  expect(b.state.doc.eq(before)).toBe(true)
  expect(session.history("a", true)).toBe(true)
  expect(a.state.doc.eq(edited)).toBe(true)
  expect(b.state.doc.eq(edited)).toBe(true)
})

it("删除移除完整链接文字块并保留邻字，撤销和重做恢复同一事务", () => {
  const { session, a, b } = make([paragraph([
    text("前"), text("完整链接", link("https://example.test")), text("后")
  ])])
  const before = a.state.doc
  const popover = open(a)
  fireEvent.click(within(popover).getByRole("button", { name: "删除" }))
  expect(a.state.doc.textContent).toBe("前后")
  expect(a.view.dom.querySelector("a")).toBeNull()
  expect(b.state.doc.eq(a.state.doc)).toBe(true)
  const deleted = a.state.doc
  expect(session.history("a", false)).toBe(true)
  expect(a.state.doc.eq(before)).toBe(true)
  expect(b.state.doc.eq(before)).toBe(true)
  expect(session.history("a", true)).toBe(true)
  expect(a.state.doc.eq(deleted)).toBe(true)
  expect(b.state.doc.eq(deleted)).toBe(true)
})

it("局部输入、删除、格式化和跨链接选区均被拒绝，边界输入仍可提交", () => {
  const { a, b } = make([paragraph([
    text("前"), text("链接", link("https://example.test")), text("后")
  ])])
  const before = a.state.doc
  a.commands.setTextSelection(3)
  a.commands.insertContent("X")
  expect(a.state.doc.eq(before)).toBe(true)
  a.commands.setTextSelection({ from: 2, to: 3 })
  a.commands.toggleBold()
  expect(a.state.doc.eq(before)).toBe(true)
  a.commands.deleteSelection()
  expect(a.state.doc.eq(before)).toBe(true)
  a.commands.setTextSelection({ from: 3, to: 5 })
  a.commands.deleteSelection()
  expect(a.state.doc.eq(before)).toBe(true)
  expect(b.state.doc.eq(before)).toBe(true)
  a.commands.setTextSelection(2)
  a.commands.insertContent("边")
  expect(a.state.doc.textContent).toBe("前边链接后")
})

it("普通外链仅在跳转后打开一次，宿主回调优先于 Web window.open", () => {
  const href = "https://example.test/path"
  const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null)
  const external = vi.fn()
  const { a } = make([paragraph([text("官网", link(href))])], { onExternalLinkActivate: external })
  let popover = open(a)
  expect(windowOpen).not.toHaveBeenCalled()
  fireEvent.click(within(popover).getByRole("button", { name: "跳转" }))
  expect(external).toHaveBeenCalledOnce()
  expect(external).toHaveBeenCalledWith(href)
  expect(windowOpen).not.toHaveBeenCalled()
  popover = open(a)
  fireEvent.keyDown(anchor(a), { key: "Enter" })
  popover = within(document.body).getByRole("dialog", { name: "链接操作" })
  fireEvent.keyDown(anchor(a), { key: " ", repeat: true })
  fireEvent.keyDown(popover, { key: "Escape" })
  expect(within(document.body).queryByRole("dialog", { name: "链接操作" })).toBeNull()
  expect(external).toHaveBeenCalledOnce()
})

it("无宿主外链回调时 Web 默认只新增一个 noopener 标签页", () => {
  const href = "https://example.test/default"
  const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null)
  const { a } = make([paragraph([text("官网", link(href))])])
  const popover = open(a)
  fireEvent.click(within(popover).getByRole("button", { name: "跳转" }))
  expect(windowOpen).toHaveBeenCalledOnce()
  expect(windowOpen).toHaveBeenCalledWith(href, "_blank", "noopener,noreferrer")
})

it("过期浮层关闭且不导航；只读链接允许跳转但不能编辑或删除", () => {
  const external = vi.fn()
  const { a, b } = make([paragraph([text("官网", link("https://example.test"))])], {
    onExternalLinkActivate: external
  })
  open(a)
  b.commands.insertContent("新")
  expect(within(document.body).queryByRole("dialog", { name: "链接操作" })).toBeNull()
  expect(external).not.toHaveBeenCalled()
  a.setEditable(false)
  const popover = open(a)
  expect(within(popover).getByRole<HTMLButtonElement>("button", { name: "编辑" }).disabled).toBe(true)
  expect(within(popover).getByRole<HTMLButtonElement>("button", { name: "删除" }).disabled).toBe(true)
})

it("多步骤事务按每个 step 前的文档坐标拒绝链接局部删除", () => {
  const { session, a, b } = make([paragraph([
    text("前"), text("链接", link("https://example.test")), text("后")
  ])])
  const before = a.state.doc
  // 第一步在链接前插入两个字，链接区间从 [2,4) 移到 [4,6)；
  // 第二步按新坐标删除链接首字，必须按该 step 执行前的文档判定并拒绝整个事务。
  // 拿事务初始文档的 [2,4) 去比对会误放行这条删除，所以这条用例能区分两版实现。
  const transaction = a.state.tr.insertText("预预", 2, 2).delete(4, 5)
  expect(session.dispatch("a", transaction)).toBe(false)
  expect(a.state.doc.eq(before)).toBe(true)
  expect(b.state.doc.eq(before)).toBe(true)
})

it("链接前缀增长后可从新的链接起点输入，缩短前缀也不误拒", () => {
  const { session, a, b } = make([paragraph([
    text("前"), text("链接", link("https://example.test")), text("后")
  ])])
  const grow = a.state.tr.insertText("预", 2, 2).insertText("边", 3, 3)
  expect(session.dispatch("a", grow)).toBe(true)
  expect(a.state.doc.textContent).toBe("前预边链接后")
  expect(b.state.doc.eq(a.state.doc)).toBe(true)
  const grown = a.state.doc
  // 缩短前缀后链接区间是 [2,4)。同一个事务里第一步删掉「预边」把链接拉回 [2,4)，
  // 第二步在缩短后的坐标上删链接首字必须被拒——这里考的是缩短后的坐标，不是原坐标。
  const shrinkThenCut = a.state.tr.delete(2, 4).delete(2, 3)
  expect(session.dispatch("a", shrinkThenCut)).toBe(false)
  expect(a.state.doc.eq(grown)).toBe(true)
  expect(b.state.doc.eq(grown)).toBe(true)
  const shrink = a.state.tr.delete(2, 4)
  expect(session.dispatch("a", shrink)).toBe(true)
  expect(a.state.doc.textContent).toBe("前链接后")
  expect(b.state.doc.eq(a.state.doc)).toBe(true)
  expect(a.state.doc.eq(grown)).toBe(false)
  const shortened = a.state.doc
  // 反向正向：缩短后在新链接起点（2）输入属于边界输入，应放行。
  const insertAtNewStart = a.state.tr.insertText("边", 2, 2)
  expect(session.dispatch("a", insertAtNewStart)).toBe(true)
  expect(a.state.doc.textContent).toBe("前边链接后")
  expect(b.state.doc.eq(a.state.doc)).toBe(true)
  expect(a.state.doc.eq(shortened)).toBe(false)
})

it("浮层在容器滚动与窗口缩放时重新读取锚点位置", () => {
  const { a } = make([paragraph([text("官网", link("https://example.test"))])])
  const linkElement = anchor(a)
  let current = { left: 20, bottom: 40 }
  vi.spyOn(linkElement, "getBoundingClientRect").mockImplementation(() => ({
    left: current.left, bottom: current.bottom, top: current.bottom - 20,
    right: current.left + 100, width: 100, height: 20
  }) as DOMRect)
  const popover = open(a)
  vi.spyOn(popover, "getBoundingClientRect").mockReturnValue({ width: 100, height: 20 } as DOMRect)
  expect(popover.style.left).toBe("20px")
  expect(popover.style.top).toBe("44px")
  current = { left: 120, bottom: 96 }
  fireEvent.scroll(a.view.dom)
  expect(popover.style.left).toBe("120px")
  expect(popover.style.top).toBe("100px")
  current = { left: 180, bottom: 150 }
  fireEvent(window, new Event("resize"))
  expect(popover.style.left).toBe("180px")
  expect(popover.style.top).toBe("154px")
})
