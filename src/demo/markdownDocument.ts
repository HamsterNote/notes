import type { Root } from "mdast"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import { unified } from "unified"

import type { NoteBlock } from "../lib/types"
import { parseMarkdownBlocks } from "./markdownDocumentBlocks"

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
  const tree = {
    type: "root",
    children: blocks.map((block) => ({
      type: "html",
      value: serializeBlock(block)
    }))
  } satisfies Root

  return unified().use(remarkGfm).use(remarkStringify).stringify(tree).trimEnd()
}

const serializeBlock = (block: NoteBlock): string => {
  switch (block.kind) {
    case "heading":
      return [
        blockDirective(block.id, optionalAttribute("eyebrow", block.eyebrow)),
        block.text === ""
          ? "#".repeat(block.level)
          : `${"#".repeat(block.level)} ${block.text}`
      ].join("\n")
    case "paragraph":
      return [
        blockDirective(
          block.id,
          [
            block.text === "" ? requiredAttribute("empty", "true") : "",
            block.tone === undefined || block.tone === "default"
              ? ""
              : requiredAttribute("tone", block.tone)
          ].join("")
        ),
        paragraphText(block.text)
      ].join("\n")
    case "quote":
      return [blockDirective(block.id), ...quoteLines(block)].join("\n")
    case "checklist":
      return [
        `<!-- hn:checklist id="${block.id}" title="${block.title}" -->`,
        ...block.items.map(
          (item) =>
            `- [${item.checked ? "x" : " "}] <!-- hn:item id="${item.id}" --> ${item.text}`
        )
      ].join("\n")
    case "code":
      return [
        blockDirective(block.id),
        `\`\`\`${block.language}${optionalAttribute("filename", block.filename)}`,
        block.code,
        "```"
      ].join("\n")
    case "callout":
      return [
        blockDirective(block.id),
        `> [!${block.tone}] ${block.title}`,
        ...quoteTextLines(block.text)
      ].join("\n")
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

const blockDirective = (id: string, attributes = ""): string =>
  `<!-- hn:block id="${id}"${attributes} -->`

const optionalAttribute = (name: string, value: string | undefined): string =>
  value === undefined ? "" : requiredAttribute(name, value)

const requiredAttribute = (name: string, value: string): string =>
  ` ${name}="${value}"`

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
