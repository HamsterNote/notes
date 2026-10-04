// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { TextSelection } from "@tiptap/pm/state"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { encodeHnn, type HnnDocument } from "../hnn/codec"
import { NoteEditor } from "./NoteEditor"
import { EditorSession } from "./session"
import type { EditorSessionOptions, HostCandidateProvider, HostReferenceActivate, HostReferenceResolve } from "./types"

/**
 * 7.2 宿主引用最终接线的集成测试：全部经由内部 NoteEditor 真实渲染（真实
 * EditorSession，仅包装记录创建序列），断言公开 props 三回调（onReferenceCandidates/
 * onReferenceActivate/onReferenceResolve）经会话 configure 驱动 HostReferenceUI 桥的
 * 候选/激活/解析语义、hasActivate 真实能力位、切换中止与同 key/invalid key 隔离。
 * 桥本身的键盘/composition/旧 range 细节由 des-2 的 hostReferenceInteractions 与
 * HostReferenceUI 测试覆盖，本文件只验证接线层契约。
 */
const createdSessions = vi.hoisted(() => [] as EditorSession[])

vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>()
  return {
    ...actual,
    createEditorSession(options: EditorSessionOptions) {
      const session = actual.createEditorSession(options)
      createdSessions.push(session)
      return session
    }
  }
})

// 候选菜单 portal 到 document.body；显式清理避免跨用例残留。
afterEach(() => cleanup())
beforeEach(() => createdSessions.splice(0))

const ids = {
  p1: "123e4567-e89b-42d3-a456-426614174000",
  p2: "123e4567-e89b-42d3-a456-426614174001",
  m1: "123e4567-e89b-42d3-a456-426614174002",
  r1: "123e4567-e89b-42d3-a456-426614174003",
  e1: "123e4567-e89b-42d3-a456-426614174004",
  m2: "123e4567-e89b-42d3-a456-426614174005"
}

function textDocument(text: string): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: ids.p1 }, content: [{ type: "text", text }] }]
    }
  }
}

/** 含三类宿主引用的初始文档：mention u1 / resource r1 / externalItem e1。 */
function referenceDocument(mentionResourceId = "u1"): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: ids.p1 },
          content: [
            { type: "text", text: "见 " },
            { type: "mention", attrs: { nodeId: ids.m1, resourceId: mentionResourceId, name: "Ada" } },
            { type: "text", text: " 与 " },
            { type: "resource", attrs: { nodeId: ids.r1, resourceId: "r1", name: "周报" } },
            { type: "text", text: "。" }
          ]
        },
        { type: "externalItem", attrs: { nodeId: ids.e1, resourceId: "e1", name: "外部条目" } }
      ]
    }
  }
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function latestSession(): EditorSession {
  const session = createdSessions.at(-1)
  if (!session) throw new Error("会话未创建")
  return session
}

function viewDom(container: HTMLElement): HTMLElement {
  const dom = container.querySelector(".hn-editor-content")
  if (!(dom instanceof HTMLElement)) throw new Error("编辑器 dom 未渲染")
  return dom
}

function mentionAttrs(session: EditorSession): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  session.editor.state.doc.descendants((node) => {
    if (node.type.name === "mention") found.push({ ...node.attrs })
  })
  return found
}

/** 放置光标到文末并输入文本（act 包裹，驱动桥 → React 同步订阅）。 */
async function typeAtEnd(session: EditorSession, text: string): Promise<void> {
  await act(async () => {
    session.editor.view.dispatch(
      session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, session.editor.state.doc.content.size - 1))
    )
    session.editor.commands.insertContent(text)
    await flush()
  })
}

function pill(container: HTMLElement, kind: string): HTMLElement {
  const dom = container.querySelector(`[data-hnn-node="${kind}"]`)
  if (!(dom instanceof HTMLElement)) throw new Error(`${kind} 引用 dom 未渲染`)
  return dom
}

describe("7.2 宿主引用接线：候选录入与插入", () => {
  it("@query 触发候选并以单事务精确替换触发串：仅持久最小信息、新 nodeId、解析不进 HNN、单步 undo", async () => {
    const candidates = vi.fn<HostCandidateProvider>((kind) =>
      kind === "mention" ? [{ resourceId: "u9", name: "Ada" }] : []
    )
    const resolve = vi.fn<HostReferenceResolve>(() => ({ label: "解析标签" }))
    const view = render(
      <NoteEditor
        documentId="doc-a"
        loadKey="v1"
        initialDocument={textDocument("见 ")}
        onReferenceCandidates={candidates}
        onReferenceResolve={resolve}
      />
    )
    try {
      const session = latestSession()
      viewDom(view.container).focus()
      await typeAtEnd(session, "@ad")

      // 候选请求契约：kind/query 与 {documentId 来自已接受候选, signal}。
      expect(candidates).toHaveBeenCalledWith("mention", "ad", expect.objectContaining({ documentId: "doc-a" }))
      expect((candidates.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }])[2].signal).toBeInstanceOf(AbortSignal)
      const listbox = await screen.findByRole("listbox")
      expect(listbox.getAttribute("aria-label")).toBe("提及候选")

      fireEvent.click(within(listbox).getByRole("option", { name: /Ada/ }))
      await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())

      // 精确 range 替换：触发串整体消失，只留初始文本 + mention atom（renderText "@Ada"）。
      expect(session.editor.getText()).toBe("见 @Ada")
      const mentions = mentionAttrs(session)
      expect(mentions).toHaveLength(1)
      // 只持久最小信息：attrs 恰好 nodeId/resourceId/name，绝无解析结果字段。
      expect(Object.keys(mentions[0] ?? {}).sort()).toEqual(["name", "nodeId", "resourceId"])
      expect(mentions[0]).toMatchObject({ resourceId: "u9", name: "Ada" })
      expect(mentions[0]?.["nodeId"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
      expect(mentions[0]?.["nodeId"]).not.toBe(ids.m1)

      // 插入后解析照常运行，但解析结果绝不写入 HNN。
      await waitFor(() => expect(resolve).toHaveBeenCalled())
      await act(async () => flush())
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).not.toContain("解析标签")

      // 单步 undo：插入整体回退，触发串文本恢复。
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("见 @ad")
      expect(mentionAttrs(session)).toHaveLength(0)
    } finally {
      view.unmount()
    }
  })

  it("[[query 触发资源候选并插入 resource 引用", async () => {
    const candidates = vi.fn<HostCandidateProvider>((kind) =>
      kind === "resource" ? [{ resourceId: "r9", name: "月报" }] : []
    )
    const view = render(
      <NoteEditor documentId="doc-a" loadKey="v1" initialDocument={textDocument("见 ") } onReferenceCandidates={candidates} />
    )
    try {
      const session = latestSession()
      viewDom(view.container).focus()
      await typeAtEnd(session, "[[月")

      expect(candidates).toHaveBeenCalledWith("resource", "月", expect.objectContaining({ documentId: "doc-a" }))
      const listbox = await screen.findByRole("listbox")
      expect(listbox.getAttribute("aria-label")).toBe("资源候选")
      fireEvent.click(within(listbox).getByRole("option", { name: /月报/ }))
      await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())

      let inserted: Record<string, unknown> | undefined
      session.editor.state.doc.descendants((node) => {
        if (node.type.name === "resource") inserted = { ...node.attrs }
      })
      expect(inserted).toMatchObject({ resourceId: "r9", name: "月报" })
      expect(session.editor.getText()).toBe("见 月报")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("见 [[月")
    } finally {
      view.unmount()
    }
  })
})

describe("7.2 宿主引用接线：运行时解析占位", () => {
  it("初始引用按 resolve 结果呈现 missing/error/resolved 占位；解析结果不进 HNN；无 activate 无 tab stop", async () => {
    const resolve = vi.fn<HostReferenceResolve>(({ resourceId }) => {
      if (resourceId === "u1") return null
      if (resourceId === "r1") return Promise.reject(new Error("解析爆炸"))
      return { label: "外部标签", description: "描述" }
    })
    const view = render(
      <NoteEditor documentId="doc-a" loadKey="v1" initialDocument={referenceDocument()} onReferenceResolve={resolve} />
    )
    try {
      const mentionDom = pill(view.container, "mention")
      const resourceDom = pill(view.container, "resource")
      const externalDom = pill(view.container, "externalItem")

      await waitFor(() => expect(mentionDom.getAttribute("data-hnn-resolve-status")).toBe("missing"))
      await waitFor(() => expect(resourceDom.getAttribute("data-hnn-resolve-status")).toBe("error"))
      await waitFor(() => expect(externalDom.getAttribute("data-hnn-resolve-status")).toBe("resolved"))
      expect(externalDom.getAttribute("title")).toBe("外部标签：描述")

      // 未提供 activate：不补任何 tab stop/链接语义（主代理不接受假链接）。
      for (const dom of [mentionDom, resourceDom, externalDom]) {
        expect(dom.getAttribute("tabindex")).toBeNull()
        expect(dom.getAttribute("role")).toBeNull()
      }
      // 解析结果绝不写入 HNN。
      const json = JSON.stringify(encodeHnn(latestSession().editor.state.doc))
      expect(json).not.toContain("外部标签")
      expect(json).toContain("\"resourceId\":\"u1\"")
    } finally {
      view.unmount()
    }
  })

  it("不提供 resolve：既有引用一律受控 missing 占位，不产生解析请求", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [])
    const view = render(
      <NoteEditor documentId="doc-a" loadKey="v1" initialDocument={referenceDocument()} onReferenceCandidates={candidates} />
    )
    try {
      await waitFor(() => expect(pill(view.container, "mention").getAttribute("data-hnn-resolve-status")).toBe("missing"))
      expect(pill(view.container, "resource").getAttribute("data-hnn-resolve-status")).toBe("missing")
      expect(pill(view.container, "externalItem").getAttribute("data-hnn-resolve-status")).toBe("missing")
    } finally {
      view.unmount()
    }
  })
})

describe("7.2 宿主引用接线：激活与无回调语义", () => {
  it("click/key 三类引用交接宿主：kind/resourceId/name 与 {documentId, signal}；tab stop 真实能力位", async () => {
    const activate = vi.fn<HostReferenceActivate>()
    const view = render(
      <NoteEditor documentId="doc-a" loadKey="v1" initialDocument={referenceDocument()} onReferenceActivate={activate} />
    )
    try {
      const session = latestSession()
      expect(session.hostReferences?.hasActivate).toBe(true)
      const mentionDom = pill(view.container, "mention")
      const resourceDom = pill(view.container, "resource")
      const externalDom = pill(view.container, "externalItem")
      // 有真实 activate：桥运行时补 tabindex/role（运行时 attribute，不进 HNN）。
      await waitFor(() => expect(mentionDom.getAttribute("tabindex")).toBe("0"))
      expect(mentionDom.getAttribute("role")).toBe("link")

      fireEvent.click(mentionDom)
      expect(activate).toHaveBeenCalledTimes(1)
      const [mentionRef, mentionContext] = activate.mock.calls[0] as unknown as [
        { kind: string; resourceId: string; name: string },
        { documentId: string; signal: AbortSignal }
      ]
      expect(mentionRef).toEqual({ kind: "mention", resourceId: "u1", name: "Ada" })
      expect(mentionContext.documentId).toBe("doc-a")
      expect(mentionContext.signal).toBeInstanceOf(AbortSignal)
      expect(mentionContext.signal.aborted).toBe(false)

      fireEvent.keyDown(externalDom, { key: "Enter" })
      expect(activate).toHaveBeenCalledTimes(2)
      expect((activate.mock.calls[1] as unknown as [{ kind: string }])[0].kind).toBe("externalItem")

      fireEvent.keyDown(resourceDom, { key: " " })
      expect(activate).toHaveBeenCalledTimes(3)
      expect((activate.mock.calls[2] as unknown as [{ kind: string }])[0].kind).toBe("resource")

      // 键盘语义 attribute 绝不进入文档。
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).not.toContain("tabindex")
    } finally {
      view.unmount()
    }
  })

  it("三回调全无：无候选入口、无解析占位、无激活语义，文档纯文本行为", async () => {
    const view = render(<NoteEditor documentId="doc-a" loadKey="v1" initialDocument={referenceDocument()} />)
    try {
      const session = latestSession()
      expect(session.hostReferences).toBeUndefined()
      const mentionDom = pill(view.container, "mention")
      expect(mentionDom.getAttribute("tabindex")).toBeNull()
      expect(mentionDom.getAttribute("data-hnn-resolve-status")).toBeNull()

      viewDom(view.container).focus()
      await typeAtEnd(session, "@x")
      expect(screen.queryByRole("listbox")).toBeNull()
      // 点击引用无任何动作也不抛错（没有任何桥监听）。
      expect(() => fireEvent.click(mentionDom)).not.toThrow()
    } finally {
      view.unmount()
    }
  })
})

describe("7.2 宿主引用接线：会话切换与同 key 能力变化", () => {
  it("切换会话：旧解析 abort 且 stale 丢弃，新会话以自身 documentId 独立解析", async () => {
    const pendingA = deferred<{ label: string } | null>()
    const pendingB = deferred<{ label: string } | null>()
    const resolveA = vi.fn<HostReferenceResolve>(() => pendingA.promise)
    const resolveB = vi.fn<HostReferenceResolve>(() => pendingB.promise)
    const propsA = { documentId: "doc-a", loadKey: "v1", initialDocument: referenceDocument("u1") }
    const view = render(<NoteEditor {...propsA} onReferenceResolve={resolveA} />)
    try {
      const sessionA = latestSession()
      // 初始文档含 mention/resource/externalItem 三个引用：各自独立 signal 发起解析。
      await waitFor(() => expect(resolveA).toHaveBeenCalledTimes(3))
      const contextA = (resolveA.mock.calls[0] as unknown as [unknown, { documentId: string; signal: AbortSignal }])[1]
      expect(contextA.documentId).toBe("doc-a")

      view.rerender(
        <NoteEditor documentId="doc-b" loadKey="v2" initialDocument={referenceDocument("u2")} onReferenceResolve={resolveB} />
      )
      await waitFor(() => expect(resolveB).toHaveBeenCalledTimes(3))
      const contextB = (resolveB.mock.calls[0] as unknown as [unknown, { documentId: string; signal: AbortSignal }])[1]
      expect(contextB.documentId).toBe("doc-b")
      expect(createdSessions).toHaveLength(2)
      expect(latestSession()).not.toBe(sessionA)
      // A 的全部在途解析 signal 随会话销毁 abort。
      for (const call of resolveA.mock.calls) {
        expect((call as unknown as [unknown, { signal: AbortSignal }])[1].signal.aborted).toBe(true)
      }

      // A 的迟到结果在库内丢弃：不污染 B 的占位，也不进任何文档。
      pendingA.resolve({ label: "陈旧标签" })
      await act(async () => flush())
      const mentionDom = pill(view.container, "mention")
      expect(mentionDom.getAttribute("data-hnn-resolve-status")).toBe("loading")
      pendingB.resolve({ label: "新标签" })
      await waitFor(() => expect(mentionDom.getAttribute("data-hnn-resolve-status")).toBe("resolved"))
      expect(mentionDom.getAttribute("title")).toBe("新标签")
      expect(JSON.stringify(encodeHnn(latestSession().editor.state.doc))).not.toContain("陈旧标签")
    } finally {
      view.unmount()
    }
  })

  it("同 key 新增 candidates 立即启用：菜单按当前光标即刻可开，会话/文档/历史不重建", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const props = { documentId: "doc-a", loadKey: "v1", initialDocument: textDocument("见 ") }
    const view = render(<NoteEditor {...props} />)
    try {
      const session = latestSession()
      expect(session.hostReferences).toBeUndefined()
      viewDom(view.container).focus()
      await typeAtEnd(session, "@a")
      expect(screen.queryByRole("listbox")).toBeNull()

      view.rerender(<NoteEditor {...props} onReferenceCandidates={candidates} />)
      // 桥随 installer 挂载即按当前光标只读识别既有触发串（focus 保持），菜单直接可用。
      await screen.findByRole("listbox")
      await waitFor(() => expect(candidates).toHaveBeenCalledWith("mention", "a", expect.objectContaining({ documentId: "doc-a" })))
      expect(createdSessions).toHaveLength(1)
      expect(session.editor.getText()).toBe("见 @a")
      // 历史未受影响：一步 undo 仍只回退用户输入。
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("见 ")
    } finally {
      view.unmount()
    }
  })

  it("同 key 新增 candidates（保留 activate）：既有 @ 触发串由受控空菜单转为真实候选", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const activate = () => undefined
    const props = { documentId: "doc-a", loadKey: "v1", initialDocument: textDocument("见 ") }
    const view = render(<NoteEditor {...props} onReferenceActivate={activate} />)
    try {
      const session = latestSession()
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      viewDom(view.container).focus()
      await typeAtEnd(session, "@a")
      // 无 candidates：wrapper 受控 empty，菜单呈“无匹配结果”（该 UX 本轮不改 scope）。
      const emptyListbox = await screen.findByRole("listbox")
      await waitFor(() => expect(within(emptyListbox).getByRole("status").textContent).toBe("无匹配结果"))

      view.rerender(<NoteEditor {...props} onReferenceActivate={activate} onReferenceCandidates={candidates} />)
      // candidates presence 变化 → installer/桥保守重建：按当前光标重新识别既有触发串。
      const rebuilt = session.hostReferences
      expect(rebuilt).toBeDefined()
      expect(rebuilt).not.toBe(installer)
      expect(rebuilt?.hasActivate).toBe(true)
      await waitFor(() =>
        expect(candidates).toHaveBeenCalledWith("mention", "a", expect.objectContaining({ documentId: "doc-a" }))
      )
      await waitFor(() => expect(screen.getByRole("option").textContent).toContain("Ada"))
      expect(createdSessions).toHaveLength(1)
      // 文档与历史不受重建影响。
      expect(session.editor.getText()).toBe("见 @a")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("见 ")
    } finally {
      view.unmount()
    }
  })

  it("同 key fn→fn 更新：installer 不重建、selection 不动，未来请求用新 handler", async () => {
    const candidatesOld = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const candidatesNew = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u2", name: "Ben" }])
    const props = { documentId: "doc-a", loadKey: "v1", initialDocument: textDocument("见 ") }
    const view = render(<NoteEditor {...props} onReferenceCandidates={candidatesOld} />)
    try {
      const session = latestSession()
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      viewDom(view.container).focus()
      await typeAtEnd(session, "@a")
      await screen.findByRole("listbox")
      expect(candidatesOld).toHaveBeenCalledTimes(1)
      const selectionFrom = session.editor.state.selection.from

      view.rerender(<NoteEditor {...props} onReferenceCandidates={candidatesNew} />)
      expect(session.hostReferences).toBe(installer)
      expect(session.editor.state.selection.from).toBe(selectionFrom)

      // 继续输入：新查询走新 handler，菜单项随之更新。
      await typeAtEnd(session, "b")
      await waitFor(() => expect(candidatesNew).toHaveBeenCalledWith("mention", "ab", expect.objectContaining({ documentId: "doc-a" })))
      expect(candidatesOld).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.getByRole("option").textContent).toContain("Ben"))
    } finally {
      view.unmount()
    }
  })

  it("同 key 移除 activate：installer 保守重建，tab 语义消失，候选能力保留", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const props = { documentId: "doc-a", loadKey: "v1", initialDocument: referenceDocument() }
    const view = render(<NoteEditor {...props} onReferenceCandidates={candidates} onReferenceActivate={() => undefined} />)
    try {
      const session = latestSession()
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      const mentionDom = pill(view.container, "mention")
      await waitFor(() => expect(mentionDom.getAttribute("tabindex")).toBe("0"))

      view.rerender(<NoteEditor {...props} onReferenceCandidates={candidates} />)
      const rebuilt = session.hostReferences
      expect(rebuilt).toBeDefined()
      expect(rebuilt).not.toBe(installer)
      expect(rebuilt?.hasActivate).toBe(false)
      // 新桥无激活能力：运行时 tab stop/role 移除，不留假链接。
      await waitFor(() => expect(mentionDom.getAttribute("tabindex")).toBeNull())
      expect(mentionDom.getAttribute("role")).toBeNull()
      // 候选能力保留：菜单仍可打开。
      viewDom(view.container).focus()
      await typeAtEnd(session, " @a")
      await screen.findByRole("listbox")
      expect(createdSessions).toHaveLength(1)
    } finally {
      view.unmount()
    }
  })

  it("同 key 移除全部回调：菜单卸载、在途候选 abort，会话与文档不动", async () => {
    const pending = deferred<readonly { resourceId: string; name: string }[]>()
    const candidates = vi.fn<HostCandidateProvider>(() => pending.promise)
    const props = { documentId: "doc-a", loadKey: "v1", initialDocument: textDocument("见 ") }
    const view = render(<NoteEditor {...props} onReferenceCandidates={candidates} />)
    try {
      const session = latestSession()
      viewDom(view.container).focus()
      await typeAtEnd(session, "@q")
      const listbox = await screen.findByRole("listbox")
      expect(within(listbox).getByRole("status").textContent).toBe("正在搜索…")
      const context = (candidates.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }])[2]

      view.rerender(<NoteEditor {...props} />)
      await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
      expect(session.hostReferences).toBeUndefined()
      expect(context.signal.aborted).toBe(true)
      expect(createdSessions).toHaveLength(1)
      // stale 候选迟到：不再有任何订阅者，文档不受影响。
      pending.resolve([{ resourceId: "stale", name: "Stale" }])
      await act(async () => flush())
      expect(session.editor.getText()).toBe("见 @q")
    } finally {
      view.unmount()
    }
  })

  it("invalid 新 key：旧 callbacks/候选/激活界面与 doc/selection/history 全部保留", async () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const errors: string[] = []
    const view = render(
      <NoteEditor
        documentId="doc-a"
        loadKey="v1"
        initialDocument={referenceDocument()}
        onReferenceCandidates={candidates}
        onReferenceActivate={() => undefined}
      />
    )
    try {
      const session = latestSession()
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      const mentionDom = pill(view.container, "mention")
      await waitFor(() => expect(mentionDom.getAttribute("tabindex")).toBe("0"))
      const docJsonBefore = JSON.stringify(encodeHnn(session.editor.state.doc))
      const selectionFrom = session.editor.state.selection.from

      // invalid 新 key 且不带任何引用回调：未接受候选不能刷新能力。
      view.rerender(
        <NoteEditor
          documentId="doc-b"
          loadKey="v1"
          initialDocument={{ schemaVersion: 1, data: { type: "doc", content: [{ type: "unknown" }] } }}
          onInitialLoadError={(_error, context) => errors.push(context.documentId)}
        />
      )
      expect(errors).toEqual(["doc-b"])
      expect(createdSessions).toHaveLength(1)
      expect(latestSession()).toBe(session)
      expect(session.hostReferences).toBe(installer)
      expect(mentionDom.getAttribute("tabindex")).toBe("0")
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).toBe(docJsonBefore)
      expect(session.editor.state.selection.from).toBe(selectionFrom)

      // 旧候选能力原样可用（旧 callback 未被移除）。
      viewDom(view.container).focus()
      await typeAtEnd(session, " @a")
      await screen.findByRole("listbox")
      expect(candidates).toHaveBeenCalledWith("mention", "a", expect.objectContaining({ documentId: "doc-a" }))
    } finally {
      view.unmount()
    }
  })
})
