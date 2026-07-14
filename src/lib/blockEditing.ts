import type { NoteBlock, NoteHeadingBlock, NoteParagraphBlock } from "./types"
import { assertNever } from "./utils"

export { convertBlockFormat, convertTextBlockFormat } from "./blockConversion"

type TextBlock = NoteHeadingBlock | NoteParagraphBlock

type SplitTextBlockAtHtmlInput = {
  readonly afterHtml: string
  readonly beforeHtml: string
  readonly block: TextBlock
  readonly nextId: string
}

type InsertSplitBlockInput = {
  readonly afterHtml: string
  readonly beforeHtml: string
  readonly blocks: readonly NoteBlock[]
  readonly sourceId: string
}

type DeleteEmptyTextBlockInput = {
  readonly blocks: readonly NoteBlock[]
  readonly currentHtml: string
  readonly sourceId: string
}

export const createNextBlockId = (
  blocks: readonly NoteBlock[],
  sourceId: string
): string => {
  const takenIds = new Set(
    blocks.flatMap((block) =>
      block.kind === "checklist"
        ? [block.id, ...block.items.map((item) => item.id)]
        : [block.id]
    )
  )
  const baseId = `${sourceId}-line`

  if (!takenIds.has(baseId)) {
    return baseId
  }

  let suffix = 2
  while (takenIds.has(`${baseId}-${suffix}`)) {
    suffix += 1
  }

  return `${baseId}-${suffix}`
}

const boundaryBreakPattern = /^(?:\s*<br>\s*)+|(?:\s*<br>\s*)+$/giu

const toStoredTextBlock = (block: TextBlock, text: string): TextBlock => {
  switch (block.kind) {
    case "heading":
      return {
        id: block.id,
        kind: "heading",
        level: block.level,
        text
      }
    case "paragraph":
      return {
        id: block.id,
        kind: "paragraph",
        text,
        ...(block.tone === undefined ? {} : { tone: block.tone })
      }
    default:
      return assertNever(block)
  }
}

const toPlainStoredTextBlock = (block: TextBlock, text: string): TextBlock => {
  switch (block.kind) {
    case "heading":
      return {
        id: block.id,
        kind: "heading",
        level: block.level,
        text
      }
    case "paragraph":
      return {
        id: block.id,
        kind: "paragraph",
        text
      }
    default:
      return assertNever(block)
  }
}

export const normalizeEditableHtml = (html: string): string => {
  const normalized = html
    .trim()
    .replace(/\u200B/gu, "")
    .replace(/<\s*br\s*\/?>/giu, "<br>")
    .replace(/<\s*(?:div|p)\b[^>]*>/giu, "<br>")
    .replace(/<\s*\/\s*(?:div|p)\s*>/giu, "")

  return normalized.replace(boundaryBreakPattern, "")
}

export const isVisibleHtmlEmpty = (html: string): boolean => {
  const visibleText = normalizeEditableHtml(html)
    .replace(/<br>/giu, "")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .trim()

  return visibleText.length === 0
}

export const splitTextBlockAtHtml = ({
  afterHtml,
  beforeHtml,
  block,
  nextId
}: SplitTextBlockAtHtmlInput): readonly [TextBlock, TextBlock] => {
  const beforeText = normalizeEditableHtml(beforeHtml)
  const afterText = normalizeEditableHtml(afterHtml)
  const updatedBlock = toStoredTextBlock(block, beforeText)
  const insertedBlock = toStoredTextBlock({ ...block, id: nextId }, afterText)

  return [updatedBlock, insertedBlock]
}

export const insertSplitBlock = ({
  afterHtml,
  beforeHtml,
  blocks,
  sourceId
}: InsertSplitBlockInput): NoteBlock[] => {
  const nextId = createNextBlockId(blocks, sourceId)

  return blocks.flatMap<NoteBlock>((block): NoteBlock[] => {
    switch (block.kind) {
      case "heading":
      case "paragraph":
        if (block.id !== sourceId) return [block]
        return splitTextBlockAtHtml({
          afterHtml,
          beforeHtml,
          block,
          nextId
        }).map((textBlock) => toPlainStoredTextBlock(textBlock, textBlock.text))
      case "checklist": {
        const itemIndex = block.items.findIndex((item) => item.id === sourceId)
        if (itemIndex < 0) return [block]
        const item = block.items[itemIndex]
        if (!item) return [block]
        const items = [...block.items]
        items.splice(
          itemIndex,
          1,
          { ...item, text: normalizeEditableHtml(beforeHtml) },
          {
            id: nextId,
            checked: false,
            text: normalizeEditableHtml(afterHtml)
          }
        )
        return [{ ...block, items }]
      }
      case "quote":
      case "callout":
        if (block.id !== sourceId) return [block]
        return [
          { ...block, text: normalizeEditableHtml(beforeHtml) },
          { ...block, id: nextId, text: normalizeEditableHtml(afterHtml) }
        ]
      case "code":
        if (block.id !== sourceId) return [block]
        return [
          { ...block, code: beforeHtml },
          { ...block, id: nextId, code: afterHtml }
        ]
      case "table":
        return [block]
      default:
        return assertNever(block)
    }
  })
}

export const deleteEmptyTextBlock = ({
  blocks,
  currentHtml,
  sourceId
}: DeleteEmptyTextBlockInput): NoteBlock[] => {
  const normalizedText = normalizeEditableHtml(currentHtml)

  const checklist = blocks.find(
    (block) =>
      block.kind === "checklist" &&
      block.items.some((item) => item.id === sourceId)
  )
  if (checklist?.kind === "checklist") {
    if (!isVisibleHtmlEmpty(normalizedText)) {
      return blocks.map((block) =>
        block.id === checklist.id
          ? {
              ...checklist,
              items: checklist.items.map((item) =>
                item.id === sourceId ? { ...item, text: normalizedText } : item
              )
            }
          : block
      )
    }
    if (checklist.items.length > 1) {
      return blocks.map((block) =>
        block.id === checklist.id
          ? {
              ...checklist,
              items: checklist.items.filter((item) => item.id !== sourceId)
            }
          : block
      )
    }
    if (blocks.length === 1) {
      return [{ id: checklist.id, kind: "paragraph", text: "" }]
    }
    return blocks.filter((block) => block.id !== checklist.id)
  }

  if (!isVisibleHtmlEmpty(normalizedText)) {
    return blocks.map((block) => {
      if (block.id !== sourceId) {
        return block
      }

      switch (block.kind) {
        case "heading":
        case "paragraph":
          return toPlainStoredTextBlock(block, normalizedText)
        case "quote":
        case "callout":
          return { ...block, text: normalizedText }
        case "code":
          return { ...block, code: currentHtml }
        case "checklist":
          return block
        case "table":
          return block
        default:
          return assertNever(block)
      }
    })
  }

  const sourceBlock = blocks.find((block) => block.id === sourceId)
  if (
    (sourceBlock?.kind === "quote" && sourceBlock.author?.trim()) ||
    (sourceBlock?.kind === "callout" && sourceBlock.title.trim()) ||
    (sourceBlock?.kind === "code" && sourceBlock.filename?.trim())
  ) {
    return blocks.map((block) => {
      if (block.id !== sourceId) return block
      if (block.kind === "quote" || block.kind === "callout") {
        return { ...block, text: "" }
      }
      return block.kind === "code" ? { ...block, code: "" } : block
    })
  }

  if (blocks.length === 1) {
    return [
      {
        id: sourceId,
        kind: "paragraph",
        text: ""
      }
    ]
  }

  return blocks.filter((block) => block.id !== sourceId)
}
