import type { TableDragAxis } from "./tableDragPreview"
import { assertNever } from "./utils"

export type TableCellPosition = {
  readonly row: number
  readonly col: number
}

export type TableMove = {
  readonly sourceIndex: number
  readonly destinationIndex: number
}

const resolveMovedIndex = (index: number, move: TableMove): number => {
  const { sourceIndex, destinationIndex } = move
  if (index === sourceIndex) return destinationIndex
  if (
    sourceIndex < destinationIndex &&
    index > sourceIndex &&
    index <= destinationIndex
  ) {
    return index - 1
  }
  if (
    sourceIndex > destinationIndex &&
    index >= destinationIndex &&
    index < sourceIndex
  ) {
    return index + 1
  }
  return index
}

export const resolveTableMoveFocus = (
  axis: TableDragAxis,
  focusedCell: TableCellPosition | null,
  move: TableMove
): TableCellPosition => {
  const { destinationIndex } = move
  if (focusedCell === null) {
    return axis === "row"
      ? { row: destinationIndex, col: 0 }
      : { row: 0, col: destinationIndex }
  }

  switch (axis) {
    case "row":
      return {
        row: resolveMovedIndex(focusedCell.row, move),
        col: focusedCell.col
      }
    case "column":
      return {
        row: focusedCell.row,
        col: resolveMovedIndex(focusedCell.col, move)
      }
    default:
      return assertNever(axis)
  }
}
