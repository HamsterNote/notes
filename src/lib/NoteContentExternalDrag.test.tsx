/** @vitest-environment jsdom */

import { Drag } from "@system-ui-js/multi-drag"
import { act, fireEvent, render } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type {
  ExternalNoteDragInput,
  ExternalNoteDragStartResult
} from "./externalNoteDrag"
import type { NoteBlock, NoteContentHandle } from "./types"

type ExternalDragTestHandle = NoteContentHandle & {
  readonly startExternalDrag: (
    input: ExternalNoteDragInput
  ) => ExternalNoteDragStartResult
}

const setRect = (
  element: Element,
  rect: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
): void => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect
  })
}

describe("NoteContent external drag", () => {
  it("previews and inserts a multiline item at the released boundary", async () => {
    // Given: an editable note and one active host-owned Drag.
    const noteRef = createRef<ExternalDragTestHandle>()
    const onBlocksChange = vi.fn<(blocks: NoteBlock[]) => void>()
    const { container } = render(
      <NoteContent
        ref={noteRef}
        editable
        title="External drag"
        blocks={[
          { id: "first", kind: "paragraph", text: "First" },
          { id: "second", kind: "paragraph", text: "Second" }
        ]}
        onBlocksChange={onBlocksChange}
      />
    )
    const body = container.querySelector<HTMLElement>(".hn-note-body")
    const first = container.querySelector<HTMLElement>("[data-note-block-id='first']")
    const second = container.querySelector<HTMLElement>("[data-note-block-id='second']")
    if (!body || !first || !second) throw new Error("Expected rendered note boundaries")
    setRect(body, { left: 0, right: 400, top: 0, bottom: 300 })
    setRect(first, { left: 0, right: 400, top: 20, bottom: 80 })
    setRect(second, { left: 0, right: 400, top: 100, bottom: 160 })

    const source = document.createElement("div")
    document.body.append(source)
    const drag = new Drag(source, { setPose: () => {} })
    source.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 10,
        pointerId: 71
      })
    )
    const startResult = noteRef.current?.startExternalDrag({
      drag,
      pointerId: 71,
      item: {
        id: "host-item",
        content: "Line one\nLine two",
        clickable: true
      }
    })
    if (!startResult?.ok) throw new Error("Expected external drag to start")

    // When: the host pointer moves above the second block midpoint and releases.
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 20,
          clientY: 110,
          pointerId: 71
        })
      )
    })

    // Then: the shared handle-drag insertion line marks that exact boundary.
    expect(second.classList.contains("hn-note-external-drop-before")).toBe(true)

    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 20,
          clientY: 110,
          pointerId: 71
        })
      )
    })
    const completion = await startResult.session.completion
    expect(completion.status).toBe("placed")
    expect(onBlocksChange).toHaveBeenCalledOnce()
    const nextBlocks = onBlocksChange.mock.calls[0]?.[0]
    expect(nextBlocks?.map((block) => block.id)).toEqual([
      "first",
      completion.status === "placed" ? completion.block.id : "",
      "second"
    ])
    expect(completion.status === "placed" ? completion.block : null).toMatchObject({
      kind: "paragraph",
      text: "Line one<br>Line two",
      externalItem: { id: "host-item", content: "Line one\nLine two", clickable: true }
    })
    expect(second.classList.contains("hn-note-external-drop-before")).toBe(false)

    drag.destroy()
    source.remove()
  })

  it("rejects a second session while one external drag is active", () => {
    // Given: one external drag session already owns the note preview.
    const noteRef = createRef<ExternalDragTestHandle>()
    render(
      <NoteContent
        ref={noteRef}
        editable
        title="External drag"
        blocks={[]}
        onBlocksChange={() => {}}
      />
    )
    const firstSource = document.createElement("div")
    const secondSource = document.createElement("div")
    document.body.append(firstSource, secondSource)
    const firstDrag = new Drag(firstSource, { setPose: () => {} })
    const secondDrag = new Drag(secondSource, { setPose: () => {} })
    for (const [source, pointerId] of [
      [firstSource, 81],
      [secondSource, 82]
    ] as const) {
      source.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId })
      )
    }
    const item = { id: "host-item", content: "Text", clickable: false }
    const first = noteRef.current?.startExternalDrag({
      drag: firstDrag,
      item,
      pointerId: 81
    })
    if (!first?.ok) throw new Error("Expected first external drag to start")

    // When: another host Drag tries to start before the first one settles.
    const second = noteRef.current?.startExternalDrag({
      drag: secondDrag,
      item,
      pointerId: 82
    })

    // Then: one session exclusively owns the insertion preview.
    expect(second).toEqual({ ok: false, reason: "drag-already-active" })
    first.session.cancel()
    firstDrag.destroy()
    secondDrag.destroy()
    firstSource.remove()
    secondSource.remove()
  })

  it("rejects completion when the controlled commit fails", async () => {
    // Given: a valid drop target whose controlled host rejects the update.
    const noteRef = createRef<ExternalDragTestHandle>()
    const commitError = new Error("Host commit failed")
    const { container } = render(
      <NoteContent
        ref={noteRef}
        editable
        title="External drag"
        blocks={[]}
        onBlocksChange={() => {
          throw commitError
        }}
      />
    )
    const body = container.querySelector<HTMLElement>(".hn-note-body")
    const tail = container.querySelector<HTMLElement>(".hn-note-body-tail")
    if (!body || !tail) throw new Error("Expected empty note drop boundary")
    setRect(body, { left: 0, right: 400, top: 0, bottom: 300 })
    setRect(tail, { left: 0, right: 400, top: 20, bottom: 60 })
    const source = document.createElement("div")
    document.body.append(source)
    const drag = new Drag(source, { setPose: () => {} })
    source.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 91 })
    )
    const result = noteRef.current?.startExternalDrag({
      drag,
      item: { id: "host-item", content: "Text", clickable: false },
      pointerId: 91
    })
    if (!result?.ok) throw new Error("Expected external drag to start")

    // When: the pointer releases inside the empty note.
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 20,
          clientY: 30,
          pointerId: 91
        })
      )
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 20,
          clientY: 30,
          pointerId: 91
        })
      )
    })

    // Then: completion exposes the host failure instead of reporting placement.
    await expect(result.session.completion).rejects.toBe(commitError)
    expect(tail.classList.contains("hn-note-external-drop-before")).toBe(false)
    drag.destroy()
    source.remove()
  })

  it("emits the external item for pointer and keyboard activation", () => {
    // Given: a clickable host item rendered inside an editable note.
    const onExternalItemClick = vi.fn()
    const item = {
      id: "linked-item",
      content: "Open linked item",
      clickable: true
    } as const
    const { getByRole } = render(
      <NoteContent
        editable
        title="External link"
        blocks={[
          {
            id: "external-block",
            kind: "paragraph",
            text: item.content,
            externalItem: item
          }
        ]}
        onBlocksChange={() => {}}
        onExternalItemClick={onExternalItemClick}
      />
    )
    const link = getByRole("link", { name: item.content })

    // When: the item is clicked and then activated from the keyboard.
    fireEvent.click(link)
    fireEvent.keyDown(link, { key: "Enter" })
    fireEvent.keyDown(link, { key: " " })

    // Then: each activation emits the owned item snapshot without editing it.
    expect(onExternalItemClick).toHaveBeenCalledTimes(2)
    expect(onExternalItemClick).toHaveBeenNthCalledWith(1, item)
    expect(onExternalItemClick).toHaveBeenNthCalledWith(2, item)
    expect(link.getAttribute("contenteditable")).toBeNull()
  })
})
