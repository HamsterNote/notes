/** @vitest-environment jsdom */
import { act, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

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

const sortableIds = (container: HTMLElement): (string | null)[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[data-note-sortable-id]")
  ).map((element) => element.getAttribute("data-note-sortable-id"))

const dragMouse = (handle: Element): void => {
  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 20,
    clientY: 20,
    pointerId: 1,
    pointerType: "mouse"
  })
  fireEvent.pointerMove(document, {
    clientX: 20,
    clientY: 95,
    pointerId: 1,
    pointerType: "mouse"
  })
  fireEvent.pointerUp(document, {
    clientX: 20,
    clientY: 95,
    pointerId: 1,
    pointerType: "mouse"
  })
}

const setRowRects = (elements: readonly HTMLElement[]): void => {
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
}

describe("NoteContent block drag boundaries", () => {
  it("reorders quote lines from their existing conversion handles", () => {
    // Given: a multi-line quote whose lines already expose conversion handles.
    const blocks: readonly NoteBlock[] = [
      { id: "quote", kind: "quote", text: "First\nSecond" }
    ]
    const ControlledQuote = () => {
      const [value, setValue] = useState(blocks)
      return (
        <NoteContent
          blocks={value}
          title="Quote drag"
          editable
          onBlocksChange={setValue}
        />
      )
    }
    const view = render(<ControlledQuote />)
    const lines = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        '.hn-note-body > [data-note-drag-kind="quote-line"]'
      )
    )
    setRowRects(lines)
    const existingHandle = view.container.querySelector(
      '[data-block-id="quote"][data-block-menu-mode="convert"]'
    )
    const addedParentHandle = view.container.querySelector(
      '[data-note-block-drag-handle="quote"]'
    )
    if (!existingHandle) throw new Error("Expected quote-line handle.")

    // When: the first line's existing conversion handle is dragged downward.
    dragMouse(existingHandle)

    // Then: quote lines reorder in place and no extra parent handle is rendered.
    expect(
      Array.from(view.container.querySelectorAll(".hn-note-quote-line p")).map(
        (line) => line.textContent
      )
    ).toEqual(["Second", "First"])
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLElement>(
          '.hn-note-body > [data-note-drag-kind="quote-line"]'
        )
      ).every((line) => {
        const content = line.querySelector<HTMLElement>(
          ":scope > .hn-note-quote-content"
        )
        return (
          line.classList.contains("hn-note-quote") &&
          line.classList.contains("hn-note-quote-line") &&
          content?.classList.contains("hn-note-quote") === true &&
          content.classList.contains("hn-note-quote-line")
        )
      })
    ).toBe(true)
    expect(addedParentHandle).toBeNull()
  })

  it("reorders todo items from their existing conversion handles", () => {
    // Given: a todo with two independently actionable items.
    const ControlledTodo = () => {
      const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
        {
          id: "list",
          kind: "todo",
          title: "Todo",
          items: [
            { id: "first", checked: false, text: "First" },
            { id: "second", checked: true, text: "Second" }
          ]
        }
      ])
      return (
        <NoteContent
          blocks={blocks}
          title="Todo drag"
          editable
          onBlocksChange={setBlocks}
        />
      )
    }
    const view = render(<ControlledTodo />)
    const items = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        '.hn-note-body > [data-note-drag-kind="todo-item"]'
      )
    )
    setRowRects(items)
    const handle = view.container.querySelector(
      '[data-block-id="first"][data-block-menu-mode="convert"]'
    )
    if (!handle) throw new Error("Expected todo item handle.")

    // When: the first item's existing conversion handle is dragged downward.
    dragMouse(handle)

    // Then: only the items within the todo are reordered.
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLElement>(
        '.hn-note-body > [data-note-drag-kind="todo-item"]'
        )
      ).map((item) => item.id)
    ).toEqual(["second", "first"])
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLElement>(
        '.hn-note-body > [data-note-drag-kind="todo-item"]'
        )
      ).every((item) => {
        const content = item.querySelector<HTMLElement>(
          ":scope > .hn-note-todo-content"
        )
        return (
          item.classList.contains("hn-note-todo-item") &&
          content?.classList.contains("hn-note-todo-item") === true
        )
      })
    ).toBe(true)
  })

  it("rebinds desktop dragging when a block changes kind without changing ID", () => {
    // Given: a controlled block that can be replaced under the same ID.
    const KindChangingNote = () => {
      const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
        { id: "same", kind: "paragraph", text: "Before" },
        { id: "after", kind: "paragraph", text: "After" }
      ])
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setBlocks([
                { id: "same", kind: "heading", level: 2, text: "After" },
                { id: "after", kind: "paragraph", text: "After" }
              ])
            }
          >
            Change kind
          </button>
          <NoteContent
            blocks={blocks}
            title="Kind change drag"
            editable
            onBlocksChange={setBlocks}
          />
        </>
      )
    }
    const view = render(<KindChangingNote />)
    fireEvent.click(view.getByRole("button", { name: "Change kind" }))
    setBlockRects(view.container)
    const handle = view.container.querySelector(
      '[data-block-id="same"][data-block-menu-mode="convert"]'
    )
    if (!handle) throw new Error("Expected replacement block handle.")

    // When: the replacement handle is dragged after the kind transition.
    dragMouse(handle)

    // Then: the current DOM handle owns the drag and commits the reorder.
    expect(sortableIds(view.container)).toEqual(["after", "same"])
  })

  it("enables touch holding only while compact handles are hidden", async () => {
    vi.useFakeTimers()
    try {
      // Given: the same controlled note rendered at the wide breakpoint.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 1000
      })
      const blocks: readonly NoteBlock[] = [
        { id: "alpha", kind: "paragraph", text: "Alpha" },
        { id: "beta", kind: "paragraph", text: "Beta" }
      ]
      const ControlledNote = () => {
        const [value, setValue] = useState(blocks)
        return (
          <NoteContent
            blocks={value}
            title="Wide touch drag"
            editable
            onBlocksChange={setValue}
          />
        )
      }
      const view = render(<ControlledNote />)
      const elements = setBlockRects(view.container)
      const source = elements[0]
      if (!source) throw new Error("Expected sortable source.")

      // When: a wide-screen touch holds and moves past the second block.
      fireEvent.pointerDown(source, {
        clientX: 20,
        clientY: 20,
        pointerId: 7,
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

      // Then: no touch drag starts while desktop handles are visible.
      expect(sortableIds(view.container)).toEqual(["alpha", "beta"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("suppresses the single compatibility click produced by a touch drag", async () => {
    vi.useFakeTimers()
    try {
      // Given: a compact controlled note and a click observer outside the block.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 390
      })
      const onClick = vi.fn()
      document.addEventListener("click", onClick)
      const blocks: readonly NoteBlock[] = [
        { id: "alpha", kind: "paragraph", text: "Alpha" },
        { id: "beta", kind: "paragraph", text: "Beta" }
      ]
      const ControlledNote = () => {
        const [value, setValue] = useState(blocks)
        return (
          <NoteContent
            blocks={value}
            title="Touch click drag"
            editable
            onBlocksChange={setValue}
          />
        )
      }
      const view = render(<ControlledNote />)
      const source = setBlockRects(view.container)[0]
      if (!source) throw new Error("Expected sortable source.")

      // When: a touch drag finishes and the browser emits its compatibility click.
      fireEvent.pointerDown(source, {
        clientX: 20,
        clientY: 20,
        pointerId: 8,
        pointerType: "touch"
      })
      await act(() => vi.advanceTimersByTime(500))
      fireEvent.pointerMove(document, {
        clientX: 20,
        clientY: 95,
        pointerId: 8,
        pointerType: "touch"
      })
      fireEvent.pointerUp(document, {
        clientX: 20,
        clientY: 95,
        pointerId: 8,
        pointerType: "touch"
      })
      fireEvent.click(source)

      // Then: only that generated click is consumed.
      expect(onClick).not.toHaveBeenCalled()
      document.removeEventListener("click", onClick)
    } finally {
      vi.useRealTimers()
    }
  })
})
