/** @vitest-environment jsdom */

import { Drag } from "@system-ui-js/multi-drag"
import { describe, expect, it } from "vitest"

import {
  createExternalNoteBlock,
  insertExternalNoteBlock,
  prepareExternalNoteDragStart,
  snapshotExternalNoteItem,
  type NoteExternalItem
} from "./externalNoteDrag"
import { getExternalNoteDropTarget } from "./externalNoteDropTarget"
import type { NoteBlock } from "./types"

const startDrag = (): { readonly drag: Drag; readonly source: HTMLElement } => {
  const source = document.createElement("div")
  document.body.append(source)
  const drag = new Drag(source, { setPose: () => {} })
  source.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 8,
      clientY: 8,
      pointerId: 41
    })
  )
  return { drag, source }
}

describe("external note drag boundary", () => {
  it("snapshots a valid item when a drag has an active pointer", () => {
    // Given: a valid host item and an active multi-drag pointer.
    const { drag, source } = startDrag()
    const item: NoteExternalItem = {
      id: "source-1",
      content: "First line\nSecond line",
      clickable: true
    }

    // When: the public boundary prepares the external drag.
    const result = prepareExternalNoteDragStart(
      { item, drag, pointerId: 41 },
      { editable: true, canCommit: true, activeDrags: new Set() }
    )

    // Then: it owns an immutable plain snapshot rather than the caller object.
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("Expected preparation to succeed")
    expect(result.preparation.item).toEqual(item)
    expect(result.preparation.item).not.toBe(item)
    drag.destroy()
    source.remove()
  })

  it("rejects malformed items at the public boundary", () => {
    // Given: an active drag and malformed values crossing the runtime boundary.
    const { drag, source } = startDrag()
    const invalidItems: readonly unknown[] = [
      { id: "", content: "Text", clickable: true },
      { id: "   ", content: "Text", clickable: true },
      { id: "source", content: 4, clickable: true },
      { id: "source", content: "Text", clickable: "yes" }
    ]

    // When: each value is prepared through the typed public API at runtime.
    const results = invalidItems.map(snapshotExternalNoteItem)

    // Then: every malformed value is rejected without entering note state.
    expect(results).toEqual(invalidItems.map(() => undefined))
    drag.destroy()
    source.remove()
  })

  it("creates a safe multiline paragraph and inserts it immutably", () => {
    // Given: rich-looking plain text from an external source.
    const item: NoteExternalItem = {
      id: "source-2",
      content: "<b>First</b>\nSecond & final",
      clickable: false
    }
    const blocks: readonly NoteBlock[] = [
      { id: "a", kind: "paragraph", text: "A" },
      { id: "b", kind: "paragraph", text: "B" }
    ]

    // When: it becomes a note paragraph at the middle boundary.
    const inserted = createExternalNoteBlock(item, "inserted")
    const next = insertExternalNoteBlock(blocks, inserted, 1)

    // Then: plain text is escaped, line breaks survive, and input stays unchanged.
    expect(inserted).toEqual({
      id: "inserted",
      kind: "paragraph",
      text: "&lt;b&gt;First&lt;/b&gt;<br>Second &amp; final",
      externalItem: item
    })
    expect(next.map((block) => block.id)).toEqual(["a", "inserted", "b"])
    expect(blocks.map((block) => block.id)).toEqual(["a", "b"])
  })
})

describe("external note drop target", () => {
  it("groups renderer-owned rows into persisted block boundaries", () => {
    // Given: one paragraph and a two-row todo rendered as direct body children.
    const body = document.createElement("div")
    const paragraph = document.createElement("div")
    const todoFirst = document.createElement("div")
    const todoSecond = document.createElement("div")
    for (const [element, sortableId, blockId] of [
      [paragraph, "paragraph", "paragraph"],
      [todoFirst, "todo-1", "todo"],
      [todoSecond, "todo-2", "todo"]
    ] as const) {
      element.dataset["noteSortableId"] = sortableId
      element.dataset["noteBlockId"] = blockId
      body.append(element)
    }
    Object.defineProperty(body, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 400, top: 0, bottom: 300 })
    })
    Object.defineProperty(paragraph, "getBoundingClientRect", {
      value: () => ({ top: 20, bottom: 80 })
    })
    Object.defineProperty(todoFirst, "getBoundingClientRect", {
      value: () => ({ top: 100, bottom: 150 })
    })
    Object.defineProperty(todoSecond, "getBoundingClientRect", {
      value: () => ({ top: 150, bottom: 220 })
    })
    const blocks: readonly NoteBlock[] = [
      { id: "paragraph", kind: "paragraph", text: "Text" },
      { id: "todo", kind: "todo", title: "Todo", items: [] }
    ]

    // When: the pointer crosses the todo group's midpoint.
    const before = getExternalNoteDropTarget(body, blocks, { x: 20, y: 120 })
    const after = getExternalNoteDropTarget(body, blocks, { x: 20, y: 190 })

    // Then: both rows resolve to one persisted block and the visible edge row.
    expect(before).toEqual({
      element: todoFirst,
      insertionIndex: 1,
      placement: "before"
    })
    expect(after).toEqual({
      element: todoSecond,
      insertionIndex: 2,
      placement: "after"
    })
  })

  it("rejects a pointer outside the note body", () => {
    // Given: a body with a measurable note surface.
    const body = document.createElement("div")
    Object.defineProperty(body, "getBoundingClientRect", {
      value: () => ({ left: 10, right: 110, top: 20, bottom: 120 })
    })

    // When: the pointer is beyond its horizontal edge.
    const target = getExternalNoteDropTarget(body, [], { x: 140, y: 40 })

    // Then: no insertion boundary is offered.
    expect(target).toBeNull()
  })
})
