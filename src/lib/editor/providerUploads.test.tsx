// @vitest-environment jsdom
import { createRef } from "react"
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController, type NoteDocumentProviderProps, type PictureUploadResult } from "../index"
import { DocumentSession } from "./documentSession"
import { HNN_CARD_EMPTY_DATA } from "../hnn/cardPayload"
import { HNN_DRAWING_EMPTY_DATA } from "../hnn/drawingPayload"

const sessions: DocumentSession[] = []
afterEach(() => { cleanup(); for (const s of sessions.splice(0)) s.dispose() })
const initial = { schemaVersion: 1, data: { type: "doc", content: [{ type: "paragraph", attrs: {
  nodeId: "123e4567-e89b-42d3-a456-426614174000"
}, content: [{ type: "text", text: "body" }] }] } }
const image = (name = "image.png") => new File(["image"], name, { type: "image/png" })
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
function pending() {
  let resolve!: (value: PictureUploadResult) => void, reject!: (error: unknown) => void
  const promise = new Promise<PictureUploadResult>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(overrides: Partial<NoteDocumentProviderProps> = {}) {
  const options = { documentId: "doc", loadKey: 1, initialDocument: initial,
    initialHostSnapshot: { changeId: 0, value: { title: "title", summary: "summary" } },
    onSave: vi.fn(async () => {}), onChange: vi.fn(), ...overrides }
  const s = new DocumentSession(options)
  sessions.push(s)
  const a = s.attachView("a"), b = s.attachView("b"), c = s.controller
  return { s, a, b, c, options, expectedSessionId: s.identity.sessionId }
}
function pictures(s: DocumentSession) {
  return s.views.values().next().value!.editor.state.doc.content.content.filter((node) => node.type.name === "picture")
}
it("hot enables/removes/re-enables upload and uses replacement handlers only for future attempts", async () => {
  const old = pending(), next = pending()
  const first = vi.fn(() => old.promise), second = vi.fn(() => next.promise)
  const { s, a, options } = setup()
  const dom = a.editor.view.dom
  expect(a.pictureUpload).toBeUndefined()
  s.updateCallbacks({ ...options, onPictureUpload: first })
  const uploader = a.pictureUpload!
  uploader.enqueue([image()])
  s.updateCallbacks({ ...options, onPictureUpload: second })
  expect(a.pictureUpload).toBe(uploader)
  old.reject(new Error("failure")); await tick()
  const id = uploader.getState().items[0]!.uploadId
  expect(uploader.retry(id)).toBe(true)
  expect(second.mock.calls[0]).toBeDefined()
  expect(first.mock.calls).toHaveLength(1)
  s.updateCallbacks(options)
  expect(a.pictureUpload).toBeUndefined()
  next.resolve({ src: "https://example.com/late.png" }); await tick()
  expect(pictures(s)).toEqual([])
  s.updateCallbacks({ ...options, onPictureUpload: () => Promise.resolve({ src: "https://example.com/current.png" }) })
  a.pictureUpload!.enqueue([image()]); await tick()
  expect(pictures(s)).toHaveLength(1)
  expect(a.editor.view.dom).toBe(dom)
})
it("commits once through authority, maps anchors and supports independent adjacent edits and cross-view undo/redo", async () => {
  const result = pending()
  const { s, a, b, options } = setup({ onPictureUpload: () => result.promise })
  a.pictureUpload!.enqueue([image()])
  s.dispatch("b", b.editor.state.tr.insertText("before ", 1))
  const changes = vi.mocked(options.onChange).mock.calls.length
  result.resolve({ src: "https://example.com/current.png", alt: "Uploaded" }); await tick()
  expect(options.onChange).toHaveBeenCalledTimes(changes + 1)
  expect(a.editor.state.doc.eq(b.editor.state.doc)).toBe(true)
  expect(a.pictureUpload!.getState().items).toEqual([])
  expect(pictures(s)[0]!.attrs).toMatchObject({ src: "https://example.com/current.png", alt: "Uploaded" })
  s.dispatch("a", a.editor.state.tr.insertText("after ", 1))
  s.history("b", false); expect(pictures(s)).toHaveLength(1)
  s.history("b", false); expect(pictures(s)).toHaveLength(0)
  expect(b.editor.state.doc.textContent).toBe("before body")
  s.history("a", true); expect(pictures(s)).toHaveLength(1)
})
it("preserves batch order when same-anchor files finish out of order", async () => {
  const one = pending(), two = pending(), three = pending()
  const upload = vi.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise).mockReturnValueOnce(three.promise)
  const { s, a, b } = setup({ onPictureUpload: upload })
  a.pictureUpload!.enqueue([image("one.png"), image("two.png"), image("three.png")])
  three.resolve({ src: "https://example.com/3.png" }); await tick()
  one.resolve({ src: "https://example.com/1.png" }); await tick()
  two.resolve({ src: "https://example.com/2.png" }); await tick()
  expect(pictures(s).map((p) => String(p.attrs["src"]))).toEqual(["https://example.com/1.png", "https://example.com/2.png", "https://example.com/3.png"])
  expect(a.editor.state.doc.eq(b.editor.state.doc)).toBe(true)
})
it("keeps a rejected authoritative commit retryable instead of reporting a false completion", async () => {
  const result = pending()
  const { s, a, options } = setup({ onPictureUpload: () => result.promise })
  const uploader = a.pictureUpload!, [id] = uploader.enqueue([image()])
  const dispatch = vi.spyOn(s, "dispatch").mockReturnValue(false)
  result.resolve({ src: "https://example.com/ok.png" }); await tick()
  expect(uploader.getState().items[0]).toMatchObject({ status: "failed", uploadId: id })
  expect(options.onChange).not.toHaveBeenCalled()
  dispatch.mockRestore()
  expect(uploader.retry(id!)).toBe(true); await tick()
  expect(pictures(s)).toHaveLength(1)
})
it.each(["cancel", "detach", "remove", "dispose", "anchor"])("aborts on %s and ignores a host that resolves late", async (action) => {
  const result = pending()
  const upload = vi.fn<NonNullable<NoteDocumentProviderProps["onPictureUpload"]>>(() => result.promise)
  const { s, a, options } = setup({ onPictureUpload: upload })
  if (action === "anchor") s.dispatch("a", a.editor.state.tr.insert(a.editor.state.doc.content.size, a.editor.schema.nodes["paragraph"]!.create()))
  const [id] = a.pictureUpload!.enqueue([image()])
  expect(s.canReplace()).toBe(false)
  const signal = upload.mock.calls[0]![1].signal
  if (action === "cancel") a.pictureUpload!.cancel(id!)
  if (action === "detach") { s.detachView("a", a); s.attachView("a") }
  if (action === "remove") { const withoutUpload = { ...options }; delete withoutUpload.onPictureUpload; s.updateCallbacks(withoutUpload) }
  if (action === "dispose") s.dispose()
  if (action === "anchor") s.dispatch("a", a.editor.state.tr.delete(1, a.editor.state.doc.content.size - 1))
  expect(signal.aborted).toBe(true)
  const changes = vi.mocked(options.onChange).mock.calls.length
  result.resolve({ src: "https://example.com/late.png" }); await tick()
  expect(options.onChange).toHaveBeenCalledTimes(changes)
  if (action !== "dispose") expect(pictures(s)).toEqual([])
})
it("save excludes all upload state; freeze rejects pending/failed without consuming requestId, and queue entry blocks new work", async () => {
  const result = pending()
  const upload = vi.fn<NonNullable<NoteDocumentProviderProps["onPictureUpload"]>>(() => result.promise)
  const { s, a, c, options, expectedSessionId } = setup({ onPictureUpload: upload })
  s.dispatch("a", a.editor.state.tr.insertText("edit ", 1))
  const [id] = a.pictureUpload!.enqueue([image()])
  const save = c.requestSave({ reason: "host-save", expectedSessionId })
  expect(save.kind).toBe("pending")
  expect(c.requestSave({ reason: "host-close", expectedSessionId })).toBe(save)
  if (save.kind === "pending") expect((await save.completion).kind).toBe("saved")
  expect(options.onSave).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(vi.mocked(options.onSave).mock.calls)).not.toMatch(/uploadId|attempt|image\.png/)
  const lease = c.setInputFrozen(true, { expectedSessionId, requestId: "R" })
  expect(a.pictureUpload!.enqueue([image()])).toEqual([])
  expect(await lease).toMatchObject({ kind: "failure", reason: "pending-edit" })
  result.reject(new Error("offline")); await tick()
  expect(await c.setInputFrozen(true, { expectedSessionId, requestId: "R" })).toMatchObject({ kind: "failure", reason: "pending-edit" })
  a.pictureUpload!.cancel(id!)
  const first = c.setInputFrozen(true, { expectedSessionId, requestId: "R" })
  expect(a.pictureUpload!.retry(id!)).toBe(false)
  const one = await first, two = await c.setInputFrozen(true, { expectedSessionId, requestId: "S" })
  expect(one.kind).toBe("applied"); expect(two.kind).toBe("applied")
  if (!("leaseId" in one) || !("leaseId" in two)) throw new Error("leases missing")
  expect(a.pictureUpload!.enqueue([image()])).toEqual([])
  await c.setInputFrozen(false, { expectedSessionId, requestId: "R", leaseId: one.leaseId })
  expect(a.pictureUpload!.enqueue([image()])).toEqual([])
  await c.setInputFrozen(false, { expectedSessionId, requestId: "S", leaseId: two.leaseId })
  expect(a.pictureUpload!.enqueue([image()])).toHaveLength(1)
  expect(upload).toHaveBeenCalledTimes(2)
})
it.each(["card", "drawing"] as const)("defers successful upload during %s draft and commits once after close with separate history", async (kind) => {
  const result = pending()
  const { s, a, b, options } = setup({ onPictureUpload: () => result.promise })
  a.pictureUpload!.enqueue([image()])
  expect(s.beginDraft("b", kind)).toBe(true)
  expect(a.pictureUpload!.enqueue([image()])).toEqual([])
  result.resolve({ src: "https://example.com/deferred.png" }); await tick()
  expect(pictures(s)).toHaveLength(0)
  expect(options.onChange).not.toHaveBeenCalled()
  expect(s.commitDraft(() => s.dispatch("b", b.editor.state.tr.insertText("draft ", 1)))).toBe(true)
  s.endDraft()
  expect(pictures(s)).toHaveLength(1)
  expect(options.onChange).toHaveBeenCalledTimes(2)
  s.endDraft(); expect(pictures(s)).toHaveLength(1)
  s.history("b", false); expect(pictures(s)).toHaveLength(0)
  expect(b.editor.state.doc.textContent).toBe("draft body")
  s.history("a", false); expect(b.editor.state.doc.textContent).toBe("body")
})
it.each(["cancel", "detach"])("cleans deferred result on %s and a never-settling upload releases replacement gate", async (action) => {
  const result = pending()
  const { s, a, b } = setup({ onPictureUpload: () => result.promise })
  const [id] = a.pictureUpload!.enqueue([image()])
  s.beginDraft("b", "card")
  result.resolve({ src: "https://example.com/deferred.png" }); await tick()
  if (action === "cancel") a.pictureUpload!.cancel(id!)
  else s.detachView("a", a)
  s.endDraft(); expect(pictures(s)).toHaveLength(0)
  expect(s.canReplace()).toBe(true)
  s.updateCallbacks({ documentId: "doc", loadKey: 1, initialDocument: initial,
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } }, onChange: () => {}, onSave: async () => {},
    onPictureUpload: () => new Promise(() => {}) })
  const [next] = b.pictureUpload!.enqueue([image()])
  expect(s.canReplace()).toBe(false)
  b.pictureUpload!.cancel(next!)
  expect(s.canReplace()).toBe(true)
})
function mount(upload?: NoteDocumentProviderProps["onPictureUpload"], kind?: "card" | "drawing") {
  const controllerRef = createRef<NoteDocumentController>()
  const onChange = vi.fn<NoteDocumentProviderProps["onChange"]>()
  const props: NoteDocumentProviderProps = { documentId: "doc", loadKey: 1,
    initialDocument: kind ? { schemaVersion: 1, data: { type: "doc", content: [...initial.data.content, {
      type: kind, attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174001", data: kind === "card" ? HNN_CARD_EMPTY_DATA : HNN_DRAWING_EMPTY_DATA }
    }] } } : initial,
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    controllerRef, onSave: vi.fn(async () => {}), onChange, ...(upload ? { onPictureUpload: upload } : {}),
    children: <><NoteEditorView viewId="a" /><NoteEditorView viewId="b" /></> }
  return { ...render(<NoteDocumentProvider {...props} />), props, controllerRef, onChange }
}
it.each(["throw", "reject", "unsafe"])("public UI supports %s failure, accessible retry, stable identity and cancel/late isolation", async (failure) => {
  const late = pending()
  const upload = vi.fn<NonNullable<NoteDocumentProviderProps["onPictureUpload"]>>()
    .mockImplementationOnce(() => {
      if (failure === "throw") throw new Error("offline")
      return failure === "reject" ? Promise.reject(new Error("offline")) : Promise.resolve({ src: "javascript:alert(1)" })
    }).mockImplementation(() => late.promise)
  const h = mount(upload)
  const input = h.container.querySelector<HTMLInputElement>('input[type="file"]')!
  fireEvent.change(input, { target: { files: [image()] } })
  await waitFor(() => expect(h.getByRole("alert").textContent).toContain("上传失败"))
  expect(h.onChange).not.toHaveBeenCalled()
  fireEvent.click(h.getByRole("button", { name: "重试上传 image.png" }))
  expect(upload.mock.calls[1]![1]).toMatchObject({ uploadId: upload.mock.calls[0]![1].uploadId, attempt: 2 })
  expect(upload.mock.calls[1]![1].signal).not.toBe(upload.mock.calls[0]![1].signal)
  fireEvent.click(h.getByRole("button", { name: "取消上传 image.png" }))
  expect(upload.mock.calls[1]![1].signal.aborted).toBe(true)
  await act(async () => { late.resolve({ src: "https://example.com/late.png" }); await tick() })
  expect(h.onChange).not.toHaveBeenCalled()
  expect(h.container.querySelector('[data-hnn-node="picture"]')).toBeNull()
  expect(h.queryByRole("button", { name: "取消上传 image.png" })).toBeNull()
})
it.each(["card", "drawing"] as const)("real %s portal cancellation commits the deferred upload once", async (kind) => {
  const result = pending()
  const h = mount(() => result.promise, kind)
  fireEvent.change(h.container.querySelector('input[type="file"]')!, { target: { files: [image()] } })
  const a = within(h.container.querySelector('[data-view-id="a"]') as HTMLElement)
  fireEvent.click(a.getByLabelText(kind === "card" ? "编辑卡片" : "编辑画板"))
  await act(async () => { result.resolve({ src: "https://example.com/deferred.png" }); await tick() })
  expect(h.onChange).not.toHaveBeenCalled()
  fireEvent.click(within(document.body).getByRole("button", { name: "取消" }))
  await waitFor(() => expect(h.onChange).toHaveBeenCalledTimes(1))
  expect(h.container.querySelectorAll('img[src="https://example.com/deferred.png"]')).toHaveLength(2)
})
it("public no-upload behavior, image paste, internal drag guard and legal session replacement isolate old results", async () => {
  const late = pending(), upload = vi.fn(() => late.promise)
  const h = mount()
  expect(h.queryByRole("button", { name: "插入图片" })).toBeNull()
  h.rerender(<NoteDocumentProvider {...h.props} onPictureUpload={upload} />)
  const c = h.controllerRef.current!, id = c.getState().identity!.sessionId
  const area = h.container.querySelector<HTMLElement>(".tiptap")!
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", { value: { files: [image()], getData: () => "", types: ["Files"] } })
  fireEvent(area, event)
  expect(upload).toHaveBeenCalledTimes(1)
  h.rerender(<NoteDocumentProvider {...h.props} loadKey={2} onPictureUpload={upload} />)
  expect(h.controllerRef.current!.getState().identity!.sessionId).toBe(id)
  fireEvent.click(h.getByRole("button", { name: "取消上传 image.png" }))
  h.rerender(<NoteDocumentProvider {...h.props} loadKey={2} onPictureUpload={upload} />)
  expect(h.controllerRef.current!.getState().identity!.sessionId).not.toBe(id)
  await act(async () => { late.resolve({ src: "https://example.com/old.png" }); await tick() })
  expect(h.onChange).not.toHaveBeenCalled()
})
