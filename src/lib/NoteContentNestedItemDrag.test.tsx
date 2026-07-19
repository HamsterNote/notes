/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const setRect = (element: HTMLElement, top: number): void => {
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
}

const dragMouse = (handle: Element, startY: number, destinationY: number): void => {
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

const ControlledNote = ({ blocks }: { readonly blocks: readonly NoteBlock[] }) => {
  const [currentBlocks, setCurrentBlocks] = useState(blocks)
  return (
    <NoteContent
      blocks={currentBlocks}
      title="Nested item drag"
      editable
      onBlocksChange={setCurrentBlocks}
    />
  )
}

describe("NoteContent nested item dragging", () => {
  it("keeps todo item reordering inside its collapsible container", () => {
    // Given: an expanded collapsible contains one two-item todo block.
    const view = render(
      <ControlledNote
        blocks={[
          {
            id: "fold",
            kind: "collapsible",
            title: "Tasks",
            collapsed: false,
            blocks: [
              {
                id: "todo",
                kind: "todo",
                title: "Nested",
                items: [
                  { id: "first", checked: false, text: "First" },
                  { id: "second", checked: false, text: "Second" }
                ]
              }
            ]
          },
          { id: "tail", kind: "paragraph", text: "Tail" }
        ]}
      />
    )
    const items = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        '.hn-note-collapsible-body > [data-note-drag-kind="todo-item"]'
      )
    )
    const handle = view.container.querySelector(
      '[data-block-id="first"][data-block-menu-mode="convert"]'
    )
    if (!handle || items.length !== 2) throw new Error("Expected nested todo items.")
    setRect(items[0] ?? document.body, 60)
    setRect(items[1] ?? document.body, 110)

    // When: the first item moves below the second item.
    dragMouse(handle, 70, 140)

    // Then: both items stay nested and only their local order changes.
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLElement>(
          '.hn-note-collapsible-body > [data-note-drag-kind="todo-item"]'
        )
      ).map((item) => item.id)
    ).toEqual(["second", "first"])
    expect(
      view.container.querySelectorAll(
        '.hn-note-body > [data-note-drag-kind="todo-item"]'
      )
    ).toHaveLength(0)
  })

  it("keeps quote line reordering inside its collapsible container", () => {
    // Given: an expanded collapsible contains one two-line quote block.
    const view = render(
      <ControlledNote
        blocks={[
          {
            id: "fold",
            kind: "collapsible",
            title: "Quotes",
            collapsed: false,
            blocks: [{ id: "quote", kind: "quote", text: "First\nSecond" }]
          },
          { id: "tail", kind: "paragraph", text: "Tail" }
        ]}
      />
    )
    const lines = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        ".hn-note-collapsible-body > .hn-note-quote-line"
      )
    )
    const handle = view.container.querySelector(
      '[data-block-id="quote"][data-block-menu-mode="convert"]'
    )
    if (!handle || lines.length !== 2) throw new Error("Expected nested quote lines.")
    setRect(lines[0] ?? document.body, 60)
    setRect(lines[1] ?? document.body, 100)

    // When: the first line moves below the second line.
    dragMouse(handle, 70, 130)

    // Then: both lines stay nested and only their local order changes.
    expect(
      Array.from(
        view.container.querySelectorAll(
          ".hn-note-collapsible-body > .hn-note-quote-line p"
        )
      ).map((line) => line.textContent)
    ).toEqual(["Second", "First"])
    expect(view.container.querySelectorAll(".hn-note-body > .hn-note-quote-line")).toHaveLength(
      0
    )
  })
})
