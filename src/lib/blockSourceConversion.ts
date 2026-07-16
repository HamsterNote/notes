import type { BlockConvertTarget } from "./blockConversion"
import { convertBlockFormat } from "./blockConversion"
import { createNoteId } from "./noteId"
import type {
  NoteBlock,
  NoteChecklistBlock,
  NotePictureBlock,
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
  readonly checklistItemId?: string | undefined
  readonly replacementId?: string | undefined
  readonly source: BlockSource
  readonly target: BlockConvertTarget
}

type ReplaceBlockSourceWithPictureInput = {
  readonly blocks: readonly NoteBlock[]
  readonly source: BlockSource
  readonly url: string
  readonly filename: string
  readonly width?: number | undefined
  readonly height?: number | undefined
}

type ReplaceSourceBlock = (sourceBlock: NoteBlock) => NoteBlock

export const quoteTextLines = (text: string): readonly string[] =>
  text.split(/\n|<br\s*\/?>/giu)

export const quoteLineId = (blockId: string, lineIndex: number): string =>
  lineIndex === 0 ? blockId : `${blockId}-line-${lineIndex}`

const replaceChecklistItem = (
  block: NoteChecklistBlock,
  itemId: string,
  replace: ReplaceSourceBlock
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
  const replacement = replace({
      id: item.id,
      kind: "paragraph",
      text: isOnlyItem ? `<strong>${title}</strong><br>${itemText}` : itemText
  })

  return [
    ...(beforeItems.length > 0 ? [{ ...block, items: beforeItems }] : []),
    replacement,
    ...(afterItems.length > 0
      ? [
          {
            ...block,
            id: createNoteId(),
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

const replaceQuoteLine = (
  block: NoteQuoteBlock,
  lineIndex: number,
  replacementId: string,
  replace: ReplaceSourceBlock
): NoteBlock[] => {
  const lines = quoteTextLines(block.text)
  const line = lines[lineIndex]
  if (line === undefined) return [block]

  const beforeLines = lines.slice(0, lineIndex)
  const afterLines = lines.slice(lineIndex + 1)
  const authorStaysAfter = afterLines.length > 0
  const isOnlyLine = beforeLines.length === 0 && afterLines.length === 0
  const replacement = replace(
    isOnlyLine ? { ...block, id: replacementId, text: line } : {
      id: replacementId,
      kind: "paragraph",
      text: line
    }
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
    replacement,
    ...(afterLines.length > 0
      ? [
          quoteSegment(
            createNoteId(),
            afterLines,
            block.author
          )
        ]
      : [])
  ]
}

type ReplaceBlockSourceInput = {
  readonly blocks: readonly NoteBlock[]
  readonly replacementId?: string | undefined
  readonly source: BlockSource
  readonly replace: ReplaceSourceBlock
}

const replaceBlockSource = ({
  blocks,
  replacementId,
  source,
  replace
}: ReplaceBlockSourceInput): NoteBlock[] =>
  blocks.flatMap((block) => {
    if (block.id !== source.blockId) return [block]

    switch (source.kind) {
      case "block":
        return [replace(block)]
      case "checklist-item":
        return block.kind === "checklist"
          ? replaceChecklistItem(block, source.itemId, replace)
          : [block]
      case "quote-line":
        return block.kind === "quote"
          ? replaceQuoteLine(
              block,
              source.lineIndex,
              source.lineIndex === 0
                ? block.id
                : replacementId ?? createNoteId(),
              replace
            )
          : [block]
      default:
        return assertNever(source)
    }
  })

export const convertBlockSource = ({
  blocks,
  checklistItemId,
  replacementId,
  source,
  target
}: ConvertBlockSourceInput): NoteBlock[] =>
  replaceBlockSource({
    blocks,
    replacementId,
    source,
    replace: (sourceBlock) =>
      convertBlockFormat(sourceBlock, target, checklistItemId)
  })

export const replaceBlockSourceWithPicture = ({
  blocks,
  source,
  url,
  filename,
  width,
  height
}: ReplaceBlockSourceWithPictureInput): NoteBlock[] =>
  replaceBlockSource({
    blocks,
    source,
    replace: (sourceBlock): NotePictureBlock => ({
      id: sourceBlock.id,
      kind: "picture",
      url,
      filename,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height })
    })
  })
