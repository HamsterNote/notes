/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { getBlockBoundaryTarget } from "./blockDragDom"
import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

type Rect = Readonly<{ height: number; top: number }>

const setRect = (element: HTMLElement, { height, top }: Rect): void => {
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

const sortableIds = (container: HTMLElement): (string | null)[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
  ).map((element) => element.getAttribute("data-note-sortable-id"))

const requiredElement = (
  elements: readonly HTMLElement[],
  index: number
): HTMLElement => {
  const element = elements[index]
  if (!element) {
    throw new Error(`Expected element at index ${index}.`)
  }
  return element
}

const ControlledNote = ({ initialBlocks }: { initialBlocks: readonly NoteBlock[] }) => {
  const [blocks, setBlocks] = useState(initialBlocks)
  return (
    <NoteContent
      blocks={blocks}
      title="Cross-boundary drag"
      editable
      onBlocksChange={setBlocks}
    />
  )
}

describe("NoteContent cross-boundary block dragging", () => {
  it("uses every direct todo item when resolving a persisted target", () => {
    // Given: a two-item target todo followed by a separate source todo.
    const body = document.createElement("div")
    const targetFirst = document.createElement("div")
    const targetSecond = document.createElement("div")
    const source = document.createElement("div")
    for (const [element, itemId, blockId] of [
      [targetFirst, "target-first", "target-list"],
      [targetSecond, "target-second", "target-list"],
      [source, "source-item", "source-list"]
    ] as const) {
      element.id = itemId
      element.setAttribute("data-note-sortable-id", itemId)
      element.setAttribute("data-note-block-id", blockId)
      element.setAttribute("data-note-drag-kind", "todo-item")
      element.setAttribute("data-note-drag-parent-id", blockId)
      body.append(element)
    }
    setRect(targetFirst, { top: 60, height: 40 })
    setRect(targetSecond, { top: 110, height: 40 })
    setRect(source, { top: 200, height: 40 })

    // When: the source is dragged over the second half of the target todo.
    const target = getBlockBoundaryTarget(body, source, 130)

    // Then: the destination is after the whole target todo, at its last item.
    expect(target?.destination).toEqual({
      placement: "after",
      targetBlockId: "target-list"
    })
    expect(target?.element).toBe(targetSecond)
  })

  it("extracts a quote line after an external block", () => {
    // Given: the second line of a quote sits between two body-level paragraphs.
    const view = render(
      <ControlledNote
        initialBlocks={[
          { id: "intro", kind: "paragraph", text: "Intro" },
          { id: "quote", kind: "quote", text: "First\nSecond" },
          { id: "tail", kind: "paragraph", text: "Tail" }
        ]}
      />
    )
    const sortables = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
    )
    const quoteLines = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        ".hn-note-body > .hn-note-quote-line"
      )
    )
    const handle = view.container.querySelector(
      '[data-block-id="quote-line-1"][data-block-menu-mode="convert"]'
    )
    if (!handle || sortables.length !== 4 || quoteLines.length !== 2) {
      throw new Error("Expected body blocks and the second quote-line handle.")
    }
    setRect(requiredElement(sortables, 0), { top: 0, height: 40 })
    setRect(requiredElement(sortables, 1), { top: 60, height: 40 })
    setRect(requiredElement(sortables, 2), { top: 100, height: 40 })
    setRect(requiredElement(sortables, 3), { top: 160, height: 40 })

    // When: the nested line is dragged below the trailing paragraph.
    dragMouse(handle, 110, 190)

    // Then: it becomes a body-level quote line after the external target.
    const nextSortables = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
    )
    expect(sortableIds(view.container).slice(0, 3)).toEqual([
      "intro",
      "quote",
      "tail"
    ])
    expect(nextSortables).toHaveLength(4)
    expect(nextSortables[3]?.textContent).toContain("Second")
    expect(nextSortables[3]?.classList.contains("hn-note-quote-line")).toBe(
      true
    )
    expect(nextSortables[3]?.getAttribute("data-note-drag-kind")).toBe(
      "quote-line"
    )
    expect(
      Array.from(view.container.querySelectorAll(".hn-note-quote-line p")).map(
        (line) => line.textContent
      )
    ).toEqual(["First", "Second"])
  })

  it("removes a todo parent when its only item moves outside", () => {
    // Given: a single-item todo sits before an external paragraph.
    const view = render(
      <ControlledNote
        initialBlocks={[
          {
            id: "list",
            kind: "todo",
            title: "Solo",
            items: [{ id: "only", checked: false, text: "Only item" }]
          },
          { id: "tail", kind: "paragraph", text: "Tail" }
        ]}
      />
    )
    const sortables = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
    )
    const item = view.container.querySelector<HTMLElement>(
      '.hn-note-body > [data-note-drag-kind="todo-item"]'
    )
    const handle = view.container.querySelector(
      '[data-block-id="only"][data-block-menu-mode="convert"]'
    )
    if (!handle || !item || sortables.length !== 2) {
      throw new Error("Expected the todo item and body blocks.")
    }
    setRect(requiredElement(sortables, 0), { top: 0, height: 40 })
    setRect(requiredElement(sortables, 1), { top: 60, height: 40 })
    setRect(item, { top: 0, height: 40 })

    // When: the only item is dragged below the external paragraph.
    dragMouse(handle, 20, 90)

    // Then: the empty parent disappears and the item remains a todo item.
    expect(sortableIds(view.container)).toEqual(["tail", "only"])
    expect(view.container.querySelector(".hn-note-todo")).toBeNull()
    const movedItem = view.container.querySelector<HTMLElement>(
      '[data-note-sortable-id="only"]'
    )
    expect(movedItem?.textContent).toContain("Only item")
    expect(movedItem?.classList.contains("hn-note-todo-item")).toBe(true)
    expect(movedItem?.getAttribute("data-note-drag-kind")).toBe(
      "todo-item"
    )
  })

  it("keeps todo item reordering local inside its persisted block", () => {
    // Given: a flat-rendered todo between two body-level paragraphs.
    const view = render(
      <ControlledNote
        initialBlocks={[
          { id: "intro", kind: "paragraph", text: "Intro" },
          {
            id: "list",
            kind: "todo",
            title: "Tasks",
            items: [
              { id: "first", checked: false, text: "First" },
              { id: "second", checked: false, text: "Second" }
            ]
          },
          { id: "tail", kind: "paragraph", text: "Tail" }
        ]}
      />
    )
    const items = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        '.hn-note-body > [data-note-drag-kind="todo-item"]'
      )
    )
    const handle = view.container.querySelector(
      '[data-block-id="first"][data-block-menu-mode="convert"]'
    )
    if (!handle || items.length !== 2) {
      throw new Error("Expected two direct todo items and a drag handle.")
    }
    setRect(requiredElement(items, 0), { top: 60, height: 40 })
    setRect(requiredElement(items, 1), { top: 110, height: 40 })

    // When: the first item is dragged below the second item.
    dragMouse(handle, 70, 140)

    // Then: only item order changes and both remain direct body children.
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLElement>(
          '.hn-note-body > [data-note-drag-kind="todo-item"]'
        )
      ).map((item) => item.id)
    ).toEqual(["second", "first"])
    expect(sortableIds(view.container)).toEqual([
      "intro",
      "second",
      "first",
      "tail"
    ])
  })

  it("keeps quote line reordering local inside its parent", () => {
    // Given: a quote with two independently draggable lines.
    const view = render(
      <ControlledNote
        initialBlocks={[
          { id: "intro", kind: "paragraph", text: "Intro" },
          { id: "quote", kind: "quote", text: "First\nSecond" },
          { id: "tail", kind: "paragraph", text: "Tail" }
        ]}
      />
    )
    const sortables = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
    )
    const quoteLines = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        ".hn-note-body > .hn-note-quote-line"
      )
    )
    const handle = view.container.querySelector(
      '[data-block-id="quote"][data-block-menu-mode="convert"]'
    )
    if (!handle || sortables.length !== 4 || quoteLines.length !== 2) {
      throw new Error("Expected body blocks and the first quote-line handle.")
    }
    setRect(requiredElement(sortables, 0), { top: 0, height: 40 })
    setRect(requiredElement(sortables, 1), { top: 60, height: 40 })
    setRect(requiredElement(sortables, 2), { top: 100, height: 40 })
    setRect(requiredElement(sortables, 3), { top: 160, height: 40 })

    // When: the first line moves below the second while staying inside the quote.
    dragMouse(handle, 70, 130)

    // Then: only the quote's internal line order changes.
    expect(sortableIds(view.container)).toEqual([
      "intro",
      "quote",
      "quote-line-1",
      "tail"
    ])
    expect(
      Array.from(view.container.querySelectorAll(".hn-note-quote-line p")).map(
        (line) => line.textContent
      )
    ).toEqual(["Second", "First"])
  })
})
