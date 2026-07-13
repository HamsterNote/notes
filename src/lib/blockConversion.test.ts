import { describe, expect, it } from "vitest"

import { convertBlockFormat } from "./blockConversion"
import type { NoteParagraphBlock } from "./types"

const paragraph: NoteParagraphBlock = {
  id: "intro",
  kind: "paragraph",
  text: "<strong>Alpha</strong><br>Beta"
}

describe("convertBlockFormat structural targets", () => {
  it("converts rich text to a one-item checklist", () => {
    // Given: a rich paragraph that becomes a Markdown list.
    // When: the List target is selected from the block menu.
    const converted = convertBlockFormat(paragraph, { kind: "checklist" })

    // Then: its visible content becomes one stable unchecked item.
    expect(converted).toEqual({
      id: "intro",
      kind: "checklist",
      title: "List",
      items: [
        {
          id: "intro-item",
          checked: false,
          text: "<strong>Alpha</strong><br>Beta"
        }
      ]
    })
  })

  it("converts rich text to a quote", () => {
    // Given: a paragraph whose inline formatting should remain visible.
    // When: the Quote target is selected.
    const converted = convertBlockFormat(paragraph, { kind: "quote" })

    // Then: the rich body is preserved in the quote.
    expect(converted).toEqual({
      id: "intro",
      kind: "quote",
      text: "<strong>Alpha</strong><br>Beta"
    })
  })

  it("converts rich text to escaped plain code", () => {
    // Given: rich HTML that must not be interpreted inside a code block.
    // When: the Code target is selected.
    const converted = convertBlockFormat(paragraph, { kind: "code" })

    // Then: only visible plain text remains and the language is explicit.
    expect(converted).toEqual({
      id: "intro",
      kind: "code",
      language: "text",
      code: "Alpha\nBeta"
    })
  })

  it("converts rich text to an informational callout", () => {
    // Given: a paragraph that becomes the body of a Markdown callout.
    // When: the Callout target is selected.
    const converted = convertBlockFormat(paragraph, { kind: "callout" })

    // Then: deterministic visible defaults wrap the preserved body.
    expect(converted).toEqual({
      id: "intro",
      kind: "callout",
      tone: "info",
      title: "Note",
      text: "<strong>Alpha</strong><br>Beta"
    })
  })
})
