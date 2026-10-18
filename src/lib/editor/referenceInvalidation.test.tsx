// @vitest-environment jsdom
import { createRef } from "react"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController } from "../index"
import { DocumentSession } from "./documentSession"
import type { NoteDocumentProviderProps, ReferenceInvalidationScope } from "./documentTypes"
import type { HostReferenceResolution } from "./types"
import { encodeHnn } from "../hnn/codec"

const sessions: DocumentSession[] = []
afterEach(() => { cleanup(); for (const session of sessions.splice(0)) session.dispose() })
const uuid = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`
const initial = { schemaVersion: 1, data: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: uuid(0) }, content: [
  { type: "text", text: "body" },
  ...["mention", "mention", "resource"].map((type, i) => ({ type, attrs: { nodeId: uuid(i + 1), resourceId: "highlight", name: "Highlight" } }))
] }, { type: "externalItem", attrs: { nodeId: uuid(4), resourceId: "highlight", name: "Highlight" } }] } }
const scope: ReferenceInvalidationScope = { kind: "reference", reference: { kind: "mention", resourceId: "highlight" } }
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
function setup(overrides: Partial<NoteDocumentProviderProps> = {}) {
  const options = { documentId: "doc", loadKey: 1, initialDocument: initial,
    initialHostSnapshot: { changeId: 0, value: { title: "title", summary: "summary" } },
    onSave: vi.fn(async () => {}), onChange: vi.fn(), ...overrides }
  const s = new DocumentSession(options)
  sessions.push(s)
  return { s, options, c: s.controller, expectedSessionId: s.identity.sessionId }
}
it("invalidates by kind/id in both views, deduplicates nodes, preserves body/history/selection and supports no views", async () => {
  let resolution: HostReferenceResolution | null = { label: "first" }
  const resolver = vi.fn(() => resolution)
  const { s, c, expectedSessionId, options } = setup({ onReferenceResolve: resolver })
  const a = s.attachView("a"), b = s.attachView("b")
  await tick()
  expect(resolver).toHaveBeenCalledTimes(6)
  s.dispatch("a", a.editor.state.tr.insertText("edit ", 1))
  c.updateHostSnapshot({ changeId: 1, value: { title: "new", summary: "s" } }, { expectedSessionId })
  const before = encodeHnn(a.editor.state.doc), state = c.getState(), history = s.resourceUsage()
  const selection: unknown = a.editor.state.selection.toJSON()
  const changes = vi.mocked(options.onChange).mock.calls.length
  resolution = null
  expect(c.invalidateReferences!({ expectedSessionId, scope })).toEqual({ kind: "accepted", sessionId: expectedSessionId })
  expect(a.references!.getReferenceState().entries.find((x) => x.kind === "mention")!.status).toBe("loading")
  await tick()
  expect(resolver).toHaveBeenCalledTimes(8)
  for (const view of [a, b]) expect(view.references!.getReferenceState().entries.map((x) => [x.kind, x.status])).toEqual([
    ["externalItem", "resolved"], ["mention", "missing"], ["resource", "resolved"]
  ])
  c.invalidateReferences!({ expectedSessionId, scope: { kind: "reference", reference: { kind: "resource", resourceId: "absent" } } })
  expect(resolver).toHaveBeenCalledTimes(8)
  c.invalidateReferences!({ expectedSessionId, scope: { kind: "document" } })
  await tick()
  expect(resolver).toHaveBeenCalledTimes(14)
  expect(a.references!.getReferenceState().entries.every((x) => x.status === "missing")).toBe(true)
  expect(encodeHnn(a.editor.state.doc)).toEqual(before)
  expect(c.getState()).toEqual(state)
  expect(a.editor.state.selection.toJSON()).toEqual(selection)
  expect(s.resourceUsage()).toEqual(history)
  expect(options.onChange).toHaveBeenCalledTimes(changes)
  expect(options.onSave).not.toHaveBeenCalled()
  s.history("b", false); expect(a.editor.state.doc.textContent).toBe("body")
  s.history("a", true); expect(encodeHnn(b.editor.state.doc)).toEqual(before)
  s.detachView("a", a); s.detachView("b", b)
  expect(c.invalidateReferences!({ expectedSessionId, scope: { kind: "document" } }).kind).toBe("accepted")
  const reopened = s.attachView("a")
  await tick()
  expect(reopened.references!.getReferenceState().entries.every((x) => x.status === "missing")).toBe(true)
  s.history("a", false); expect(reopened.editor.state.doc.textContent).toBe("body")
})
it("aborts loading attempts, ignores late results, recovers missing/error and uses the latest resolver", async () => {
  const old = pending<HostReferenceResolution | null>()
  const resolver = vi.fn<NonNullable<NoteDocumentProviderProps["onReferenceResolve"]>>(() => old.promise)
  const { s, c, expectedSessionId, options } = setup({ onReferenceResolve: resolver })
  const view = s.attachView("a")
  const oldSignals = resolver.mock.calls.map((call) => call[1].signal)
  const latest = vi.fn(() => null)
  s.updateCallbacks({ ...options, onReferenceResolve: latest })
  expect(latest).not.toHaveBeenCalled()
  c.invalidateReferences!({ expectedSessionId, scope: { kind: "document" } })
  expect(oldSignals.every((signal) => signal.aborted)).toBe(true)
  await tick(); old.resolve({ label: "late" }); await tick()
  expect(view.references!.getReferenceState().entries.every((x) => x.status === "missing")).toBe(true)
  s.updateCallbacks({ ...options, onReferenceResolve: () => { throw new Error("host failure") } })
  c.invalidateReferences!({ expectedSessionId, scope })
  expect(view.references!.getReferenceState().entries.find((x) => x.kind === "mention")).toMatchObject({ status: "error" })
  s.updateCallbacks({ ...options, onReferenceResolve: () => ({ label: "restored" }) })
  c.invalidateReferences!({ expectedSessionId, scope })
  await tick()
  expect(view.references!.getReferenceState().entries.find((x) => x.kind === "mention")).toMatchObject({ status: "resolved", label: "restored" })
})
it("validates lifecycle, identity, scope and aborts a synchronous dispose during refresh", async () => {
  const resolver = vi.fn(() => ({ label: "ok" }))
  const { s, c, expectedSessionId, options } = setup({ onReferenceResolve: resolver })
  s.attachView("a"); await tick(); resolver.mockClear()
  expect(c.invalidateReferences!({ expectedSessionId: "old", scope }).kind).toBe("noop")
  for (const invalid of [null, {}, { kind: "all" }, { kind: "reference", reference: { kind: "bad", resourceId: "r" } },
    { kind: "reference", reference: { kind: "mention", resourceId: " " } }, { kind: "reference", reference: { kind: "mention", resourceId: "x".repeat(5000) } }]) {
    expect(c.invalidateReferences!({ expectedSessionId, scope: invalid as ReferenceInvalidationScope })).toMatchObject({ kind: "failure", reason: "invalid-scope" })
  }
  expect(resolver).not.toHaveBeenCalled()
  const broken = setup({ initialDocument: {} })
  expect(broken.c.invalidateReferences!({ expectedSessionId: broken.expectedSessionId, scope })).toMatchObject({ kind: "noop", reason: "not-ready" })
  s.updateCallbacks({ ...options, onReferenceResolve: () => { s.dispose(); return { label: "stale" } } })
  expect(c.invalidateReferences!({ expectedSessionId, scope })).toEqual({ kind: "abort", reason: "disposed", sessionId: null })
  expect(c.invalidateReferences!({ expectedSessionId, scope })).toEqual({ kind: "abort", reason: "disposed", sessionId: null })
  await tick()
})
it.each([false, true])("public Provider refreshes DOM with a %s stable resolver while preserving focus, save and undo", async (stable) => {
  const ref = createRef<NoteDocumentController>()
  const onChange = vi.fn(), onSave = vi.fn(async () => { await Promise.resolve() })
  let removed = false
  const resolve = vi.fn(() => removed ? null : { label: "present" })
  const props: NoteDocumentProviderProps = { documentId: "doc", loadKey: 1, initialDocument: initial,
    initialHostSnapshot: { changeId: 0, value: { title: "title", summary: "summary" } },
    onSave, onChange, controllerRef: ref, onReferenceResolve: resolve,
    children: <><NoteEditorView viewId="a" /><NoteEditorView viewId="b" /></> }
  const h = render(<NoteDocumentProvider {...props} />)
  const statuses = () => [...h.container.querySelectorAll('[data-hnn-node="mention"]')].map((el) => el.getAttribute("data-hnn-resolve-status"))
  await waitFor(() => expect(statuses()).toEqual(["resolved", "resolved", "resolved", "resolved"]))
  const c = ref.current!, expectedSessionId = c.getState().identity!.sessionId
  const area = h.container.querySelector<HTMLElement>(".tiptap")!
  await act(async () => {
    area.focus()
    document.getSelection()?.collapse(area.querySelector("p")!.firstChild, 2)
    fireEvent(document, new Event("selectionchange"))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const selection = document.getSelection(), anchor = selection?.anchorNode, offset = selection?.anchorOffset
  const state = c.getState()
  removed = true
  h.rerender(<NoteDocumentProvider {...props} onReferenceResolve={stable ? resolve : () => null} />)
  expect(resolve).toHaveBeenCalledTimes(6)
  expect(statuses().every((s) => s === "resolved")).toBe(true)
  await act(async () => { c.invalidateReferences!({ expectedSessionId, scope }); await tick() })
  await waitFor(() => expect(statuses().every((s) => s === "missing")).toBe(true))
  expect(document.activeElement).toBe(area)
  expect(selection?.anchorNode).toBe(anchor); expect(selection?.anchorOffset).toBe(offset)
  expect(c.getState()).toEqual(state)
  expect(onChange).not.toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled()
  await act(async () => {
    const lease = await c.setInputFrozen(true, { expectedSessionId, requestId: "R" })
    expect(lease.kind).toBe("applied")
    c.invalidateReferences!({ expectedSessionId, scope: { kind: "document" } })
  })
  expect(onChange).not.toHaveBeenCalled()
  expect(area.getAttribute("contenteditable")).toBe("false")
  fireEvent.click(h.container.querySelector('button[aria-label="撤销"]')!)
})

it("does not resurrect a request when abort listeners or reference subscribers invalidate again", async () => {
  const requests: Array<ReturnType<typeof pending<HostReferenceResolution | null>>> = []
  const { s, c, expectedSessionId } = setup({ onReferenceResolve: (_reference, { signal }) => {
    const request = pending<HostReferenceResolution | null>()
    requests.push(request)
    signal.addEventListener("abort", () => {
      if (requests.length === 3) c.invalidateReferences!({ expectedSessionId, scope })
    }, { once: true })
    return request.promise
  } })
  const a = s.attachView("a")
  c.invalidateReferences!({ expectedSessionId, scope })
  expect(requests).toHaveLength(4)
  requests[3]!.resolve(null)
  requests[0]!.resolve({ label: "late" })
  await tick()
  expect(a.references!.getReferenceState().entries.find((entry) => entry.kind === "mention")?.status).toBe("missing")
  let again = false
  const unsub = a.references!.subscribeReferences(() => {
    if (!again) { again = true; c.invalidateReferences!({ expectedSessionId, scope }) }
  })
  c.invalidateReferences!({ expectedSessionId, scope })
  unsub()
  requests.at(-1)!.resolve({ label: "latest" })
  requests.at(-2)!.resolve({ label: "stale" })
  await tick()
  expect(a.references!.getReferenceState().entries.find((entry) => entry.kind === "mention")).toMatchObject({ status: "resolved", label: "latest" })
})
