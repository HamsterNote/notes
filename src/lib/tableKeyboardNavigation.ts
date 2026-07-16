import type { KeyboardEvent as ReactKeyboardEvent } from "react"

import type { EditContext } from "./NoteContentEditing"
import type { NoteTableBlock } from "./types"

export const tableCellId = (
  blockId: string,
  row: number,
  col: number
): string => `${blockId}-r${row}-c${col}`

const isCaretAtEnd = (element: HTMLElement): boolean => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return false
  const endRange = document.createRange()
  endRange.selectNodeContents(element)
  endRange.setStart(range.endContainer, range.endOffset)
  return endRange.toString() === ""
}

const isCaretAtStart = (element: HTMLElement): boolean => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return false
  const startRange = document.createRange()
  startRange.selectNodeContents(element)
  startRange.setEnd(range.startContainer, range.startOffset)
  return startRange.toString() === ""
}

type TableKeyDownInput = {
  readonly ctx: EditContext
  readonly event: ReactKeyboardEvent<HTMLElement>
  readonly block: NoteTableBlock
  readonly row: number
  readonly col: number
}

export const handleTableCellKeyDown = ({
  ctx,
  event,
  block,
  row,
  col
}: TableKeyDownInput): void => {
  const { onBlocksChange, requestFocus } = ctx
  if (!onBlocksChange) return

  const element = event.currentTarget
  const rowCount = block.rows.length
  const colCount = block.rows[0]?.length ?? 0

  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault()
    const selection = window.getSelection()
    if (!selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    const br = document.createElement("br")
    const zwsp = document.createTextNode("\u200B")
    range.deleteContents()
    range.insertNode(zwsp)
    range.insertNode(br)
    range.setStartAfter(zwsp)
    range.setEndAfter(zwsp)
    selection.removeAllRanges()
    selection.addRange(range)
    return
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    const nextRow = row + 1
    if (nextRow < rowCount) {
      requestFocus?.(tableCellId(block.id, nextRow, col), "start")
    }
    return
  }

  if (event.key === "ArrowRight") {
    if (!isCaretAtEnd(element)) return
    event.preventDefault()
    const nextCol = col + 1
    if (nextCol < colCount) {
      requestFocus?.(tableCellId(block.id, row, nextCol), "start")
    } else {
      const nextRow = row + 1
      if (nextRow < rowCount) {
        requestFocus?.(tableCellId(block.id, nextRow, 0), "start")
      }
    }
    return
  }

  if (event.key === "ArrowLeft") {
    if (!isCaretAtStart(element)) return
    event.preventDefault()
    const prevCol = col - 1
    if (prevCol >= 0) {
      requestFocus?.(tableCellId(block.id, row, prevCol), "end")
    } else {
      const prevRow = row - 1
      if (prevRow >= 0) {
        const lastCol = (block.rows[prevRow]?.length ?? 1) - 1
        requestFocus?.(tableCellId(block.id, prevRow, lastCol), "end")
      }
    }
    return
  }

  if (event.key === "ArrowDown") {
    if (!isCaretAtEnd(element)) return
    event.preventDefault()
    const nextRow = row + 1
    if (nextRow < rowCount) {
      requestFocus?.(tableCellId(block.id, nextRow, col), "start")
    }
    return
  }

  if (event.key === "ArrowUp") {
    if (!isCaretAtStart(element)) return
    event.preventDefault()
    const prevRow = row - 1
    if (prevRow >= 0) {
      requestFocus?.(tableCellId(block.id, prevRow, col), "end")
    }
  }
}
