import { normalizeEditableHtml } from "./blockEditing"
import type { NoteBlock, NoteTableBlock } from "./types"

/**
 * 表格块编辑工具集。
 * 所有函数均为不可变更新：返回新的 blocks 数组，不修改原数组。
 * 参照 quoteLineEditing.ts 的 replaceQuote 模式实现。
 */

const replaceTable = (
  blocks: readonly NoteBlock[],
  blockId: string,
  update: (block: NoteTableBlock) => NoteTableBlock | null
): NoteBlock[] =>
  blocks.flatMap((block) => {
    // 不是目标 table 块则原样保留
    if (block.id !== blockId || block.kind !== "table") return [block]
    const replacement = update(block)
    return replacement === null ? [] : [replacement]
  })

const moveItem = <T>(
  items: readonly T[],
  sourceIndex: number,
  destinationIndex: number
): T[] | null => {
  if (
    items[sourceIndex] === undefined ||
    items[destinationIndex] === undefined
  ) {
    return null
  }
  const movedItems = [...items]
  const [movedItem] = movedItems.splice(sourceIndex, 1)
  if (movedItem === undefined) return null
  movedItems.splice(destinationIndex, 0, movedItem)
  return movedItems
}

/**
 * 更新指定单元格的文本内容。
 * @param row 行索引（0-based）
 * @param col 列索引（0-based）
 * @param text 新的单元格 HTML 文本
 */
export const updateTableCell = (
  blocks: readonly NoteBlock[],
  blockId: string,
  row: number,
  col: number,
  text: string
): NoteBlock[] =>
  replaceTable(blocks, blockId, (block) => {
    // 行或列越界则不更新
    if (block.rows[row]?.[col] === undefined) return block
    const rows = block.rows.map((tableRow, ri) =>
      ri === row
        ? tableRow.map((cell, ci) =>
            ci === col ? normalizeEditableHtml(text) : cell
          )
        : tableRow
    )
    return { ...block, rows }
  })

/**
 * 在 rowIndex 位置插入一行空单元格。
 * 新行的列数与表格现有列数一致。
 * @param rowIndex 插入位置（0-based），新行将成为该索引的行
 */
export const insertTableRow = (
  blocks: readonly NoteBlock[],
  blockId: string,
  rowIndex: number
): NoteBlock[] =>
  replaceTable(blocks, blockId, (block) => {
    // 新行列数与第一行一致（空表格默认 1 列）
    const colCount = block.rows[0]?.length ?? 1
    const newRow: string[] = Array.from({ length: colCount }, () => "")
    const rows = [...block.rows]
    // 钳制插入位置到合法范围
    const insertAt = Math.max(0, Math.min(rowIndex, rows.length))
    rows.splice(insertAt, 0, newRow)
    return { ...block, rows }
  })

/**
 * 在 colIndex 位置插入一列空单元格。
 * 每一行都会在对应位置插入一个空单元格。
 * @param colIndex 插入位置（0-based）
 */
export const insertTableColumn = (
  blocks: readonly NoteBlock[],
  blockId: string,
  colIndex: number
): NoteBlock[] =>
  replaceTable(blocks, blockId, (block) => {
    const rows = block.rows.map((row) => {
      const newRow = [...row]
      const insertAt = Math.max(0, Math.min(colIndex, newRow.length))
      newRow.splice(insertAt, 0, "")
      return newRow
    })
    return { ...block, rows }
  })

/**
 * 删除指定行。
 * 表格至少保留 1 行，若仅剩 1 行则不操作。
 * @param rowIndex 要删除的行索引（0-based）
 */
export const deleteTableRow = (
  blocks: readonly NoteBlock[],
  blockId: string,
  rowIndex: number
): NoteBlock[] =>
  replaceTable(blocks, blockId, (block) => {
    // 至少保留 1 行
    if (block.rows.length <= 1) return block
    if (block.rows[rowIndex] === undefined) return block
    const rows = block.rows.filter((_, ri) => ri !== rowIndex)
    return { ...block, rows }
  })

/**
 * 删除指定列。
 * 表格至少保留 1 列，若仅剩 1 列则不操作。
 * @param colIndex 要删除的列索引（0-based）
 */
export const deleteTableColumn = (
  blocks: readonly NoteBlock[],
  blockId: string,
  colIndex: number
): NoteBlock[] =>
  replaceTable(blocks, blockId, (block) => {
    const colCount = block.rows[0]?.length ?? 0
    // 至少保留 1 列
    if (colCount <= 1) return block
    if (block.rows[0]?.[colIndex] === undefined) return block
    const rows = block.rows.map((row) =>
      row.filter((_, ci) => ci !== colIndex)
    )
    return { ...block, rows }
  })

export const moveTableRow = (
  blocks: readonly NoteBlock[],
  blockId: string,
  sourceIndex: number,
  destinationIndex: number
): NoteBlock[] =>
  replaceTable(blocks, blockId, (block) => {
    const rows = moveItem(block.rows, sourceIndex, destinationIndex)
    return rows === null ? block : { ...block, rows }
  })

export const moveTableColumn = (
  blocks: readonly NoteBlock[],
  blockId: string,
  sourceIndex: number,
  destinationIndex: number
): NoteBlock[] =>
  replaceTable(blocks, blockId, (block) => {
    const columnCount = block.rows[0]?.length ?? 0
    if (
      sourceIndex < 0 ||
      sourceIndex >= columnCount ||
      destinationIndex < 0 ||
      destinationIndex >= columnCount
    ) {
      return block
    }
    const rows = block.rows.map(
      (row) => moveItem(row, sourceIndex, destinationIndex) ?? row
    )
    return { ...block, rows }
  })
