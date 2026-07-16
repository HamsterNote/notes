import { describe, expect, it } from "vitest"

import {
  deleteQuoteLine,
  splitQuoteLine,
  updateQuoteLine
} from "./quoteLineEditing"
import type { NoteBlock } from "./types"

const blocks: readonly NoteBlock[] = [
  {
    id: "quote",
    kind: "quote",
    text: "First\nSecond",
    author: "Author"
  }
]

describe("quote line editing", () => {
  it("updates one persisted quote line", () => {
    // Given: a multi-line quote rendered as separate editable rows.
    // When: the second line is edited.
    const updated = updateQuoteLine(blocks, "quote", 1, "Changed")

    // Then: the quote shape and author remain stable.
    expect(updated).toEqual([
      {
        id: "quote",
        kind: "quote",
        text: "First\nChanged",
        author: "Author"
      }
    ])
  })

  it("splits one quote line without creating a new top-level block", () => {
    // Given: the caret is inside the first persisted quote line.
    // When: Enter divides its rich text.
    const updated = splitQuoteLine(blocks, "quote", 0, "Fi", "rst")

    // Then: the new line stays inside the quote and preserves metadata once.
    expect(updated).toEqual([
      {
        id: "quote",
        kind: "quote",
        text: "Fi\nrst\nSecond",
        author: "Author"
      }
    ])
  })

  it("deletes only an empty quote line", () => {
    // Given: a quote contains one empty line among visible lines.
    const withEmptyLine: readonly NoteBlock[] = [
      { id: "quote", kind: "quote", text: "First\n\nSecond", author: "Author" }
    ]

    // When: Backspace removes the empty middle line.
    const updated = deleteQuoteLine(withEmptyLine, "quote", 1)

    // Then: both visible lines and author remain.
    expect(updated).toEqual([
      {
        id: "quote",
        kind: "quote",
        text: "First\nSecond",
        author: "Author"
      }
    ])
  })
})
