/** @vitest-environment jsdom */
import { act, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const setRect = (element: HTMLElement, top: number, height: number): void => {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom: top + height,
    height,
    left: 0,
    right: 400,
    top,
    width: 400,
    x: 0,
    y: top,
    toJSON: () => ({})
  })
}

const requiredElement = <ElementType extends Element>(
  elements: readonly ElementType[],
  index: number
): ElementType => {
  const element = elements[index]
  if (!element) throw new Error(`Expected element at index ${index}.`)
  return element
}

const sortableIds = (container: HTMLElement): (string | null)[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
  ).map((element) => element.getAttribute("data-note-sortable-id"))

const dragMouse = (
  handle: Element,
  startY: number,
  destinationY: number
): void => {
  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 20,
    clientY: startY,
    pointerId: 1,
    pointerType: "mouse"
  })
  fireEvent.pointerMove(document, {
    clientX: 20,
    clientY: destinationY,
    pointerId: 1,
    pointerType: "mouse"
  })
  fireEvent.pointerUp(document, {
    clientX: 20,
    clientY: destinationY,
    pointerId: 1,
    pointerType: "mouse"
  })
}

const ControlledNote = ({ initialBlocks }: { initialBlocks: readonly NoteBlock[] }) => {
  const [blocks, setBlocks] = useState(initialBlocks)
  return (
    <NoteContent
      blocks={blocks}
      title="Reviewer regressions"
      editable
      onBlocksChange={setBlocks}
    />
  )
}

describe("NoteContent reviewed drag boundaries", () => {
  it("extracts the first quote line before a surviving first parent", () => {
    // Given: the first body block is a quote that keeps one line after extraction.
    const view = render(
      <ControlledNote
        initialBlocks={[
          { id: "quote", kind: "quote", text: "First\nSecond" },
          { id: "tail", kind: "paragraph", text: "Tail" }
        ]}
      />
    )
    const sortables = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
    )
    const handle = view.container.querySelector(
      '[data-block-id="quote"][data-block-menu-mode="convert"]'
    )
    if (!handle) throw new Error("Expected the first quote-line handle.")
    setRect(requiredElement(sortables, 0), 20, 40)
    setRect(requiredElement(sortables, 1), 60, 40)
    setRect(requiredElement(sortables, 2), 120, 40)

    // When: the first line crosses above the document's first parent block.
    dragMouse(handle, 40, 10)

    // Then: the extracted quote line precedes the surviving quote parent.
    expect(sortableIds(view.container)).toEqual([
      "quote",
      expect.any(String),
      "tail"
    ])
    const extractedQuoteLine = view.container.querySelector<HTMLElement>(
      '.hn-note-body > [data-note-drag-kind="quote-line"]'
    )
    expect(extractedQuoteLine?.textContent).toContain("First")
    expect(extractedQuoteLine?.classList.contains("hn-note-quote-line")).toBe(
      true
    )
    expect(extractedQuoteLine?.getAttribute("data-note-drag-kind")).toBe(
      "quote-line"
    )
    expect(
      Array.from(view.container.querySelectorAll(".hn-note-quote-line p")).map(
        (line) => line.textContent
      )
    ).toEqual(["First", "Second"])
  })

  it("extracts the last checklist item after a surviving last parent", () => {
    // Given: the final body block is a checklist with two items.
    const view = render(
      <ControlledNote
        initialBlocks={[
          { id: "intro", kind: "paragraph", text: "Intro" },
          {
            id: "list",
            kind: "checklist",
            title: "List",
            items: [
              { id: "first", checked: false, text: "First" },
              { id: "last", checked: true, text: "Last" }
            ]
          }
        ]}
      />
    )
    const sortables = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
    )
    const handle = view.container.querySelector(
      '[data-block-id="last"][data-block-menu-mode="convert"]'
    )
    if (!handle) throw new Error("Expected the last checklist-item handle.")
    setRect(requiredElement(sortables, 0), 0, 40)
    setRect(requiredElement(sortables, 1), 60, 40)
    setRect(requiredElement(sortables, 2), 100, 40)

    // When: the last item crosses below the document's final parent block.
    dragMouse(handle, 120, 150)

    // Then: the surviving checklist remains before the extracted checklist item.
    expect(sortableIds(view.container)).toEqual(["intro", "first", "last"])
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLElement>(
          '.hn-note-body > [data-note-drag-kind="checklist-item"]'
        )
      ).map((item) => item.id)
    ).toEqual(["first", "last"])
    const extractedChecklistItem = view.container.querySelector<HTMLElement>(
      '[data-note-sortable-id="last"]'
    )
    expect(extractedChecklistItem?.classList.contains("hn-note-checklist-item")).toBe(
      true
    )
    expect(extractedChecklistItem?.getAttribute("data-note-drag-kind")).toBe(
      "checklist-item"
    )
  })

  it("cancels an active quote drag when equal-line-count text replaces it", () => {
    // Given: a quote drag is active while its controlled text can be replaced.
    const UpdatingNote = () => {
      const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
        { id: "quote", kind: "quote", text: "First\nSecond" },
        { id: "tail", kind: "paragraph", text: "Tail" }
      ])
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setBlocks([
                { id: "quote", kind: "quote", text: "Updated A\nUpdated B" },
                { id: "tail", kind: "paragraph", text: "Tail" }
              ])
            }
          >
            Replace quote
          </button>
          <NoteContent
            title="Quote update drag"
            blocks={blocks}
            editable
            onBlocksChange={setBlocks}
          />
        </>
      )
    }
    const view = render(<UpdatingNote />)
    const sortables = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
    )
    const handle = view.container.querySelector(
      '[data-block-id="quote"][data-block-menu-mode="convert"]'
    )
    if (!handle) throw new Error("Expected the first quote-line handle.")
    setRect(requiredElement(sortables, 0), 0, 40)
    setRect(requiredElement(sortables, 1), 40, 40)
    setRect(requiredElement(sortables, 2), 100, 40)

    // When: content changes after drag activation but before pointer release.
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 1,
      pointerType: "mouse"
    })
    fireEvent.pointerMove(document, {
      clientX: 20,
      clientY: 130,
      pointerId: 1,
      pointerType: "mouse"
    })
    fireEvent.click(view.getByRole("button", { name: "Replace quote" }))
    fireEvent.pointerUp(document, {
      clientX: 20,
      clientY: 130,
      pointerId: 1,
      pointerType: "mouse"
    })

    // Then: the replacement remains intact and no stale line is extracted.
    expect(sortableIds(view.container)).toEqual([
      "quote",
      "quote-line-1",
      "tail"
    ])
    expect(
      Array.from(view.container.querySelectorAll(".hn-note-quote-line p")).map(
        (line) => line.textContent
      )
    ).toEqual(["Updated A", "Updated B"])
  })

  it("keeps the first active touch pointer in control", async () => {
    vi.useFakeTimers()
    try {
      // Given: a compact note where the first touch has completed its long press.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 390
      })
      const view = render(
        <ControlledNote
          initialBlocks={[
            { id: "alpha", kind: "paragraph", text: "Alpha" },
            { id: "beta", kind: "paragraph", text: "Beta" }
          ]}
        />
      )
      const sortables = Array.from(
        view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
      )
      setRect(requiredElement(sortables, 0), 0, 40)
      setRect(requiredElement(sortables, 1), 60, 40)
      fireEvent.pointerDown(requiredElement(sortables, 0), {
        clientX: 20,
        clientY: 20,
        pointerId: 7,
        pointerType: "touch"
      })
      await act(() => vi.advanceTimersByTime(500))

      // When: a second touch long-presses before the first touch completes its move.
      fireEvent.pointerDown(requiredElement(sortables, 1), {
        clientX: 20,
        clientY: 80,
        pointerId: 8,
        pointerType: "touch"
      })
      await act(() => vi.advanceTimersByTime(500))
      fireEvent.pointerMove(document, {
        clientX: 20,
        clientY: 95,
        pointerId: 7,
        pointerType: "touch"
      })
      fireEvent.pointerUp(document, {
        clientX: 20,
        clientY: 95,
        pointerId: 7,
        pointerType: "touch"
      })

      // Then: the first pointer commits and the second never takes ownership.
      expect(sortableIds(view.container)).toEqual(["beta", "alpha"])
      expect(view.container.querySelectorAll(".hn-note-sortable-block--dragging")).toHaveLength(
        0
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
