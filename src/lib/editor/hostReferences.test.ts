// @vitest-environment jsdom
/**
 * 7.2（局部）headless 宿主引用核心验收：候选查询、候选插入、运行时解析、激活与
 * destroy/取消的 signal/token 隔离。不涉及 UI/NodeView 渲染；经内部 createEditorSession
 * 安装 installer 并显式销毁。
 */
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import { afterEach, describe, expect, it, vi } from "vitest"
import { encodeHnn } from "../hnn/codec"
import { installHostReferences, type HostReferenceInstaller, type HostReferenceOptions } from "./hostReferences"
import { createEditorSession } from "./session"
import type { HostCandidateProvider, HostReferenceActivate, HostReferenceResolve, HostReferenceResolution } from "./types"

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
  return { type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] }
}

function textSession(text = "hi") {
  return createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith([paragraph(ids[0], text)]) })
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

function install(session: Session, options: Partial<HostReferenceOptions> = {}): HostReferenceInstaller {
  const installer = installHostReferences(session.editor, { documentId: "doc-1", ...options })
  cleanups.push(() => { installer.destroy(); session.destroy() })
  return installer
}

function mentionNodes(session: Session): Array<{ nodeId: string; resourceId: string; name: string; marks: number }> {
  const found: Array<{ nodeId: string; resourceId: string; name: string; marks: number }> = []
  session.editor.state.doc.descendants((node) => {
    if (node.type.name === "mention" || node.type.name === "resource") {
      found.push({ nodeId: node.attrs["nodeId"] as string, resourceId: node.attrs["resourceId"] as string, name: node.attrs["name"] as string, marks: node.marks.length })
    }
  })
  return found
}

describe("7.2 宿主引用：候选查询", () => {
  it("requestCandidates 以 kind/query/{documentId,signal} 调用宿主并发布状态；无回调受控 empty", async () => {
    const session = textSession()
    const candidates = vi.fn<HostCandidateProvider>(() => [{ resourceId: "u1", name: "Ada" }])
    const installer = install(session, { candidates })

    installer.requestCandidates("mention", "ad")
    expect(installer.getCandidateState()).toMatchObject({ kind: "mention", query: "ad", status: "loading" })
    await flush()

    expect(candidates).toHaveBeenCalledTimes(1)
    const [kind, query, context] = candidates.mock.calls[0]!
    expect(kind).toBe("mention")
    expect(query).toBe("ad")
    expect(context.documentId).toBe("doc-1")
    expect(context.signal).toBeInstanceOf(AbortSignal)
    expect(installer.getCandidateState()).toMatchObject({ status: "ready", items: [{ resourceId: "u1", name: "Ada" }] })

    const noCallback = install(textSession())
    noCallback.requestCandidates("resource", "x")
    expect(noCallback.getCandidateState()).toMatchObject({ kind: "resource", query: "x", status: "empty", items: [] })
  })

  it("候选空与宿主失败分别映射 empty/error，且不影响文档", async () => {
    const session = textSession()
    const candidates = vi.fn<HostCandidateProvider>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("boom"))
    const installer = install(session, { candidates })
    const before = session.editor.state.doc

    installer.requestCandidates("mention", "a")
    await flush()
    expect(installer.getCandidateState().status).toBe("empty")

    installer.requestCandidates("mention", "b")
    await flush()
    expect(installer.getCandidateState().status).toBe("error")
    expect(session.editor.state.doc.eq(before)).toBe(true)
  })

  it("快速改 query：旧请求被 abort，旧结果不覆盖新状态", async () => {
    const session = textSession()
    const first = deferred<readonly { resourceId: string; name: string }[]>()
    const second = deferred<readonly { resourceId: string; name: string }[]>()
    const candidates = vi.fn<HostCandidateProvider>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const installer = install(session, { candidates })

    installer.requestCandidates("mention", "a")
    const firstSignal = candidates.mock.calls[0]![2].signal
    installer.requestCandidates("mention", "b")
    expect(firstSignal.aborted).toBe(true)

    // 旧查询迟到：不得覆盖 b 的状态。
    first.resolve([{ resourceId: "old", name: "Old" }])
    await flush()
    expect(installer.getCandidateState()).toMatchObject({ query: "b", status: "loading" })

    second.resolve([{ resourceId: "new", name: "New" }])
    await flush()
    expect(installer.getCandidateState()).toMatchObject({ query: "b", status: "ready", items: [{ resourceId: "new", name: "New" }] })
  })

  it("cancelCandidates abort 并回到 idle", () => {
    const session = textSession()
    const pending = deferred<readonly { resourceId: string; name: string }[]>()
    const candidates = vi.fn<HostCandidateProvider>(() => pending.promise)
    const installer = install(session, { candidates })

    installer.requestCandidates("resource", "q")
    const signal = candidates.mock.calls[0]![2].signal
    installer.cancelCandidates()
    expect(signal.aborted).toBe(true)
    expect(installer.getCandidateState()).toMatchObject({ kind: null, query: "", status: "idle", items: [] })
  })
})

describe("7.2 宿主引用：选择候选插入", () => {
  it("在当前 TextSelection 插入合法 inline ref，仅持久 resourceId/name，单步 undo", () => {
    const session = textSession("hi")
    const installer = install(session, {})
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))

    expect(installer.selectCandidate("mention", { resourceId: "u1", name: "Ada" })).toBe(true)
    const mentions = mentionNodes(session)
    expect(mentions).toHaveLength(1)
    expect(mentions[0]).toMatchObject({ resourceId: "u1", name: "Ada", marks: 0 })
    expect(mentions[0]?.nodeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    // 仅持久 nodeId/resourceId/name，绝无解析内容字段。
    const node = session.editor.state.doc.firstChild?.child(1)
    expect(node?.type.name).toBe("mention")
    expect(Object.keys(node?.attrs ?? {}).sort()).toEqual(["name", "nodeId", "resourceId"])
    expect(session.editor.getText()).toBe("h@Adai")
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()

    // 单步 undo 移除引用并恢复文本。
    expect(session.undo()).toBe(true)
    expect(mentionNodes(session)).toHaveLength(0)
    expect(session.editor.getText()).toBe("hi")
  })

  it("给定范围内以引用替换文本；非法范围返回 false 且文档不变", () => {
    const session = textSession("hi")
    const installer = install(session, {})
    expect(installer.selectCandidate("resource", { resourceId: "r1", name: "Res" }, { from: 1, to: 3 })).toBe(true)
    expect(mentionNodes(session)[0]).toMatchObject({ resourceId: "r1", name: "Res" })

    const before = session.editor.state.doc
    expect(installer.selectCandidate("resource", { resourceId: "r2", name: "R2" }, { from: 5, to: 2 })).toBe(false)
    expect(installer.selectCandidate("resource", { resourceId: "r2", name: "R2" }, { from: 0, to: 999 })).toBe(false)
    expect(session.editor.state.doc.eq(before)).toBe(true)
  })

  it("预算/kind/资源标识非法一律拒绝且不改变文档", () => {
    const session = textSession("hi")
    const installer = install(session, {})
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const before = session.editor.state.doc

    expect(installer.selectCandidate("mention", { resourceId: "u1", name: "x".repeat(600) })).toBe(false)
    expect(installer.selectCandidate("mention", { resourceId: "", name: "Ada" })).toBe(false)
    expect(installer.selectCandidate("mention", { resourceId: "u1", name: "" })).toBe(false)
    expect(installer.selectCandidate("externalItem" as never, { resourceId: "u1", name: "Ada" })).toBe(false)
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(session.undo()).toBe(false)
  })

  it("整文档预算前置验证：接近节点上限时拒绝且不 dispatch", () => {
    const nodeIdAt = (index: number) => `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`
    const content: unknown[] = []
    for (let index = 0; index < 250; index += 1) {
      const children: unknown[] = [{ type: "text", text: `p${index}` }]
      if (index < 11) children.push({ type: "hardBreak", attrs: { nodeId: nodeIdAt(1000 + index) } })
      content.push({ type: "paragraph", attrs: { nodeId: nodeIdAt(index) }, content: children })
    }
    const session = createEditorSession({ documentId: "A", loadKey: 7, initialDocument: documentWith(content) })
    const installer = install(session, { resolve: () => null })
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    const before = session.editor.state.doc

    expect(installer.selectCandidate("mention", { resourceId: "u1", name: "Ada" })).toBe(false)
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(mentionNodes(session)).toHaveLength(0)
  })
})

function refSession(): Session {
  return createEditorSession({
    documentId: "A",
    loadKey: 2,
    initialDocument: documentWith([
      {
        type: "paragraph",
        attrs: { nodeId: ids[0] },
        content: [
          { type: "text", text: "a" },
          { type: "mention", attrs: { nodeId: ids[1], resourceId: "u1", name: "Ada" } },
          { type: "mention", attrs: { nodeId: ids[2], resourceId: "u1", name: "Ada" } },
          { type: "resource", attrs: { nodeId: ids[3], resourceId: "r1", name: "Res" } }
        ]
      },
      { type: "externalItem", attrs: { nodeId: ids[4], resourceId: "x1", name: "Ext" } }
    ])
  })
}

describe("7.2 宿主引用：运行时解析状态", () => {
  it("按 kind+id 去重解析，成功/空/失败映射 resolved/missing/error，文档不变", async () => {
    const session = refSession()
    const resolve = vi.fn<HostReferenceResolve>((reference) => {
      if (reference.kind === "mention") return { label: "Ada", description: "person" }
      if (reference.kind === "resource") return null
      return Promise.reject(new Error("boom"))
    })
    const installer = install(session, { resolve })
    const before = session.editor.state.doc
    await flush()

    // mention u1 在文档中出现两次，但同一 kind+id 只解析一次。
    expect(resolve.mock.calls.filter(([reference]) => reference.kind === "mention")).toHaveLength(1)
    const entries = installer.getReferenceState().entries
    expect(entries).toHaveLength(3)
    const byKey = Object.fromEntries(entries.map((entry) => [`${entry.kind}:${entry.resourceId}`, entry]))
    expect(byKey["mention:u1"]).toMatchObject({ status: "resolved", label: "Ada", description: "person" })
    expect(byKey["resource:r1"]).toMatchObject({ status: "missing" })
    expect(byKey["externalItem:x1"]).toMatchObject({ status: "error" })

    // 每个调用都收到 { documentId, signal }，且解析不写入文档。
    const context = resolve.mock.calls[0]![1]
    expect(context.documentId).toBe("doc-1")
    expect(context.signal).toBeInstanceOf(AbortSignal)
    expect(session.editor.state.doc.eq(before)).toBe(true)
  })

  it("无 resolve 回调时受控 missing，不破坏文档", async () => {
    const session = refSession()
    const installer = install(session, {})
    const before = session.editor.state.doc
    await flush()
    expect(installer.getReferenceState().entries).toHaveLength(3)
    expect(installer.getReferenceState().entries.every((entry) => entry.status === "missing")).toBe(true)
    expect(session.editor.state.doc.eq(before)).toBe(true)
  })

  it("解析结果缺少有效 label 视为 error（受控占位）", async () => {
    const session = refSession()
    const resolve = vi.fn<HostReferenceResolve>(() => ({ label: 42 } as unknown as HostReferenceResolution))
    const installer = install(session, { resolve })
    await flush()
    expect(installer.getReferenceState().entries.every((entry) => entry.status === "error")).toBe(true)
  })

  it("文档新增引用触发解析；删除引用 abort 请求并清理状态", async () => {
    const session = textSession("hi")
    const resolve = vi.fn<HostReferenceResolve>(() => new Promise<never>(() => {}))
    const installer = install(session, { resolve })
    expect(installer.getReferenceState().entries).toHaveLength(0)

    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
    expect(installer.selectCandidate("mention", { resourceId: "u9", name: "New" })).toBe(true)
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
    const signal = resolve.mock.calls[0]![1].signal
    expect(installer.getReferenceState().entries).toHaveLength(1)

    // 插入后 mention 位于位置 2..3。
    session.editor.view.dispatch(session.editor.state.tr.delete(2, 3))
    await flush()
    expect(signal.aborted).toBe(true)
    expect(installer.getReferenceState().entries).toHaveLength(0)
  })
})

describe("7.2 宿主引用：激活与 destroy", () => {
  it("hnmagic 激活只透传安全 href，沿用会话 AbortSignal，不接受普通 URL", () => {
    const session = textSession()
    const activate = vi.fn<HostReferenceActivate>(() => new Promise<void>(() => undefined))
    const installer = install(session, { activate })
    installer.activate({ kind: "hnmagic", href: "https://example.test/" })
    installer.activate({ kind: "hnmagic", href: "hnmagic://note/\u200b42" })
    expect(activate).not.toHaveBeenCalled()
    installer.activate({ kind: "hnmagic", href: "hnmagic://note/42" })
    expect(activate.mock.calls[0]?.[0]).toEqual({ kind: "hnmagic", href: "hnmagic://note/42" })
    const signal = activate.mock.calls[0]![1].signal
    expect(signal.aborted).toBe(false)
    installer.destroy()
    expect(signal.aborted).toBe(true)
  })

  it("activate 调用宿主一次且不修改文档；无回调为 no-op", async () => {
    const session = textSession("hi")
    const activate = vi.fn<HostReferenceActivate>()
    const installer = install(session, { activate })
    const before = session.editor.state.doc

    installer.activate({ kind: "mention", resourceId: "u1", name: "Ada" })
    await flush()

    expect(activate).toHaveBeenCalledTimes(1)
    const [reference, context] = activate.mock.calls[0]!
    expect(reference).toEqual({ kind: "mention", resourceId: "u1", name: "Ada" })
    expect(context.documentId).toBe("doc-1")
    expect(context.signal).toBeInstanceOf(AbortSignal)
    expect(session.editor.state.doc.eq(before)).toBe(true)

    const noCallback = install(textSession())
    expect(() => noCallback.activate({ kind: "mention", resourceId: "u1", name: "Ada" })).not.toThrow()
  })

  it("destroy abort 在途解析；宿主忽略 abort 的迟到结果被丢弃", async () => {
    const session = refSession()
    const pending = deferred<{ label: string } | null>()
    const resolve = vi.fn<HostReferenceResolve>(() => pending.promise)
    const installer = install(session, { resolve })
    await flush()

    const signal = resolve.mock.calls[0]![1].signal
    const before = session.editor.state.doc
    installer.destroy()
    expect(signal.aborted).toBe(true)

    pending.resolve({ label: "late" })
    await flush()
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(installer.getReferenceState().entries).toHaveLength(0)
  })

  it("destroy abort 在途候选与激活；迟到结果不更新状态", async () => {
    const session = textSession()
    const candidatePending = deferred<readonly { resourceId: string; name: string }[]>()
    const activatePending = deferred<void>()
    const candidates = vi.fn<HostCandidateProvider>(() => candidatePending.promise)
    const activate = vi.fn<HostReferenceActivate>(() => activatePending.promise)
    const installer = install(session, { candidates, activate })

    installer.requestCandidates("mention", "a")
    installer.activate({ kind: "mention", resourceId: "u1", name: "Ada" })
    const candidateSignal = candidates.mock.calls[0]![2].signal
    const activateSignal = activate.mock.calls[0]![1].signal

    installer.destroy()
    expect(candidateSignal.aborted).toBe(true)
    expect(activateSignal.aborted).toBe(true)

    candidatePending.resolve([{ resourceId: "late", name: "Late" }])
    activatePending.resolve()
    await flush()
    expect(installer.getCandidateState().status).toBe("loading")
  })
})

describe("7.2 宿主引用：边界质量修复", () => {
  it("候选插入只有一个 doc transaction，且 undo 隔离前序编辑与紧随输入", () => {
    const session = textSession("hi")
    const installer = install(session, {})
    const append = (text: string) => {
      const position = session.editor.state.doc.content.size - 1
      session.editor.view.dispatch(session.editor.state.tr.insertText(text, position))
    }

    append(" pre")
    session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))

    let changed = 0
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged) changed += 1 }
    session.editor.on("transaction", onTransaction)
    expect(installer.selectCandidate("mention", { resourceId: "u9", name: "New" })).toBe(true)
    session.editor.off("transaction", onTransaction)
    expect(changed).toBe(1)
    const afterInsert = session.editor.getText()

    append(" post")
    // undo1 撤紧随输入
    expect(session.undo()).toBe(true)
    expect(session.editor.getText()).toBe(afterInsert)
    // undo2 撤候选插入
    expect(session.undo()).toBe(true)
    expect(mentionNodes(session)).toHaveLength(0)
    // undo3 撤前序编辑
    expect(session.undo()).toBe(true)
    expect(session.editor.getText()).toBe("hi")
  })

  it("loading 通知期间 subscriber 取消/销毁/换 query，不会向过期 provider 发请求", () => {
    // cancel：loading 时同步取消，provider 不应被调用。
    const cancelSession = textSession()
    const cancelCandidates = vi.fn<HostCandidateProvider>(() => [])
    const cancelInstaller = install(cancelSession, { candidates: cancelCandidates })
    const unsubscribeCancel = cancelInstaller.subscribeCandidates((state) => { if (state.status === "loading") cancelInstaller.cancelCandidates() })
    cancelInstaller.requestCandidates("mention", "a")
    expect(cancelCandidates).not.toHaveBeenCalled()
    expect(cancelInstaller.getCandidateState().status).toBe("idle")
    unsubscribeCancel()

    // destroy：loading 时同步销毁，provider 不应被调用。
    const destroySession = textSession()
    const destroyCandidates = vi.fn<HostCandidateProvider>(() => [])
    const destroyInstaller = install(destroySession, { candidates: destroyCandidates })
    const unsubscribeDestroy = destroyInstaller.subscribeCandidates((state) => { if (state.status === "loading") destroyInstaller.destroy() })
    destroyInstaller.requestCandidates("mention", "b")
    expect(destroyCandidates).not.toHaveBeenCalled()
    unsubscribeDestroy()

    // 换 query：A loading 时 subscriber 发起 B；A 的 provider 不得调用，B 调用一次。
    const swapSession = textSession()
    const swapCandidates = vi.fn<HostCandidateProvider>(() => [])
    const swapInstaller = install(swapSession, { candidates: swapCandidates })
    let triggered = false
    const unsubscribeSwap = swapInstaller.subscribeCandidates((state) => {
      if (state.status === "loading" && state.query === "a" && !triggered) {
        triggered = true
        swapInstaller.requestCandidates("mention", "b")
      }
    })
    swapInstaller.requestCandidates("mention", "a")
    expect(swapCandidates).toHaveBeenCalledTimes(1)
    expect(swapCandidates.mock.calls[0]![1]).toBe("b")
    unsubscribeSwap()
  })

  it("非 TextSelection 且无 range 受控 false；顶层/跨块 range 拒绝且 doc/history 不变；合法文本 range 可用", () => {
    // NodeSelection：选中 block picture，无 range → false。
    const nodeSession = createEditorSession({
      documentId: "A", loadKey: 11,
      initialDocument: documentWith([
        { type: "picture", attrs: { nodeId: ids[0], src: "https://cdn.test/a.png", alt: "A" } },
        paragraph(ids[1], "text")
      ])
    })
    const nodeInstaller = install(nodeSession, {})
    nodeSession.editor.view.dispatch(nodeSession.editor.state.tr.setSelection(NodeSelection.create(nodeSession.editor.state.doc, 0)))
    const beforeNode = nodeSession.editor.state.doc
    expect(nodeInstaller.selectCandidate("mention", { resourceId: "u1", name: "Ada" })).toBe(false)
    expect(nodeSession.editor.state.doc.eq(beforeNode)).toBe(true)
    expect(nodeSession.undo()).toBe(false)

    // CellSelection：无 range → false，文档/历史不变。
    const cellSession = createEditorSession({
      documentId: "A", loadKey: 12,
      initialDocument: documentWith([{
        type: "table", attrs: { nodeId: ids[0] }, content: [
          { type: "tableRow", attrs: { nodeId: ids[1] }, content: [
            { type: "tableCell", attrs: { nodeId: ids[2], colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [paragraph(ids[3], "a")] },
            { type: "tableCell", attrs: { nodeId: ids[4], colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [paragraph(ids[5], "b")] }
          ] }
        ]
      }])
    })
    const cellInstaller = install(cellSession, {})
    const cellPositions: number[] = []
    cellSession.editor.state.doc.descendants((node, pos) => { if (node.type.name === "tableCell") cellPositions.push(pos) })
    const [firstCell, secondCell] = cellPositions
    if (firstCell === undefined || secondCell === undefined) throw new Error("expected two table cells")
    cellSession.editor.view.dispatch(cellSession.editor.state.tr.setSelection(CellSelection.create(cellSession.editor.state.doc, firstCell, secondCell)))
    const beforeCell = cellSession.editor.state.doc
    expect(cellInstaller.selectCandidate("resource", { resourceId: "r1", name: "R" })).toBe(false)
    expect(cellSession.editor.state.doc.eq(beforeCell)).toBe(true)

    // 顶层/跨块 range 拒绝；合法段落内文本 range 可用。
    const rangeSession = createEditorSession({ documentId: "A", loadKey: 13, initialDocument: documentWith([paragraph(ids[0], "one"), paragraph(ids[1], "two")]) })
    const rangeInstaller = install(rangeSession, {})
    const beforeRange = rangeSession.editor.state.doc
    expect(rangeInstaller.selectCandidate("mention", { resourceId: "u1", name: "Ada" }, { from: 0, to: 0 })).toBe(false)
    expect(rangeInstaller.selectCandidate("mention", { resourceId: "u1", name: "Ada" }, { from: 2, to: 6 })).toBe(false)
    expect(rangeSession.editor.state.doc.eq(beforeRange)).toBe(true)

    expect(rangeInstaller.selectCandidate("resource", { resourceId: "r1", name: "R" }, { from: 1, to: 3 })).toBe(true)
    expect(mentionNodes(rangeSession)[0]).toMatchObject({ resourceId: "r1", name: "R" })
  })
})
