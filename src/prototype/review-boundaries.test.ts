// @vitest-environment jsdom
import { expect, it } from "vitest"
import { PrototypeSession } from "./session"
import { initialDocument } from "./fixtures"

function make() {
  return new PrototypeSession({
    documentId: "audit", loadKey: 1,
    initialDocument: initialDocument(),
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onSave: async () => {}
  })
}

it("queued acquisition prevents replacement before the first microtask", async () => {
  const session = make()
  const pending = session.controller.setInputFrozen(true, {
    expectedSessionId: session.identity.sessionId, requestId: "queued"
  })
  const replaceable = session.canReplace()
  session.dispose()
  const result = await pending
  expect(result.kind).toBe("abort")
  expect(replaceable).toBe(false)
})

it("disposal from a public state subscriber aborts acquisition", async () => {
  const session = make()
  session.controller.subscribe(state => {
    if (state.inputFrozen) session.dispose()
  })
  const result = await session.controller.setInputFrozen(true, {
    expectedSessionId: session.identity.sessionId, requestId: "dispose-on-notify"
  })
  expect(session.getState().lifecycle).toBe("disposed")
  expect(session.getState().inputFrozen).toBe(false)
  expect(result).toMatchObject({ kind: "abort", reason: "disposed", identity: null })
})
