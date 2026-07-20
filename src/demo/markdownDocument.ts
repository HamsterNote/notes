import type { Root } from "mdast"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"

import type { NoteBlock } from "../lib/types"
import { NOTE_DRAWING_FENCE_LANGUAGE } from "../lib/drawingData"
import { parseMarkdownBlocks } from "./markdownDocumentBlocks"
import { serializePicture } from "./markdownDocumentPhrasing"

type MetadataField = "title" | "summary" | "tagLabel" | "updatedAt"

export class DemoMarkdownParseError extends Error {
  readonly code: string

  constructor(options: { readonly code: string; readonly message: string }) {
    super(options.message)
    this.name = "DemoMarkdownParseError"
    this.code = options.code
  }
}

export type DemoMarkdownDocument = {
  readonly title: string
  readonly summary: string
  readonly tagLabel: string
  readonly updatedAt: string
  readonly blocks: readonly NoteBlock[]
}

export const parseMarkdownDocument = (
  markdown: string
): DemoMarkdownDocument => {
  const trimmedMarkdown = markdown.trimStart()
  const metadataMatch = /^```json\s*\n([\s\S]*?)\n```\s*\n/.exec(
    trimmedMarkdown
  )
  const metadataJson = metadataMatch?.[1]

  if (metadataMatch === null || metadataJson === undefined) {
    throw new DemoMarkdownParseError({
      code: "MISSING_METADATA_BLOCK",
      message: "Document must start with a JSON metadata fenced block."
    })
  }

  const metadata = parseMetadataJson(metadataJson)
  const body = trimmedMarkdown.slice(metadataMatch[0].length)
  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(body)

  return { ...metadata, blocks: parseMarkdownBlocks(tree) }
}

export const serializeMarkdownDocument = (
  document: DemoMarkdownDocument
): string => {
  const metadataJson = JSON.stringify(
    {
      title: document.title,
      summary: document.summary,
      tagLabel: document.tagLabel,
      updatedAt: document.updatedAt
    },
    null,
    2
  )

  return `\`\`\`json\n${metadataJson}\n\`\`\`\n\n${serializeBlocks(document.blocks)}`
}

const serializeBlocks = (blocks: readonly NoteBlock[]): string => {
  const chunks: string[] = []
  let pendingListKind: "unorderedList" | "orderedList" | null = null
  let pendingListLines: string[] = []

  const flushList = () => {
    if (pendingListKind === null) return
    if (pendingListKind === "unorderedList") {
      chunks.push(pendingListLines.map((text) => `- ${text}`).join("\n"))
    } else {
      chunks.push(
        pendingListLines
          .map((text, index) => `${index + 1}. ${text}`)
          .join("\n")
      )
    }
    pendingListKind = null
    pendingListLines = []
  }

  for (const block of blocks) {
    if (block.kind === "unorderedList" || block.kind === "orderedList") {
      if (pendingListKind !== null && pendingListKind !== block.kind) {
        flushList()
      }
      pendingListKind = block.kind
      pendingListLines.push(block.text)
      continue
    }

    flushList()
    const value = serializeBlock(block)
    if (value !== "") chunks.push(value)
  }

  flushList()
  return chunks.join("\n\n").trimEnd()
}

const serializeBlock = (block: NoteBlock): string => {
  switch (block.kind) {
    case "heading":
      return block.text === ""
        ? "#".repeat(block.level)
        : `${"#".repeat(block.level)} ${block.text}`
    case "paragraph":
      return paragraphText(block.text)
    case "quote":
      return quoteLines(block).join("\n")
    case "unorderedList":
    case "orderedList":
      return ""
    case "todo":
    case "checklist":
      return block.items
        .map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`)
        .join("\n")
    case "code":
      return fencedBlock(
        `${block.language}${filenameAttribute(block.filename)}`,
        block.code
      ).join("\n")
    case "callout":
      return [
        `> [!${block.tone}] ${block.title}`,
        ...quoteTextLines(block.text)
      ].join("\n")
    case "table":
      return serializeTableRows(block.rows).join("\n")
    case "formula":
      return fencedBlock("math", block.formula).join("\n")
    case "picture":
      return serializePicture(block)
    case "drawing":
      return fencedBlock(NOTE_DRAWING_FENCE_LANGUAGE, block.data).join("\n")
    case "directory":
      return fencedBlock("directory", "").join("\n")
    case "collapsible": {
      // 用 fenced code 块表示 collapsible：首行 JSON 元数据（title + collapsed），空行后递归序列化内部子块
      const metadata = JSON.stringify({
        title: block.title,
        collapsed: block.collapsed
      })
      const body = serializeBlocks(block.blocks)
      return fencedBlock("collapsible", `${metadata}\n\n${body}`).join("\n")
    }
    default:
      return assertNever(block)
  }
}

const quoteLines = (
  block: Extract<NoteBlock, { readonly kind: "quote" }>
): readonly string[] => {
  const lines = quoteTextLines(block.text)
  return block.author === undefined ? lines : [...lines, `> — ${block.author}`]
}

const quoteTextLines = (text: string): readonly string[] =>
  text.split("\n").map((line) => `> ${line}`)

const paragraphText = (text: string): string => text.replaceAll("\n", "<br>")

const fencedBlock = (info: string, content: string): readonly string[] => {
  const longestBacktickRun = Array.from(content.matchAll(/`+/gu)).reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0
  )
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1))
  return [`${fence}${info}`, content, fence]
}

const serializeTableCell = (text: string): string =>
  text.replaceAll("\n", "<br>").replaceAll("|", "\\|")

const serializeTableRows = (
  rows: readonly (readonly string[])[]
): readonly string[] => {
  const header = rows[0]
  if (!header) return []
  const colCount = header.length
  const separator = Array.from({ length: colCount }, () => "---")

  return [
    `| ${header.map(serializeTableCell).join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.slice(1).map(
      (row) => `| ${row.map(serializeTableCell).join(" | ")} |`
    )
  ]
}

const filenameAttribute = (filename: string | undefined): string =>
  filename === undefined
    ? ""
    : ` filename="${filename.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

const assertNever = (value: never): never => {
  throw new Error(`Unsupported note block: ${JSON.stringify(value)}`)
}

const parseMetadataJson = (
  metadataJson: string
): Omit<DemoMarkdownDocument, "blocks"> => {
  let metadata: unknown

  try {
    metadata = JSON.parse(metadataJson)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DemoMarkdownParseError({
        code: "INVALID_METADATA_JSON",
        message: `Metadata JSON is invalid: ${error.message}`
      })
    }
    throw error
  }

  if (!isRecord(metadata)) {
    throw new DemoMarkdownParseError({
      code: "INVALID_METADATA_JSON",
      message: "Metadata JSON must be an object."
    })
  }

  return {
    title: readMetadataString(metadata, "title", "MISSING_TITLE"),
    summary: readMetadataString(metadata, "summary", "MISSING_SUMMARY"),
    tagLabel: readMetadataString(metadata, "tagLabel", "MISSING_TAG_LABEL"),
    updatedAt: readMetadataString(metadata, "updatedAt", "INVALID_UPDATED_AT")
  }
}

const readMetadataString = (
  metadata: Readonly<Record<string, unknown>>,
  field: MetadataField,
  code: string
): string => {
  const value = metadata[field]
  if (typeof value === "string") return value

  throw new DemoMarkdownParseError({
    code,
    message: `Metadata field "${field}" must be a string.`
  })
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null
