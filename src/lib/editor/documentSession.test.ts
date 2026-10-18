// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { TextSelection } from "@tiptap/pm/state"
import { DocumentSession } from "./documentSession"
import type { NoteDocumentProviderProps, RequestSaveResult, SaveTerminal } from "./documentTypes"
import { demoFixtures } from "../../demo/fixtures"
import { fireEvent } from "@testing-library/dom"

const sessions: DocumentSession[] = []
afterEach(() => { for (const s of sessions.splice(0)) s.dispose(); vi.useRealTimers(); vi.unstubAllGlobals() })
export function initialDocument() {
  return { schemaVersion: 1, data: { type: "doc", content: [{ type: "paragraph", attrs: {
    nodeId: "123e4567-e89b-42d3-a456-426614174000"
  }, content: [{ type: "text", text: "共享正文" }] }] } }
}
function make(overrides: Partial<NoteDocumentProviderProps> = {}) {
  const options = {
    documentId: "A", loadKey: 1, initialDocument: initialDocument(),
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onSave: vi.fn(async () => { await Promise.resolve() }), onChange: vi.fn(), ...overrides
  }
  const session = new DocumentSession(options)
  sessions.push(session)
  const a = session.attachView("a"), b = session.attachView("b")
  const c = session.controller, id = session.identity.sessionId
  const insert = (view = a, text = "AA", at = 1) => session.dispatch(view === a ? "a" : "b", view.editor.state.tr.insertText(text, at))
  return { session, a, b, c, id, insert, options }
}
function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function finish(result: RequestSaveResult): Promise<SaveTerminal> {
  return result.kind === "pending" ? result.completion : result
}

describe("session UUID generation", () => {
  it("uses native randomUUID when available", () => {
    const randomUUID = vi.fn(() => "123e4567-e89b-42d3-a456-426614174099")
    vi.stubGlobal("crypto", { randomUUID })
    const session = new DocumentSession({
      documentId: "A", loadKey: 1, initialDocument: initialDocument(),
      initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } }, onSave: async () => {}, onChange: () => {}
    })
    sessions.push(session)
    expect(session.identity.sessionId).toBe("123e4567-e89b-42d3-a456-426614174099")
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })
  it("sets UUIDv4 version and variant bits on cryptographically random bytes", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255))
    vi.stubGlobal("crypto", { getRandomValues })
    const session = new DocumentSession({
      documentId: "A", loadKey: 1, initialDocument: initialDocument(),
      initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } }, onSave: async () => {}, onChange: () => {}
    })
    sessions.push(session)
    expect(session.identity.sessionId).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
    expect(getRandomValues).toHaveBeenCalledExactlyOnceWith(expect.any(Uint8Array))
    expect(getRandomValues.mock.calls[0]![0]).toHaveLength(16)
  })
  it.each([undefined, {}])("fails with a diagnostic when secure random APIs are unavailable (%s)", (crypto) => {
    vi.stubGlobal("crypto", crypto)
    expect(() => make()).toThrow("DocumentSession requires crypto.randomUUID or crypto.getRandomValues to generate secure UUIDv4 identifiers")
  })
})

describe("formal authority and shared history", () => {
  it("routes ABA → AA → original and redo across full editors without remount", () => {
    const { session, a, b, insert, options } = make()
    const aDom = a.editor.view.dom, bDom = b.editor.view.dom
    insert(); insert(b, "B", 2)
    expect(a.editor.state.doc.textContent).toBe("ABA共享正文")
    expect(a.editor.state.doc.eq(b.editor.state.doc)).toBe(true)
    expect(session.history("a", false)).toBe(true)
    expect(a.editor.state.doc.textContent).toBe("AA共享正文")
    session.history("b", false)
    expect(b.editor.state.doc.textContent).toBe("共享正文")
    session.history("a", true); session.history("b", true)
    expect(a.editor.state.doc.textContent).toBe("ABA共享正文")
    expect(a.editor.view.dom).toBe(aDom); expect(b.editor.view.dom).toBe(bDom)
    expect(options.onChange).toHaveBeenCalledTimes(6)
  })
  it("keeps peer selection and stored marks local and clears redo after fresh edits", () => {
    const { session, a, b, insert } = make()
    b.editor.commands.setTextSelection(3)
    b.editor.commands.setMark("bold")
    insert()
    expect(b.editor.state.selection.from).toBe(5)
    expect(b.editor.state.storedMarks?.map((mark) => mark.type.name)).toContain("bold")
    expect(a.editor.state.selection.from).not.toBe(b.editor.state.selection.from)
    session.history("b", false); insert(b, "C")
    expect(session.history("a", true)).toBe(false)
  })
  it("retains history after all views detach, using new instance tokens", () => {
    const { session, a, b, insert } = make()
    insert()
    session.detachView("a", a)
    expect(session.views.get("b")).toBe(b)
    session.detachView("b", b)
    const reopened = session.attachView("a")
    expect(reopened.instanceId).not.toBe(a.instanceId)
    session.history("a", false)
    expect(reopened.editor.state.doc.textContent).toBe("共享正文")
  })
  it("rejects stale body transactions atomically and emits once per accepted change", () => {
    const { session, a, b, insert, options } = make()
    const stale = b.editor.state.tr.insertText("stale", 1)
    insert()
    expect(session.dispatch("b", stale)).toBe(false)
    expect(options.onChange).toHaveBeenCalledTimes(1)
    expect(a.editor.state.doc.textContent).toBe("AA共享正文")
  })
  it("groups same-view input; focus and metadata do not enter body history", () => {
    const { session, a, b, c, id, insert } = make()
    insert(); insert(a, "X", 3)
    b.editor.view.dispatch(b.editor.state.tr.setSelection(TextSelection.create(b.editor.state.doc, 4)))
    c.updateHostSnapshot({ changeId: 1, value: { title: "metadata", summary: "" } }, { expectedSessionId: id })
    session.history("b", false)
    expect(a.editor.state.doc.textContent).toBe("共享正文")
    expect(c.getState().dirty).toEqual({ body: false, host: true })
  })
})

describe("metadata and save barrier", () => {
  it("never reports saved A as success for a subsequently unencodable B", async () => {
    const { c, id, insert, a, options, session } = make()
    insert()
    expect(await finish(c.requestSave({ expectedSessionId: id, reason: "host-save" }))).toMatchObject({ kind: "saved" })
    const count = vi.mocked(options.onChange).mock.calls.length
    session.dispatch("a", a.editor.state.tr.insertText("x".repeat(530_000), 1))
    expect(c.getState()).toMatchObject({ encoding: "error", dirty: { body: true } })
    expect(c.requestSave({ expectedSessionId: id, reason: "host-close" })).toMatchObject({ kind: "blocked", cause: "encoding-error" })
    expect(options.onSave).toHaveBeenCalledTimes(1)
    expect(options.onChange).toHaveBeenCalledTimes(count)
  })
  it("copies metadata and rejects invalid and non-monotonic snapshots", async () => {
    const { c, id, options } = make()
    const metadata = { changeId: 1, value: { title: "captured", summary: "s" } }
    expect(c.updateHostSnapshot(metadata, { expectedSessionId: id }).kind).toBe("accepted")
    metadata.value.title = "external"
    expect(c.updateHostSnapshot({ changeId: NaN, value: metadata.value }, { expectedSessionId: id })).toMatchObject({ kind: "failure", reason: "invalid-snapshot" })
    expect(c.updateHostSnapshot({ changeId: 1, value: { title: "captured", summary: "s" } }, { expectedSessionId: id })).toMatchObject({ kind: "noop", reason: "unchanged" })
    expect(c.updateHostSnapshot(metadata, { expectedSessionId: id })).toMatchObject({ kind: "failure", reason: "non-monotonic-change-id" })
    expect(c.updateHostSnapshot({ ...metadata, changeId: 0 }, { expectedSessionId: id }).kind).toBe("failure")
    expect(await finish(c.requestSave({ reason: "host-save", expectedSessionId: id }))).toMatchObject({ kind: "saved" })
    expect(options.onSave).toHaveBeenCalledWith(expect.objectContaining({ hostSnapshot: { changeId: 1, value: { title: "captured", summary: "s" } } }), expect.anything())
  })
  it("joins one barrier, awaits real writes, drains A/M1 then B/M2 serially", async () => {
    const first = deferred(), second = deferred()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { c, id, insert, b } = make({ onSave: save })
    insert()
    const r1 = c.requestSave({ reason: "host-save", expectedSessionId: id })
    const r2 = c.requestSave({ reason: "host-close", expectedSessionId: id })
    expect(r2).toBe(r1)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    insert(b, "B", 2)
    c.updateHostSnapshot({ changeId: 2, value: { title: "M2", summary: "" } }, { expectedSessionId: id })
    expect(c.getState().dirty.body).toBe(true)
    first.resolve()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(c.getState().dirty).toEqual({ body: true, host: true })
    second.resolve()
    expect(await finish(r1)).toMatchObject({ kind: "saved", writesCompleted: 2 })
    expect(c.getState().dirty).toEqual({ body: false, host: false })
  })
  it("failure retains dirty without automatic retry; explicit retry recovers", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("write failed")).mockResolvedValue(undefined)
    const { c, id, insert } = make({ onSave: save })
    insert()
    expect(await finish(c.requestSave({ reason: "host-save", expectedSessionId: id }))).toMatchObject({ kind: "failure" })
    expect(c.getState()).toMatchObject({ save: "failure", dirty: { body: true } })
    expect(c.requestSave({ reason: "autosave", expectedSessionId: id }).kind).toBe("failure")
    expect(save).toHaveBeenCalledTimes(1)
    expect(await finish(c.requestSave({ reason: "host-retry", expectedSessionId: id }))).toMatchObject({ kind: "saved" })
  })
  it("dispose settles inflight writes immediately even when adapter ignores abort", async () => {
    const pending = deferred()
    const { session, c, id, insert } = make({ onSave: () => pending.promise })
    insert()
    const result = c.requestSave({ reason: "host-close", expectedSessionId: id })
    await Promise.resolve()
    session.dispose()
    expect(await finish(result)).toEqual({ kind: "abort", sessionId: null, cause: "disposed" })
    expect(c.getState().identity).toBeNull()
    pending.resolve()
  })
  it("only the 600ms requestSave timer persists accepted host changes", async () => {
    vi.useFakeTimers()
    const { c, id, options } = make()
    c.updateHostSnapshot({ changeId: 1, value: { title: "title", summary: "" } }, { expectedSessionId: id })
    await vi.advanceTimersByTimeAsync(599)
    expect(options.onSave).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(options.onSave).toHaveBeenCalledTimes(1)
  })
  it.each(["body", "metadata"] as const)("stale save leaves the current %s autosave deadline intact", async (change) => {
    vi.useFakeTimers()
    const { c, id, insert, options } = make()
    if (change === "body") insert()
    else c.updateHostSnapshot({ changeId: 1, value: { title: "current", summary: "" } }, { expectedSessionId: id })
    await vi.advanceTimersByTimeAsync(400)
    expect(c.requestSave({ expectedSessionId: "old-session", reason: "host-save" })).toMatchObject({ kind: "noop", cause: "stale" })
    await vi.advanceTimersByTimeAsync(199)
    expect(options.onSave).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(options.onSave).toHaveBeenCalledTimes(1)
    expect(c.getState().dirty).toEqual({ body: false, host: false })
  })
  it.each(["card", "drawing"] as const)("ending %s draft does not retry a failed write", async (kind) => {
    vi.useFakeTimers()
    const save = vi.fn().mockRejectedValueOnce(new Error("write failed")).mockResolvedValue(undefined)
    const { c, id, insert, session } = make({ onSave: save })
    insert()
    expect(await finish(c.requestSave({ reason: "host-save", expectedSessionId: id }))).toMatchObject({ kind: "failure" })
    expect(session.beginDraft("a", kind)).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    session.endDraft()
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(c.getState()).toMatchObject({ save: "failure", dirty: { body: true } })
    expect(await finish(c.requestSave({ reason: "host-retry", expectedSessionId: id }))).toMatchObject({ kind: "saved" })
    expect(save).toHaveBeenCalledTimes(2)
  })
  it("ending a draft lets the existing save barrier drain without a second producer", async () => {
    vi.useFakeTimers()
    const write = deferred()
    const save = vi.fn().mockReturnValueOnce(write.promise).mockResolvedValue(undefined)
    const { c, id, insert, session, b } = make({ onSave: save })
    insert()
    const barrier = c.requestSave({ reason: "host-save", expectedSessionId: id })
    await Promise.resolve()
    insert(b, "B", 2)
    session.beginDraft("a", "card")
    await vi.advanceTimersByTimeAsync(1000)
    session.endDraft()
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
    write.resolve()
    expect(await finish(barrier)).toMatchObject({ kind: "saved", writesCompleted: 2 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(2)
    expect(c.getState().save).toBe("clean")
  })
})

describe("request-owned freeze and lifecycle", () => {
  it("reentrant acquire and failing requests retain independent replacement gates", async () => {
    const { c, id, session } = make()
    const first = await c.setInputFrozen(true, { expectedSessionId: id, requestId: "first" })
    if (!("leaseId" in first)) throw new Error("missing lease")
    let queued: Promise<unknown> | undefined
    c.subscribe((state) => {
      if (state.lifecycle === "ready" && !state.inputFrozen && !queued) {
        queued = c.setInputFrozen(true, { expectedSessionId: id, requestId: "reentrant" })
        expect(session.canReplace()).toBe(false)
      }
    })
    const release = c.setInputFrozen(false, { expectedSessionId: id, requestId: "first", leaseId: first.leaseId })
    const invalid = c.setInputFrozen(true, { expectedSessionId: id, requestId: " " })
    const valid = c.setInputFrozen(true, { expectedSessionId: id, requestId: "last" })
    await release
    expect(await invalid).toMatchObject({ kind: "failure", reason: "invalid-request" })
    expect(session.canReplace()).toBe(false)
    await valid; await queued
  })
  it("composition failure can retry the same request after compositionend", async () => {
    const { c, id, a } = make()
    fireEvent.compositionStart(a.editor.view.dom)
    expect(await c.setInputFrozen(true, { expectedSessionId: id, requestId: "IME" })).toMatchObject({ kind: "failure", reason: "composition-commit" })
    fireEvent.compositionEnd(a.editor.view.dom)
    expect(await c.setInputFrozen(true, { expectedSessionId: id, requestId: "IME" })).toMatchObject({ kind: "applied", action: "acquired" })
  })
  it("pending candidates block acquire; cancelled or completed requests can retry and frozen insertion is rejected", async () => {
    let resolve!: (value: []) => void
    const promise = new Promise<[]>((yes) => { resolve = yes })
    const { a, c, id, options } = make({ onReferenceCandidates: () => promise })
    a.references!.requestCandidates("mention", "a")
    expect(await c.setInputFrozen(true, { expectedSessionId: id, requestId: "R" })).toMatchObject({ kind: "failure", reason: "pending-edit" })
    resolve([])
    await promise; await Promise.resolve()
    expect(await c.setInputFrozen(true, { expectedSessionId: id, requestId: "R" })).toMatchObject({ kind: "applied", action: "acquired" })
    expect(a.references!.selectCandidate("mention", { resourceId: "r1", name: "name" })).toBe(false)
    expect(options.onChange).not.toHaveBeenCalled()
  })
  it("validates session first, request bounds, idempotency, ownership and tombstones", async () => {
    const { c, id } = make()
    const acquire = (requestId: string, expectedSessionId = id) => c.setInputFrozen(true, { expectedSessionId, requestId })
    expect(await acquire("", "stale")).toMatchObject({ kind: "noop", reason: "stale" })
    for (const request of ["", " \t", "x".repeat(129)]) expect(await acquire(request)).toMatchObject({ kind: "failure", reason: "invalid-request" })
    const r = await acquire("R"), again = await acquire("R"), s = await acquire("x".repeat(128))
    expect(r.kind).toBe("applied"); expect(s.kind).toBe("applied")
    if (!("leaseId" in r) || !("leaseId" in s)) throw new Error("missing lease")
    expect(again).toMatchObject({ kind: "noop", reason: "already-owned", leaseId: r.leaseId })
    expect(await c.setInputFrozen(false, { expectedSessionId: id, requestId: "S", leaseId: r.leaseId })).toMatchObject({ kind: "noop", reason: "stale-lease" })
    await c.setInputFrozen(false, { expectedSessionId: id, requestId: "R", leaseId: r.leaseId })
    expect(c.getState().inputFrozen).toBe(true)
    expect(await acquire("R")).toMatchObject({ kind: "noop", reason: "request-ended" })
    await c.setInputFrozen(false, { expectedSessionId: id, requestId: "x".repeat(128), leaseId: s.leaseId })
    expect(c.getState().inputFrozen).toBe(false)
  })
  it.each(["acquire", "release"])("returns abort/null when %s notification synchronously disposes", async (phase) => {
    const { session, c, id } = make()
    let leaseId = ""
    if (phase === "release") {
      const lease = await c.setInputFrozen(true, { expectedSessionId: id, requestId: "R" })
      if (!("leaseId" in lease)) throw new Error("missing lease")
      leaseId = lease.leaseId
    }
    c.subscribe((state) => {
      if (state.inputFrozen === (phase === "acquire")) session.dispose()
    })
    const result = phase === "acquire"
      ? await c.setInputFrozen(true, { expectedSessionId: id, requestId: "R" })
      : await c.setInputFrozen(false, { expectedSessionId: id, requestId: "R", leaseId })
    expect(result).toEqual({ kind: "abort", reason: "disposed", identity: null, requestId: "R" })
  })
  it("queued acquire parameters are copied and replacement remains blocked at release boundary", async () => {
    const { session, c, id } = make()
    const request = { expectedSessionId: id, requestId: "R" }
    const result = c.setInputFrozen(true, request)
    request.requestId = "mutated"
    expect(session.canReplace()).toBe(false)
    const r = await result
    if (!("leaseId" in r)) throw new Error("missing lease")
    const replacing: boolean[] = []
    c.subscribe((state) => { if (!state.inputFrozen) replacing.push(session.canReplace()) })
    const release = c.setInputFrozen(false, { expectedSessionId: id, requestId: "R", leaseId: r.leaseId })
    const acquire = c.setInputFrozen(true, { expectedSessionId: id, requestId: "S" })
    await release; await acquire
    expect(replacing).toEqual([false])
  })
  it("freezes metadata/body/undo, preserves accepted content and aborts queued work", async () => {
    const { session, c, id, insert, a } = make()
    insert()
    await c.setInputFrozen(true, { expectedSessionId: id, requestId: "R" })
    expect(insert()).toBe(false)
    expect(session.history("b", false)).toBe(false)
    expect(c.updateHostSnapshot({ changeId: 1, value: { title: "no", summary: "" } }, { expectedSessionId: id })).toMatchObject({ kind: "blocked", reason: "input-frozen" })
    expect(a.editor.state.doc.textContent).toBe("AA共享正文")
    const queued = c.setInputFrozen(true, { expectedSessionId: id, requestId: "S" })
    session.dispose()
    expect(await queued).toEqual({ kind: "abort", reason: "disposed", identity: null, requestId: "S" })
  })
})

describe("full node assembly and asynchronous origin", () => {
  it("budgets long history without expiring request-ended tombstones", async () => {
    const { session, c, id, a, b } = make()
    for (let i = 0; i < 300; i++) {
      const view = i % 2 ? a : b
      session.dispatch(i % 2 ? "a" : "b", view.editor.state.tr.insertText("x", 1))
    }
    const afterEdits = session.resourceUsage()
    expect(afterEdits.undoEvents).toBeGreaterThanOrEqual(100)
    expect(afterEdits.undoEvents).toBeLessThanOrEqual(120)
    session.detachView("a", a); session.detachView("b", b)
    for (let i = 0; i < 200; i++) {
      const requestId = `request-${i}`
      const result = await c.setInputFrozen(true, { expectedSessionId: id, requestId })
      if (!("leaseId" in result)) throw new Error("missing lease")
      await c.setInputFrozen(false, { expectedSessionId: id, requestId, leaseId: result.leaseId })
    }
    expect(session.resourceUsage()).toMatchObject({ requests: 200, activeLeases: 0, sessionMappingEntries: 0 })
    expect(await c.setInputFrozen(true, { expectedSessionId: id, requestId: "request-0" })).toMatchObject({ kind: "noop", reason: "request-ended" })
    session.attachView("a")
    expect(session.history("a", false)).toBe(true)
    console.log("resource-budget", JSON.stringify({ operations: { edits: 300, acquisitions: 200, releases: 200 }, afterEdits, final: session.resourceUsage() }))
  }, 15000)
  it.each(demoFixtures)("mounts $documentId twice, roundtrips commands through shared history", (fixture) => {
    const { session, a, b, options } = make({ initialDocument: fixture.document })
    expect(a.editor.schema).toBe(b.editor.schema)
    const before = a.editor.state.doc
    a.editor.commands.setTextSelection(2)
    a.editor.commands.toggleBold()
    a.editor.commands.insertContent("edited")
    expect(a.editor.state.doc.eq(b.editor.state.doc)).toBe(true)
    session.history("b", false)
    expect(a.editor.state.doc.eq(before)).toBe(true)
    expect(options.onChange).toHaveBeenCalledTimes(2)
    expect(a.editor.view.dom.querySelectorAll("[data-hnn-node]").length).toBe(b.editor.view.dom.querySelectorAll("[data-hnn-node]").length)
  })
  it("drops late candidates and resolution after the source view is detached/rebuilt", async () => {
    let resolve!: (value: Array<{ resourceId: string; name: string }>) => void
    const candidates = new Promise<Array<{ resourceId: string; name: string }>>((yes) => { resolve = yes })
    const { session, a, b, options } = make({ onReferenceCandidates: () => candidates })
    const installer = a.references!
    installer.requestCandidates("mention", "a")
    session.detachView("a", a)
    const reopened = session.attachView("a")
    resolve([{ resourceId: "late", name: "Late" }])
    await candidates; await Promise.resolve()
    expect(installer.selectCandidate("mention", { resourceId: "late", name: "Late" })).toBe(false)
    expect(reopened.editor.state.doc.eq(b.editor.state.doc)).toBe(true)
    expect(options.onChange).not.toHaveBeenCalled()
  })
})
