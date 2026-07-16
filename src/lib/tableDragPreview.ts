import {
  getTableDragTarget,
  type TableDragTarget
} from "./tableDragTarget"

export type TableDragAxis = "row" | "column"

interface TablePointerTargetInput {
  readonly axis: TableDragAxis
  readonly point: Readonly<{ x: number; y: number }>
  readonly sourceIndex: number
  readonly table: HTMLTableElement
}

type TableDropPreviewClassName =
  | "hn-note-table-drop-preview--row-before"
  | "hn-note-table-drop-preview--row-after"
  | "hn-note-table-drop-preview--column-before"
  | "hn-note-table-drop-preview--column-after"

export function getTablePointerTarget({
  axis,
  point,
  sourceIndex,
  table
}: TablePointerTargetInput): TableDragTarget | null {
  const cell = document
    .elementFromPoint(point.x, point.y)
    ?.closest<HTMLTableCellElement>("td[data-table-row][data-table-column]")
  if (cell === undefined || cell === null || cell.closest("table") !== table) {
    return null
  }

  const rect = cell.getBoundingClientRect()
  const rowIndex = Number.parseInt(cell.getAttribute("data-table-row") ?? "", 10)
  const columnIndex = Number.parseInt(
    cell.getAttribute("data-table-column") ?? "",
    10
  )
  switch (axis) {
    case "row":
      return getTableDragTarget({
        sourceIndex,
        targetIndex: rowIndex,
        itemCount: table.rows.length,
        pointerOffset: point.y - rect.top,
        targetSize: rect.height
      })
    case "column":
      return getTableDragTarget({
        sourceIndex,
        targetIndex: columnIndex,
        itemCount: table.rows.item(0)?.cells.length ?? 0,
        pointerOffset: point.x - rect.left,
        targetSize: rect.width
      })
  }
}

export function showTableDropPreview(
  table: HTMLTableElement,
  axis: TableDragAxis,
  insertionIndex: number
): () => void {
  const cells: HTMLTableCellElement[] = []
  let className: TableDropPreviewClassName

  switch (axis) {
    case "row": {
      const rowIndex = insertionIndex === 0 ? 0 : insertionIndex - 1
      const row = table.rows.item(rowIndex)
      if (row !== null) cells.push(...Array.from(row.cells))
      className =
        insertionIndex === 0
          ? "hn-note-table-drop-preview--row-before"
          : "hn-note-table-drop-preview--row-after"
      break
    }
    case "column": {
      const columnIndex = insertionIndex === 0 ? 0 : insertionIndex - 1
      for (const row of Array.from(table.rows)) {
        const cell = row.cells.item(columnIndex)
        if (cell !== null) cells.push(cell)
      }
      className =
        insertionIndex === 0
          ? "hn-note-table-drop-preview--column-before"
          : "hn-note-table-drop-preview--column-after"
      break
    }
  }

  for (const cell of cells) cell.classList.add(className)
  return () => {
    for (const cell of cells) cell.classList.remove(className)
  }
}
