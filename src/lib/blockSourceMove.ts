import {
  type BlockContainerId,
  updateBlockContainer
} from "./blockContainerMove"
import { moveBlock } from "./blockDragTarget"
import { quoteTextLines } from "./blockSourceConversion"
import { splitQuoteBlock, splitTodoBlock } from "./blockSourceSplit"
import type { NoteBlock } from "./types"

export type BlockDragSource =
  | {
      readonly kind: "block"
      readonly blockId: string
      readonly containerId: BlockContainerId
    }
  | {
      readonly kind: "todo-item"
      readonly blockId: string
      readonly containerId: BlockContainerId
      readonly sourceId: string
    }
  | {
      readonly kind: "quote-line"
      readonly blockId: string
      readonly containerId: BlockContainerId
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

  return updateBlockContainer(blocks, source.containerId, (children) =>
    children.map((block) => {
      if (block.id !== source.blockId) return block
      if (source.kind === "todo-item") {
        if (block.kind !== "todo") return block
        const items = moveItem(block.items, sourceIndex, destinationIndex)
        return items === block.items ? block : { ...block, items }
      }
      if (block.kind !== "quote") return block
      const lines = quoteTextLines(block.text)
      const nextLines = moveItem(lines, sourceIndex, destinationIndex)
      return nextLines === lines ? block : { ...block, text: nextLines.join("\n") }
    })
  )
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
  if (source.containerId !== null) {
    let extractedBlock: NoteBlock | undefined
    const extracted = updateBlockContainer(
      blocks,
      source.containerId,
      (children) =>
        children.flatMap((block) => {
          if (block.id !== source.blockId) return [block]
          const split =
            source.kind === "todo-item"
              ? block.kind === "todo"
                ? splitTodoBlock(block, source.sourceId)
                : [block]
              : block.kind === "quote"
                ? splitQuoteBlock(block, sourceIndex, source.sourceId)
                : [block]
          extractedBlock = split.find((part) => part.id === source.sourceId)
          return split.filter((part) => part.id !== source.sourceId)
        })
    )
    if (extractedBlock === undefined || extracted === blocks) return blocks
    const targetIndex = extracted.findIndex(
      (block) => block.id === destination.targetBlockId
    )
    if (targetIndex < 0) return blocks
    const nextBlocks = extracted.slice()
    nextBlocks.splice(
      destination.placement === "after" ? targetIndex + 1 : targetIndex,
      0,
      extractedBlock
    )
    return nextBlocks
  }
  if (!blocks.some((block) => block.id === source.blockId)) return blocks

  const extracted = blocks.flatMap((block) => {
    if (block.id !== source.blockId) return [block]
    if (source.kind === "todo-item") {
      if (block.kind !== "todo") return [block]
      return splitTodoBlock(block, source.sourceId)
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
