import type { NoteBlock } from "./types"

export type BlockDragTargetInput = {
  readonly sourceIndex: number
  readonly targetIndex: number
  readonly itemCount: number
  readonly pointerOffset: number
  readonly targetSize: number
}

export type BlockDragTarget = {
  readonly insertionIndex: number
  readonly destinationIndex: number
}

export const getBlockDragTarget = ({
  sourceIndex,
  targetIndex,
  itemCount,
  pointerOffset,
  targetSize
}: BlockDragTargetInput): BlockDragTarget | null => {
  const hasValidIndexes =
    Number.isInteger(sourceIndex) &&
    sourceIndex >= 0 &&
    sourceIndex < itemCount &&
    Number.isInteger(targetIndex) &&
    targetIndex >= 0 &&
    targetIndex < itemCount

  if (
    !hasValidIndexes ||
    !Number.isFinite(pointerOffset) ||
    !Number.isFinite(targetSize) ||
    targetSize <= 0
  ) {
    return null
  }

  const insertionIndex =
    pointerOffset >= targetSize / 2 ? targetIndex + 1 : targetIndex
  const destinationIndex =
    insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex

  return { destinationIndex, insertionIndex }
}

export const moveBlock = (
  blocks: readonly NoteBlock[],
  sourceIndex: number,
  destinationIndex: number
): readonly NoteBlock[] => {
  const indexesAreValid =
    Number.isInteger(sourceIndex) &&
    sourceIndex >= 0 &&
    sourceIndex < blocks.length &&
    Number.isInteger(destinationIndex) &&
    destinationIndex >= 0 &&
    destinationIndex < blocks.length

  if (!indexesAreValid || sourceIndex === destinationIndex) return blocks

  const nextBlocks = blocks.slice()
  const [source] = nextBlocks.splice(sourceIndex, 1)
  if (source === undefined) return blocks
  nextBlocks.splice(destinationIndex, 0, source)
  return nextBlocks
}
