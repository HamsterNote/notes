/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const selectableBlocks: readonly NoteBlock[] = [
  { id: "intro", kind: "paragraph", text: "Introduction" },
  {
    id: "tasks",
    kind: "checklist",
    title: "Tasks",
    items: [
      { id: "task-1", checked: false, text: "First task" },
      { id: "task-2", checked: true, text: "Second task" }
    ]
  },
  {
    id: "quote",
    kind: "quote",
    text: "Line A\nLine B",
    author: "Author"
  }
]

describe("NoteContent select mode", () => {
  it("keeps every block read-only when editable is also enabled", () => {
    // Given: a note whose editing and selection props are both enabled.
    const view = render(
      <NoteContent
        blocks={selectableBlocks}
        title="Selectable note"
        editable
        selectMode
      />
    )

    // Then: selection mode wins and no editing surface is mounted.
    expect(view.container.querySelector("[contenteditable=true]")).toBeNull()
    expect(view.container.querySelector(".hn-note-block-handle")).toBeNull()
    expect(view.container.querySelector(".hn-note-body-tail")).toBeNull()
  })

  it("selects the individual checklist item when nested content is clicked", () => {
    // Given: a selectable note and a callback owned by the host.
    const onBlockSelect = vi.fn()
    const view = render(
      <NoteContent
        blocks={selectableBlocks}
        title="Selectable note"
        selectMode
        onBlockSelect={onBlockSelect}
      />
    )
    const checklistItem = Array.from(view.container.querySelectorAll("span")).find(
      (element) => element.textContent === "First task"
    )
    if (!checklistItem) throw new Error("Expected checklist item.")

    // When: content nested inside a checklist item is clicked.
    fireEvent.click(checklistItem)

    // Then: the host receives the item id (not the block id) and the item boundary is highlighted.
    const itemBoundary = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="task-1"]'
    )
    expect(onBlockSelect).toHaveBeenCalledOnce()
    expect(onBlockSelect).toHaveBeenCalledWith("task-1")
    expect(itemBoundary?.getAttribute("aria-selected")).toBe("true")
  })

  it("selects the second checklist item independently from the first", () => {
    // Given: a selectable checklist with two items.
    const onBlockSelect = vi.fn()
    const view = render(
      <NoteContent
        blocks={selectableBlocks}
        title="Selectable note"
        selectMode
        onBlockSelect={onBlockSelect}
      />
    )

    const firstItem = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="task-1"]'
    )
    const secondItem = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="task-2"]'
    )
    if (!firstItem || !secondItem) {
      throw new Error("Expected two selectable checklist items.")
    }

    // When: selection moves from the first item to the second.
    fireEvent.click(firstItem)
    fireEvent.click(secondItem)

    // Then: only the latest item remains selected.
    expect(firstItem.getAttribute("aria-selected")).toBe("false")
    expect(secondItem.getAttribute("aria-selected")).toBe("true")
    expect(onBlockSelect).toHaveBeenLastCalledWith("task-2")
  })

  it("moves the highlight between a paragraph and a checklist item", () => {
    // Given: a paragraph block and a checklist block.
    const view = render(
      <NoteContent blocks={selectableBlocks} title="Selectable note" selectMode />
    )
    const paragraph = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="intro"]'
    )
    const checklistItem = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="task-1"]'
    )
    if (!paragraph || !checklistItem) {
      throw new Error("Expected selectable boundaries.")
    }

    // When: selection moves from the paragraph to a checklist item.
    fireEvent.click(paragraph)
    fireEvent.click(checklistItem)

    // Then: only the latest target remains selected.
    expect(paragraph.getAttribute("aria-selected")).toBe("false")
    expect(checklistItem.getAttribute("aria-selected")).toBe("true")
  })

  it("selects individual quote lines independently", () => {
    // Given: a quote block with two lines ("Line A\nLine B").
    const onBlockSelect = vi.fn()
    const view = render(
      <NoteContent
        blocks={selectableBlocks}
        title="Selectable note"
        selectMode
        onBlockSelect={onBlockSelect}
      />
    )
    // quoteLineId("quote", 0) === "quote", quoteLineId("quote", 1) === "quote-line-1"
    const firstLine = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="quote"]'
    )
    const secondLine = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="quote-line-1"]'
    )
    if (!firstLine || !secondLine) {
      throw new Error("Expected two selectable quote lines.")
    }

    // When: selection moves from the first line to the second.
    fireEvent.click(firstLine)
    fireEvent.click(secondLine)

    // Then: only the second line remains selected, and the host receives the line id.
    expect(firstLine.getAttribute("aria-selected")).toBe("false")
    expect(secondLine.getAttribute("aria-selected")).toBe("true")
    expect(onBlockSelect).toHaveBeenLastCalledWith("quote-line-1")
  })

  it("moves the highlight from a checklist item to a quote line", () => {
    // Given: a checklist item and a quote line.
    const view = render(
      <NoteContent blocks={selectableBlocks} title="Selectable note" selectMode />
    )
    const checklistItem = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="task-2"]'
    )
    const quoteLine = view.container.querySelector<HTMLElement>(
      '[data-note-select-id="quote"]'
    )
    if (!checklistItem || !quoteLine) {
      throw new Error("Expected selectable boundaries.")
    }

    // When: selection moves from the checklist item to the first quote line.
    fireEvent.click(checklistItem)
    fireEvent.click(quoteLine)

    // Then: only the quote line remains selected.
    expect(checklistItem.getAttribute("aria-selected")).toBe("false")
    expect(quoteLine.getAttribute("aria-selected")).toBe("true")
  })

  it("ignores selection attributes injected inside rich text", () => {
    // Given: rich text containing an attribute reserved for renderer boundaries.
    const onBlockSelect = vi.fn()
    const blocks: readonly NoteBlock[] = [
      {
        id: "safe-block",
        kind: "paragraph",
        text: '<span data-note-select-id="spoofed">Injected</span>'
      }
    ]
    const view = render(
      <NoteContent
        blocks={blocks}
        title="Selectable note"
        selectMode
        onBlockSelect={onBlockSelect}
      />
    )
    const injected = view.container.querySelector("[data-note-select-id=spoofed]")
    if (!injected) throw new Error("Expected injected rich-text element.")

    // When: the injected descendant is clicked.
    fireEvent.click(injected)

    // Then: selection resolves to the renderer-owned paragraph boundary.
    expect(onBlockSelect).toHaveBeenCalledOnce()
    expect(onBlockSelect).toHaveBeenCalledWith("safe-block")
  })
})
