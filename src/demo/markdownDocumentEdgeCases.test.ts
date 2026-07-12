import { describe, expect, it } from "vitest"

import type { NoteBlock } from "../lib/types"
import type { DemoMarkdownDocument } from "./markdownDocument"
import {
  parseMarkdownDocument,
  serializeMarkdownDocument
} from "./markdownDocument"

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
})
