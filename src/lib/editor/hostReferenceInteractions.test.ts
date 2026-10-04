// @vitest-environment jsdom
/**
 * 7.2 宿主引用交互桥验收：触发识别（@query / [[query）、composition 不触发不抢键、
 * 键盘环形/Enter/Escape、selection/query 变化取消、旧 range 拒绝插入、点击激活交接宿主、
 * resolve mapping 的 DOM 占位呈现、destroy 清理。文档真实性以 encodeHnn/undo 复核。
 */
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { afterEach, describe, expect, it, vi } from "vitest"
import { encodeHnn } from "../hnn/codec"
import { createHostReferenceInteractions, type HostReferenceInteractions } from "./hostReferenceInteractions"
import { installHostReferences, type HostReferenceInstaller, type HostReferenceOptions } from "./hostReferences"
import { createEditorSession } from "./session"
import type { HostCandidateProvider, HostReferenceActivate, HostReferenceResolve } from "./types"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003",
  "123e4567-e89b-42d3-a456-426614174004",
  "123e4567-e89b-42d3-a456-426614174005"
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

function mentionNode(nodeId: string, resourceId: string, name: string) {
  return { type: "mention", attrs: { nodeId, resourceId, name } }
}

function resourceNode(nodeId: string, resourceId: string, name: string) {
  return { type: "resource", attrs: { nodeId, resourceId, name } }
}

function referenceDocument() {
  return documentWith([
    {
      type: "paragraph",
      attrs: { nodeId: ids[0] },
      content: [
        { type: "text", text: "见 " },
        mentionNode(ids[1], "u1", "Ada"),
        { type: "text", text: " 与 " },
        resourceNode(ids[2], "r1", "周报"),
        { type: "text", text: "。" }
      ]
    },
    { type: "externalItem", attrs: { nodeId: ids[3], resourceId: "e1", name: "外部条目" } }
  ])
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length > 0) cleanups.pop()?.() })

function setup(content: unknown[], options: Partial<HostReferenceOptions> = {}): {
  session: Session
  installer: HostReferenceInstaller
  bridge: HostReferenceInteractions
} {
  const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith(content) })
  // 与生产一致挂载到 document：桥的键盘拦截走 document capture 阶段，要求 editor dom 在文档树内。
  const viewDom = session.editor.view.dom
  document.body.appendChild(viewDom)
  const installer = installHostReferences(session.editor, { documentId: "doc-1", ...options })
  const bridge = createHostReferenceInteractions(session.editor, installer)
  cleanups.push(() => { bridge.destroy(); installer.destroy(); session.destroy(); viewDom.remove() })
  // 真实 focus（jsdom 支持 contenteditable 聚焦）：focus gate 仅在聚焦时识别触发。
  viewDom.focus()
  return { session, installer, bridge }
}

/** 手动装配（不建桥、不 focus）：供初始同步/focus gate 用例自定义桥的创建时机。 */
function assemble(content: unknown[], options: Partial<HostReferenceOptions> = {}): {
  session: Session
  installer: HostReferenceInstaller
  viewDom: HTMLElement
} {
  const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith(content) })
  const viewDom = session.editor.view.dom
  document.body.appendChild(viewDom)
  const installer = installHostReferences(session.editor, { documentId: "doc-1", ...options })
  cleanups.push(() => { installer.destroy(); session.destroy(); viewDom.remove() })
  return { session, installer, viewDom }
}

function textSetup(text = "", options: Partial<HostReferenceOptions> = {}) {
  return setup([paragraph(ids[0], text)], options)
}

function setCursor(session: Session, pos: number): void {
  session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, pos)))
}

function typeText(session: Session, text: string): void {
  session.editor.commands.insertContent(text)
}

function keydown(session: Session, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  session.editor.view.dom.dispatchEvent(event)
  return event
}

/** 在指定元素（如引用 pill）上派发 keydown，target 即该元素。 */
function keydownOn(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

/**
 * 探针：挂在 view.dom 上的 keydown 监听（注册晚于 PM）。桥的 document capture 拦截
 * 会 stopPropagation，探针不触发即证明事件被桥消费；探针触发则证明桥放行。
 */
function keydownProbe(session: Session): { calls: string[]; stop: () => void } {
  const calls: string[] = []
  const probe = (event: Event): void => {
    calls.push((event as KeyboardEvent).key)
  }
  session.editor.view.dom.addEventListener("keydown", probe)
  return { calls, stop: () => session.editor.view.dom.removeEventListener("keydown", probe) }
}

function referenceDom(session: Session, kind: string): HTMLElement {
  const dom = session.editor.view.dom.querySelector(`[data-hnn-node="${kind}"]`)
  if (!(dom instanceof HTMLElement)) throw new Error(`未找到 ${kind} 的 NodeView dom`)
  return dom
}

function mentionCount(session: Session): number {
  let count = 0
  session.editor.state.doc.descendants((node) => {
    if (node.type.name === "mention" || node.type.name === "resource") count += 1
  })
  return count
}

describe("7.2 交互桥：触发识别与候选请求", () => {
  it("@query 在当前 textblock 内触发 mention 候选并记录精确 range", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, bridge } = textSetup("", { candidates })
    setCursor(session, 1)

    typeText(session, "@ad")
    expect(candidates).toHaveBeenCalledTimes(1)
    expect(candidates.mock.calls[0]?.slice(0, 2)).toEqual(["mention", "ad"])
    expect(bridge.getState().trigger).toEqual({ kind: "mention", query: "ad", from: 1, to: 4 })
  })

  it("[[query 触发 resource 候选", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "r1", name: "周报" }])
    const { session, bridge } = textSetup("", { candidates })
    setCursor(session, 1)

    typeText(session, "[[te")
    expect(candidates).toHaveBeenCalledTimes(1)
    expect(candidates.mock.calls[0]?.slice(0, 2)).toEqual(["resource", "te"])
    expect(bridge.getState().trigger).toEqual({ kind: "resource", query: "te", from: 1, to: 5 })
  })

  it("@ 前非空白（邮箱样文本）不触发；空白后的 @ 触发", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [])
    const email = textSetup("a@b", { candidates })
    setCursor(email.session, 4) // "a@b" 文本末尾
    expect(candidates).not.toHaveBeenCalled()
    expect(email.bridge.getState().trigger).toBeNull()

    const spaced = textSetup("hi", { candidates })
    setCursor(spaced.session, 3) // "hi" 末尾
    typeText(spaced.session, " @ad")
    expect(candidates).toHaveBeenCalledTimes(1)
    expect(candidates.mock.calls[0]?.slice(0, 2)).toEqual(["mention", "ad"])
  })

  it("继续输入改变 query 重新请求；selection 移出触发词即取消", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [])
    const { session, installer, bridge } = textSetup("", { candidates })
    setCursor(session, 1)

    typeText(session, "@a")
    typeText(session, "b")
    expect(candidates.mock.calls.map((call) => call[1])).toEqual(["a", "ab"])
    expect(bridge.getState().trigger?.query).toBe("ab")

    // 光标移到触发串之前：不再是触发场景，候选取消回 idle。
    setCursor(session, 1)
    expect(bridge.getState().trigger).toBeNull()
    expect(installer.getCandidateState()).toMatchObject({ kind: null, status: "idle" })
  })

  it("NodeSelection（点击引用）不触发候选", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [])
    const { session, bridge } = setup([
      {
        type: "paragraph",
        attrs: { nodeId: ids[0] },
        content: [{ type: "text", text: "见 " }, mentionNode(ids[1], "u1", "Ada")]
      }
    ], { candidates })
    // "见 " 占 pos 1..3，mention atom 在 pos 3。
    session.editor.view.dispatch(
      session.editor.state.tr.setSelection(NodeSelection.create(session.editor.state.doc, 3))
    )
    expect(session.editor.state.selection instanceof NodeSelection).toBe(true)
    expect(candidates).not.toHaveBeenCalled()
    expect(bridge.getState().trigger).toBeNull()
  })

  it("composition 期间不识别触发，compositionend 后恢复识别", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, bridge } = textSetup("", { candidates })
    setCursor(session, 1)
    const viewDom = session.editor.view.dom

    viewDom.dispatchEvent(new Event("compositionstart"))
    typeText(session, "@ad")
    expect(candidates).not.toHaveBeenCalled()
    expect(bridge.getState().trigger).toBeNull()

    viewDom.dispatchEvent(new Event("compositionend"))
    expect(candidates).toHaveBeenCalledTimes(1)
    expect(bridge.getState().trigger).toMatchObject({ kind: "mention", query: "ad" })
  })

  it("compositionstart 取消旧 ready 候选：菜单关闭、旧候选不可接受、按键不拦截，compositionend 重新识别", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer, bridge } = textSetup("", { candidates })
    setCursor(session, 1)
    typeText(session, "@ad")
    await flush()
    expect(installer.getCandidateState().status).toBe("ready")
    const viewDom = session.editor.view.dom

    // 进入 IME：旧候选立即不可点/不可接受。
    viewDom.dispatchEvent(new Event("compositionstart"))
    expect(bridge.getState().trigger).toBeNull()
    expect(installer.getCandidateState().status).toBe("idle")
    expect(viewDom.getAttribute("aria-expanded")).toBeNull()
    const before = session.editor.state.doc
    expect(bridge.selectCandidate({ resourceId: "u1", name: "Ada" })).toBe(false)
    expect(session.editor.state.doc.eq(before)).toBe(true)

    // composition 中按键不拦截（探针仍收到），菜单保持关闭。
    const probe = keydownProbe(session)
    keydown(session, "Escape")
    probe.stop()
    expect(probe.calls).toEqual(["Escape"])
    expect(bridge.getState().trigger).toBeNull()

    viewDom.dispatchEvent(new Event("compositionend"))
    expect(bridge.getState().trigger).toMatchObject({ kind: "mention", query: "ad" })
    expect(candidates).toHaveBeenCalledTimes(2)
  })

  it("compositionstart abort 在途 pending 请求：迟到的旧 promise 不覆盖 idle", async () => {
    const request = deferred<readonly { resourceId: string; name: string }[]>()
    const candidates = vi.fn<HostCandidateProvider>(() => request.promise)
    const { session, installer, bridge } = textSetup("", { candidates })
    setCursor(session, 1)
    typeText(session, "@ad")
    expect(installer.getCandidateState().status).toBe("loading")
    const firstCall = candidates.mock.calls[0]
    if (!firstCall) throw new Error("未调用 candidates")
    const viewDom = session.editor.view.dom

    viewDom.dispatchEvent(new Event("compositionstart"))
    expect(firstCall[2].signal.aborted).toBe(true)
    expect(installer.getCandidateState().status).toBe("idle")
    expect(bridge.getState().trigger).toBeNull()

    // 旧 promise 迟到兑现：被 token 机制丢弃，不覆盖 idle。
    request.resolve([{ resourceId: "u1", name: "Ada" }])
    await flush()
    expect(installer.getCandidateState().status).toBe("idle")

    viewDom.dispatchEvent(new Event("compositionend"))
    expect(candidates).toHaveBeenCalledTimes(2)
    expect(installer.getCandidateState()).toMatchObject({ status: "loading", query: "ad" })
  })
})

describe("7.2 交互桥：键盘导航与精确替换", () => {
  const threeCandidates: HostCandidateProvider = () => [
    { resourceId: "u1", name: "Ada" },
    { resourceId: "u2", name: "Bob" },
    { resourceId: "u3", name: "Cid" }
  ]

  it("ArrowUp/ArrowDown 环形移动高亮，Enter 以存储 range 精确替换且单步 undo", async () => {
    const candidates = vi.fn<HostCandidateProvider>(threeCandidates)
    const { session, bridge } = textSetup("", { candidates })
    setCursor(session, 1)
    typeText(session, "@a")
    await flush()
    const probe = keydownProbe(session)

    expect(keydown(session, "ArrowDown").defaultPrevented).toBe(true)
    expect(probe.calls).toEqual([]) // 桥在 capture 阶段拦截，PM 看不到该键
    expect(bridge.getState().activeIndex).toBe(1)
    keydown(session, "ArrowDown")
    expect(bridge.getState().activeIndex).toBe(2)
    keydown(session, "ArrowDown") // 环形回 0
    expect(bridge.getState().activeIndex).toBe(0)
    keydown(session, "ArrowUp") // 环形回 2
    expect(bridge.getState().activeIndex).toBe(2)

    const enter = keydown(session, "Enter")
    expect(enter.defaultPrevented).toBe(true)
    expect(probe.calls).toEqual([]) // Enter 也被完全拦截，不产生换行
    probe.stop()
    expect(bridge.getState().trigger).toBeNull()
    // 触发串 "@a" 被整体替换为高亮项（第 3 项 Cid），文档只持久资源标识与 name。
    expect(mentionCount(session)).toBe(1)
    expect(session.editor.getText()).toBe("@Cid")
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
    expect(session.undo()).toBe(true)
    expect(session.editor.getText()).toBe("@a")
    expect(mentionCount(session)).toBe(0)
  })

  it("Escape 关闭菜单且不改变触发文本", async () => {
    const candidates = vi.fn<HostCandidateProvider>(threeCandidates)
    const { session, installer, bridge } = textSetup("", { candidates })
    setCursor(session, 1)
    typeText(session, "@a")
    await flush()
    const before = session.editor.state.doc
    const probe = keydownProbe(session)

    const escape = keydown(session, "Escape")
    expect(escape.defaultPrevented).toBe(true)
    expect(probe.calls).toEqual([])
    probe.stop()
    expect(bridge.getState().trigger).toBeNull()
    expect(installer.getCandidateState().status).toBe("idle")
    expect(session.editor.state.doc.eq(before)).toBe(true)
  })

  it("无候选时 Enter/方向键不拦截，交由编辑器正常处理", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [])
    const { session, bridge } = textSetup("", { candidates })
    setCursor(session, 1)
    typeText(session, "@zz")
    await flush()
    expect(bridge.getState().trigger).not.toBeNull()
    const probe = keydownProbe(session)

    keydown(session, "ArrowDown")
    keydown(session, "Enter")
    probe.stop()
    // 两个键都到达 view.dom（桥未拦截）；activeIndex 保持 0。
    expect(probe.calls).toEqual(["ArrowDown", "Enter"])
    expect(bridge.getState().activeIndex).toBe(0)
  })

  it("取消/selection 改变后旧 range 不能插到新光标：selectCandidate 拒绝且文档不变", async () => {
    const candidates = vi.fn<HostCandidateProvider>(threeCandidates)
    const { session, bridge } = textSetup("", { candidates })
    setCursor(session, 1)
    typeText(session, "@x")
    await flush()
    expect(bridge.getState().trigger).not.toBeNull()

    // 光标移回文档开头（离开触发词），候选取消。
    setCursor(session, 1)
    const before = session.editor.state.doc
    expect(bridge.selectCandidate({ resourceId: "u1", name: "Ada" })).toBe(false)
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(mentionCount(session)).toBe(0)
  })

  it("桥 selectCandidate 使用存储 range：不重新读取宿主、不重新捕获快照", async () => {
    const candidates = vi.fn<HostCandidateProvider>(threeCandidates)
    const { session, bridge } = textSetup("hi ", { candidates })
    setCursor(session, 4) // "hi " 末尾
    typeText(session, "@b")
    await flush()

    expect(bridge.selectCandidate({ resourceId: "u2", name: "Bob" })).toBe(true)
    // "@b"（pos 4..7）被精确替换，前面文本 "hi " 原样保留。
    expect(session.editor.getText()).toBe("hi @Bob")
    expect(mentionCount(session)).toBe(1)
    // 成功路径只调用一次候选请求（触发时），插入不再触发新查询。
    expect(candidates).toHaveBeenCalledTimes(1)
  })
})

describe("7.2 交互桥：点击激活交接宿主", () => {
  it("点击 mention/resource/externalItem 的 NodeView 激活宿主回调，库不自行导航", () => {
    const activate = vi.fn<HostReferenceActivate>()
    const { session } = setup(referenceDocument().data.content, { activate })

    referenceDom(session, "mention").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate.mock.calls[0]?.[0]).toEqual({ kind: "mention", resourceId: "u1", name: "Ada" })
    expect(activate.mock.calls[0]?.[1].documentId).toBe("doc-1")
    expect(activate.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)

    referenceDom(session, "resource").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    referenceDom(session, "externalItem").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(activate.mock.calls[1]?.[0]).toEqual({ kind: "resource", resourceId: "r1", name: "周报" })
    expect(activate.mock.calls[2]?.[0]).toEqual({ kind: "externalItem", resourceId: "e1", name: "外部条目" })

    // 点击普通区域不激活；文档全程不变。
    const before = session.editor.state.doc
    session.editor.view.dom.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(activate).toHaveBeenCalledTimes(3)
    expect(session.editor.state.doc.eq(before)).toBe(true)
  })

  it("嵌套 DOM 目标：点击/键盘命中 externalItem 内部 label 也正确解析", () => {
    const activate = vi.fn<HostReferenceActivate>()
    const { session } = setup(referenceDocument().data.content, { activate })
    const label = referenceDom(session, "externalItem").querySelector(".hn-editor-external-item-name")
    if (!(label instanceof HTMLElement)) throw new Error("未找到 externalItem label")

    label.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(activate.mock.calls[0]?.[0]).toEqual({ kind: "externalItem", resourceId: "e1", name: "外部条目" })
    const event = keydownOn(label, "Enter")
    expect(event.defaultPrevented).toBe(true)
    expect(activate.mock.calls[1]?.[0]).toEqual({ kind: "externalItem", resourceId: "e1", name: "外部条目" })
  })
})

describe("7.2 交互桥：引用键盘可达与激活（hasActivate）", () => {
  it("宿主提供 activate 时三类引用运行时获得 tabindex/role；doc/selection/history/HNN 零变", () => {
    const activate = vi.fn<HostReferenceActivate>()
    const { session, installer } = setup(referenceDocument().data.content, { activate })
    expect(installer.hasActivate).toBe(true)
    const before = encodeHnn(session.editor.state.doc)
    const selectionBefore = session.editor.state.selection

    for (const kind of ["mention", "resource", "externalItem"]) {
      const dom = referenceDom(session, kind)
      expect(dom.getAttribute("tabindex")).toBe("0")
      expect(dom.getAttribute("role")).toBe("link")
    }
    // 运行时 attribute 不进 PM/HNN，selection 与历史不变。
    expect(encodeHnn(session.editor.state.doc)).toEqual(before)
    expect(session.editor.state.selection.eq(selectionBefore)).toBe(true)
    expect(session.undo()).toBe(false)
  })

  it("无 activate 回调（hasActivate=false）：无任何 tab stop/链接语义，按键一律放行", () => {
    const { session, installer } = setup(referenceDocument().data.content)
    expect(installer.hasActivate).toBe(false)
    for (const kind of ["mention", "resource", "externalItem"]) {
      const dom = referenceDom(session, kind)
      expect(dom.hasAttribute("tabindex")).toBe(false)
      expect(dom.hasAttribute("role")).toBe(false)
    }
    const probe = keydownProbe(session)
    keydownOn(referenceDom(session, "mention"), "Enter")
    probe.stop()
    expect(probe.calls).toEqual(["Enter"])
  })

  it("Enter/Space 激活聚焦的引用：三类回调、preventDefault，doc/selection/history 零变", () => {
    const activate = vi.fn<HostReferenceActivate>()
    const { session } = setup(referenceDocument().data.content, { activate })
    const before = encodeHnn(session.editor.state.doc)
    const selectionBefore = session.editor.state.selection

    const mention = referenceDom(session, "mention")
    mention.focus()
    expect(document.activeElement).toBe(mention) // tab stop 真实可用
    const enterEvent = keydownOn(mention, "Enter")
    expect(enterEvent.defaultPrevented).toBe(true)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate.mock.calls[0]?.[0]).toEqual({ kind: "mention", resourceId: "u1", name: "Ada" })

    const resource = referenceDom(session, "resource")
    resource.focus()
    const spaceEvent = keydownOn(resource, " ")
    expect(spaceEvent.defaultPrevented).toBe(true)
    expect(activate.mock.calls[1]?.[0]).toEqual({ kind: "resource", resourceId: "r1", name: "周报" })

    const external = referenceDom(session, "externalItem")
    external.focus()
    keydownOn(external, "Enter")
    expect(activate.mock.calls[2]?.[0]).toEqual({ kind: "externalItem", resourceId: "e1", name: "外部条目" })

    // 零变：文档/HNN/selection/历史（blur meta transaction 不入历史）。
    expect(encodeHnn(session.editor.state.doc)).toEqual(before)
    expect(session.editor.state.selection.eq(selectionBefore)).toBe(true)
    expect(session.undo()).toBe(false)
  })

  it("非引用按键一律放行：不 preventDefault、不激活", () => {
    const activate = vi.fn<HostReferenceActivate>()
    const { session } = setup(referenceDocument().data.content, { activate })
    const probe = keydownProbe(session)
    // pill 上的普通字符键：放行。
    keydownOn(referenceDom(session, "mention"), "a")
    // 非引用目标（view.dom）上的 Enter（无候选菜单）：放行。
    keydown(session, "Enter")
    probe.stop()
    expect(probe.calls).toEqual(["a", "Enter"])
    expect(activate).not.toHaveBeenCalled()
  })

  it("菜单打开时 Enter 属于候选而非引用激活", async () => {
    const activate = vi.fn<HostReferenceActivate>()
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u2", name: "Grace" }])
    const { session } = textSetup("", { activate, candidates })
    setCursor(session, 1)
    typeText(session, "@gr")
    await flush()

    keydown(session, "Enter")
    expect(activate).not.toHaveBeenCalled()
    expect(mentionCount(session)).toBe(1) // 候选被选中插入
  })

  it("composition 期间引用激活不抢键，compositionend 后恢复", () => {
    const activate = vi.fn<HostReferenceActivate>()
    const { session } = setup(referenceDocument().data.content, { activate })
    const viewDom = session.editor.view.dom
    const pill = referenceDom(session, "mention")

    viewDom.dispatchEvent(new Event("compositionstart"))
    const probe = keydownProbe(session)
    keydownOn(pill, "Enter")
    probe.stop()
    expect(probe.calls).toEqual(["Enter"]) // 桥未拦截
    expect(activate).not.toHaveBeenCalled()

    viewDom.dispatchEvent(new Event("compositionend"))
    keydownOn(pill, "Enter")
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it("NodeView 重建后链接语义自动补齐且激活可用", async () => {
    const activate = vi.fn<HostReferenceActivate>()
    const { session } = setup(referenceDocument().data.content, { activate })
    // 删除 mention 所在段后 undo：NodeView 重建为新 dom。
    const doc = session.editor.state.doc
    const first = doc.child(0)
    session.editor.view.dispatch(session.editor.state.tr.delete(0, first.nodeSize))
    expect(session.editor.view.dom.querySelector('[data-hnn-node="mention"]')).toBeNull()
    expect(session.undo()).toBe(true)
    await flush()

    const rebuilt = referenceDom(session, "mention")
    expect(rebuilt.getAttribute("tabindex")).toBe("0")
    expect(rebuilt.getAttribute("role")).toBe("link")
    keydownOn(rebuilt, "Enter")
    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate.mock.calls[0]?.[0]).toEqual({ kind: "mention", resourceId: "u1", name: "Ada" })
  })

  it("destroy 精确还原桥添加的 tabindex/role", () => {
    const activate = vi.fn<HostReferenceActivate>()
    const { session, bridge } = setup(referenceDocument().data.content, { activate })
    expect(referenceDom(session, "mention").getAttribute("role")).toBe("link")

    bridge.destroy()
    for (const kind of ["mention", "resource", "externalItem"]) {
      const dom = referenceDom(session, kind)
      expect(dom.hasAttribute("tabindex")).toBe(false)
      expect(dom.hasAttribute("role")).toBe(false)
    }
  })
})

describe("7.2 交互桥：editor.destroy 级联", () => {
  it("编辑器销毁级联桥销毁：旧按键不再被拦截，读 view 路径不抛错，重复 destroy 幂等", async () => {
    const activate = vi.fn<HostReferenceActivate>()
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, bridge } = textSetup("", { activate, candidates })
    setCursor(session, 1)
    typeText(session, "@ad")
    await flush()
    expect(bridge.getState().trigger).not.toBeNull()
    const viewDom = session.editor.view.dom

    session.destroy() // editor.on("destroy") 级联 bridge.destroy()
    expect(bridge.getState().trigger).toBeNull()

    // 注意：TipTap 的 editor.view getter 在 destroy 后抛错，探针须挂在事前捕获的
    // viewDom 上（PM 不从 document 摘除该元素，事件仍沿 DOM 树冒泡）。
    const calls: string[] = []
    const probe = (event: Event): void => { calls.push((event as KeyboardEvent).key) }
    viewDom.addEventListener("keydown", probe)
    expect(() => {
      viewDom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
      viewDom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    }).not.toThrow()
    viewDom.removeEventListener("keydown", probe)
    expect(calls).toEqual(["Escape", "Enter"]) // 桥的 document capture 监听已摘除，不拦截
    expect(activate).not.toHaveBeenCalled()

    // destroy 后触及 view 的路径全部安全：selectCandidate 拒绝、cancel/destroy 幂等。
    expect(bridge.selectCandidate({ resourceId: "u1", name: "Ada" })).toBe(false)
    expect(() => { bridge.cancel(); bridge.destroy() }).not.toThrow()
  })
})

describe("7.2 交互桥：解析状态占位呈现", () => {
  it("resolved：DOM attribute 呈现 label/description，文档与 DOM 文本不变", async () => {
    const resolve = vi.fn<HostReferenceResolve>(() => ({ label: "Ada Lovelace", description: "项目成员" }))
    const { session } = setup(referenceDocument().data.content, { resolve })
    const before = session.editor.state.doc
    setCursor(session, 2)
    await flush()

    const mention = referenceDom(session, "mention")
    expect(mention.getAttribute("data-hnn-resolve-status")).toBe("resolved")
    expect(mention.getAttribute("title")).toBe("Ada Lovelace：项目成员")
    // 占位不破坏文档或 DOM selection：label 不写进节点文本，文档零变化。
    expect(mention.textContent).toBe("@Ada")
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(session.editor.state.selection.from).toBe(2)
    // 不将 label/description 写 PM/HNN：序列化结果与原文档一致。
    expect(encodeHnn(session.editor.state.doc)).toEqual(encodeHnn(before))
  })

  it("loading/missing/error 分别呈现为可观察占位", async () => {
    const pending = new Promise<null>(() => undefined)
    const loading = setup(referenceDocument().data.content, { resolve: () => pending })
    await flush()
    expect(referenceDom(loading.session, "mention").getAttribute("data-hnn-resolve-status")).toBe("loading")
    cleanups.pop()?.()

    const missing = setup(referenceDocument().data.content, { resolve: () => null })
    await flush()
    const missingMention = referenceDom(missing.session, "mention")
    expect(missingMention.getAttribute("data-hnn-resolve-status")).toBe("missing")
    expect(missingMention.textContent).toBe("@Ada")
    cleanups.pop()?.()

    const failing = setup(referenceDocument().data.content, { resolve: () => Promise.reject(new Error("解析失败")) })
    await flush()
    expect(referenceDom(failing.session, "mention").getAttribute("data-hnn-resolve-status")).toBe("error")
    expect(failing.session.editor.getText()).toContain("@Ada")
  })

  it("引用从文档删除后解析状态 attribute 一并消失", async () => {
    const resolve = vi.fn<HostReferenceResolve>(() => ({ label: "Ada" }))
    const { session } = setup([
      paragraph(ids[0], "x"),
      { type: "paragraph", attrs: { nodeId: ids[1] }, content: [mentionNode(ids[2], "u1", "Ada")] }
    ], { resolve })
    await flush()
    expect(referenceDom(session, "mention").getAttribute("data-hnn-resolve-status")).toBe("resolved")

    // 删除整个第二段（含 mention）。
    const doc = session.editor.state.doc
    const from = doc.child(0).nodeSize
    const second = doc.child(1)
    session.editor.view.dispatch(session.editor.state.tr.delete(from, from + second.nodeSize))
    await flush()
    expect(session.editor.view.dom.querySelector('[data-hnn-node="mention"]')).toBeNull()
  })
})

describe("7.2 交互桥：destroy 清理", () => {
  it("destroy 摘除监听、取消候选、还原 aria 与占位 attribute，之后输入不再触发", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const resolve = vi.fn<HostReferenceResolve>(() => ({ label: "Ada" }))
    const { session, installer, bridge } = setup(referenceDocument().data.content, { candidates, resolve })
    await flush()
    expect(referenceDom(session, "mention").getAttribute("data-hnn-resolve-status")).toBe("resolved")

    // 打开菜单后再 destroy（"见 " 的空白后输入 @q）。
    setCursor(session, 3)
    typeText(session, "@q")
    expect(bridge.getState().trigger).not.toBeNull()
    expect(session.editor.view.dom.getAttribute("aria-expanded")).toBe("true")

    const callsBefore = candidates.mock.calls.length
    bridge.destroy()
    expect(session.editor.view.dom.getAttribute("aria-expanded")).toBeNull()
    expect(session.editor.view.dom.getAttribute("aria-controls")).toBeNull()
    expect(session.editor.view.dom.getAttribute("aria-activedescendant")).toBeNull()
    expect(referenceDom(session, "mention").getAttribute("data-hnn-resolve-status")).toBeNull()
    expect(installer.getCandidateState().status).toBe("idle")

    // destroy 后输入与按键都不再有任何效果。
    typeText(session, "more")
    keydown(session, "Escape")
    expect(candidates.mock.calls.length).toBe(callsBefore)
    expect(bridge.getState().trigger).toBeNull()

    // 幂等：重复 destroy 安全。
    expect(() => bridge.destroy()).not.toThrow()
  })
})

describe("7.2 交互桥：range 迁移重新请求", () => {
  it("同 kind/query 但 range 移到另一处：取消旧请求并重新请求，旧结果不覆盖", async () => {
    const first = deferred<readonly { resourceId: string; name: string }[]>()
    const second = deferred<readonly { resourceId: string; name: string }[]>()
    const candidates = vi.fn<HostCandidateProvider>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    // 两段完全相同的触发文本 "@ad"：para1 文本 1..4，para2 文本 6..9。
    const { session, installer, bridge } = setup([paragraph(ids[0], "@ad"), paragraph(ids[1], "@ad")], { candidates })
    setCursor(session, 4)
    expect(bridge.getState().trigger).toEqual({ kind: "mention", query: "ad", from: 1, to: 4 })
    const firstCall = candidates.mock.calls[0]
    if (!firstCall) throw new Error("未调用 candidates")

    // 光标移到第二段的相同触发词：range 变化 → 取消旧请求并重新请求。
    setCursor(session, 9)
    expect(candidates).toHaveBeenCalledTimes(2)
    expect(firstCall[2].signal.aborted).toBe(true)
    expect(bridge.getState().trigger).toEqual({ kind: "mention", query: "ad", from: 6, to: 9 })
    expect(bridge.getState().activeIndex).toBe(0)

    // 旧请求迟到兑现不覆盖新状态；新请求兑现后正常 ready。
    first.resolve([{ resourceId: "old", name: "Old" }])
    await flush()
    expect(installer.getCandidateState().status).toBe("loading")
    second.resolve([{ resourceId: "u1", name: "Ada" }])
    await flush()
    expect(installer.getCandidateState()).toMatchObject({ status: "ready", query: "ad" })
  })
})

describe("7.2 交互桥：初始同步", () => {
  it("桥创建前已 resolved/missing/loading 的引用立即呈现：无 doc 变更、HNN 不变", async () => {
    const pending = new Promise<null>(() => undefined)
    // resolve 签名为 (reference: { kind, resourceId }, context)。
    const resolve = vi.fn<HostReferenceResolve>(({ resourceId }) => {
      if (resourceId === "r1") return null
      if (resourceId === "e1") return pending
      return { label: "Ada Lovelace" }
    })
    // 手动装配：installer 先完成解析，桥后建，全程无 doc 变更/通知。
    const { session, installer } = assemble(referenceDocument().data.content, { resolve })
    await flush() // u1 resolved / r1 missing / e1 loading 均已落 entries
    const before = encodeHnn(session.editor.state.doc)

    const bridge = createHostReferenceInteractions(session.editor, installer)
    cleanups.push(() => bridge.destroy())

    expect(referenceDom(session, "mention").getAttribute("data-hnn-resolve-status")).toBe("resolved")
    expect(referenceDom(session, "mention").getAttribute("title")).toBe("Ada Lovelace")
    expect(referenceDom(session, "resource").getAttribute("data-hnn-resolve-status")).toBe("missing")
    expect(referenceDom(session, "externalItem").getAttribute("data-hnn-resolve-status")).toBe("loading")
    // 占位不写 PM/HNN：序列化与建桥前一致；解析条目即 installer 初始扫描的三条。
    expect(encodeHnn(session.editor.state.doc)).toEqual(before)
    expect(installer.getReferenceState().entries.map((entry) => `${entry.kind}:${entry.status}`)).toEqual([
      "externalItem:loading",
      "mention:resolved",
      "resource:missing"
    ])
  })
})

describe("7.2 交互桥：focus gate", () => {
  it("未聚焦编辑器不因后台 doc 变化打开候选；真实 focus 后只读识别既有触发", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    // 手动装配：编辑器全程未聚焦（不调用 focus）。
    const { session, installer, viewDom } = assemble([paragraph(ids[0], "")], { candidates })
    const bridge = createHostReferenceInteractions(session.editor, installer)
    cleanups.push(() => bridge.destroy())

    // 后台（程序）输入触发文本：未聚焦 → 不识别、不请求。
    setCursor(session, 1)
    typeText(session, "@ad")
    expect(candidates).not.toHaveBeenCalled()
    expect(bridge.getState().trigger).toBeNull()

    // 真实 focus：不改动 selection/文档，仅按当前光标识别既有合法触发。
    const docBefore = session.editor.state.doc
    const selectionBefore = session.editor.state.selection
    viewDom.focus()
    expect(document.activeElement).toBe(viewDom)
    expect(candidates).toHaveBeenCalledTimes(1)
    expect(candidates.mock.calls[0]?.slice(0, 2)).toEqual(["mention", "ad"])
    expect(bridge.getState().trigger).toMatchObject({ kind: "mention", query: "ad" })
    expect(session.editor.state.doc.eq(docBefore)).toBe(true)
    expect(session.editor.state.selection.eq(selectionBefore)).toBe(true)
  })

  it("blur 后后台 doc/history 变化不重开候选，重新 focus 再按当前光标识别", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer, bridge } = textSetup("", { candidates }) // setup 已真实 focus
    setCursor(session, 1)
    typeText(session, "@ad")
    await flush()
    expect(bridge.getState().trigger).not.toBeNull()

    // 真实 blur：菜单取消、候选回 idle。
    session.editor.view.dom.blur()
    expect(document.activeElement).not.toBe(session.editor.view.dom)
    expect(bridge.getState().trigger).toBeNull()
    expect(installer.getCandidateState().status).toBe("idle")

    // 后台 history 变化（撤销输入）：不重开候选、不再请求。
    expect(session.undo()).toBe(true)
    expect(candidates).toHaveBeenCalledTimes(1)
    expect(bridge.getState().trigger).toBeNull()

    // 重新 focus：光标处文本已撤销、无合法触发，保持关闭且不请求。
    session.editor.view.dom.focus()
    expect(candidates).toHaveBeenCalledTimes(1)
    expect(bridge.getState().trigger).toBeNull()
  })

  it("初始 focus 尊重编辑器既有聚焦状态：桥创建前已聚焦则立即可识别", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const { session, installer, viewDom } = assemble([paragraph(ids[0], "")], { candidates })
    // 先 focus，再建桥：初始 recompute 即按当前光标识别（无额外 transaction）。
    setCursor(session, 1)
    typeText(session, "@ad")
    viewDom.focus()
    const bridge = createHostReferenceInteractions(session.editor, installer)
    cleanups.push(() => bridge.destroy())

    expect(candidates).toHaveBeenCalledTimes(1)
    expect(bridge.getState().trigger).toMatchObject({ kind: "mention", query: "ad" })
  })
})
