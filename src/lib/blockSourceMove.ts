import { moveBlock } from "./blockDragTarget"
import { quoteTextLines } from "./blockSourceConversion"
import { createNoteId } from "./noteId"
import type { NoteBlock, NoteChecklistBlock, NoteQuoteBlock } from "./types"

export type BlockDragSource =
  | { readonly kind: "block" }
  | {
      readonly kind: "checklist-item"
      readonly blockId: string
      readonly sourceId: string
    }
  | {
      readonly kind: "quote-line"
      readonly blockId: string
      readonly sourceId: string
    }

export type BlockBoundaryDestination = {
  readonly placement: "after" | "before"
  readonly targetBlockId: string
}

type MoveBlockSourceInput = {
  readonly blocks: readonly NoteBlock[]
  readonly destinationIndex: number
  readonly source: BlockDragSource
  readonly sourceIndex: number
}

const moveItem = <Item,>(
  items: readonly Item[],
  sourceIndex: number,
  destinationIndex: number
): readonly Item[] => {
  const indexesAreValid =
    Number.isInteger(sourceIndex) &&
    sourceIndex >= 0 &&
    sourceIndex < items.length &&
    Number.isInteger(destinationIndex) &&
    destinationIndex >= 0 &&
    destinationIndex < items.length
  if (!indexesAreValid || sourceIndex === destinationIndex) return items

  const nextItems = items.slice()
  const [sourceItem] = nextItems.splice(sourceIndex, 1)
  if (sourceItem === undefined) return items
  nextItems.splice(destinationIndex, 0, sourceItem)
  return nextItems
}

export const moveBlockSource = ({
  blocks,
  destinationIndex,
  source,
  sourceIndex
}: MoveBlockSourceInput): readonly NoteBlock[] => {
  if (source.kind === "block") {
    return moveBlock(blocks, sourceIndex, destinationIndex)
  }

  return blocks.map((block) => {
    if (block.id !== source.blockId) return block
    if (source.kind === "checklist-item") {
      if (block.kind !== "checklist") return block
      const items = moveItem(block.items, sourceIndex, destinationIndex)
      return items === block.items ? block : { ...block, items }
    }
    if (block.kind !== "quote") return block
    const lines = quoteTextLines(block.text)
    const nextLines = moveItem(lines, sourceIndex, destinationIndex)
    return nextLines === lines ? block : { ...block, text: nextLines.join("\n") }
  })
}

type MoveBlockSourceToBoundaryInput = {
  readonly blocks: readonly NoteBlock[]
  readonly destination: BlockBoundaryDestination
  readonly source: Exclude<BlockDragSource, { readonly kind: "block" }>
  readonly sourceIndex: number
}

export const moveBlockSourceToBoundary = ({
  blocks,
  destination,
  source,
  sourceIndex
}: MoveBlockSourceToBoundaryInput): readonly NoteBlock[] => {
  if (!blocks.some((block) => block.id === source.blockId)) return blocks

  const extracted = blocks.flatMap((block) => {
    if (block.id !== source.blockId) return [block]
    if (source.kind === "checklist-item") {
      if (block.kind !== "checklist") return [block]
      return splitChecklistBlock(block, source.sourceId)
    }
    if (block.kind !== "quote") return [block]
    return splitQuoteBlock(block, sourceIndex, source.sourceId)
  })
  const extractedIndex = extracted.findIndex(
    (block) => block.id === source.sourceId
  )
  if (extractedIndex < 0) return blocks

  const nextBlocks = extracted.slice()
  const [extractedBlock] = nextBlocks.splice(extractedIndex, 1)
  if (extractedBlock === undefined) return blocks
  const targetIndex = nextBlocks.findIndex(
    (block) => block.id === destination.targetBlockId
  )
  if (destination.targetBlockId === source.blockId) {
    const sourceBlockIndex = blocks.findIndex(
      (block) => block.id === source.blockId
    )
    if (sourceBlockIndex < 0) return blocks
    const previousBlock = blocks[sourceBlockIndex - 1]
    const nextBlock = blocks[sourceBlockIndex + 1]
    const sourceBoundaryIndex =
      destination.placement === "before"
        ? previousBlock === undefined
          ? 0
          : nextBlocks.findIndex((block) => block.id === previousBlock.id) + 1
        : nextBlock === undefined
          ? nextBlocks.length
          : nextBlocks.findIndex((block) => block.id === nextBlock.id)
    if (sourceBoundaryIndex < 0) return blocks
    nextBlocks.splice(sourceBoundaryIndex, 0, extractedBlock)
    return nextBlocks
  }
  if (targetIndex < 0) return blocks
  nextBlocks.splice(
    destination.placement === "after" ? targetIndex + 1 : targetIndex,
    0,
    extractedBlock
  )
  return nextBlocks
}

const splitChecklistBlock = (
  block: NoteChecklistBlock,
  itemId: string
): NoteBlock[] => {
  const itemIndex = block.items.findIndex((item) => item.id === itemId)
  const item = block.items[itemIndex]
  if (itemIndex < 0 || item === undefined) return [block]

  const beforeItems = block.items.slice(0, itemIndex)
  const afterItems = block.items.slice(itemIndex + 1)
  const titleForExtractedItem =
    beforeItems.length === 0 && afterItems.length === 0 ? block.title : ""

  return [
    ...(beforeItems.length > 0 ? [{ ...block, items: beforeItems }] : []),
    {
      id: item.id,
      kind: "checklist",
      title: titleForExtractedItem,
      items: [item]
    },
    ...(afterItems.length > 0
      ? [
          {
            ...block,
            id: beforeItems.length > 0 ? createNoteId() : block.id,
            title: beforeItems.length > 0 ? "" : block.title,
            items: afterItems
          }
        ]
      : [])
  ]
}

const splitQuoteBlock = (
  block: NoteQuoteBlock,
  lineIndex: number,
  lineId: string
): NoteBlock[] => {
  const lines = quoteTextLines(block.text)
  const line = lines[lineIndex]
  if (line === undefined) return [block]

  const beforeLines = lines.slice(0, lineIndex)
  const afterLines = lines.slice(lineIndex + 1)
  const quoteBlock = (
    id: string,
    text: string,
    author?: string
  ): NoteQuoteBlock => ({
    id,
    kind: "quote",
    text,
    ...(author === undefined ? {} : { author })
  })

  return [
    ...(beforeLines.length > 0
      ? [quoteBlock(block.id, beforeLines.join("\n"))]
      : []),
    quoteBlock(
      lineId,
      line,
      afterLines.length === 0 ? block.author : undefined
    ),
    ...(afterLines.length > 0
      ? [quoteBlock(createNoteId(), afterLines.join("\n"), block.author)]
      : [])
  ]
}
