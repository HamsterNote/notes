import { afterEach, describe, expect, it, vi } from "vitest"

import { convertBlockFormat } from "./blockConversion"
import type { NoteParagraphBlock } from "./types"

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

const paragraph: NoteParagraphBlock = {
  id: "intro",
  kind: "paragraph",
  text: "<strong>Alpha</strong><br>Beta"
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("convertBlockFormat structural targets", () => {
  it("converts rich text to a one-item todo", () => {
    // Given: a rich paragraph that becomes a Markdown task list.
    // When: the Todo target is selected from the block menu.
    const converted = convertBlockFormat(paragraph, { kind: "todo" })

    // Then: its visible content becomes one stable unchecked item.
    expect(converted).toMatchObject({
      id: "intro",
      kind: "todo",
      title: "",
      items: [
        {
          checked: false,
          text: "<strong>Alpha</strong><br>Beta"
        }
      ]
    })
    if (converted.kind !== "todo") {
      throw new Error("Expected a todo block.")
    }
    expect(converted.items[0]?.id).toMatch(UUID_V4_PATTERN)
  })

  it("converts rich text to a one-item unordered list", () => {
    // Given: a rich paragraph that becomes a Markdown bullet list.
    const converted = convertBlockFormat(paragraph, { kind: "unorderedList" })

    expect(converted).toEqual({
      id: "intro",
      kind: "unorderedList",
      text: "<strong>Alpha</strong><br>Beta"
    })
  })

  it("converts rich text to a one-item ordered list", () => {
    // Given: a rich paragraph that becomes a Markdown numbered list.
    const converted = convertBlockFormat(paragraph, { kind: "orderedList" })

    expect(converted).toEqual({
      id: "intro",
      kind: "orderedList",
      text: "<strong>Alpha</strong><br>Beta"
    })
  })

  it("converts rich text to a quote", () => {
    // Given: a paragraph whose inline formatting should remain visible.
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")

    // When: the Quote target is selected.
    const converted = convertBlockFormat(paragraph, { kind: "quote" })

    // Then: the rich body is preserved in the quote.
    expect(converted).toEqual({
      id: "intro",
      kind: "quote",
      text: "<strong>Alpha</strong><br>Beta"
    })
    expect(randomUUID).not.toHaveBeenCalled()
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

  it("converts rich text to a plain formula source", () => {
    // Given: rich text whose visible value is valid LaTeX source.
    // When: the Formula target is selected.
    const converted = convertBlockFormat(paragraph, { kind: "formula" })

    // Then: formatting markup is removed while line breaks are preserved.
    expect(converted).toEqual({
      id: "intro",
      kind: "formula",
      formula: "Alpha\nBeta"
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

  it("converts rich text to an expanded collapsible with empty children", () => {
    // Given: a paragraph whose rich text should become the collapsible title.
    // When: the Collapsible target is selected.
    const converted = convertBlockFormat(paragraph, { kind: "collapsible" })

    // Then: title preserves rich text, children start empty, collapsed=false.
    expect(converted).toEqual({
      id: "intro",
      kind: "collapsible",
      title: "<strong>Alpha</strong><br>Beta",
      collapsed: false,
      blocks: []
    })
  })

  it("discards all source content when converting to a directory", () => {
    // Given: a rich paragraph whose content must not become directory data.
    // When: the Directory target is selected.
    const converted = convertBlockFormat(paragraph, { kind: "directory" })

    // Then: only the stable block identity and directory marker remain.
    expect(converted).toEqual({
      id: "intro",
      kind: "directory"
    })
  })
})
