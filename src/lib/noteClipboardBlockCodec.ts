import { parseCardData } from "./cardData"
import {
  MAX_CLIPBOARD_LIST_ITEMS,
  MAX_CLIPBOARD_TABLE_CELLS,
  MAX_CLIPBOARD_TABLE_ROWS,
} from "./noteClipboardLimits"
import { createNoteId } from "./noteId"
import { sanitizeBodyHtml } from "./restrictedHtml"
import type { NoteBlock, NoteCardBlock, NoteCardData } from "./types"
import { assertNever } from "./utils"

const MAX_CLIPBOARD_BLOCK_DEPTH = 8
const MAX_CLIPBOARD_BLOCKS = 256
const MAX_CLIPBOARD_STRING_LENGTH = 1_000_000

type ParseBudget = { remainingBlocks: number }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  isRecord(value) ? value : null

const stringField = (value: Readonly<Record<string, unknown>>, key: string): string | null => {
  const field = value[key]
  return typeof field === "string" && field.length <= MAX_CLIPBOARD_STRING_LENGTH ? field : null
}

const optionalString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | null | undefined => {
  const field = value[key]
  return field === undefined || (typeof field === "string" && field.length <= MAX_CLIPBOARD_STRING_LENGTH)
    ? field
    : null
}

const parseListItems = (value: unknown): readonly { readonly id: string; readonly checked: boolean; readonly text: string }[] | null => {
  if (!Array.isArray(value) || value.length > MAX_CLIPBOARD_LIST_ITEMS) return null
  const items = []
  for (const candidate of value) {
    const item = record(candidate)
    if (!item) return null
    const id = stringField(item, "id")
    const text = stringField(item, "text")
    const checked = item["checked"]
    if (id === null || text === null || typeof checked !== "boolean") return null
    items.push({ id, checked, text: sanitizeBodyHtml(text) })
  }
  return items
}

const parseTextBlock = (
  value: Readonly<Record<string, unknown>>,
  id: string,
  kind: "orderedList" | "paragraph" | "quote" | "unorderedList",
): NoteBlock | null => {
  const text = stringField(value, "text")
  if (text === null) return null
  if (kind === "paragraph") {
    const tone = value["tone"]
    if (tone !== undefined && tone !== "default" && tone !== "muted" && tone !== "accent") return null
    return { id, kind, text: sanitizeBodyHtml(text), ...(tone ? { tone } : {}) }
  }
  if (kind === "quote") {
    const author = optionalString(value, "author")
    return author === null
      ? null
      : {
          id,
          kind,
          text: sanitizeBodyHtml(text),
          ...(author ? { author: sanitizeBodyHtml(author) } : {}),
        }
  }
  return { id, kind, text: sanitizeBodyHtml(text) }
}

const parseStructuredBlock = (
  value: Readonly<Record<string, unknown>>,
  id: string,
  kind: "callout" | "checklist" | "collapsible" | "table" | "todo",
  depth: number,
  budget: ParseBudget,
): NoteBlock | null => {
  if (kind === "table") {
    const rawRows = value["rows"]
    if (!Array.isArray(rawRows) || rawRows.length > MAX_CLIPBOARD_TABLE_ROWS) return null
    const rows = []
    for (const candidate of rawRows) {
      if (
        !Array.isArray(candidate)
        || candidate.length > MAX_CLIPBOARD_TABLE_CELLS
        || !candidate.every((cell) => typeof cell === "string")
      ) return null
      rows.push(candidate.map(sanitizeBodyHtml))
    }
    return { id, kind, rows }
  }
  const title = stringField(value, "title")
  if (title === null) return null
  if (kind === "todo" || kind === "checklist") {
    const items = parseListItems(value["items"])
    return items ? { id, kind, title: sanitizeBodyHtml(title), items } : null
  }
  if (kind === "callout") {
    const text = stringField(value, "text")
    const tone = value["tone"]
    return text !== null && (tone === "info" || tone === "success" || tone === "warning")
      ? { id, kind, title: sanitizeBodyHtml(title), text: sanitizeBodyHtml(text), tone }
      : null
  }
  const collapsed = value["collapsed"]
  const rawBlocks = value["blocks"]
  if (typeof collapsed !== "boolean" || !Array.isArray(rawBlocks)) return null
  const blocks = []
  for (const candidate of rawBlocks) {
    const block = parseClipboardBlockAt(candidate, depth + 1, budget)
    if (!block) return null
    blocks.push(block)
  }
  return { id, kind, title: sanitizeBodyHtml(title), collapsed, blocks }
}

const parseClipboardBlockAt = (
  value: unknown,
  depth: number,
  budget: ParseBudget,
): NoteBlock | null => {
  if (depth > MAX_CLIPBOARD_BLOCK_DEPTH || budget.remainingBlocks <= 0) return null
  budget.remainingBlocks -= 1
  const source = record(value)
  if (!source) return null
  const id = stringField(source, "id")
  const kind = stringField(source, "kind")
  if (id === null || kind === null) return null
  switch (kind) {
    case "orderedList":
    case "paragraph":
    case "quote":
    case "unorderedList":
      return parseTextBlock(source, id, kind)
    case "callout":
    case "checklist":
    case "collapsible":
    case "table":
    case "todo":
      return parseStructuredBlock(source, id, kind, depth, budget)
    case "heading": {
      const text = stringField(source, "text")
      const eyebrow = optionalString(source, "eyebrow")
      const level = source["level"]
      return text !== null && eyebrow !== null && (level === 1 || level === 2 || level === 3 || level === 4 || level === 5)
        ? {
            id,
            kind,
            level,
            text: sanitizeBodyHtml(text),
            ...(eyebrow ? { eyebrow: sanitizeBodyHtml(eyebrow) } : {}),
          }
        : null
    }
    case "code": {
      const code = stringField(source, "code")
      const language = stringField(source, "language")
      const filename = optionalString(source, "filename")
      return code !== null && language !== null && filename !== null
        ? { id, kind, code, language, ...(filename ? { filename } : {}) }
        : null
    }
    case "formula": {
      const formula = stringField(source, "formula")
      return formula === null ? null : { id, kind, formula }
    }
    case "picture": {
      const url = stringField(source, "url")
      const filename = stringField(source, "filename")
      const width = source["width"]
      const height = source["height"]
      if (url === null || filename === null) return null
      if (width !== undefined && typeof width !== "number") return null
      if (height !== undefined && typeof height !== "number") return null
      return { id, kind, url, filename, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) }
    }
    case "card": {
      const data = parseCardData(JSON.stringify(source["data"]))
      return data ? { id, kind, data } : null
    }
    case "drawing": {
      const data = stringField(source, "data")
      return data === null ? null : { id, kind, data }
    }
    case "directory":
      return { id, kind }
    default:
      return null
  }
}

export const parseClipboardBlock = (value: unknown): NoteBlock | null =>
  parseClipboardBlockAt(value, 0, { remainingBlocks: MAX_CLIPBOARD_BLOCKS })

const cloneCardData = (cards: readonly NoteCardData[]): readonly NoteCardData[] => {
  const ids = new Map(cards.map((card) => [card.id, createNoteId()]))
  return cards.map((card) => {
    const { parent: oldParent, linkedCardIds, ...withoutRelationships } = card
    const parent = oldParent ? ids.get(oldParent) : undefined
    return {
      ...withoutRelationships,
      id: ids.get(card.id) ?? createNoteId(),
      ...(parent ? { parent } : {}),
      ...(linkedCardIds
        ? { linkedCardIds: linkedCardIds.flatMap((linkedId) => ids.get(linkedId) ?? []) }
        : {}),
    }
  })
}

export const cloneClipboardBlock = (block: NoteBlock): NoteBlock => {
  const id = createNoteId()
  switch (block.kind) {
    case "todo":
    case "checklist":
      return { ...block, id, items: block.items.map((item) => ({ ...item, id: createNoteId() })) }
    case "collapsible":
      return { ...block, id, blocks: block.blocks.map(cloneClipboardBlock) }
    case "card":
      return { ...block, id, data: cloneCardData(block.data) } satisfies NoteCardBlock
    case "heading":
    case "paragraph":
    case "unorderedList":
    case "orderedList":
    case "quote":
    case "code":
    case "callout":
    case "table":
    case "formula":
    case "picture":
    case "drawing":
    case "directory":
      return { ...block, id }
  }
  return assertNever(block)
}
