// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { TextSelection } from "@tiptap/pm/state"
import { undoDepth, redoDepth } from "@tiptap/pm/history"
import { encodeHnn } from "../lib/hnn/codec"
import { cardId, initialDocument } from "./fixtures"
import { PrototypeSession } from "./session"
import type { FreezeResult } from "./types"

const sessions: PrototypeSession[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  document.body.replaceChildren()
})
function make(undoPolicy: "shared" | "view-local-baseline" = "shared") {
  const onSave = vi.fn(async () => {})
  const onChange = vi.fn()
  const session = new PrototypeSession({
    documentId: "round2",
    loadKey: 1,
    initialDocument: initialDocument(),
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onSave,
    onChange,
    undoPolicy
  })
  sessions.push(session)
  for (const id of ["a", "b"])
    session.attachView(
      id,
      document.body.appendChild(document.createElement("div"))
    )
  const view = (id = "a") => session.views.get(id)!.view
  const text = () => {
    expect(view().state.doc.eq(view("b").state.doc)).toBe(true)
    return view().state.doc.textContent
  }
  const insert = (id: string, value: string, position = 1) =>
    session.dispatch(id, view(id).state.tr.insertText(value, position))
  const acquire = (requestId: string) =>
    session.controller.setInputFrozen(true, {
      expectedSessionId: session.identity.sessionId,
      requestId
    })
  const release = (
    lease: FreezeResult,
    requestId = lease.requestId,
    sessionId = session.identity.sessionId
  ) => {
    if (!("leaseId" in lease)) throw new Error("Expected owned lease")
    return session.controller.setInputFrozen(false, {
      expectedSessionId: sessionId,
      requestId,
      leaseId: lease.leaseId
    })
  }
  return { session, view, text, insert, acquire, release, onSave, onChange }
}

describe("第二轮：共享撤销栈候选（不是局部撤销契约）", () => {
  it("历史 bookmark 来自编辑视图原选区；undo 发起视图采用该选区，peer 保留映射选区", () => {
    const { session, view } = make()
    session.dispatch(
      "a",
      view().state.tr.setSelection(TextSelection.create(view().state.doc, 2))
    )
    session.dispatch(
      "b",
      view("b").state.tr.setSelection(
        TextSelection.create(view("b").state.doc, 4)
      )
    )
    session.dispatch("a", view().state.tr.insertText("A"))
    expect(view("b").state.selection.from).toBe(5)
    session.undo("b")
    expect(view("b").state.selection.from).toBe(2)
    expect(view().state.selection.from).toBe(2)
  })

  it("结构 split 的追加 nodeId 修复只提交一次，双方同树且全局 undo 顺序保持", () => {
    const { session, view, onChange } = make()
    const original = encodeHnn(view().state.doc)
    session.dispatch("a", view().state.tr.split(3))
    const split = encodeHnn(view().state.doc)
    expect(split.data).not.toEqual(original.data)
    expect(view().state.doc.eq(view("b").state.doc)).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    session.dispatch("b", view("b").state.tr.insertText("B", 5))
    session.undo("a")
    expect(encodeHnn(view().state.doc)).toEqual(split)
    session.undo("b")
    expect(encodeHnn(view().state.doc)).toEqual(original)
  })

  it("重叠编辑只按全局逆序撤销；任一 pane 发命令结果相同", () => {
    const { session, insert, text, view, onChange } = make()
    const originalA = view(),
      originalB = view("b")
    insert("a", "AA")
    insert("b", "B", 2)
    expect(text()).toBe("ABA共享正文")
    expect(session.undo("a")).toBe(true)
    expect(text()).toBe("AA共享正文")
    session.undo("b")
    expect(text()).toBe("共享正文")
    session.redo("b")
    expect(text()).toBe("AA共享正文")
    session.redo("a")
    expect(text()).toBe("ABA共享正文")
    expect(onChange).toHaveBeenCalledTimes(6)
    expect(view()).toBe(originalA)
    expect(view("b")).toBe(originalB)
  })

  it("同视图连续输入成组，换视图即分组；新编辑清空双方 redo", () => {
    const { session, insert, text, view } = make()
    insert("a", "A")
    insert("a", "A", 2)
    expect(undoDepth(view().state)).toBe(1)
    insert("b", "B", 2)
    expect(undoDepth(view().state)).toBe(2)
    session.undo("a")
    expect(text()).toBe("AA共享正文")
    expect(redoDepth(view("b").state)).toBe(1)
    insert("b", "C", 2)
    expect(text()).toBe("ACA共享正文")
    expect(session.redo("a")).toBe(false)
    expect(redoDepth(view().state)).toBe(0)
    expect(redoDepth(view("b").state)).toBe(0)
  })

  it("选择、stored marks 相互独立，peer 选择映射但不增加 history", () => {
    const { session, insert, view } = make()
    session.dispatch(
      "b",
      view("b").state.tr.setSelection(
        TextSelection.create(view("b").state.doc, 3)
      )
    )
    const strong = view().state.schema.marks["bold"]!
    session.dispatch("b", view("b").state.tr.setStoredMarks([strong.create()]))
    insert("a", "AA")
    expect(view("b").state.selection.from).toBe(5)
    expect(view().state.selection.from).not.toBe(5)
    expect(view("b").state.storedMarks?.[0]?.type).toBe(strong)
    expect(view().state.storedMarks).toBeNull()
    expect(undoDepth(view("b").state)).toBe(1)
  })

  it("跨 pane 替换/mark 的全局 undo 恢复精确正规化内容", () => {
    const { session, view, insert } = make()
    const original = encodeHnn(view().state.doc)
    insert("a", "AA")
    session.dispatch("b", view("b").state.tr.insertText("B", 1, 3))
    session.dispatch(
      "a",
      view().state.tr.addMark(1, 2, view().state.schema.marks["bold"]!.create())
    )
    session.undo("b")
    expect(view().state.doc.nodeAt(1)?.marks).toHaveLength(0)
    session.undo("a")
    expect(view().state.doc.textContent).toBe("AA共享正文")
    session.undo("b")
    expect(encodeHnn(view().state.doc)).toEqual(original)
  })

  it("card 完成与节点删除进入同一 history，取消草稿零历史事件", () => {
    const { session, view, onChange } = make()
    session.beginDraft("a", cardId)
    const data = JSON.parse(session.getDraftData())
    data.cards[0].title = "round2 card"
    session.changeDraft(JSON.stringify(data))
    expect(session.completeDraft()).toBe(true)
    const afterCard = encodeHnn(view().state.doc)
    let position = 0,
      size = 0
    view().state.doc.descendants((node, pos) => {
      if (node.attrs["nodeId"] === cardId) {
        position = pos
        size = node.nodeSize
      }
    })
    session.dispatch("b", view("b").state.tr.delete(position, position + size))
    session.undo("a")
    expect(encodeHnn(view().state.doc)).toEqual(afterCard)
    session.undo("b")
    expect(JSON.stringify(encodeHnn(view().state.doc))).not.toContain(
      "round2 card"
    )
    const count = onChange.mock.calls.length
    const depth = undoDepth(view().state)
    session.beginDraft("b", cardId)
    expect(session.undo("a")).toBe(false)
    session.cancelDraft()
    expect(undoDepth(view().state)).toBe(depth)
    expect(onChange).toHaveBeenCalledTimes(count)
  })

  it("pane 重建保留共享栈；所有 pane detach 后再挂载仍可 undo", () => {
    const { session, view, insert, text } = make()
    insert("a", "A")
    const originalA = view()
    session.detachView("b")
    session.attachView(
      "b",
      document.body.appendChild(document.createElement("div"))
    )
    expect(view()).toBe(originalA)
    expect(undoDepth(view("b").state)).toBe(1)
    session.detachView("a")
    session.detachView("b")
    for (const id of ["a", "b"])
      session.attachView(
        id,
        document.body.appendChild(document.createElement("div"))
      )
    session.undo("b")
    expect(text()).toBe("共享正文")
  })

  it("冻结不清空共享历史；存储包含相同正文快照且 metadata 不进入正文撤销", async () => {
    const { session, insert, text, acquire, release, onSave } = make()
    insert("a", "A")
    const id = session.identity.sessionId
    session.controller.updateHostSnapshot(
      { changeId: 1, value: { title: "host", summary: "" } },
      { expectedSessionId: id }
    )
    const lease = await acquire("close")
    expect(session.undo("b")).toBe(false)
    expect(text()).toBe("A共享正文")
    const result = session.controller.requestSave({
      reason: "host-close",
      expectedSessionId: id
    })
    expect(result.kind).toBe("pending")
    if (result.kind === "pending")
      expect((await result.completion).kind).toBe("saved")
    expect(onSave).toHaveBeenCalledTimes(1)
    await release(lease)
    session.undo("b")
    expect(text()).toBe("共享正文")
    expect(session.getState().dirty).toEqual({ body: true, host: false })
  })
})

describe("第二轮：按请求归属的 freeze lease", () => {
  it.each(["shared", "view-local-baseline"] as const)(
    "%s 同请求并发获取幂等、不同请求独立，错误所有者不能释放",
    async (mode) => {
      const { session, acquire, release } = make(mode)
      const [first, duplicate, second] = await Promise.all([
        acquire("A"),
        acquire("A"),
        acquire("B")
      ])
      expect(first).toMatchObject({ kind: "applied", action: "acquired" })
      expect(duplicate).toMatchObject({ kind: "noop", reason: "already-owned" })
      if (
        !("leaseId" in first) ||
        !("leaseId" in duplicate) ||
        !("leaseId" in second)
      )
        throw new Error("Missing leases")
      expect(first.leaseId).toBe(duplicate.leaseId)
      expect(first.leaseId).not.toBe(second.leaseId)
      expect(await release(first, "B")).toMatchObject({
        kind: "noop",
        reason: "stale-lease"
      })
      expect(await release(first, "A", "old-session")).toMatchObject({
        reason: "stale"
      })
      expect(await release(first)).toMatchObject({
        kind: "applied",
        action: "released",
        inputFrozen: true
      })
      expect(await release(first)).toMatchObject({
        kind: "noop",
        reason: "stale-lease"
      })
      expect(await acquire("A")).toMatchObject({
        kind: "noop",
        reason: "request-ended"
      })
      expect(session.getState().inputFrozen).toBe(true)
      expect(await release(second)).toMatchObject({ inputFrozen: false })
      expect(session.getState().inputFrozen).toBe(false)
    }
  )

  it("失败不发 lease、不消费 requestId，可用同一 requestId 重试", async () => {
    const { session, acquire, release } = make()
    const pending = session.captureInsertion("a")!
    expect(await acquire("retry")).toMatchObject({
      kind: "failure",
      reason: "pending-edit"
    })
    expect(session.getState().inputFrozen).toBe(false)
    expect(session.resolveInsertion(pending, "late")).toBe(true)
    const lease = await acquire("retry")
    expect(lease).toMatchObject({ kind: "applied", action: "acquired" })
    await release(lease)
  })

  it("排队获取前后 dispose 均 abort，不复活 lease，旧结果不影响新 session", async () => {
    const { session, acquire } = make()
    const pending = acquire("queued")
    session.dispose()
    expect(await pending).toMatchObject({
      kind: "abort",
      reason: "disposed",
      identity: null
    })
    const next = make()
    const lease = await next.acquire("same-request")
    const duringBarrier = next.acquire("during-barrier")
    await Promise.resolve()
    next.session.dispose()
    expect(await duringBarrier).toMatchObject({ kind: "abort", identity: null })
    expect(next.session.getState().inputFrozen).toBe(false)
    expect(await next.release(lease)).toMatchObject({
      kind: "abort",
      reason: "disposed",
      identity: null
    })
    const third = make()
    expect(third.session.getState().inputFrozen).toBe(false)
  })

  it("release 不放行新获取者；结果是线性化时刻状态，不是导航许可证", async () => {
    const { session, acquire, release } = make()
    const lease = await acquire("first")
    const [released, acquired] = await Promise.all([
      release(lease),
      acquire("next")
    ])
    expect(released).toMatchObject({ action: "released", inputFrozen: false })
    expect(acquired).toMatchObject({ action: "acquired", inputFrozen: true })
    expect(session.getState().inputFrozen).toBe(true)
    await release(acquired)
  })

  it("请求参数在入队时捕获；活动 lease 即使文档 clean 也阻止替换 Provider 会话", async () => {
    const { session, acquire, release } = make()
    const options = {
      expectedSessionId: session.identity.sessionId,
      requestId: "captured"
    }
    const promise = session.controller.setInputFrozen(true, options)
    options.expectedSessionId = "old"
    options.requestId = "changed"
    const lease = await promise
    expect(lease).toMatchObject({ kind: "applied", requestId: "captured" })
    expect(session.canReplace()).toBe(false)
    expect((await acquire("other")).kind).toBe("applied")
    await release(lease)
    expect(session.canReplace()).toBe(false)
    const other = await acquire("other")
    await release(other)
    expect(session.canReplace()).toBe(true)
  })

  it("空/超长 requestId 拒绝，载入失败无 lease", async () => {
    const { acquire } = make()
    for (const id of ["", " ", "x".repeat(129)])
      expect(await acquire(id)).toMatchObject({
        kind: "failure",
        reason: "invalid-request"
      })
    const broken = new PrototypeSession({
      documentId: "invalid",
      loadKey: 1,
      initialDocument: {},
      initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
      onSave: async () => {}
    })
    sessions.push(broken)
    expect(
      await broken.controller.setInputFrozen(true, {
        expectedSessionId: broken.identity.sessionId,
        requestId: "invalid-load"
      })
    ).toMatchObject({ kind: "noop", reason: "not-ready", identity: null })
  })
})
