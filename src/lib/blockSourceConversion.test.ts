import { describe, expect, it } from "vitest"

import {
  convertBlockSource,
  replaceBlockSourceWithPicture
} from "./blockSourceConversion"
import type { NoteBlock } from "./types"

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const QUOTE_REPLACEMENT_ID = "5b66ed99-ea4d-4978-bce3-53aa6a390497"

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
    expect(converted).toMatchObject([
      {
        id: "tasks",
        kind: "checklist",
        title: "Tasks",
        items: [{ id: "first", checked: true, text: "First" }]
      },
      { id: "second", kind: "paragraph", text: "[ ] Second" },
      {
        kind: "checklist",
        title: "",
        items: [{ id: "third", checked: false, text: "Third" }]
      }
    ])
    expect(converted[2]?.id).toMatch(UUID_V4_PATTERN)
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
      replacementId: QUOTE_REPLACEMENT_ID,
      source: {
        kind: "quote-line",
        blockId: "quote",
        lineId: "quote-line-1",
        lineIndex: 1
      },
      target: { kind: "paragraph" }
    })

    // Then: the author remains on the final quote segment without duplication.
    expect(converted).toMatchObject([
      { id: "quote", kind: "quote", text: "First" },
      { id: QUOTE_REPLACEMENT_ID, kind: "paragraph", text: "Second" },
      {
        kind: "quote",
        text: "Third",
        author: "Author"
      }
    ])
    expect(converted[2]?.id).toMatch(UUID_V4_PATTERN)
  })
})

describe("replaceBlockSourceWithPicture", () => {
  it("replaces a block while preserving its id", () => {
    // Given: a paragraph whose left-side menu owns the upload action.
    const blocks: readonly NoteBlock[] = [
      { id: "intro", kind: "paragraph", text: "Replace me" }
    ]

    // When: the uploaded image URL resolves.
    const replaced = replaceBlockSourceWithPicture({
      blocks,
      source: { kind: "block", blockId: "intro" },
      url: "blob:http://localhost/intro",
      filename: "intro.png",
      width: 1600,
      height: 900
    })

    // Then: the source becomes a first-class picture block with the same id.
    expect(replaced).toMatchObject([
      {
        id: "intro",
        kind: "picture",
        url: "blob:http://localhost/intro",
        filename: "intro.png",
        width: 1600,
        height: 900
      }
    ])
  })

  it("extracts a selected checklist item as a picture", () => {
    // Given: the middle item in a checklist owns the upload action.
    const blocks: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "checklist",
        title: "Tasks",
        items: [
          { id: "first", checked: false, text: "First" },
          { id: "second", checked: false, text: "Second" },
          { id: "third", checked: false, text: "Third" }
        ]
      }
    ]

    // When: that item is replaced by an uploaded picture.
    const replaced = replaceBlockSourceWithPicture({
      blocks,
      source: { kind: "checklist-item", blockId: "tasks", itemId: "second" },
      url: "blob:http://localhost/checklist",
      filename: "checklist.png"
    })

    // Then: the surrounding checklist segments retain their order and title.
    expect(replaced).toMatchObject([
      {
        id: "tasks",
        kind: "checklist",
        title: "Tasks",
        items: [{ id: "first", checked: false, text: "First" }]
      },
      {
        id: "second",
        kind: "picture",
        url: "blob:http://localhost/checklist",
        filename: "checklist.png"
      },
      {
        kind: "checklist",
        title: "",
        items: [{ id: "third", checked: false, text: "Third" }]
      }
    ])
    expect(replaced[2]?.id).toMatch(UUID_V4_PATTERN)
  })
})
