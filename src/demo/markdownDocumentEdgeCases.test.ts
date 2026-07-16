import { describe, expect, it } from "vitest"

import type { NoteBlock } from "../lib/types"
import type { DemoMarkdownDocument } from "./markdownDocument"
import {
  parseMarkdownDocument,
  serializeMarkdownDocument
} from "./markdownDocument"

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

const markdownDocument = (body: string): string =>
  [
    "```json",
    "{",
    '  "title": "Edge cases",',
    '  "summary": "Markdown parser and serializer edge cases",',
    '  "tagLabel": "Parser",',
    '  "updatedAt": "2026-07-12"',
    "}",
    "```",
    "",
    body
  ].join("\n")

const expectBlockAtIndex = (
  document: DemoMarkdownDocument,
  index: number
): NoteBlock => {
  const block = document.blocks[index]
  if (block === undefined) {
    throw new Error(`Expected block at index ${index} to exist.`)
  }
  return block
}

describe("markdown document edge cases", () => {
  it("round-trips H4 and H5 heading blocks", () => {
    const document = parseMarkdownDocument(
      markdownDocument(
        [
          '<!-- hn:block id="h4" eyebrow="Depth" -->',
          "#### Fourth level",
          "",
          '<!-- hn:block id="h5" eyebrow="Detail" -->',
          "##### Fifth level"
        ].join("\n")
      )
    )

    expect(document.blocks).toHaveLength(2)
    expect(expectBlockAtIndex(document, 0)).toMatchObject({
      eyebrow: "Depth",
      id: "h4",
      kind: "heading",
      level: 4,
      text: "Fourth level"
    })
    expect(expectBlockAtIndex(document, 1)).toMatchObject({
      eyebrow: "Detail",
      id: "h5",
      kind: "heading",
      level: 5,
      text: "Fifth level"
    })

    const serialized = serializeMarkdownDocument(document)
    expect(serialized).toContain("#### Fourth level")
    expect(serialized).toContain("##### Fifth level")
    expect(parseMarkdownDocument(serialized).blocks).toEqual(document.blocks)
  })

  it("round-trips an empty paragraph block directive", () => {
    const document = parseMarkdownDocument(
      markdownDocument('<!-- hn:block id="empty-paragraph" empty="true" -->')
    )

    expect(document.blocks).toEqual([
      {
        id: "empty-paragraph",
        kind: "paragraph",
        text: ""
      }
    ])

    const serialized = serializeMarkdownDocument(document)
    expect(serialized).toContain(
      '<!-- hn:block id="empty-paragraph" empty="true" -->'
    )
    expect(parseMarkdownDocument(serialized).blocks).toEqual(document.blocks)
  })

  it("round-trips an empty heading marker with its block directive", () => {
    const document = parseMarkdownDocument(
      markdownDocument(
        ['<!-- hn:block id="empty-heading" -->', "##"].join("\n")
      )
    )

    expect(document.blocks).toEqual([
      {
        id: "empty-heading",
        kind: "heading",
        level: 2,
        text: ""
      }
    ])

    const serialized = serializeMarkdownDocument(document)
    const splitToken = "\n```\n\n"
    const bodyStart = serialized.indexOf(splitToken)
    if (bodyStart === -1) {
      throw new Error("Expected serialized markdown to contain a body.")
    }
    expect(serialized.slice(bodyStart + splitToken.length)).toBe(
      ['<!-- hn:block id="empty-heading" -->', "##"].join("\n")
    )
    expect(parseMarkdownDocument(serialized).blocks).toEqual(document.blocks)
  })

  it("parses serialized inline br tags as canonical soft breaks", () => {
    const document = parseMarkdownDocument(
      markdownDocument(
        ['<!-- hn:block id="soft-break" -->', "Alpha<br>Bravo"].join("\n")
      )
    )

    expect(document.blocks).toEqual([
      {
        id: "soft-break",
        kind: "paragraph",
        text: "Alpha\nBravo"
      }
    ])

    const serialized = serializeMarkdownDocument(document)
    expect(serialized).toContain("Alpha<br>Bravo")
    expect(parseMarkdownDocument(serialized).blocks).toEqual(document.blocks)
  })

  it("creates unique UUID fallback ids for blocks and checklist items", () => {
    const document = parseMarkdownDocument(
      markdownDocument(
        [
          "# Heading without a directive",
          "",
          '<!-- hn:checklist id="0e12376c-1685-4703-8c01-6c112357f02c" title="First" -->',
          "- [ ] First item",
          "",
          '<!-- hn:checklist id="9638742e-650b-4fb7-9e7c-c6d6b7557f25" title="Second" -->',
          "- [ ] Second item",
        ].join("\n")
      )
    )

    const generatedIds = document.blocks.flatMap((block) => {
      if (block.kind === "heading") return [block.id]
      if (block.kind === "checklist") return block.items.map((item) => item.id)
      return []
    })

    expect(generatedIds).toHaveLength(3)
    expect(generatedIds.every((id) => UUID_V4_PATTERN.test(id))).toBe(true)
    expect(new Set(generatedIds).size).toBe(generatedIds.length)
  })
})
