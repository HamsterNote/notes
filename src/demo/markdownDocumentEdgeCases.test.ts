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
  it("parses hamster-note-card fences as structured card data", () => {
    // Given: Markdown contains a card payload with nested JSON data.
    const cardData = {
      title: "Release health",
      columns: [
        { id: "todo", title: "Todo" },
        { id: "done", title: "Done" }
      ],
      items: [{ id: "ship", columnId: "done", text: "Ship notes" }]
    }

    // When: the document crosses the Markdown parsing boundary.
    const document = parseMarkdownDocument(
      markdownDocument(
        [
          "```hamster-note-card",
          JSON.stringify(cardData, null, 2),
          "```"
        ].join("\n")
      )
    )

    // Then: the fence becomes a first-class card block without losing JSON fields.
    expect(expectBlockAtIndex(document, 0)).toMatchObject({
      kind: "card",
      data: cardData
    })
  })

  it("round-trips hamster-note-drawing fences as drawing blocks", () => {
    // Given: a drawing fence whose payload is DrawingValue JSON.
    const drawingData = JSON.stringify({
      schemaVersion: 2,
      strokes: [
        {
          schemaVersion: 2,
          id: "stroke-1",
          tool: "pen",
          points: [
            { x: 0, y: 0 },
            { x: 24, y: 18 }
          ]
        }
      ]
    })

    // When: the document crosses the Markdown parsing boundary.
    const document = parseMarkdownDocument(
      markdownDocument(
        ["```hamster-note-drawing", drawingData, "```"].join("\n")
      )
    )

    // Then: the fence becomes a drawing block keeping the raw JSON payload.
    expect(expectBlockAtIndex(document, 0)).toMatchObject({
      kind: "drawing",
      data: drawingData
    })

    // And: serialization restores the same fence for a full round-trip.
    const serialized = serializeMarkdownDocument(document)
    expect(serialized).toContain("```hamster-note-drawing")
    expect(serialized).toContain(drawingData)

    const reparsed = parseMarkdownDocument(serialized)
    expect(reparsed.blocks).toMatchObject([
      { kind: "drawing", data: drawingData }
    ])
  })

  it("round-trips H4 and H5 heading blocks", () => {    const document = parseMarkdownDocument(
      markdownDocument(
        ["#### Fourth level", "", "##### Fifth level"].join("\n")
      )
    )

    expect(document.blocks).toHaveLength(2)
    expect(expectBlockAtIndex(document, 0)).toMatchObject({
      kind: "heading",
      level: 4,
      text: "Fourth level"
    })
    expect(expectBlockAtIndex(document, 1)).toMatchObject({
      kind: "heading",
      level: 5,
      text: "Fifth level"
    })

    const serialized = serializeMarkdownDocument(document)
    expect(serialized).toContain("#### Fourth level")
    expect(serialized).toContain("##### Fifth level")
    const reparsed = parseMarkdownDocument(serialized)
    expect(reparsed.blocks.map(({ id }) => id)).not.toEqual(
      document.blocks.map(({ id }) => id)
    )
    expect(reparsed.blocks).toMatchObject([
      { kind: "heading", level: 4, text: "Fourth level" },
      { kind: "heading", level: 5, text: "Fifth level" }
    ])
  })

  it("ignores standalone HTML comments in Markdown data", () => {
    const document = parseMarkdownDocument(markdownDocument("<!-- note -->"))

    expect(document.blocks).toEqual([])
    expect(serializeMarkdownDocument(document)).not.toContain("<!-- note -->")
  })

  it("round-trips an empty heading marker with a regenerated id", () => {
    const document = parseMarkdownDocument(markdownDocument("##"))

    expect(document.blocks).toMatchObject([
      { kind: "heading", level: 2, text: "" }
    ])

    const serialized = serializeMarkdownDocument(document)
    const splitToken = "\n```\n\n"
    const bodyStart = serialized.indexOf(splitToken)
    if (bodyStart === -1) {
      throw new Error("Expected serialized markdown to contain a body.")
    }
    expect(serialized.slice(bodyStart + splitToken.length)).toBe("##")
    expect(parseMarkdownDocument(serialized).blocks).toMatchObject([
      { kind: "heading", level: 2, text: "" }
    ])
  })

  it("parses serialized inline br tags as canonical soft breaks", () => {
    const document = parseMarkdownDocument(
      markdownDocument("Alpha<br>Bravo")
    )

    expect(document.blocks).toMatchObject([
      { kind: "paragraph", text: "Alpha\nBravo" }
    ])

    const serialized = serializeMarkdownDocument(document)
    expect(serialized).toContain("Alpha<br>Bravo")
    expect(parseMarkdownDocument(serialized).blocks).toMatchObject([
      { kind: "paragraph", text: "Alpha\nBravo" }
    ])
  })

  it("creates unique UUID fallback ids for blocks and todo items", () => {
    const document = parseMarkdownDocument(
      markdownDocument(
        [
          "# Heading",
          "",
          "- [ ] First item",
          "",
          "A paragraph",
          "",
          "- [ ] Second item"
        ].join("\n")
      )
    )

    const generatedIds = document.blocks.flatMap((block) => {
      if (block.kind === "todo") {
        return [block.id, ...block.items.map((item) => item.id)]
      }
      return [block.id]
    })

    expect(generatedIds).toHaveLength(6)
    expect(generatedIds.every((id) => UUID_V4_PATTERN.test(id))).toBe(true)
    expect(new Set(generatedIds).size).toBe(generatedIds.length)
  })
})
