// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"
import { initialDocument } from "./fixtures"
import { PrototypeSession } from "./session"
import type { FreezeResult } from "./types"

const sessions: PrototypeSession[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  document.body.replaceChildren()
})

function make() {
  const session = new PrototypeSession({
    documentId: "freeze-lifecycle",
    loadKey: 1,
    initialDocument: initialDocument(),
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onSave: async () => {}
  })
  sessions.push(session)
  const expectedSessionId = session.identity.sessionId
  return {
    session,
    acquire: (requestId: string) =>
      session.controller.setInputFrozen(true, { expectedSessionId, requestId }),
    release: (lease: FreezeResult) => {
      if (!("leaseId" in lease)) throw new Error("Missing lease")
      return session.controller.setInputFrozen(false, {
        expectedSessionId,
        requestId: lease.requestId,
        leaseId: lease.leaseId
      })
    }
  }
}

it("last release cannot open replacement while the next acquire is queued", async () => {
  const { session, acquire, release } = make()
  const first = await acquire("first")
  const observed: boolean[] = []
  session.controller.subscribe((state) => {
    if (!state.inputFrozen) observed.push(session.canReplace())
  })
  const releasing = release(first)
  const acquiring = acquire("next")
  expect(await releasing).toMatchObject({
    action: "released",
    inputFrozen: false
  })
  expect(observed).toEqual([false])
  expect(session.canReplace()).toBe(false)
  const next = await acquiring
  expect(next).toMatchObject({ action: "acquired" })
  expect(session.canReplace()).toBe(false)
  await release(next)
  expect(session.canReplace()).toBe(true)
})

it("acquire queued reentrantly during last release closes replacement immediately", async () => {
  const { session, acquire, release } = make()
  const first = await acquire("first")
  let next: Promise<FreezeResult> | undefined
  let replaceable: boolean | undefined
  const unsubscribe = session.controller.subscribe((state) => {
    if (state.inputFrozen || next) return
    next = acquire("from-release-notification")
    replaceable = session.canReplace()
  })
  await release(first)
  expect(replaceable).toBe(false)
  if (!next) throw new Error("Acquire was not queued")
  const lease = await next
  unsubscribe()
  await release(lease)
  expect(session.canReplace()).toBe(true)
})

it("one completed failure cannot clear another queued acquire's replacement gate", async () => {
  const { session, acquire, release } = make()
  const invalid = acquire("")
  const next = acquire("next")
  expect(session.canReplace()).toBe(false)
  expect(await invalid).toMatchObject({
    kind: "failure",
    reason: "invalid-request"
  })
  expect(session.canReplace()).toBe(false)
  await release(await next)
  expect(session.canReplace()).toBe(true)
  expect(await acquire(" ")).toMatchObject({ kind: "failure" })
  expect(session.canReplace()).toBe(true)
})

it("pending-edit failure clears its gate and preserves same-request retry", async () => {
  const { session, acquire, release } = make()
  session.attachView(
    "a",
    document.body.appendChild(document.createElement("div"))
  )
  const insertion = session.captureInsertion("a")!
  const pending = acquire("retry")
  expect(session.canReplace()).toBe(false)
  expect(await pending).toMatchObject({
    kind: "failure",
    reason: "pending-edit"
  })
  expect(session.canReplace()).toBe(true)
  session.detachView("a")
  expect(session.resolveInsertion(insertion, "discarded")).toBe(false)
  await release(await acquire("retry"))
  expect(session.canReplace()).toBe(true)
})

it("disposal inside release notification returns abort with no identity or lease", async () => {
  const { session, acquire, release } = make()
  const first = await acquire("first")
  session.controller.subscribe((state) => {
    if (!state.inputFrozen) session.dispose()
  })
  const result = await release(first)
  expect(result).toEqual({
    requestId: "first",
    kind: "abort",
    reason: "disposed",
    identity: null
  })
  expect(session.getState()).toMatchObject({
    lifecycle: "disposed",
    inputFrozen: false
  })
})

it("reentrant disposal aborts every queued acquire without reviving leases", async () => {
  const { session, acquire } = make()
  session.controller.subscribe((state) => {
    if (state.inputFrozen) session.dispose()
  })
  const results = await Promise.all([
    acquire("first"),
    acquire("second"),
    acquire("third")
  ])
  for (const [index, result] of results.entries())
    expect(result).toEqual({
      requestId: ["first", "second", "third"][index],
      kind: "abort",
      reason: "disposed",
      identity: null
    })
  expect(session.getState()).toMatchObject({
    lifecycle: "disposed",
    inputFrozen: false
  })
  // 销毁不重置计数；各请求完成后门禁应清理，不能减成负数而永久残留。
  expect(session.canReplace()).toBe(true)
})
