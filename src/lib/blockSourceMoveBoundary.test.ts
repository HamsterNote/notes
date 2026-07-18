import { describe, expect, it } from "vitest"

import { moveBlockSourceToBoundary } from "./blockSourceMove"
import type { NoteBlock } from "./types"

describe("moveBlockSourceToBoundary", () => {
  it("places a middle checklist item after every residual segment of its final parent", () => {
    // Given: extracting the middle item splits the final checklist into two blocks.
    const blocks: readonly NoteBlock[] = [
      { id: "intro", kind: "paragraph", text: "Intro" },
      {
        id: "list",
        kind: "checklist",
        title: "Final list",
        items: [
          { id: "first", checked: false, text: "First" },
          { id: "middle", checked: true, text: "Middle" },
          { id: "last", checked: false, text: "Last" }
        ]
      }
    ]

    // When: the middle item moves below its own top-level parent boundary.
    const moved = moveBlockSourceToBoundary({
      blocks,
      destination: { placement: "after", targetBlockId: "list" },
      source: {
        kind: "checklist-item",
        blockId: "list",
        sourceId: "middle"
      },
      sourceIndex: 1
    })

    // Then: both surviving checklist segments precede the extracted checklist.
    expect(moved.map((block) => block.kind)).toEqual([
      "paragraph",
      "checklist",
      "checklist",
      "checklist"
    ])
    expect(moved.map((block) => block.id)).toEqual([
      "intro",
      "list",
      expect.any(String),
      "middle"
    ])
    expect(moved.at(-1)).toMatchObject({
      id: "middle",
      kind: "checklist",
      title: "",
      items: [{ id: "middle", checked: true, text: "Middle" }]
    })
  })

  it("preserves the quote marker when a quote line moves to a body boundary", () => {
    // Given: a quote with a movable second line and a body-level paragraph.
    const blocks: readonly NoteBlock[] = [
      {
        id: "quote",
        kind: "quote",
        text: "First\nSecond",
        author: "Author"
      },
      { id: "outro", kind: "paragraph", text: "Outro" }
    ]

    // When: the second quote line moves after the body-level paragraph.
    const moved = moveBlockSourceToBoundary({
      blocks,
      destination: { placement: "after", targetBlockId: "outro" },
      source: {
        kind: "quote-line",
        blockId: "quote",
        sourceId: "quote-line-1"
      },
      sourceIndex: 1
    })

    // Then: the extracted quote line remains a standalone quote block.
    expect(moved.at(-1)).toEqual({
      id: "quote-line-1",
      kind: "quote",
      text: "Second",
      author: "Author"
    })
  })
})
