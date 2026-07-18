import { describe, expect, it } from "vitest"
import type { NoteBlock, NoteChecklistItem } from "../lib/types"
import type { DemoMarkdownDocument } from "./markdownDocument"
import {
  DemoMarkdownParseError,
  parseMarkdownDocument,
  serializeMarkdownDocument
} from "./markdownDocument"
import { demoMarkdownDocument } from "./noteData"

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const expectFirstChecklistItem = (
  block: Extract<NoteBlock, { readonly kind: "checklist" }>
): NoteChecklistItem => {
  const item = block.items[0]
  if (item === undefined) {
    throw new Error("Expected checklist to contain at least one item.")
  }
  return item
}

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

const markdownBlockValue = (block: NoteBlock): unknown => {
  switch (block.kind) {
    case "heading":
      return { kind: block.kind, level: block.level, text: block.text }
    case "paragraph":
      return { kind: block.kind, text: block.text }
    case "quote":
      return { author: block.author, kind: block.kind, text: block.text }
    case "checklist":
      return {
        items: block.items.map(({ checked, text }) => ({ checked, text })),
        kind: block.kind
      }
    case "code":
      return {
        code: block.code,
        filename: block.filename,
        kind: block.kind,
        language: block.language
      }
    case "callout":
      return {
        kind: block.kind,
        text: block.text,
        title: block.title,
        tone: block.tone
      }
    case "table":
      return { kind: block.kind, rows: block.rows }
    case "formula":
      return { formula: block.formula, kind: block.kind }
    case "picture":
      return {
        filename: block.filename,
        kind: block.kind,
        url: block.url
      }
    default:
      return assertNever(block)
  }
}

const assertNever = (value: never): never => {
  throw new Error(`Unsupported note block: ${JSON.stringify(value)}`)
}

const documentParts = (
  markdown: string
): { readonly metadata: string; readonly body: string } => {
  const splitToken = "\n```\n\n"
  const bodyStart = markdown.indexOf(splitToken)
  if (bodyStart === -1) {
    throw new Error(
      "Expected serialized markdown to contain metadata and body."
    )
  }
  return {
    metadata: markdown.slice(0, bodyStart + "\n```".length),
    body: markdown.slice(bodyStart + splitToken.length)
  }
}

const expectParseErrorCode = (markdown: string, code: string): void => {
  try {
    parseMarkdownDocument(markdown)
  } catch (error) {
    if (error instanceof DemoMarkdownParseError) {
      expect(error.code).toBe(code)
      return
    }
    throw error
  }
  throw new Error(`Expected DemoMarkdownParseError with code ${code}.`)
}

/* ------------------------------------------------------------------ */
/*  Parse tests                                                        */
/* ------------------------------------------------------------------ */

describe("markdown document parsing", () => {
  it("uses unique UUIDs for every block and checklist item in the default document", () => {
    // Given: the Markdown document rendered by the demo.
    const document = parseMarkdownDocument(demoMarkdownDocument)

    // When: all runtime block and checklist item IDs are collected.
    const ids = document.blocks.flatMap((block) =>
      block.kind === "checklist"
        ? [block.id, ...block.items.map((item) => item.id)]
        : [block.id]
    )

    // Then: each ID is a UUID v4 and no two data records share one.
    expect(ids.every((id) => UUID_V4_PATTERN.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("parses default document metadata correctly", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)

    expect(document.title).toBe("Launch Notes for the first public package")
    expect(document.summary).toContain("editorial note surface")
    expect(document.tagLabel).toBe("Release candidate")
    expect(document.updatedAt).toBe("2026-07-11")
  })

  it("preserves representative fields from the default document blocks", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)

    expect(document.blocks).toHaveLength(11)
    const hero = expectBlockAtIndex(document, 0)
    expect(hero).toMatchObject({
      kind: "heading",
      level: 1
    })
    if (hero.kind !== "heading") throw new Error("Expected heading block.")
    expect(hero.text).toContain("Ship a note component")
    expect(expectBlockAtIndex(document, 1)).toMatchObject({ kind: "paragraph" })
    const principle = expectBlockAtIndex(document, 2)
    expect(principle).toMatchObject({ kind: "quote" })
    if (principle.kind !== "quote") throw new Error("Expected quote block.")
    expect(principle.text).toContain("Readable note surfaces")
    expect(expectBlockAtIndex(document, 3)).toMatchObject({
      kind: "heading",
      level: 2
    })

    const checklist = expectBlockAtIndex(document, 4)
    if (checklist.kind !== "checklist") {
      throw new Error("Expected checklist block.")
    }
    expect(checklist.title).toBe("")
    expect(checklist.items).toHaveLength(3)
    expect(checklist.items.some((item) => item.checked)).toBe(true)
    expect(checklist.items.every((item) => item.checked)).toBe(true)
    for (const item of checklist.items) {
      expect(item.id).not.toBe("")
      expect(item.text).not.toBe("")
      expect(typeof item.checked).toBe("boolean")
    }

    const callout = expectBlockAtIndex(document, 5)
    expect(callout).toMatchObject({
      kind: "callout",
      title: "Structured input, flexible visuals",
      tone: "info"
    })
    if (callout.kind !== "callout") throw new Error("Expected callout block.")
    expect(callout.text).toContain("typed block array")
    expect(expectBlockAtIndex(document, 6)).toMatchObject({
      kind: "heading",
      level: 3
    })

    const code = expectBlockAtIndex(document, 7)
    expect(code).toMatchObject({
      filename: "App.tsx",
      kind: "code",
      language: "tsx"
    })
    if (code.kind !== "code") throw new Error("Expected code block.")
    expect(code.code.trim()).not.toBe("")

    expect(expectBlockAtIndex(document, 8)).toMatchObject({ kind: "paragraph" })
    expect(expectBlockAtIndex(document, 9)).toMatchObject({
      kind: "callout",
      title: "Versioning rule",
      tone: "warning"
    })
    const table = expectBlockAtIndex(document, 10)
    expect(table).toMatchObject({
      kind: "table"
    })
    if (table.kind !== "table") throw new Error("Expected table block.")
    expect(table.rows.length).toBeGreaterThan(0)
    expect(table.rows[0]).toContain("Feature")
    expect(table.rows[0]).toContain("Status")
  })

  it("parses quote author from the author line", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)

    expect(expectBlockAtIndex(document, 2)).toMatchObject({
      author: "Design note",
      kind: "quote"
    })
  })

  it("throws stable parser errors for invalid metadata documents", () => {
    expectParseErrorCode("# Hello", "MISSING_METADATA_BLOCK")
    expectParseErrorCode(
      "```json\nnot json\n```\n\n# Hello",
      "INVALID_METADATA_JSON"
    )
    expectParseErrorCode("```json\n{}\n```\n\n# Hello", "MISSING_TITLE")
    expectParseErrorCode(
      '```json\n{"title":"T","summary":"S","tagLabel":"L","updatedAt":123}\n```\n\n# Hello',
      "INVALID_UPDATED_AT"
    )
  })
})

/* ------------------------------------------------------------------ */
/*  Serialize tests                                                    */
/* ------------------------------------------------------------------ */

describe("markdown document serialization", () => {
  it("keeps Markdown data free of internal block directives", () => {
    // Given: the demo document contains runtime-only ids and presentation fields.
    const document = parseMarkdownDocument(demoMarkdownDocument)

    // When: the document is exposed as Markdown data.
    const serialized = serializeMarkdownDocument(document)

    // Then: internal editor metadata never leaks into user content.
    expect(serialized).not.toContain("<!-- hn:")
  })

  it("round-trips parsed documents through serialization", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)
    const reparsed = parseMarkdownDocument(serializeMarkdownDocument(document))

    expect(reparsed.title).toBe(document.title)
    expect(reparsed.summary).toBe(document.summary)
    expect(reparsed.tagLabel).toBe(document.tagLabel)
    expect(reparsed.updatedAt).toBe(document.updatedAt)
    expect(reparsed.blocks).toHaveLength(document.blocks.length)

    expect(reparsed.blocks.map(markdownBlockValue)).toEqual(
      document.blocks.map(markdownBlockValue)
    )
    expect(reparsed.blocks.map(({ id }) => id)).not.toEqual(
      document.blocks.map(({ id }) => id)
    )
  })

  it("reflects metadata edits only in the JSON fence while preserving updatedAt", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)
    const editedDocument: DemoMarkdownDocument = {
      ...document,
      summary: "Edited summary",
      tagLabel: "Edited tag",
      title: "Edited title"
    }
    const serialized = serializeMarkdownDocument(editedDocument)
    const { body, metadata } = documentParts(serialized)
    const reparsed = parseMarkdownDocument(serialized)

    expect(metadata).toContain('"title": "Edited title"')
    expect(metadata).toContain('"summary": "Edited summary"')
    expect(metadata).toContain('"tagLabel": "Edited tag"')
    expect(metadata).toContain('"updatedAt": "2026-07-11"')
    expect(body).not.toContain("Edited title")
    expect(body).not.toContain("Edited summary")
    expect(body).not.toContain("Edited tag")
    expect(reparsed.updatedAt).toBe(document.updatedAt)
  })

  it("persists checklist block edits through serialization without changing updatedAt", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)
    const checklist = expectBlockAtIndex(document, 4)
    if (checklist.kind !== "checklist") {
      throw new Error("Expected checklist block.")
    }
    const firstItem = expectFirstChecklistItem(checklist)
    const editedItemText = "Confirm edited checklist persistence."
    const editedBlocks: readonly NoteBlock[] = document.blocks.map((block) => {
      if (block.kind !== "checklist" || block.id !== checklist.id) return block
      return {
        ...block,
        items: block.items.map((item) =>
          item.id === firstItem.id
            ? { ...item, checked: !item.checked, text: editedItemText }
            : item
        )
      }
    })
    const editedDocument: DemoMarkdownDocument = {
      ...document,
      blocks: editedBlocks
    }
    const reparsed = parseMarkdownDocument(
      serializeMarkdownDocument(editedDocument)
    )
    const reparsedChecklist = expectBlockAtIndex(reparsed, 4)
    if (reparsedChecklist.kind !== "checklist") {
      throw new Error("Expected reparsed checklist block.")
    }
    const reparsedItem = expectFirstChecklistItem(reparsedChecklist)

    expect(reparsedItem.checked).toBe(!firstItem.checked)
    expect(reparsedItem.text).toBe(editedItemText)
    expect(reparsed.updatedAt).toBe(document.updatedAt)
  })

  it("round-trips a formula block through a standard math fence", () => {
    // Given: a runtime formula block.
    const document = parseMarkdownDocument(demoMarkdownDocument)
    const formulaSource = String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`
    const editedDocument: DemoMarkdownDocument = {
      ...document,
      blocks: [
        ...document.blocks,
        { id: "formula", kind: "formula", formula: formulaSource }
      ]
    }

    // When: the document is serialized and parsed again.
    const reparsed = parseMarkdownDocument(
      serializeMarkdownDocument(editedDocument)
    )

    // Then: the math fence preserves the formula source without internal metadata.
    expect(markdownBlockValue(expectBlockAtIndex(reparsed, 11))).toEqual({
      kind: "formula",
      formula: formulaSource
    })
  })

  it("round-trips a picture block with its upload filename", () => {
    // Given: the Markdown representation produced after a picture upload.
    const markdown = [
      "```json",
      '{"title":"T","summary":"S","tagLabel":"L","updatedAt":"2026-07-15"}',
      "```",
      "",
      "![launch\\]preview.png](blob:http://localhost/preview)"
    ].join("\n")

    // When: the document is parsed, serialized, and parsed again.
    const parsed = parseMarkdownDocument(markdown)
    const reparsed = parseMarkdownDocument(serializeMarkdownDocument(parsed))

    // Then: the picture remains a first-class block with its URL and filename.
    expect(markdownBlockValue(expectBlockAtIndex(reparsed, 0))).toEqual({
      kind: "picture",
      url: "blob:http://localhost/preview",
      filename: "launch]preview.png"
    })
  })

  it("round-trips picture URLs containing spaces", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)
    const editedDocument: DemoMarkdownDocument = {
      ...document,
      blocks: [
        ...document.blocks,
        {
          id: "spaced-picture",
          kind: "picture",
          url: "https://example.com/my picture.png",
          filename: "my picture.png"
        }
      ]
    }

    const serialized = serializeMarkdownDocument(editedDocument)
    const reparsed = parseMarkdownDocument(serialized)

    expect(serialized).toContain(
      "![my picture.png](<https://example.com/my picture.png>)"
    )
    expect(markdownBlockValue(expectBlockAtIndex(reparsed, 11))).toEqual({
      kind: "picture",
      url: "https://example.com/my picture.png",
      filename: "my picture.png"
    })
  })

  it("preserves inline image references inside text paragraphs", () => {
    const markdown = [
      "```json",
      '{"title":"T","summary":"S","tagLabel":"L","updatedAt":"2026-07-15"}',
      "```",
      "",
      "See ![Chart](chart.png) for details."
    ].join("\n")

    const parsed = parseMarkdownDocument(markdown)
    const paragraph = parsed.blocks[0]
    if (paragraph?.kind !== "paragraph") {
      throw new Error("Expected paragraph block.")
    }

    expect(paragraph.text).toBe("See ![Chart](<chart.png>) for details.")
    expect(serializeMarkdownDocument(parsed)).toContain(
      "See ![Chart](<chart.png>) for details."
    )
  })

  it("round-trips fenced block content containing backtick runs", () => {
    // Given: formula and code sources that contain a Markdown closing fence.
    const document = parseMarkdownDocument(demoMarkdownDocument)
    const formulaSource = String.raw`\text{before}
\`\`\`
\text{after}`
    const codeSource = "const before = true\n```\nconst after = true"
    const editedDocument: DemoMarkdownDocument = {
      ...document,
      blocks: [
        ...document.blocks,
        { id: "fenced-formula", kind: "formula", formula: formulaSource },
        {
          id: "fenced-code",
          kind: "code",
          language: "ts",
          code: codeSource
        }
      ]
    }

    // When: the document is serialized and parsed again.
    const reparsed = parseMarkdownDocument(
      serializeMarkdownDocument(editedDocument)
    )

    // Then: dynamic outer fences preserve both source strings exactly.
    expect(markdownBlockValue(expectBlockAtIndex(reparsed, 11))).toEqual({
      kind: "formula",
      formula: formulaSource
    })
    expect(markdownBlockValue(expectBlockAtIndex(reparsed, 12))).toEqual({
      kind: "code",
      language: "ts",
      code: codeSource
    })
  })
})
