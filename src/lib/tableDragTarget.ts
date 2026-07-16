export interface TableDragTargetInput {
  readonly sourceIndex: number
  readonly targetIndex: number
  readonly itemCount: number
  readonly pointerOffset: number
  readonly targetSize: number
}

export interface TableDragTarget {
  readonly insertionIndex: number
  readonly destinationIndex: number
}

export function getTableDragTarget({
  sourceIndex,
  targetIndex,
  itemCount,
  pointerOffset,
  targetSize
}: TableDragTargetInput): TableDragTarget | null {
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

  return { insertionIndex, destinationIndex }
}
