import type {
  NoteBlock,
  NoteHeadingBlock,
  NoteParagraphBlock
} from "./types"
import { assertNever } from "./utils"

type TextBlock = NoteHeadingBlock | NoteParagraphBlock

type HeadingTarget = {
  readonly kind: "heading"
  readonly level: 1 | 2 | 3 | 4 | 5
}

type ParagraphTarget = {
  readonly kind: "paragraph"
}

type StructuralTarget = {
  readonly kind: "checklist" | "quote" | "code" | "callout" | "table"
}

export type BlockConvertTarget =
  | HeadingTarget
  | ParagraphTarget
  | StructuralTarget

export type TextBlockTarget = HeadingTarget | ParagraphTarget

type ConvertedHeadingBlock = Omit<NoteHeadingBlock, "level"> & {
  readonly level: 1 | 2 | 3 | 4 | 5
}

type ConvertedTextBlock = ConvertedHeadingBlock | NoteParagraphBlock

export const convertTextBlockFormat = (
  block: TextBlock,
  target: TextBlockTarget
): ConvertedTextBlock => {
  switch (target.kind) {
    case "heading":
      return {
        id: block.id,
        kind: "heading",
        level: target.level,
        text: block.text
      }
    case "paragraph":
      return { id: block.id, kind: "paragraph", text: block.text }
    default:
      return assertNever(target)
  }
}

const escapePlainText = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

const escapeCodeAsRichText = (code: string): string =>
  escapePlainText(code)
    .replaceAll("\n", "<br>")

const decodeHtmlEntity = (_match: string, entity: string): string => {
  switch (entity) {
    case "amp":
      return "&"
    case "lt":
      return "<"
    case "gt":
      return ">"
    case "quot":
      return '"'
    case "#39":
    case "apos":
      return "'"
    case "nbsp":
      return " "
    default:
      if (entity.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
      }
      return `&${entity};`
  }
}

const richTextToPlainText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:div|p|li|blockquote|h[1-6])>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&([^;]+);/gu, decodeHtmlEntity)
    .replace(/\n{3,}/gu, "\n\n")
    .trim()

const blockAsRichText = (block: NoteBlock): string => {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return block.text
    case "checklist":
      return [
        `<strong>${escapePlainText(block.title)}</strong>`,
        ...block.items.map(
          (item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`
        )
      ].join("<br>")
    case "quote": {
      const author = block.author?.trim()
      return author ? `${block.text}<br>${escapePlainText(author)}` : block.text
    }
    case "callout":
      return `<strong>${escapePlainText(block.title)}</strong><br>${block.text}`
    case "code": {
      const filename = block.filename?.trim()
      const metadata = filename
        ? `${filename} (${block.language})`
        : block.language
      return `<strong>${escapePlainText(metadata)}</strong><br>${escapeCodeAsRichText(block.code)}`
    }
    case "table":
      return block.rows
        .flatMap((row) => row.map((cell) => cell))
        .join("<br>")
    default:
      return assertNever(block)
  }
}

export const convertBlockFormat = (
  block: NoteBlock,
  target: BlockConvertTarget
): NoteBlock => {
  if (block.kind === target.kind) {
    if (block.kind !== "heading" || target.kind !== "heading") return block
    return convertTextBlockFormat(block, target)
  }

  const text = blockAsRichText(block)
  switch (target.kind) {
    case "heading":
      return { id: block.id, kind: "heading", level: target.level, text }
    case "paragraph":
      return { id: block.id, kind: "paragraph", text }
    case "checklist":
      return {
        id: block.id,
        kind: "checklist",
        title: "List",
        items: [{ id: `${block.id}-item`, checked: false, text }]
      }
    case "quote":
      return { id: block.id, kind: "quote", text }
    case "code":
      return {
        id: block.id,
        kind: "code",
        language: "text",
        code: richTextToPlainText(text)
      }
    case "callout":
      return {
        id: block.id,
        kind: "callout",
        tone: "info",
        title: "Note",
        text
      }
    case "table":
      return {
        id: block.id,
        kind: "table",
        rows: [[text]]
      }
    default:
      return assertNever(target)
  }
}
