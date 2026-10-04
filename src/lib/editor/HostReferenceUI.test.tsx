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
})
