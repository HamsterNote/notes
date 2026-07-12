import { describe, expect, it } from "vitest"
import type {
  NoteBlock,
  NoteChecklistBlock,
  NoteChecklistItem
} from "../lib/types"
import type { DemoMarkdownDocument } from "./markdownDocument"
import {
  DemoMarkdownParseError,
  parseMarkdownDocument,
  serializeMarkdownDocument
} from "./markdownDocument"
import { demoMarkdownDocument } from "./noteData"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const expectBlock = (document: DemoMarkdownDocument, id: string): NoteBlock => {
  const block = document.blocks.find((candidate) => candidate.id === id)
  if (block === undefined) throw new Error(`Expected block ${id} to exist.`)
  return block
}

const expectChecklistBlock = (
  document: DemoMarkdownDocument,
  id: string
): NoteChecklistBlock => {
  const block = expectBlock(document, id)
  if (block.kind !== "checklist") {
    throw new Error(`Expected block ${id} to be a checklist.`)
  }
  return block
}

const expectChecklistItem = (
  block: NoteChecklistBlock,
  id: string
): NoteChecklistItem => {
  const item = block.items.find((candidate) => candidate.id === id)
  if (item === undefined) {
    throw new Error(`Expected checklist item ${id} to exist.`)
  }
  return item
}

const expectFirstChecklistItem = (
  block: NoteChecklistBlock
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

const stringContaining = (
  s: string
): { asymmetricMatch: (other: string) => boolean } => ({
  asymmetricMatch: (other: string) => other.includes(s)
})

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
  it("parses default document metadata correctly", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)

    expect(document.title).toBe("Launch Notes for the first public package")
    expect(document.summary).toContain("editorial note surface")
    expect(document.tagLabel).toBe("Release candidate")
    expect(document.updatedAt).toBe("2026-07-11")
  })

  it("preserves representative fields from the default document blocks", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)

    expect(document.blocks).toHaveLength(10)
    expect(expectBlock(document, "hero")).toMatchObject({
      eyebrow: "Hamster Note",
      kind: "heading",
      level: 1,
      text: stringContaining("Ship a note component")
    })
    expect(expectBlock(document, "intro")).toMatchObject({
      kind: "paragraph",
      tone: "accent"
    })
    expect(expectBlock(document, "principle")).toMatchObject({
      kind: "quote",
      text: stringContaining("Readable note surfaces")
    })
    expect(expectBlock(document, "subheading")).toMatchObject({
      eyebrow: "Launch checklist",
      kind: "heading",
      level: 2
    })

    const checklist = expectChecklistBlock(document, "checklist")
    expect(checklist.title).toBe("Release readiness")
    expect(checklist.items).toHaveLength(3)
    expect(checklist.items.some((item) => item.checked)).toBe(true)
    expect(checklist.items.every((item) => item.checked)).toBe(true)
    for (const item of checklist.items) {
      expect(item.id).not.toBe("")
      expect(item.text).not.toBe("")
      expect(typeof item.checked).toBe("boolean")
    }

    expect(expectBlock(document, "callout")).toMatchObject({
      kind: "callout",
      text: stringContaining("typed block array"),
      title: "Structured input, flexible visuals",
      tone: "info"
    })
    expect(expectBlock(document, "code-heading")).toMatchObject({
      kind: "heading",
      level: 3
    })

    const code = expectBlock(document, "code")
    expect(code).toMatchObject({
      filename: "App.tsx",
      kind: "code",
      language: "tsx"
    })
    if (code.kind !== "code") throw new Error("Expected code block.")
    expect(code.code.trim()).not.toBe("")

    expect(expectBlock(document, "ending")).toMatchObject({
      kind: "paragraph",
      tone: "muted"
    })
    expect(expectBlock(document, "warning")).toMatchObject({
      kind: "callout",
      title: "Versioning rule",
      tone: "warning"
    })
  })

  it("parses quote author from the author line", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)

    expect(expectBlock(document, "principle")).toMatchObject({
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
  it("round-trips parsed documents through serialization", () => {
    const document = parseMarkdownDocument(demoMarkdownDocument)
    const reparsed = parseMarkdownDocument(serializeMarkdownDocument(document))

    expect(reparsed.title).toBe(document.title)
    expect(reparsed.summary).toBe(document.summary)
    expect(reparsed.tagLabel).toBe(document.tagLabel)
    expect(reparsed.updatedAt).toBe(document.updatedAt)
    expect(reparsed.blocks).toHaveLength(document.blocks.length)

    for (let index = 0; index < document.blocks.length; index += 1) {
      const originalBlock = expectBlockAtIndex(document, index)
      const reparsedBlock = expectBlockAtIndex(reparsed, index)
      expect(reparsedBlock.id).toBe(originalBlock.id)
      expect(reparsedBlock.kind).toBe(originalBlock.kind)
      expect(reparsedBlock).toEqual(originalBlock)
    }
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
    const checklist = expectChecklistBlock(document, "checklist")
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
    const reparsedChecklist = expectChecklistBlock(reparsed, checklist.id)
    const reparsedItem = expectChecklistItem(reparsedChecklist, firstItem.id)

    expect(reparsedItem.checked).toBe(!firstItem.checked)
    expect(reparsedItem.text).toBe(editedItemText)
    expect(reparsed.updatedAt).toBe(document.updatedAt)
  })
})
