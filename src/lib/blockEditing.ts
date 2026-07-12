import type { NoteBlock, NoteHeadingBlock, NoteParagraphBlock } from "./types"
import { assertNever } from "./utils"

type TextBlock = NoteHeadingBlock | NoteParagraphBlock

type HeadingLevel = 1 | 2 | 3 | 4 | 5

type ConvertedHeadingBlock = Omit<NoteHeadingBlock, "level"> & {
  readonly level: HeadingLevel
}

type ConvertedTextBlock = ConvertedHeadingBlock | NoteParagraphBlock

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

type HeadingTarget = {
  readonly kind: "heading"
  readonly level: HeadingLevel
}

type ParagraphTarget = {
  readonly kind: "paragraph"
}

type TextBlockTarget = HeadingTarget | ParagraphTarget

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
      return {
        id: block.id,
        kind: "paragraph",
        text: block.text
      }
    default:
      return assertNever(target)
  }
}

export const createNextBlockId = (
  blocks: readonly NoteBlock[],
  sourceId: string
): string => {
  const takenIds = new Set(blocks.map((block) => block.id))
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

  return blocks.flatMap((block) => {
    if (block.id !== sourceId) {
      return [block]
    }

    switch (block.kind) {
      case "heading":
      case "paragraph":
        return splitTextBlockAtHtml({
          afterHtml,
          beforeHtml,
          block,
          nextId
        }).map((textBlock) => toPlainStoredTextBlock(textBlock, textBlock.text))
      default:
        return [block]
    }
  })
}

export const deleteEmptyTextBlock = ({
  blocks,
  currentHtml,
  sourceId
}: DeleteEmptyTextBlockInput): NoteBlock[] => {
  const normalizedText = normalizeEditableHtml(currentHtml)

  if (!isVisibleHtmlEmpty(normalizedText)) {
    return blocks.map((block) => {
      if (block.id !== sourceId) {
        return block
      }

      switch (block.kind) {
        case "heading":
        case "paragraph":
          return toPlainStoredTextBlock(block, normalizedText)
        default:
          return block
      }
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
