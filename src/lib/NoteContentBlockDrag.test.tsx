/** @vitest-environment jsdom */
import { act, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { getDraggableElements } from "./blockDragDom"
import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const initialBlocks: readonly NoteBlock[] = [
  { id: "alpha", kind: "paragraph", text: "Alpha" },
  { id: "beta", kind: "paragraph", text: "Beta" },
  { id: "gamma", kind: "paragraph", text: "Gamma" }
]

const allBlockKinds: readonly NoteBlock[] = [
  { id: "heading", kind: "heading", level: 2, text: "Heading" },
  { id: "paragraph", kind: "paragraph", text: "Paragraph" },
  {
    id: "checklist",
    kind: "checklist",
    title: "Checklist",
    items: [
      { id: "checklist-item-1", checked: false, text: "First item" },
      { id: "checklist-item-2", checked: true, text: "Second item" }
    ]
  },
  { id: "quote", kind: "quote", text: "First quote line\nSecond quote line" },
  { id: "code", kind: "code", language: "text", code: "Code" },
  {
    id: "callout",
    kind: "callout",
    tone: "info",
    title: "Callout",
    text: "Details"
  },
  { id: "table", kind: "table", rows: [["Cell"]] },
  { id: "formula", kind: "formula", formula: "x^2" },
  {
    id: "picture",
    kind: "picture",
    url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    filename: "Picture"
  }
]

const setBlockRects = (container: HTMLElement): HTMLElement[] => {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
  )
  elements.forEach((element, index) => {
    const top = index * 60
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      bottom: top + 40,
      height: 40,
      left: 0,
      right: 400,
      top,
      width: 400,
      x: 0,
      y: top,
      toJSON: () => ({})
    })
  })
  return elements
}

const ControlledNote = () => {
  const [blocks, setBlocks] = useState(initialBlocks)
  return (
    <NoteContent
      blocks={blocks}
      title="Block drag"
      editable
      onBlocksChange={setBlocks}
    />
  )
}

describe("NoteContent block dragging", () => {
  it("ignores drag attributes injected inside rich text", () => {
    // Given: a paragraph containing renderer-reserved drag attributes.
    const view = render(
      <NoteContent
        blocks={[
          {
            id: "safe-block",
            kind: "paragraph",
            text: '<span data-note-drag-kind="block">Injected</span>'
          }
        ]}
        title="Block drag"
        editable
        onBlocksChange={vi.fn()}
      />
    )
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")
    if (!body) throw new Error("Expected note body.")

    // When: draggable renderer boundaries are discovered.
    const draggableElements = getDraggableElements(body)

    // Then: only the direct renderer-owned block is returned.
    expect(draggableElements).toHaveLength(1)
    expect(draggableElements[0]?.getAttribute("data-note-sortable-id")).toBe(
      "safe-block"
    )
  })

  it("renders checklist items as direct body-level sortable siblings", () => {
    // Given: an editable note containing every supported block kind.
    const view = render(
      <NoteContent
        blocks={allBlockKinds}
        title="Flat blocks"
        editable
        onBlocksChange={vi.fn()}
      />
    )

    // When: the direct children of the note body are inspected.
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")
    if (!body) throw new Error("Expected note body.")
    const blocks = Array.from(body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement
    )

    // Then: checklist rows sit beside heading/table and retain their semantic class.
    const firstItem = blocks.find((block) => block.id === "checklist-item-1")
    const secondItem = blocks.find((block) => block.id === "checklist-item-2")
    expect(firstItem?.parentElement).toBe(body)
    expect(secondItem?.parentElement).toBe(body)
    expect(firstItem?.classList.contains("hn-note-block")).toBe(true)
    expect(firstItem?.classList.contains("hn-note-checklist-item")).toBe(true)
    expect(
      firstItem?.querySelector(
        ":scope > .hn-note-checklist-content.hn-note-checklist-item"
      )
    ).not.toBeNull()
    expect(secondItem?.classList.contains("hn-note-block")).toBe(true)
    expect(secondItem?.classList.contains("hn-note-checklist-item")).toBe(true)
    expect(
      secondItem?.querySelector(
        ":scope > .hn-note-checklist-content.hn-note-checklist-item"
      )
    ).not.toBeNull()
    expect(blocks.some((block) => block.id === "checklist")).toBe(false)
    expect(view.container.querySelector(".hn-note-checklist")).toBeNull()
    expect(
      view.container.querySelector(
        ".hn-note-paragraph, .hn-note-block-row, .hn-note-block-content"
      )
    ).toBeNull()
  })

  it("renders every quote line as its own body-level sortable block", () => {
    // Given: an editable note containing a two-line quote.
    const view = render(
      <NoteContent
        blocks={allBlockKinds}
        title="Flat quote lines"
        editable
        onBlocksChange={vi.fn()}
      />
    )

    // When: quote line wrappers are inspected from the note body.
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")
    if (!body) throw new Error("Expected note body.")
    const quoteLines = Array.from(
      body.querySelectorAll<HTMLElement>(
        ":scope > .hn-note-block.hn-note-quote-line"
      )
    )

    // Then: no sortable wrapper owns more than one quote line.
    expect(quoteLines).toHaveLength(2)
    expect(
      quoteLines.map((element) =>
        element.getAttribute("data-note-sortable-id")
      )
    ).toEqual(["quote", "quote-line-1"])
    for (const quoteLine of quoteLines) {
      expect(quoteLine.parentElement).toBe(body)
      expect(quoteLine.classList.contains("hn-note-quote-line")).toBe(true)
      expect(
        quoteLine.querySelector(
          ":scope > .hn-note-quote-content.hn-note-quote.hn-note-quote-line"
        )
      ).not.toBeNull()
    }
  })

  it("previews and commits a desktop drag from the block handle", () => {
    // Given: an editable controlled note with measured block boundaries.
    const view = render(<ControlledNote />)
    const elements = setBlockRects(view.container)
    const handle = view.container.querySelector<HTMLElement>(
      '[data-block-id="alpha"][data-block-menu-mode="convert"]'
    )
    if (!handle) throw new Error("Expected alpha drag handle.")

    // When: the pointer drags the handle below the final block midpoint.
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 1,
      pointerType: "mouse"
    })
    fireEvent.pointerMove(document, {
      clientX: 20,
      clientY: 155,
      pointerId: 1,
      pointerType: "mouse"
    })

    // Then: the source remains mounted while the final boundary is previewed.
    expect(elements[0]?.isConnected).toBe(true)
    expect(elements[2]?.classList.contains("hn-note-block-drop-after")).toBe(
      true
    )

    // When: the pointer is released.
    fireEvent.pointerUp(document, {
      clientX: 20,
      clientY: 155,
      pointerId: 1,
      pointerType: "mouse"
    })

    // Then: the controlled blocks reorder only after release.
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
      ).map((element) => element.getAttribute("data-note-sortable-id"))
    ).toEqual(["beta", "gamma", "alpha"])
  })

  it("starts touch dragging only after a long press on a block", async () => {
    vi.useFakeTimers()
    try {
      // Given: a compact viewport where handles are hidden.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 390
      })
      const view = render(<ControlledNote />)
      const elements = setBlockRects(view.container)
      const source = elements[0]
      if (!source) throw new Error("Expected alpha sortable block.")

      // When: a touch remains still until the hold delay completes.
      fireEvent.pointerDown(source, {
        clientX: 20,
        clientY: 20,
        pointerId: 7,
        pointerType: "touch"
      })
      await act(() => vi.advanceTimersByTime(499))
      expect(elements[2]?.classList.contains("hn-note-block-drop-after")).toBe(
        false
      )

      // When: the hold delay completes and the touch then moves over the final boundary.
      await act(() => vi.advanceTimersByTime(1))
      fireEvent.pointerMove(document, {
        clientX: 20,
        clientY: 155,
        pointerId: 7,
        pointerType: "touch"
      })

      // Then: the same insertion preview appears and release commits the move.
      expect(elements[2]?.classList.contains("hn-note-block-drop-after")).toBe(
        true
      )
      fireEvent.pointerUp(document, {
        clientX: 20,
        clientY: 155,
        pointerId: 7,
        pointerType: "touch"
      })
      expect(
        Array.from(
          view.container.querySelectorAll<HTMLElement>(
            "[data-note-sortable-id]"
          )
        ).map((element) => element.getAttribute("data-note-sortable-id"))
      ).toEqual(["beta", "gamma", "alpha"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("ignores touch drag metadata injected inside rich text", async () => {
    vi.useFakeTimers()
    try {
      // Given: rich text that impersonates a persisted checklist item on mobile.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 390
      })
      const onBlocksChange = vi.fn()
      const view = render(
        <NoteContent
          blocks={[
            {
              id: "tasks",
              kind: "checklist",
              title: "Tasks",
              items: [{ id: "task-1", checked: false, text: "Real task" }]
            },
            {
              id: "paragraph",
              kind: "paragraph",
              text: '<span id="task-1" data-note-drag-kind="checklist-item" data-note-drag-parent-id="tasks">Injected</span>'
            }
          ]}
          title="Touch drag trust boundary"
          editable
          onBlocksChange={onBlocksChange}
        />
      )
      setBlockRects(view.container)
      const body = view.container.querySelector<HTMLElement>(".hn-note-body")
      if (!body) throw new Error("Expected note body.")
      const injected = Array.from(
        view.container.querySelectorAll<HTMLElement>(
          '[data-note-drag-kind="checklist-item"]'
        )
      ).find((element) => element.parentElement !== body)
      if (!injected) throw new Error("Expected injected drag metadata.")

      // When: the injected descendant is long-pressed and moved across a boundary.
      fireEvent.pointerDown(injected, {
        clientX: 20,
        clientY: 80,
        pointerId: 11,
        pointerType: "touch"
      })
      await act(() => vi.advanceTimersByTime(500))
      fireEvent.pointerMove(document, {
        clientX: 20,
        clientY: 180,
        pointerId: 11,
        pointerType: "touch"
      })
      fireEvent.pointerUp(document, {
        clientX: 20,
        clientY: 180,
        pointerId: 11,
        pointerType: "touch"
      })

      // Then: only renderer-owned direct body children can start touch dragging.
      expect(onBlocksChange).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("prevents native touch panning only after the long press activates", async () => {
    vi.useFakeTimers()
    try {
      // Given: a touch is pending on a sortable block.
      const view = render(<ControlledNote />)
      const source = setBlockRects(view.container)[0]
      if (!source) throw new Error("Expected alpha sortable block.")
      fireEvent.pointerDown(source, {
        clientX: 20,
        clientY: 20,
        pointerId: 8,
        pointerType: "touch"
      })

      // When: native touch movement occurs before and after activation.
      const pendingMove = new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true
      })
      document.dispatchEvent(pendingMove)
      await act(() => vi.advanceTimersByTime(500))
      const activeMove = new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true
      })
      document.dispatchEvent(activeMove)

      // Then: scrolling remains available before activation and is claimed afterward.
      expect(pendingMove.defaultPrevented).toBe(false)
      expect(activeMove.defaultPrevented).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("clears text selections created after touch dragging activates", async () => {
    vi.useFakeTimers()
    try {
      // Given: an active compact-screen drag and a browser-created text selection.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 390
      })
      const view = render(<ControlledNote />)
      const source = setBlockRects(view.container)[0]
      const text = source?.querySelector("[data-editable-block-id]")?.firstChild
      if (!source || !text) throw new Error("Expected selectable source text.")
      fireEvent.pointerDown(source, {
        clientX: 20,
        clientY: 20,
        pointerId: 10,
        pointerType: "touch"
      })
      await act(() => vi.advanceTimersByTime(500))
      const range = document.createRange()
      Object.defineProperty(range, "getBoundingClientRect", {
        configurable: true,
        value: () => source.getBoundingClientRect()
      })
      range.selectNodeContents(text)
      const selection = window.getSelection()
      selection?.addRange(range)

      // When: the browser reports that selection during the active drag.
      document.dispatchEvent(new Event("selectionchange"))

      // Then: the drag owns the gesture and removes the native text selection.
      expect(selection?.rangeCount).toBe(0)
    } finally {
      window.getSelection()?.removeAllRanges()
      vi.useRealTimers()
    }
  })

  it("preserves touch scrolling when the pointer moves before the hold delay", async () => {
    vi.useFakeTimers()
    try {
      // Given: a touch has started on a sortable block.
      const view = render(<ControlledNote />)
      const elements = setBlockRects(view.container)
      const source = elements[0]
      if (!source) throw new Error("Expected alpha sortable block.")
      fireEvent.pointerDown(source, {
        clientX: 20,
        clientY: 20,
        pointerId: 9,
        pointerType: "touch"
      })

      // When: the pointer travels beyond the hold tolerance before 500ms.
      fireEvent.pointerMove(document, {
        clientX: 20,
        clientY: 40,
        pointerId: 9,
        pointerType: "touch"
      })
      await act(() => vi.advanceTimersByTime(500))
      fireEvent.pointerMove(document, {
        clientX: 20,
        clientY: 155,
        pointerId: 9,
        pointerType: "touch"
      })
      fireEvent.pointerUp(document, {
        clientX: 20,
        clientY: 155,
        pointerId: 9,
        pointerType: "touch"
      })

      // Then: no preview or reorder is produced by a scrolling gesture.
      expect(elements[2]?.classList.contains("hn-note-block-drop-after")).toBe(
        false
      )
      expect(
        Array.from(
          view.container.querySelectorAll<HTMLElement>(
            "[data-note-sortable-id]"
          )
        ).map((element) => element.getAttribute("data-note-sortable-id"))
      ).toEqual(["alpha", "beta", "gamma"])
    } finally {
      vi.useRealTimers()
    }
  })
})
