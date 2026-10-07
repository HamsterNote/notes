// @vitest-environment jsdom
/**
 * 7.2 HostReferenceUI 候选浮层验收：输入触发渲染 listbox、pending/empty/error 状态行、
 * 点击候选精确替换（指针不打断编辑器焦点/选区）、键盘导航与 Escape、失焦取消、
 * aria combobox 属性、卸载清理。视觉断言只做结构性检查（class/role/attribute）。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { TextSelection } from "@tiptap/pm/state"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HostReferenceUI } from "./HostReferenceUI"
import { installHostReferences, type HostReferenceInstaller, type HostReferenceOptions } from "./hostReferences"
import { createEditorSession } from "./session"
import type { HostCandidateProvider } from "./types"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001"
] as const

type Session = ReturnType<typeof createEditorSession>

function documentWith(content: unknown[]) {
  return { schemaVersion: 1 as const, data: { type: "doc", content } }
}

function paragraph(nodeId: string, text: string) {
  return text === ""
    ? { type: "paragraph", attrs: { nodeId } }
    : { type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanup()
  while (cleanups.length > 0) cleanups.pop()?.()
  // 各测试对 coordsAtPos/scrollHeight/innerHeight 的 mock 不泄漏到后续用例。
  vi.restoreAllMocks()
})

function setup(options: Partial<HostReferenceOptions> = {}, text = ""): { session: Session; installer: HostReferenceInstaller } {
  const session = createEditorSession({
    documentId: "A",
    loadKey: 1,
    initialDocument: documentWith([paragraph(ids[0], text)])
  })
  // 与生产一致挂载：桥的键盘拦截走 document capture，要求 editor dom 在文档树内。
  const viewDom = session.editor.view.dom
  document.body.appendChild(viewDom)
  const installer = installHostReferences(session.editor, { documentId: "doc-1", ...options })
  cleanups.push(() => { installer.destroy(); session.destroy(); viewDom.remove() })
  // 真实 focus（jsdom 支持 contenteditable 聚焦）：桥的 focus gate 仅在聚焦时识别触发。
  viewDom.focus()
  return { session, installer }
}

function renderUI(session: Session, installer: HostReferenceInstaller) {
  return render(<HostReferenceUI editor={session.editor} installer={installer} />)
}

/** 在 pos 放置光标并输入文本（act 包裹，驱动桥 → React 同步订阅）。 */
async function typeAt(session: Session, pos: number, text: string): Promise<void> {
  await act(async () => {
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, pos)))
    session.editor.commands.insertContent(text)
    await flush()
  })
}

function keydown(session: Session, key: string): void {
  fireEvent(session.editor.view.dom, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
}

function mentionCount(session: Session): number {
  let count = 0
  session.editor.state.doc.descendants((node) => {
    if (node.type.name === "mention") count += 1
  })
  return count
}

describe("7.2 HostReferenceUI：候选浮层", () => {
  it("输入 @query 打开 listbox：pending 状态行 → 候选选项，aria combobox 属性齐全", async () => {
    let resolveCandidates!: (items: readonly { resourceId: string; name: string }[]) => void
    const candidates = vi.fn<HostCandidateProvider>(
      () => new Promise((resolve) => { resolveCandidates = resolve })
    )
    const { session, installer } = setup({ candidates })
    renderUI(session, installer)

    await typeAt(session, 1, "@ad")
    // pending 可观察
    const listbox = screen.getByRole("listbox")
    expect(listbox.getAttribute("aria-label")).toBe("提及候选")
    expect(screen.getByRole("status").textContent).toBe("正在搜索…")
    expect(session.editor.view.dom.getAttribute("aria-expanded")).toBe("true")
    expect(session.editor.view.dom.getAttribute("aria-controls")).toBe(listbox.id)

    await act(async () => {
      resolveCandidates([
        { resourceId: "u1", name: "Ada" },
        { resourceId: "u2", name: "Bob" }
      ])
      await flush()
    })
    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(2)
    expect(options[0]?.textContent).toBe("@Ada")
    expect(options[1]?.textContent).toBe("@Bob")
    expect(options[0]?.getAttribute("aria-selected")).toBe("true")
    expect(options[1]?.getAttribute("aria-selected")).toBe("false")
    // aria-activedescendant 指向当前高亮选项
    expect(session.editor.view.dom.getAttribute("aria-activedescendant")).toBe(options[0]?.id)
  })

  it("[[query 打开资源候选 listbox", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "r1", name: "周报" }])
    const { session, installer } = setup({ candidates })
    renderUI(session, installer)

    await typeAt(session, 1, "[[周")
    const listbox = screen.getByRole("listbox")
    expect(listbox.getAttribute("aria-label")).toBe("资源候选")
    expect(candidates.mock.calls[0]?.slice(0, 2)).toEqual(["resource", "周"])
    await waitFor(() => expect(screen.getByRole("option").textContent).toBe("周报"))
  })

  it("候选 empty 与 error 分别以状态行可观察呈现", async () => {
    const empty = vi.fn<HostCandidateProvider>(() => [])
    const emptySetup = setup({ candidates: empty })
    const view = renderUI(emptySetup.session, emptySetup.installer)
    await typeAt(emptySetup.session, 1, "@zz")
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("无匹配结果"))
    view.unmount()

    const failing = vi.fn<HostCandidateProvider>(() => Promise.reject(new Error("网络错误")))
    const failSetup = setup({ candidates: failing })
    renderUI(failSetup.session, failSetup.installer)
    await typeAt(failSetup.session, 1, "@zz")
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("加载失败"))
  })

  it("点击候选：pointerdown 阻止默认（编辑器不失焦），精确替换触发串，单步 undo", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer } = setup({ candidates })
    renderUI(session, installer)
    await typeAt(session, 1, "@ad")
    await waitFor(() => screen.getByRole("option"))

    const menu = screen.getByRole("listbox")
    // pointerdown/mousedown preventDefault：编辑器不 blur、选区不动，存储 range 不丢失。
    expect(fireEvent.pointerDown(menu)).toBe(false)
    expect(fireEvent.mouseDown(menu)).toBe(false)

    fireEvent.click(screen.getByRole("option"))
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(mentionCount(session)).toBe(1)
    expect(session.editor.getText()).toBe("@Ada")
    expect(session.editor.view.dom.getAttribute("aria-expanded")).toBeNull()
    // 单步 undo 恢复触发文本
    expect(session.undo()).toBe(true)
    expect(session.editor.getText()).toBe("@ad")
  })

  it("键盘 ArrowDown + Enter 选择第二项", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [
      { resourceId: "u1", name: "Ada" },
      { resourceId: "u2", name: "Bob" }
    ])
    const { session, installer } = setup({ candidates })
    renderUI(session, installer)
    await typeAt(session, 1, "@b")
    await waitFor(() => screen.getAllByRole("option"))

    keydown(session, "ArrowDown")
    const options = screen.getAllByRole("option")
    expect(options[1]?.getAttribute("aria-selected")).toBe("true")
    expect(session.editor.view.dom.getAttribute("aria-activedescendant")).toBe(options[1]?.id)

    keydown(session, "Enter")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(session.editor.getText()).toBe("@Bob")
  })

  it("Escape 关闭浮层且不改变触发文本", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer } = setup({ candidates })
    renderUI(session, installer)
    await typeAt(session, 1, "@ad")
    await waitFor(() => screen.getByRole("option"))

    keydown(session, "Escape")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(session.editor.getText()).toBe("@ad")
    expect(session.editor.view.dom.getAttribute("aria-expanded")).toBeNull()
  })

  it("编辑器失焦取消候选（点击候选路径因 preventDefault 不走 blur）", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer } = setup({ candidates })
    renderUI(session, installer)
    await typeAt(session, 1, "@ad")
    await waitFor(() => screen.getByRole("option"))

    await act(async () => {
      session.editor.view.dom.blur()
      await flush()
    })
    expect(document.activeElement).not.toBe(session.editor.view.dom)
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(installer.getCandidateState().status).toBe("idle")
  })

  it("卸载组件清理桥：aria 移除，后续输入不再触发候选", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer } = setup({ candidates })
    const view = renderUI(session, installer)
    await typeAt(session, 1, "@ad")
    await waitFor(() => screen.getByRole("option"))

    view.unmount()
    expect(session.editor.view.dom.getAttribute("aria-expanded")).toBeNull()
    const callsBefore = candidates.mock.calls.length
    await typeAt(session, 4, "x")
    expect(candidates.mock.calls.length).toBe(callsBefore)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("session 切换：旧桥在 commit 即销毁，旧编辑器按键不再被拦截，新桥立即可用", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const first = setup({ candidates })
    const { rerender } = renderUI(first.session, first.installer)
    await typeAt(first.session, 1, "@ad")
    await waitFor(() => screen.getByRole("option"))

    // 切换到新 session 的 editor/installer（identity change → 桥随 useLayoutEffect 重建）。
    const second = setup({ candidates })
    rerender(<HostReferenceUI editor={second.session.editor} installer={second.installer} />)

    // 旧编辑器上的按键不再被旧桥拦截：探针（挂在旧 view.dom）正常收到 Escape/Enter。
    const calls: string[] = []
    const probe = (event: Event): void => { calls.push((event as KeyboardEvent).key) }
    first.session.editor.view.dom.addEventListener("keydown", probe)
    first.session.editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    first.session.editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    first.session.editor.view.dom.removeEventListener("keydown", probe)
    expect(calls).toEqual(["Escape", "Enter"])

    // 新桥立即可用：在第二个编辑器输入触发串，候选正常打开。
    await typeAt(second.session, 1, "@ad")
    await waitFor(() => screen.getByRole("option"))
  })

  it("#19 光标近视口底：菜单翻转到光标上方，整体不出视口（垂直钳制 + 限高）", async () => {
    // 768 视口（jsdom 默认 innerHeight）下光标 bottom=623：旧实现 top=623、
    // 内容高 200 的菜单 bottom≈823 溢出视口；修复后翻转到光标上方。
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer } = setup({ candidates })
    vi.spyOn(session.editor.view, "coordsAtPos").mockReturnValue({ left: 20, top: 600, right: 30, bottom: 623 })
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200)
    renderUI(session, installer)

    await typeAt(session, 1, "@ad")
    const menu = await screen.findByRole("listbox")
    // 翻转：top = 600 - 6 - 200 = 394；maxHeight 取 min(288, 上方可用 582) = 288。
    await waitFor(() => expect(menu.style.top).toBe("394px"))
    expect(menu.style.maxHeight).toBe("288px")
    expect(menu.style.left).toBe("20px")
    // 菜单整体 [394, 594] 落在视口内（底缘 768），不再溢出。
    expect(394 + 200).toBeLessThanOrEqual(768)
  })

  it("#19 下方空间充足：保持光标下方定位，交互与视觉语言不变", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer } = setup({ candidates })
    vi.spyOn(session.editor.view, "coordsAtPos").mockReturnValue({ left: 20, top: 80, right: 30, bottom: 100 })
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200)
    renderUI(session, installer)

    await typeAt(session, 1, "@ad")
    const menu = await screen.findByRole("listbox")
    // 下方可用 768-100-6-12=650 ≥ 200：top = 100 + 6 = 106，不翻转。
    await waitFor(() => expect(menu.style.top).toBe("106px"))
    expect(menu.style.maxHeight).toBe("288px")
  })

  it("#19 两侧都放不下的矮视口：限高 + 内部滚动，整体钳在视口内", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer } = setup({ candidates })
    // 视口高 300、光标在中部：below=300-160-6-12=122，above=140-6-12=122，内容 200。
    const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight")
    Object.defineProperty(window, "innerHeight", { value: 300, configurable: true })
    try {
      vi.spyOn(session.editor.view, "coordsAtPos").mockReturnValue({ left: 20, top: 140, right: 30, bottom: 160 })
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200)
      renderUI(session, installer)
      await typeAt(session, 1, "@ad")
      const menu = await screen.findByRole("listbox")
      // below ≥ above 不翻转：maxHeight=122，top 钳到 300-12-122=166（= 光标下缘+6）。
      await waitFor(() => expect(menu.style.maxHeight).toBe("122px"))
      expect(menu.style.top).toBe("166px")
      expect(166 + 122).toBeLessThanOrEqual(300)
    } finally {
      if (innerHeight) Object.defineProperty(window, "innerHeight", innerHeight)
    }
  })

  it("#20 键盘高亮超出可视区：只滚菜单自身到最近可见，焦点留在编辑器、页面不滚", async () => {
    const items = Array.from({ length: 20 }, (_v, i) => ({ resourceId: `u${i + 1}`, name: `用户${i + 1}` }))
    const candidates = vi.fn<HostCandidateProvider>(() => items)
    const { session, installer } = setup({ candidates })
    renderUI(session, installer)
    await typeAt(session, 1, "@u")
    const menu = await screen.findByRole("listbox")
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20))

    // jsdom 无布局：铺设可视窗 100px、每选项 20px 的几何（前 5 项可见）。
    Object.defineProperty(menu, "clientHeight", { value: 100, configurable: true })
    screen.getAllByRole("option").forEach((option, index) => {
      Object.defineProperty(option, "offsetTop", { value: index * 20, configurable: true })
      Object.defineProperty(option, "offsetHeight", { value: 20, configurable: true })
    })
    expect(menu.scrollTop).toBe(0)

    // ArrowDown ×10 → 高亮第 11 项（offsetTop 200，旧实现 scrollTop 仍 0 不可见）。
    for (let i = 0; i < 10; i += 1) keydown(session, "ArrowDown")
    const options = screen.getAllByRole("option")
    expect(options[10]?.getAttribute("aria-selected")).toBe("true")
    // 菜单内滚到最近可见：scrollTop = 220 - 100 = 120；高亮项完整落在可视窗内。
    expect(menu.scrollTop).toBe(120)

    // ArrowUp 回到顶部：高亮第 1 项 → scrollTop 回落 0（nearest 语义）。
    for (let i = 0; i < 10; i += 1) keydown(session, "ArrowUp")
    expect(options[0]?.getAttribute("aria-selected")).toBe("true")
    expect(menu.scrollTop).toBe(0)

    // 焦点全程留在编辑器，页面/文档容器不滚。
    expect(document.activeElement).toBe(session.editor.view.dom)
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)
  })

  it("#20 pending → ready 切换：无选项期间不触碰 scrollTop，候选到位不跳动", async () => {
    let resolveCandidates!: (items: readonly { resourceId: string; name: string }[]) => void
    const candidates = vi.fn<HostCandidateProvider>(
      () => new Promise((resolve) => { resolveCandidates = resolve })
    )
    const { session, installer } = setup({ candidates })
    renderUI(session, installer)
    await typeAt(session, 1, "@ad")
    const menu = await screen.findByRole("listbox")
    // pending 状态行期间：高亮 -1，scrollTop 恒 0。
    expect(screen.getByRole("status").textContent).toBe("正在搜索…")
    expect(menu.scrollTop).toBe(0)

    await act(async () => {
      resolveCandidates([{ resourceId: "u1", name: "Ada" }])
      await flush()
    })
    expect(screen.getByRole("option").getAttribute("aria-selected")).toBe("true")
    expect(menu.scrollTop).toBe(0)
  })
})
