import type { BlockConvertTarget } from "./blockConversion"
import { convertBlockFormat } from "./blockConversion"
import type {
  NoteBlock,
  NoteChecklistBlock,
  NoteQuoteBlock
} from "./types"
import { assertNever } from "./utils"

export type BlockSource =
  | { readonly kind: "block"; readonly blockId: string }
  | {
      readonly kind: "checklist-item"
      readonly blockId: string
      readonly itemId: string
    }
  | {
      readonly kind: "quote-line"
      readonly blockId: string
      readonly lineId: string
      readonly lineIndex: number
    }

type ConvertBlockSourceInput = {
  readonly blocks: readonly NoteBlock[]
  readonly source: BlockSource
  readonly target: BlockConvertTarget
}

export const quoteTextLines = (text: string): readonly string[] =>
  text.split(/\n|<br\s*\/?>/giu)

export const quoteLineId = (blockId: string, lineIndex: number): string =>
  lineIndex === 0 ? blockId : `${blockId}-line-${lineIndex}`

const convertChecklistItem = (
  block: NoteChecklistBlock,
  itemId: string,
  target: BlockConvertTarget
): NoteBlock[] => {
  const itemIndex = block.items.findIndex((item) => item.id === itemId)
  const item = block.items[itemIndex]
  if (itemIndex < 0 || item === undefined) return [block]

  const beforeItems = block.items.slice(0, itemIndex)
  const afterItems = block.items.slice(itemIndex + 1)
  const isOnlyItem = beforeItems.length === 0 && afterItems.length === 0
  const itemText = `${item.checked ? "[x]" : "[ ]"} ${item.text}`
  const title = block.title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
  const converted = convertBlockFormat(
    {
      id: item.id,
      kind: "paragraph",
      text: isOnlyItem ? `<strong>${title}</strong><br>${itemText}` : itemText
    },
    target
  )

  return [
    ...(beforeItems.length > 0 ? [{ ...block, items: beforeItems }] : []),
    converted,
    ...(afterItems.length > 0
      ? [
          {
            ...block,
            id: `${block.id}-after-${item.id}`,
            title: beforeItems.length > 0 ? "" : block.title,
            items: afterItems
          }
        ]
      : [])
  ]
}

const quoteSegment = (
  id: string,
  lines: readonly string[],
  author?: string
): NoteQuoteBlock => ({
  id,
  kind: "quote",
  text: lines.join("\n"),
  ...(author === undefined ? {} : { author })
})

const convertQuoteLine = (
  block: NoteQuoteBlock,
  lineId: string,
  lineIndex: number,
  target: BlockConvertTarget
): NoteBlock[] => {
  const lines = quoteTextLines(block.text)
  const line = lines[lineIndex]
  if (line === undefined) return [block]

  const beforeLines = lines.slice(0, lineIndex)
  const afterLines = lines.slice(lineIndex + 1)
  const authorStaysAfter = afterLines.length > 0
  const isOnlyLine = beforeLines.length === 0 && afterLines.length === 0
  const converted = convertBlockFormat(
    isOnlyLine ? { ...block, id: lineId, text: line } : {
      id: lineId,
      kind: "paragraph",
      text: line
    },
    target
  )

  return [
    ...(beforeLines.length > 0
      ? [
          quoteSegment(
            block.id,
            beforeLines,
            authorStaysAfter ? undefined : block.author
          )
        ]
      : []),
    converted,
    ...(afterLines.length > 0
      ? [
          quoteSegment(
            `${block.id}-after-${lineId}`,
            afterLines,
            block.author
          )
        ]
      : [])
  ]
}

export const convertBlockSource = ({
  blocks,
  source,
  target
}: ConvertBlockSourceInput): NoteBlock[] =>
  blocks.flatMap((block) => {
    if (block.id !== source.blockId) return [block]

    switch (source.kind) {
      case "block":
        return [convertBlockFormat(block, target)]
      case "checklist-item":
        return block.kind === "checklist"
          ? convertChecklistItem(block, source.itemId, target)
          : [block]
      case "quote-line":
        return block.kind === "quote"
          ? convertQuoteLine(block, source.lineId, source.lineIndex, target)
          : [block]
      default:
        return assertNever(source)
    }
  })
