import { useRef, useState } from "react"

import type { EditContext } from "./NoteContentEditing"
import type { TableDragAxis } from "./tableDragPreview"
import { moveTableColumn, moveTableRow } from "./tableEditing"
import { tableCellId } from "./tableKeyboardNavigation"
import {
  resolveTableMoveFocus,
  type TableCellPosition,
  type TableMove
} from "./tableMoveFocus"
import type { NoteTableBlock } from "./types"
import { assertNever } from "./utils"

const focusedCellFromTable = (
  table: HTMLTableElement
): TableCellPosition | null => {
  const activeElement = document.activeElement
  if (
    !(activeElement instanceof HTMLElement) ||
    !table.contains(activeElement) ||
    !activeElement.matches(".hn-note-table-cell[data-editable-block-id]")
  ) {
    return null
  }

  const cell = activeElement.closest<HTMLElement>(
    "[data-table-row][data-table-column]"
  )
  const row = Number(cell?.getAttribute("data-table-row"))
  const col = Number(cell?.getAttribute("data-table-column"))
  return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null
}

export const useTableMoveFocus = (
  block: NoteTableBlock,
  ctx: EditContext
) => {
  const [focusedCell, setFocusedCell] = useState<TableCellPosition | null>(null)
  const dragStartFocusRef = useRef<TableCellPosition | null>(null)

  const captureDragStartFocus = (button: HTMLButtonElement): void => {
    const table = button.closest<HTMLTableElement>("table")
    dragStartFocusRef.current = table === null ? null : focusedCellFromTable(table)
  }

  const moveTable = (axis: TableDragAxis, move: TableMove): void => {
    const target = resolveTableMoveFocus(axis, dragStartFocusRef.current, move)
    const nextBlocks = (() => {
      switch (axis) {
        case "row":
          return moveTableRow(
            ctx.getBlocks(),
            block.id,
            move.sourceIndex,
            move.destinationIndex
          )
        case "column":
          return moveTableColumn(
            ctx.getBlocks(),
            block.id,
            move.sourceIndex,
            move.destinationIndex
          )
        default:
          return assertNever(axis)
      }
    })()

    dragStartFocusRef.current = null
    setFocusedCell(target)
    ctx.onBlocksChange?.(nextBlocks)
    ctx.requestFocus?.(tableCellId(block.id, target.row, target.col), "start")
  }

  return { focusedCell, setFocusedCell, captureDragStartFocus, moveTable }
}
