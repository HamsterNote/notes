import { describe, expect, it } from "vitest"

import { moveBlockSourceToBoundary } from "./blockSourceMove"
import type { NoteBlock } from "./types"

describe("moveBlockSourceToBoundary", () => {
  it("places a middle todo item after every residual segment of its final parent", () => {
    // Given: extracting the middle item splits the final todo into two blocks.
    const blocks: readonly NoteBlock[] = [
      { id: "intro", kind: "paragraph", text: "Intro" },
      {
        id: "list",
        kind: "todo",
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
        kind: "todo-item",
        blockId: "list",
        containerId: null,
        sourceId: "middle"
      },
      sourceIndex: 1
    })

    // Then: both surviving todo segments precede the extracted todo.
    expect(moved.map((block) => block.kind)).toEqual([
      "paragraph",
      "todo",
      "todo",
      "todo"
    ])
    expect(moved.map((block) => block.id)).toEqual([
      "intro",
      "list",
      expect.any(String),
      "middle"
    ])
    expect(moved.at(-1)).toMatchObject({
      id: "middle",
      kind: "todo",
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
        containerId: null,
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

  it("extracts a todo item from a nested collapsible to a body boundary", () => {
    // Given: a todo block lives inside an expanded collapsible container.
    const blocks: readonly NoteBlock[] = [
      { id: "intro", kind: "paragraph", text: "Intro" },
      {
        id: "fold",
        kind: "collapsible",
        title: "Fold",
        collapsed: false,
        blocks: [
          {
            id: "nested-list",
            kind: "todo",
            title: "Nested",
            items: [
              { id: "nested-first", checked: false, text: "First" },
              { id: "nested-second", checked: true, text: "Second" }
            ]
          }
        ]
      }
    ]

    // When: the second nested item moves after a top-level paragraph.
    const moved = moveBlockSourceToBoundary({
      blocks,
      destination: { placement: "after", targetBlockId: "intro" },
      source: {
        kind: "todo-item",
        blockId: "nested-list",
        containerId: "fold",
        sourceId: "nested-second"
      },
      sourceIndex: 1
    })

    // Then: the extracted item becomes top-level and the parent retains its first item.
    expect(moved[1]).toMatchObject({
      id: "nested-second",
      kind: "todo",
      items: [{ id: "nested-second", checked: true, text: "Second" }]
    })
    expect(moved[2]).toMatchObject({
      id: "fold",
      kind: "collapsible",
      blocks: [
        {
          id: "nested-list",
          kind: "todo",
          items: [{ id: "nested-first", checked: false, text: "First" }]
        }
      ]
    })
  })
})
