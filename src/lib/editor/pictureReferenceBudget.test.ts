// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { DocumentSession } from "./documentSession"
import { decodeHnn, encodeHnn } from "../hnn/codec"
import { HNN_LIMITS } from "../hnn/limits"

const sessions: DocumentSession[] = []
afterEach(() => { for (const session of sessions.splice(0)) session.dispose() })
const id = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`
const oldSrc = "https://x.co/a"
const src = "hamster_note_data/images/0123456789abcdef0123456789abcdef.png"
const delta = src.length - oldSrc.length
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
const replacements = [0, 1].map(n => ({ nodeId: id(n), expectedSrc: oldSrc, src }))

/** Fill canonical ASCII text to an exact shell byte count, within per-node limits. */
function fixture(headroom: number) {
  const canonical = encodeHnn(decodeHnn({ schemaVersion: 1, data: { type: "doc", content: [
    ...Array.from({ length: 70 }, (_, n) => ({ type: "paragraph", attrs: { nodeId: id(n + 10) }, content: [{ type: "text", text: "x" }] })),
    ...replacements.map(item => ({ type: "picture", attrs: { nodeId: item.nodeId, src: oldSrc, alt: "p" } }))
  ] } }))
  let remaining = HNN_LIMITS.maxShellBytes - headroom - bytes(canonical)
  for (const paragraph of (canonical.data["content"] as Array<{ content: Array<{ text: string }> }>).slice(0, 70)) {
    const add = Math.min(8191, remaining)
    paragraph.content[0]!.text += "x".repeat(add)
    remaining -= add
  }
  expect(remaining).toBe(0)
  expect(bytes(canonical)).toBe(HNN_LIMITS.maxShellBytes - headroom)
  expect(() => encodeHnn(decodeHnn(canonical))).not.toThrow()
  return canonical
}

function mount(headroom: number) {
  const onChange = vi.fn(), onSave = vi.fn(() => Promise.resolve())
  const session = new DocumentSession({ documentId: "budget", loadKey: 1, initialDocument: fixture(headroom),
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } }, onChange, onSave })
  sessions.push(session)
  const a = session.attachView("a"), b = session.attachView("b")
  a.editor.commands.setTextSelection(2)
  b.editor.commands.setTextSelection(3)
  const replace = (items: typeof replacements) => session.controller.replacePictureReferences!({ expectedSessionId: session.identity.sessionId, replacements: items })
  return { session, a, b, onChange, onSave, replace }
}

it.each([0, delta])("rejects the complete over-budget batch before dispatch (headroom %i), preserving both views and observers", headroom => {
  const h = mount(headroom)
  const states = [h.a.editor.state, h.b.editor.state]
  const publicState = h.session.controller.getState(), usage = h.session.resourceUsage()
  const notified = vi.fn(), transaction = vi.fn()
  h.session.controller.subscribe(notified)
  h.a.editor.on("transaction", transaction); h.b.editor.on("transaction", transaction)
  expect(h.replace(headroom === 0 ? replacements.slice(0, 1) : replacements)).toMatchObject({ kind: "rejected" })
  expect(h.a.editor.state).toBe(states[0]); expect(h.b.editor.state).toBe(states[1])
  expect(h.session.controller.getState()).toEqual(publicState)
  expect(h.session.resourceUsage()).toEqual(usage)
  expect(h.onChange).not.toHaveBeenCalled(); expect(h.onSave).not.toHaveBeenCalled()
  expect(notified).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled()
})

it.each([0, 1])("accepts replacement %i alone at exactly 512 KiB, with valid encoding, save and undo/redo", async index => {
  const h = mount(delta)
  const before = h.a.editor.state.doc
  expect(h.replace([replacements[index]!])).toMatchObject({ kind: "applied" })
  expect(bytes(encodeHnn(h.a.editor.state.doc))).toBe(HNN_LIMITS.maxShellBytes)
  expect(h.session.controller.getState()).toMatchObject({ encoding: "valid", dirty: { body: true } })
  expect(h.onChange).toHaveBeenCalledTimes(1)
  let saved = h.session.controller.requestSave({ expectedSessionId: h.session.identity.sessionId, reason: "host-save" })
  if (saved.kind === "pending") saved = await saved.completion
  expect(saved.kind).toBe("saved")
  expect(h.session.history("b", false)).toBe(true)
  expect(h.a.editor.state.doc.eq(before)).toBe(true)
  expect(h.session.history("a", true)).toBe(true)
  expect(bytes(encodeHnn(h.b.editor.state.doc))).toBe(HNN_LIMITS.maxShellBytes)
})
