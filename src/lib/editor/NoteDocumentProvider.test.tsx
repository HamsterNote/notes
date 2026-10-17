// @vitest-environment jsdom
import { StrictMode, createRef } from "react"
import { flushSync } from "react-dom"
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController, type NoteDocumentProviderProps } from "../index"
import { HNN_CARD_EMPTY_DATA } from "../hnn/cardPayload"
import { HNN_DRAWING_EMPTY_DATA } from "../hnn/drawingPayload"
import { demoFixtures } from "../../demo/fixtures"

afterEach(() => { cleanup(); vi.useRealTimers() })
function initialDocument(kind?: "card" | "drawing") {
  const paragraph = { type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" }, content: [{ type: "text", text: "共享正文" }] }
  return { schemaVersion: 1, data: { type: "doc", content: kind ? [paragraph, {
    type: kind, attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174001", data: kind === "card" ? HNN_CARD_EMPTY_DATA : HNN_DRAWING_EMPTY_DATA }
  }] : [paragraph] } }
}
function paste(element: HTMLElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? text : "", files: [], items: [], types: ["text/plain"] } })
  fireEvent(element, event)
}
function mount(overrides: Partial<NoteDocumentProviderProps> = {}) {
  const controllerRef = createRef<NoteDocumentController>()
  const onChange = vi.fn<NoteDocumentProviderProps["onChange"]>()
  const props: NoteDocumentProviderProps = {
    documentId: "A", loadKey: 1, initialDocument: initialDocument(),
    initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
    onSave: vi.fn(async () => { await Promise.resolve() }), onChange, controllerRef,
    children: <><NoteEditorView key="a" viewId="a" /><NoteEditorView key="b" viewId="b" /></>, ...overrides
  }
  const rendered = render(<NoteDocumentProvider {...props} />)
  const controller = () => { if (!controllerRef.current) throw new Error("Controller missing"); return controllerRef.current }
  const area = (id = "a") => rendered.container.querySelector(`[data-view-id="${id}"] .tiptap`) as HTMLElement
  return { ...rendered, props, controllerRef, controller, area, onChange }
}
describe("formal root Provider/View lifecycle", () => {
  it.each([".hn-editor-callout-title", ".hn-editor-collapsible-title", ".hn-editor-picture-alt", ".hn-editor-code-filename"])("routes real NodeView control %s through peer history", (selector) => {
    const h = mount({ initialDocument: demoFixtures[0]!.document })
    const left = h.container.querySelector('[data-view-id="a"]') as HTMLElement
    const right = h.container.querySelector('[data-view-id="b"]') as HTMLElement
    const input = left.querySelector<HTMLInputElement>(selector)!
    const original = input.value
    fireEvent.change(input, { target: { value: "changed" } })
    expect(right.querySelector<HTMLInputElement>(selector)!.value).toBe("changed")
    expect(h.onChange).toHaveBeenCalledTimes(1)
    fireEvent.click(within(right).getByLabelText("撤销"))
    expect(input.value).toBe(original)
    expect(h.onChange).toHaveBeenCalledTimes(2)
  })
  it("flushes valid formula portal input before acquiring a lease and preserves undo", async () => {
    const h = mount({ initialDocument: demoFixtures[0]!.document })
    const preview = h.container.querySelector<HTMLButtonElement>(".hn-editor-formula-preview")!
    fireEvent.click(preview)
    const textarea = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-textarea")!
    fireEvent.input(textarea, { target: { value: "x+y" } })
    const c = h.controller(), expectedSessionId = c.getState().identity!.sessionId
    await act(async () => {
      const result = await c.setInputFrozen(true, { expectedSessionId, requestId: "formula" })
      expect(result).toMatchObject({ kind: "applied", action: "acquired" })
      expect(h.onChange).toHaveBeenCalledTimes(1)
      if (!("leaseId" in result)) throw new Error("missing lease")
      await c.setInputFrozen(false, { expectedSessionId, requestId: "formula", leaseId: result.leaseId })
    })
    expect(document.querySelector(".hn-editor-mini-popover")).toBeNull()
    fireEvent.click(within(h.container.querySelector('[data-view-id="b"]') as HTMLElement).getByLabelText("撤销"))
    expect(h.onChange).toHaveBeenCalledTimes(2)
  })
  it("blurs focused NodeView inputs before freezing and retains their change commit", async () => {
    const h = mount({ initialDocument: demoFixtures[0]!.document })
    const input = h.container.querySelector<HTMLInputElement>(".hn-editor-callout-title")!
    input.focus()
    input.value = "pending title"
    // jsdom does not synthesize the browser's change-on-blur event.
    input.addEventListener("blur", () => input.dispatchEvent(new Event("change", { bubbles: true })), { once: true })
    await act(async () => {
      const c = h.controller()
      expect(await c.setInputFrozen(true, { expectedSessionId: c.getState().identity!.sessionId, requestId: "nodeview" })).toMatchObject({ kind: "applied" })
    })
    expect(h.container.querySelector<HTMLInputElement>('[data-view-id="b"] .hn-editor-callout-title')!.value).toBe("pending title")
    expect(h.onChange).toHaveBeenCalledTimes(1)
    expect(document.activeElement).not.toBe(input)
  })
  it.each([".hn-editor-formula-preview", ".hn-editor-inline-formula"])("retains composing portal %s and retries the same freeze request after compositionend", async (selector) => {
    const h = mount({ initialDocument: demoFixtures[0]!.document })
    fireEvent.click(h.container.querySelector(selector)!)
    const textarea = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-textarea")!
    fireEvent.compositionStart(textarea)
    fireEvent.input(textarea, { target: { value: "x+y" }, isComposing: true })
    const c = h.controller(), expectedSessionId = c.getState().identity!.sessionId
    const acquire = () => c.setInputFrozen(true, { expectedSessionId, requestId: "portal-ime-retry" })
    await act(async () => {
      expect(await acquire()).toMatchObject({ kind: "failure", reason: "pending-edit" })
    })
    // A host freeze button can blur/dismiss the portal before calling acquire.
    fireEvent.pointerDown(document.body)
    fireEvent.blur(textarea)
    fireEvent.keyDown(textarea, { key: "Escape" })
    fireEvent.scroll(window)
    expect(textarea.isConnected).toBe(true)
    expect(textarea.value).toBe("x+y")
    expect(h.onChange).not.toHaveBeenCalled()
    expect(c.getState()).toMatchObject({ inputFrozen: false, dirty: { body: false } })
    await act(async () => {
      expect(await acquire()).toMatchObject({ kind: "failure", reason: "pending-edit" })
    })
    fireEvent.compositionEnd(textarea)
    await act(async () => {
      const result = await acquire()
      expect(result).toMatchObject({ kind: "applied", action: "acquired" })
      if (!("leaseId" in result)) throw new Error("missing lease")
      expect(h.onChange).toHaveBeenCalledTimes(1)
      expect(textarea.isConnected).toBe(false)
      expect(c.getState().inputFrozen).toBe(true)
      await c.setInputFrozen(false, { expectedSessionId, requestId: "portal-ime-retry", leaseId: result.leaseId })
    })
    fireEvent.click(within(h.container.querySelector('[data-view-id="b"]') as HTMLElement).getByLabelText("撤销"))
    expect(c.getState().dirty.body).toBe(false)
    expect(h.onChange).toHaveBeenCalledTimes(2)
  })
  it("cleans up a composing formula portal on teardown without committing incomplete input", () => {
    const h = mount({ initialDocument: demoFixtures[0]!.document })
    fireEvent.click(h.container.querySelector(".hn-editor-formula-preview")!)
    const textarea = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-textarea")!
    fireEvent.compositionStart(textarea)
    fireEvent.input(textarea, { target: { value: "incomplete" }, isComposing: true })
    h.unmount()
    expect(textarea.isConnected).toBe(false)
    expect(h.onChange).not.toHaveBeenCalled()
  })
  it("edits through native DOM in both views and reopens without losing the shared stack", async () => {
    const h = mount()
    expect(h.area()).toBeTruthy()
    const survivor = h.area("b")
    paste(h.area(), "AA")
    await waitFor(() => expect(h.area("b").textContent).toContain("AA"))
    h.rerender(<NoteDocumentProvider {...h.props}><><NoteEditorView key="b" viewId="b" /></></NoteDocumentProvider>)
    expect(h.area("b")).toBe(survivor)
    h.rerender(<NoteDocumentProvider {...h.props}><><NoteEditorView key="a" viewId="a" /><NoteEditorView key="b" viewId="b" /></></NoteDocumentProvider>)
    fireEvent.click(within(h.container.querySelector('[data-view-id="b"]') as HTMLElement).getByLabelText("撤销"))
    await waitFor(() => expect(h.area().querySelector("p")?.textContent).toBe("共享正文"))
  })
  it("ignores same-key initial props, refuses dirty replacement, and replaces only after save", async () => {
    const h = mount()
    const old = h.controller(), identity = old.getState().identity!
    h.rerender(<NoteDocumentProvider {...h.props} initialDocument={{ invalid: true }} />)
    expect(old.getState().identity).toEqual(identity)
    paste(h.area(), "dirty")
    h.rerender(<NoteDocumentProvider {...h.props} loadKey={2} />)
    expect(h.controller().getState().identity).toEqual(identity)
    await act(async () => {
      const result = old.requestSave({ expectedSessionId: identity.sessionId, reason: "host-save" })
      if (result.kind === "pending") await result.completion
    })
    h.rerender(<NoteDocumentProvider {...h.props} loadKey={2} />)
    expect(h.controller().getState().identity?.sessionId).not.toBe(identity.sessionId)
    expect(old.getState().lifecycle).toBe("disposed")
    expect(old.requestSave({ expectedSessionId: identity.sessionId, reason: "host-save" })).toMatchObject({ kind: "abort", cause: "replaced" })
  })
  it("reports strict load error without creating an editor or saveable fallback", () => {
    const onInitialLoadError = vi.fn()
    const h = mount({ initialDocument: { schemaVersion: 99 }, onInitialLoadError })
    expect(h.area()).toBeNull()
    expect(h.controller().getState()).toMatchObject({ lifecycle: "load-error", identity: null })
    expect(onInitialLoadError).toHaveBeenCalledTimes(1)
    expect(h.controller().requestSave({ reason: "host-save", expectedSessionId: "none" })).toMatchObject({ kind: "noop", cause: "not-ready" })
  })
  it.each(["acquire", "release"])("synchronous React unmount during %s notification returns abort/null", async (phase) => {
    const h = mount(), controller = h.controller(), expectedSessionId = controller.getState().identity!.sessionId
    let leaseId = ""
    if (phase === "release") {
      await act(async () => {
        const outcome = await controller.setInputFrozen(true, { expectedSessionId, requestId: "R" })
        if (!("leaseId" in outcome)) throw new Error("missing lease")
        leaseId = outcome.leaseId
      })
    }
    const unsubscribe = controller.subscribe((state) => {
      if (state.lifecycle === "ready" && state.inputFrozen === (phase === "acquire")) flushSync(() => h.unmount())
    })
    await act(async () => {
      const result = phase === "acquire"
        ? await controller.setInputFrozen(true, { expectedSessionId, requestId: "R" })
        : await controller.setInputFrozen(false, { expectedSessionId, requestId: "R", leaseId })
      expect(result).toEqual({ kind: "abort", reason: "disposed", identity: null, requestId: "R" })
    })
    unsubscribe()
  })
  it("survives React StrictMode effect replay and disposes the live controller on unmount", () => {
    const h = mount()
    h.rerender(<StrictMode><NoteDocumentProvider {...h.props} /></StrictMode>)
    const live = h.controller()
    expect(live.getState().views).toHaveLength(2)
    h.unmount()
    expect(live.getState().lifecycle).toBe("disposed")
  })
})

describe("formal card/drawing drafts", () => {
  it.each([
    ["card", "取消"], ["drawing", "取消"],
    ["card", "完成"], ["drawing", "完成"]
  ] as const)("%s %s resumes autosave of accepted body without saving discarded draft edits", async (kind, action) => {
    vi.useFakeTimers()
    const h = mount({ initialDocument: initialDocument(kind) })
    paste(h.area(), "accepted")
    const accepted = h.onChange.mock.calls[0]![0]
    fireEvent.click(within(h.container.querySelector('[data-view-id="a"]') as HTMLElement).getByLabelText(kind === "card" ? "编辑卡片" : "编辑画板"))
    const dialog = within(document.body).getByRole("dialog")
    if (kind === "card" && action === "取消") fireEvent.click(within(dialog).getByText("添加卡片"))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(h.controller().getState().save).toBe("blocked")
    expect(h.props.onSave).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByText(action))
    expect(h.controller().getState().draft.phase).toBe("none")
    await act(async () => { await vi.advanceTimersByTimeAsync(599) })
    expect(h.props.onSave).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(h.props.onSave).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ document: accepted }), expect.objectContaining({ reason: "autosave" }))
    expect(h.controller().getState().save).toBe("clean")
    expect(h.onChange).toHaveBeenCalledTimes(1)
  })
  it("retains invalid card payload and restores owner focus after cancellation", async () => {
    const h = mount({ initialDocument: initialDocument("card") })
    const anchor = within(h.container.querySelector('[data-view-id="a"]') as HTMLElement).getByLabelText("编辑卡片")
    fireEvent.click(anchor)
    const dialog = await within(document.body).findByRole("dialog")
    fireEvent.click(within(dialog).getByText("添加卡片"))
    const input = within(dialog).getByLabelText<HTMLInputElement>("卡片 card-1 标题")
    fireEvent.change(input, { target: { value: "x".repeat(40_000) } })
    fireEvent.click(within(dialog).getByText("完成"))
    expect(h.controller().getState().draft).toMatchObject({ phase: "invalid", changed: true, ownerViewId: "a" })
    expect(input.value).toHaveLength(40_000)
    expect(h.onChange).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByText("取消"))
    expect(document.activeElement).toBe(anchor)
  })
  it.each(["card", "drawing"] as const)("%s locks both body views, blocks save/detach and survives freeze", async (kind) => {
    const h = mount({ initialDocument: initialDocument(kind) })
    const c = h.controller(), expectedSessionId = c.getState().identity!.sessionId
    fireEvent.click(within(h.container.querySelector('[data-view-id="a"]') as HTMLElement).getByLabelText(kind === "card" ? "编辑卡片" : "编辑画板"))
    await waitFor(() => expect(c.getState().draft.phase).toBe("editing"))
    const dialog = within(document.body).getByRole("dialog")
    expect(c.getState().draft).toMatchObject({ kind, ownerViewId: "a", changed: false })
    expect(c.getState().draft).not.toHaveProperty("payload")
    expect(h.area().getAttribute("contenteditable")).toBe("false")
    expect(h.area("b").getAttribute("contenteditable")).toBe("false")
    expect(c.requestSave({ expectedSessionId, reason: "host-close" })).toMatchObject({ kind: "blocked", cause: "draft-open" })
    expect(c.canDetachView("a", { expectedSessionId }).kind).toBe("blocked")
    expect(c.canDetachView("b", { expectedSessionId }).kind).toBe("allowed")
    await act(async () => {
      const lease = await c.setInputFrozen(true, { expectedSessionId, requestId: "close" })
      if (!("leaseId" in lease)) throw new Error("lease missing")
      fireEvent.click(within(dialog).getByText("取消"))
      expect(c.getState().draft.phase).toBe("editing")
      await c.setInputFrozen(false, { expectedSessionId, requestId: "close", leaseId: lease.leaseId })
    })
    fireEvent.click(within(dialog).getByText("取消"))
    expect(c.getState().draft.phase).toBe("none")
    expect(h.onChange).not.toHaveBeenCalled()
    expect(h.props.onSave).not.toHaveBeenCalled()
  })
  it("commits a card once; either pane can undo its completed payload", async () => {
    const h = mount({ initialDocument: initialDocument("card") })
    fireEvent.click(within(h.container.querySelector('[data-view-id="a"]') as HTMLElement).getByLabelText("编辑卡片"))
    const dialog = await within(document.body).findByRole("dialog")
    fireEvent.click(within(dialog).getByText("添加卡片"))
    expect(h.controller().getState().draft).toMatchObject({ changed: true })
    fireEvent.click(within(dialog).getByText("完成"))
    expect(h.controller().getState().draft.phase).toBe("none")
    expect(h.onChange).toHaveBeenCalledTimes(1)
    fireEvent.click(within(h.container.querySelector('[data-view-id="b"]') as HTMLElement).getByLabelText("撤销"))
    expect(h.onChange).toHaveBeenCalledTimes(2)
  })
})
