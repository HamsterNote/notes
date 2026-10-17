// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { TextSelection } from "@tiptap/pm/state"
import { closeHistory, undoDepth } from "@tiptap/pm/history"
import { fireEvent } from "@testing-library/dom"
import { encodeHnn } from "../lib/hnn/codec"
import { PrototypeSession } from "./session"
import { cardId, drawingId, initialDocument } from "./fixtures"
import type {
  FreezeResult,
  SavePayload,
  SaveRequest,
  SaveTerminal
} from "./types"

const sessions: PrototypeSession[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  vi.useRealTimers()
  document.body.replaceChildren()
})

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function make(
  onSave = vi.fn(async (_payload: SavePayload) => {}),
  overrides: Partial<ConstructorParameters<typeof PrototypeSession>[0]> = {}
) {
  const onChange = vi.fn()
  const session = new PrototypeSession({
    documentId: "A",
    loadKey: 1,
    initialDocument: initialDocument(),
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onSave,
    onChange,
    ...overrides
  })
  sessions.push(session)
  const a = document.body.appendChild(document.createElement("div"))
  const b = document.body.appendChild(document.createElement("div"))
  if (session.getState().lifecycle === "ready") {
    session.attachView("a", a)
    session.attachView("b", b)
  }
  return {
    session,
    onChange,
    onSave,
    id: session.identity.sessionId,
    a: session.views.get("a")?.view,
    b: session.views.get("b")?.view
  }
}
function view(session: PrototypeSession, id = "a") {
  return session.views.get(id)!.view
}
function insert(
  session: PrototypeSession,
  text: string,
  id = "a",
  position = 1
) {
  const target = view(session, id)
  session.dispatch(id, closeHistory(target.state.tr.insertText(text, position)))
}
function save(
  session: PrototypeSession,
  reason: "host-close" | "host-retry" | "autosave" = "host-close"
) {
  return session.controller.requestSave({
    reason,
    expectedSessionId: session.identity.sessionId
  })
}
async function terminal(request: SaveRequest): Promise<SaveTerminal> {
  return request.kind === "pending" ? request.completion : request
}
async function frozen(session: PrototypeSession) {
  const result = await session.controller.setInputFrozen(true, {
    expectedSessionId: session.identity.sessionId,
    requestId: crypto.randomUUID()
  })
  expect(result.kind).toBe("applied")
  return result as Extract<FreezeResult, { kind: "applied" }>
}

describe("隔离原型：共享权威文档与本地 history", () => {
  it("交错编辑只通知一次；选区分别映射；本地 undo/redo 不撤销另一视图", () => {
    const { session, a, b, onChange } = make()
    const originalA = a
    const originalB = b
    session.dispatch(
      "b",
      b!.state.tr.setSelection(TextSelection.create(b!.state.doc, 3))
    )
    insert(session, "A")
    expect(b!.state.selection.from).toBe(4)
    expect(a!.state.selection.from).not.toBe(b!.state.selection.from)
    insert(session, "B", "b", 2)
    expect(a!.state.doc.textContent).toContain("AB共享正文")
    expect(a!.state.doc.eq(b!.state.doc)).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(undoDepth(a!.state)).toBe(1)
    expect(undoDepth(b!.state)).toBe(1)
    session.undo("a")
    expect(a!.state.doc.textContent).toContain("B共享正文")
    session.undo("b")
    expect(a!.state.doc.textContent).toBe("共享正文")
    session.redo("a")
    session.redo("b")
    expect(a!.state.doc.textContent).toContain("AB共享正文")
    expect(view(session)).toBe(originalA)
    expect(view(session, "b")).toBe(originalB)
    expect(a!.state.doc.eq(b!.state.doc)).toBe(true)
  })

  it("旧 transaction 原子拒绝；关闭重开 pane 不影响 survivor identity/history/selection", () => {
    const { session, a, b } = make()
    const stale = b!.state.tr.insertText("stale", 1)
    insert(session, "A")
    expect(session.dispatch("b", stale)).toBe(false)
    expect(session.getState().error).toBeInstanceOf(Error)
    const selection = a!.state.selection
    const depth = undoDepth(a!.state)
    expect(session.detachView("b")).toBe(true)
    const newB = session.attachView(
      "b",
      document.body.appendChild(document.createElement("div"))
    )
    expect(newB).not.toBe(b)
    expect(undoDepth(newB.state)).toBe(0)
    expect(view(session)).toBe(a)
    expect(a!.state.selection.eq(selection)).toBe(true)
    expect(undoDepth(a!.state)).toBe(depth)
  })

  it("另一 pane 在本地插入范围内部继续输入时，本地 undo 保留其文本", () => {
    const { session } = make()
    insert(session, "AA")
    insert(session, "B", "b", 2)
    expect(view(session).state.doc.textContent).toContain("ABA共享正文")
    session.undo("a")
    expect(view(session).state.doc.textContent).toBe("B共享正文")
    session.undo("b")
    expect(view(session).state.doc.textContent).toBe("共享正文")
  })

  it("异步窄插入经过 current mapping；跨 pane 重建、删除位置和旧 session 均拒绝", () => {
    const { session } = make()
    const ticket = session.captureInsertion("a")!
    insert(session, "B", "b")
    expect(session.resolveInsertion(ticket, "X")).toBe(true)
    expect(view(session).state.doc.textContent).toContain("BX共享正文")
    session.dispatch(
      "a",
      view(session).state.tr.setSelection(
        TextSelection.create(view(session).state.doc, 3)
      )
    )
    const deleted = session.captureInsertion("a")!
    session.dispatch("b", view(session, "b").state.tr.delete(1, 4))
    expect(session.resolveInsertion(deleted, "deleted-target")).toBe(false)
    const removed = session.captureInsertion("a")!
    session.detachView("a")
    session.attachView(
      "a",
      document.body.appendChild(document.createElement("div"))
    )
    expect(session.resolveInsertion(removed, "stale")).toBe(false)
    const oldSession = session.captureInsertion("a")!
    session.dispose()
    expect(session.resolveInsertion(oldSession, "stale")).toBe(false)
  })
})

describe("隔离原型：唯一保存 producer 与可信终态", () => {
  it("A inflight 时 B/M2 保留 dirty；重复请求共享 barrier；drain 最大并发一", async () => {
    const first = deferred()
    const second = deferred()
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { session, id } = make(onSave)
    insert(session, "A")
    const request = save(session)
    expect(request.kind).toBe("pending")
    expect(save(session)).toBe(request)
    await Promise.resolve()
    insert(session, "B", "b")
    session.controller.updateHostSnapshot(
      { changeId: 1, value: { title: "M2", summary: "" } },
      { expectedSessionId: id }
    )
    expect(onSave).toHaveBeenCalledTimes(1)
    first.resolve()
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(session.getState().dirty).toEqual({ body: true, host: true })
    second.resolve()
    expect(await terminal(request)).toMatchObject({
      kind: "saved",
      writesCompleted: 2
    })
    expect(session.getState().save).toBe("clean")
    expect(onSave.mock.calls[0]![0].hostSnapshot.value.title).toBe("")
    expect(onSave.mock.calls[1]![0].hostSnapshot.value.title).toBe("M2")
    expect(JSON.stringify(onSave.mock.calls[1]![0].document)).toContain(
      "BA共享正文"
    )
  })

  it("metadata-only、单调 changeId 与防御拷贝；600ms timer 走同一队列", async () => {
    vi.useFakeTimers()
    const { session, onSave, id } = make()
    const host = {
      changeId: 1,
      value: { title: "original", summary: "summary" }
    }
    expect(
      session.controller.updateHostSnapshot(host, { expectedSessionId: id })
        .kind
    ).toBe("accepted")
    host.value.title = "mutated"
    expect(session.getState().dirty).toEqual({ body: false, host: true })
    expect(
      session.controller.updateHostSnapshot(
        { changeId: 1, value: { title: "other", summary: "" } },
        { expectedSessionId: id }
      ).kind
    ).toBe("failure")
    expect(onSave).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0].hostSnapshot.value.title).toBe("original")
    expect(session.getState().save).toBe("clean")
  })

  it("旧合法快照 A 保存后进入非法 B：state error、blocked、无新增 write/onChange", async () => {
    const { session, onSave, onChange } = make()
    insert(session, "A")
    expect((await terminal(save(session))).kind).toBe("saved")
    const count = onChange.mock.calls.length
    const target = view(session)
    const unsafe = target.state.schema.nodes["picture"]!.create({
      nodeId: crypto.randomUUID(),
      src: "javascript:alert(1)",
      alt: ""
    })
    session.dispatch(
      "a",
      target.state.tr.insert(target.state.doc.content.size, unsafe)
    )
    expect(session.getState().encoding).toBe("error")
    expect(onChange).toHaveBeenCalledTimes(count)
    expect(save(session)).toMatchObject({
      kind: "blocked",
      cause: "encoding-error"
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(session.getState().dirty.body).toBe(true)
  })

  it("A 在途后 B 编码失败：A 成功也不能让 barrier 宣称 saved", async () => {
    const gate = deferred()
    const { session, onSave } = make(vi.fn(() => gate.promise))
    insert(session, "A")
    const request = save(session)
    await Promise.resolve()
    const target = view(session)
    const unsafe = target.state.schema.nodes["picture"]!.create({
      nodeId: crypto.randomUUID(),
      src: "javascript:bad",
      alt: ""
    })
    session.dispatch(
      "a",
      target.state.tr.insert(target.state.doc.content.size, unsafe)
    )
    gate.resolve()
    expect(await terminal(request)).toMatchObject({
      kind: "blocked",
      cause: "encoding-error"
    })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("失败保留最新快照、停止自动重试；显式 retry 再写 latest", async () => {
    vi.useFakeTimers()
    const gate = deferred()
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined)
    const { session } = make(onSave)
    insert(session, "A")
    const request = save(session)
    await Promise.resolve()
    insert(session, "B", "b")
    gate.reject(new Error("disk failure"))
    expect((await terminal(request)).kind).toBe("failure")
    await vi.advanceTimersByTimeAsync(1200)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(session.getState().dirty.body).toBe(true)
    expect((await terminal(save(session, "host-retry"))).kind).toBe("saved")
    expect(JSON.stringify(onSave.mock.calls[1]![0].document)).toContain(
      "BA共享正文"
    )
  })

  it("旧 session 命令与 dispose 隔离；adapter 忽略 abort 仍不更新 baseline", async () => {
    const gate = deferred()
    const { session, onSave } = make(vi.fn(() => gate.promise))
    const other = make().session
    expect(
      session.controller.requestSave({
        reason: "host-close",
        expectedSessionId: other.identity.sessionId
      }).kind
    ).toBe("noop")
    insert(session, "A")
    const request = save(session)
    await Promise.resolve()
    session.dispose()
    expect((await terminal(request)).kind).toBe("abort")
    expect(
      (onSave.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }])[1]
        .signal.aborted
    ).toBe(true)
    gate.resolve()
    await Promise.resolve()
    expect(session.getState().lifecycle).toBe("disposed")
    expect(other.getState().save).toBe("clean")
  })

  it("非法初始内容不挂载编辑器，也不提供可保存的 fallback", () => {
    const { session, onSave } = make(
      vi.fn(async () => {}),
      { initialDocument: { notes: { blocks: [] } } }
    )
    expect(session.getState().lifecycle).toBe("load-error")
    expect(session.views.size).toBe(0)
    expect(save(session)).toMatchObject({ kind: "noop", cause: "not-ready" })
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe("隔离原型：Provider 草稿所有权", () => {
  it.each([
    ["card", cardId],
    ["drawing", drawingId]
  ] as const)(
    "%s 未完成关闭必须 blocked、queue idle 时零写，视图与草稿保留",
    async (_kind, nodeId) => {
      const { session, onSave, a, b, id } = make()
      expect(session.beginDraft("a", nodeId)).toBe(true)
      const original = session.getDraftData()
      session.changeDraft(original + " ")
      expect(session.canReplace()).toBe(false)
      const lease = await frozen(session)
      expect(save(session)).toMatchObject({
        kind: "blocked",
        cause: "draft-open"
      })
      expect(onSave).not.toHaveBeenCalled()
      expect(
        session.controller.canDetachView("a", { expectedSessionId: id }).kind
      ).toBe("blocked")
      expect(session.detachView("a")).toBe(false)
      expect(session.detachView("b")).toBe(true)
      session.attachView(
        "b",
        document.body.appendChild(document.createElement("div"))
      )
      expect(session.getDraftData()).toBe(original + " ")
      expect(view(session)).toBe(a)
      expect(view(session, "b")).not.toBe(b)
      expect(a!.editable).toBe(false)
      expect(session.completeDraft()).toBe(false)
      session.cancelDraft()
      expect(session.getState().draft.phase).toBe("editing")
      await session.controller.setInputFrozen(false, {
        expectedSessionId: id,
        requestId: lease.requestId,
        leaseId: lease.leaseId
      })
      expect(session.getState().draft.phase).toBe("editing")
      session.cancelDraft()
      expect(session.getState().draft.phase).toBe("none")
      expect(a!.editable).toBe(true)
    }
  )

  it("card 完成只提交一次、恢复 owner selection，drawing cancel 零正文事务", () => {
    const { session, onChange, a } = make()
    const selection = a!.state.selection
    session.beginDraft("a", cardId)
    const data = JSON.parse(session.getDraftData())
    data.cards[0].title = "updated"
    session.changeDraft(JSON.stringify(data))
    expect(session.completeDraft()).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(a!.state.selection.eq(selection)).toBe(true)
    expect(undoDepth(a!.state)).toBe(1)
    const before = encodeHnn(a!.state.doc)
    session.beginDraft("b", drawingId)
    session.changeDraft(session.getDraftData() + " ")
    session.cancelDraft()
    expect(encodeHnn(a!.state.doc)).toEqual(before)
    expect(onChange).toHaveBeenCalledTimes(1)
    session.undo("a")
    expect(JSON.stringify(encodeHnn(a!.state.doc))).not.toContain("updated")
  })

  it("验证失败保留草稿、零提交；A 在途时打开草稿导致 barrier blocked，无新增写入", async () => {
    const gate = deferred()
    const { session, onSave, onChange } = make(vi.fn(() => gate.promise))
    insert(session, "A")
    const request = save(session)
    await Promise.resolve()
    session.beginDraft("b", cardId)
    session.changeDraft("invalid")
    expect(session.completeDraft()).toBe(false)
    expect(session.getDraftData()).toBe("invalid")
    expect(session.getState().draft.phase).toBe("invalid")
    gate.resolve()
    expect(await terminal(request)).toMatchObject({
      kind: "blocked",
      cause: "draft-open"
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe("隔离原型：冻结 barrier 与 lease 所有权", () => {
  it("所有 view 和 metadata 冻结；snapshot 不丢；不同 lease 不能互相解锁", async () => {
    const { session, id, onSave } = make()
    session.controller.updateHostSnapshot(
      { changeId: 1, value: { title: "metadata", summary: "" } },
      { expectedSessionId: id }
    )
    const first = await frozen(session)
    const second = await session.controller.setInputFrozen(true, {
      expectedSessionId: id,
      requestId: "second-close"
    })
    expect(second).toMatchObject({ kind: "applied", action: "acquired" })
    expect("leaseId" in second).toBe(true)
    const before = view(session).state.doc
    insert(session, "blocked")
    expect(view(session).state.doc).toBe(before)
    expect(view(session).editable).toBe(false)
    expect(view(session, "b").editable).toBe(false)
    expect(
      session.controller.updateHostSnapshot(
        { changeId: 2, value: { title: "lost", summary: "" } },
        { expectedSessionId: id }
      ).kind
    ).toBe("blocked")
    expect((await terminal(save(session))).kind).toBe("saved")
    expect(onSave.mock.calls[0]![0].hostSnapshot.value.title).toBe("metadata")
    await session.controller.setInputFrozen(false, {
      expectedSessionId: id,
      requestId: first.requestId,
      leaseId: first.leaseId
    })
    expect(session.getState().inputFrozen).toBe(true)
    expect(
      await session.controller.setInputFrozen(false, {
        expectedSessionId: id,
        requestId: first.requestId,
        leaseId: first.leaseId
      })
    ).toMatchObject({ reason: "stale-lease" })
    if ("leaseId" in second)
      await session.controller.setInputFrozen(false, {
        expectedSessionId: id,
        requestId: second.requestId,
        leaseId: second.leaseId
      })
    expect(session.getState().inputFrozen).toBe(false)
  })

  it("未结束的真实 view composition 显式失败，保留同一 view；结束后可重试", async () => {
    const { session, a, id } = make()
    fireEvent.compositionStart(a!.dom)
    expect(a!.composing).toBe(true)
    const result = await session.controller.setInputFrozen(true, {
      expectedSessionId: id,
      requestId: "composition"
    })
    expect(result).toMatchObject({
      kind: "failure",
      reason: "composition-commit"
    })
    expect(session.getState().inputFrozen).toBe(false)
    expect(view(session)).toBe(a)
    fireEvent.compositionEnd(a!.dom)
    await new Promise((resolve) => setTimeout(resolve, 30))
    await frozen(session)
  })

  it("pending 异步编辑不能被静默取消；完成后重试，旧 session 不解冻", async () => {
    const { session, id } = make()
    const ticket = session.captureInsertion("a")!
    expect(
      await session.controller.setInputFrozen(true, {
        expectedSessionId: id,
        requestId: "pending"
      })
    ).toMatchObject({ kind: "failure", reason: "pending-edit" })
    expect(session.resolveInsertion(ticket, "late")).toBe(true)
    const lease = await frozen(session)
    expect(
      await session.controller.setInputFrozen(false, {
        expectedSessionId: "old",
        requestId: lease.requestId,
        leaseId: lease.leaseId
      })
    ).toMatchObject({ kind: "noop", reason: "stale" })
    expect(session.getState().inputFrozen).toBe(true)
  })
})
