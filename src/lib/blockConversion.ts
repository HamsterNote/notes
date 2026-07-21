import { createNoteId } from "./noteId"
import type { NoteBlock, NoteHeadingBlock, NoteParagraphBlock } from "./types"
import { assertNever } from "./utils"

type TextBlock = NoteHeadingBlock | NoteParagraphBlock

type HeadingTarget = {
  readonly kind: "heading"
  readonly level: 1 | 2 | 3 | 4 | 5
}

type ParagraphTarget = {
  readonly kind: "paragraph"
}

type TodoTarget = { readonly kind: "todo" }
type UnorderedListTarget = { readonly kind: "unorderedList" }
type OrderedListTarget = { readonly kind: "orderedList" }
type QuoteTarget = { readonly kind: "quote" }
type CodeTarget = { readonly kind: "code" }
type CalloutTarget = { readonly kind: "callout" }
type TableTarget = { readonly kind: "table" }
type FormulaTarget = { readonly kind: "formula" }
type DirectoryTarget = { readonly kind: "directory" }
type CollapsibleTarget = { readonly kind: "collapsible" }
type CardTarget = { readonly kind: "card" }
type DrawingTarget = { readonly kind: "drawing" }

type StructuralTarget =
  | TodoTarget
  | UnorderedListTarget
  | OrderedListTarget
  | QuoteTarget
  | CodeTarget
  | CalloutTarget
  | TableTarget
  | FormulaTarget
  | DirectoryTarget
  | CollapsibleTarget
  | CardTarget
  | DrawingTarget

export type BlockConvertTarget =
  | HeadingTarget
  | ParagraphTarget
  | StructuralTarget

export type TextBlockTarget = HeadingTarget | ParagraphTarget

type ConvertedHeadingBlock = Omit<NoteHeadingBlock, "level"> & {
  readonly level: 1 | 2 | 3 | 4 | 5
}

type ConvertedTextBlock = ConvertedHeadingBlock | NoteParagraphBlock

type ListConvertTarget = {
  readonly kind: "todo" | "unorderedList" | "orderedList"
}

const convertToListBlock = (
  block: NoteBlock,
  target: ListConvertTarget,
  todoItemId: string | undefined,
  text: string
): NoteBlock => {
  switch (block.kind) {
    case "todo": {
      if (target.kind === "todo") return block
      const item = block.items[0]
      return {
        id: block.id,
        kind: target.kind,
        text: item?.text ?? ""
      }
    }
    case "unorderedList":
    case "orderedList": {
      if (target.kind === block.kind) return block
      if (target.kind === "todo") {
        return {
          id: block.id,
          kind: "todo",
          title: "",
          items: [
            {
              id: todoItemId ?? createNoteId(),
              checked: false,
              text: block.text
            }
          ]
        }
      }
      return { id: block.id, kind: target.kind, text: block.text }
    }
    default:
      if (target.kind === "todo") {
        return {
          id: block.id,
          kind: "todo",
          title: "",
          items: [{ id: todoItemId ?? createNoteId(), checked: false, text }]
        }
      }
      return { id: block.id, kind: target.kind, text }
  }
}

export const convertBlockFormatToBlocks = (
  block: NoteBlock,
  target: BlockConvertTarget,
  todoItemId?: string
): readonly NoteBlock[] => {
  if (block.kind === "todo" && (target.kind === "unorderedList" || target.kind === "orderedList")) {
    return block.items.map((item, index) => ({
      id: index === 0 ? block.id : item.id,
      kind: target.kind,
      text: item.text
    }))
  }
  return [convertBlockFormat(block, target, todoItemId)]
}

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
    case "todo":
    case "checklist":
      return [
        `<strong>${escapePlainText(block.title)}</strong>`,
        ...block.items.map(
          (item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`
        )
      ].join("<br>")
    case "unorderedList":
    case "orderedList":
      return block.text
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
    case "formula":
      return escapeCodeAsRichText(block.formula)
    case "picture":
      return escapePlainText(block.filename)
    case "card":
      return block.data.length > 0
        ? block.data.map((card) => escapePlainText(card.title)).join("<br>")
        : "[Cards]"
    case "drawing":
      return "[Drawing]"
    case "collapsible":
      return block.title
    case "directory":
      return ""
    default:
      return assertNever(block)
  }
}

export const convertBlockFormat = (
  block: NoteBlock,
  target: BlockConvertTarget,
  todoItemId?: string
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
    case "todo":
    case "unorderedList":
    case "orderedList":
      return convertToListBlock(block, target, todoItemId, text)
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
    case "formula":
      return {
        id: block.id,
        kind: "formula",
        formula: richTextToPlainText(text)
      }
    case "directory":
      return { id: block.id, kind: "directory" }
    case "card":
      return { id: block.id, kind: "card", data: [] }
    case "drawing":
      return { id: block.id, kind: "drawing", data: "" }
    case "collapsible":
      return {
        id: block.id,
        kind: "collapsible",
        title: text,
        collapsed: false,
        blocks: []
      }
    default:
      return assertNever(target)
  }
}
