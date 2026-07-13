import { describe, expect, it } from "vitest"

import { convertBlockSource } from "./blockSourceConversion"
import type { NoteBlock } from "./types"

describe("convertBlockSource", () => {
  it("extracts only the selected checklist item", () => {
    // Given: a three-item checklist whose middle item owns the menu.
    const blocks: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "checklist",
        title: "Tasks",
        items: [
          { id: "first", checked: true, text: "First" },
          { id: "second", checked: false, text: "Second" },
          { id: "third", checked: false, text: "Third" }
        ]
      }
    ]

    // When: the middle item becomes a paragraph.
    const converted = convertBlockSource({
      blocks,
      source: { kind: "checklist-item", blockId: "tasks", itemId: "second" },
      target: { kind: "paragraph" }
    })

    // Then: surrounding list items retain their document order and title once.
    expect(converted).toEqual([
      {
        id: "tasks",
        kind: "checklist",
        title: "Tasks",
        items: [{ id: "first", checked: true, text: "First" }]
      },
      { id: "second", kind: "paragraph", text: "[ ] Second" },
      {
        id: "tasks-after-second",
        kind: "checklist",
        title: "",
        items: [{ id: "third", checked: false, text: "Third" }]
      }
    ])
  })

  it("extracts only the selected quote line", () => {
    // Given: a persisted multi-line quote with author metadata.
    const blocks: readonly NoteBlock[] = [
      {
        id: "quote",
        kind: "quote",
        text: "First\nSecond\nThird",
        author: "Author"
      }
    ]

    // When: the middle quote line becomes a paragraph.
    const converted = convertBlockSource({
      blocks,
      source: {
        kind: "quote-line",
        blockId: "quote",
        lineId: "quote-line-1",
        lineIndex: 1
      },
      target: { kind: "paragraph" }
    })

    // Then: the author remains on the final quote segment without duplication.
    expect(converted).toEqual([
      { id: "quote", kind: "quote", text: "First" },
      { id: "quote-line-1", kind: "paragraph", text: "Second" },
      {
        id: "quote-after-quote-line-1",
        kind: "quote",
        text: "Third",
        author: "Author"
      }
    ])
  })
})
