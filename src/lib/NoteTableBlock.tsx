import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  useCallback,
  useState
} from "react"

import { normalizeEditableHtml } from "./blockEditing"
import { renderBlockActionMenu } from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText
} from "./NoteContentEditing"
import {
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  updateTableCell
} from "./tableEditing"
import type { NoteTableBlock as NoteTableBlockData } from "./types"

/**
 * 表格块渲染组件。
 * 支持行列增删、单元格编辑、键盘跨单元格导航。
 */
type NoteTableBlockProps = {
  readonly block: NoteTableBlockData
  readonly ctx: EditContext
}

/** 生成单元格的 data-editable-block-id，用于焦点管理 */
const tableCellId = (blockId: string, row: number, col: number): string =>
  `${blockId}-r${row}-c${col}`

/**
 * 判断光标是否在元素内容的最末尾。
 * 通过比较「光标位置到元素末尾」的文本内容是否为空来判断。
 */
const isCaretAtEnd = (element: HTMLElement): boolean => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return false
  // 创建从光标末尾到元素末尾的范围
  const endRange = document.createRange()
  endRange.selectNodeContents(element)
  endRange.setStart(range.endContainer, range.endOffset)
  return endRange.toString() === ""
}

/**
 * 判断光标是否在元素内容的最开头。
 * 通过比较「元素开头到光标位置」的文本内容是否为空来判断。
 */
const isCaretAtStart = (element: HTMLElement): boolean => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return false
  // 创建从元素开头到光标开头的范围
  const startRange = document.createRange()
  startRange.selectNodeContents(element)
  startRange.setEnd(range.startContainer, range.startOffset)
  return startRange.toString() === ""
}

/** 表格单元格键盘导航输入参数 */
type TableKeyDownInput = {
  readonly ctx: EditContext
  readonly event: ReactKeyboardEvent<HTMLElement>
  readonly block: NoteTableBlockData
  readonly row: number
  readonly col: number
}

/**
 * 表格单元格键盘导航处理器。
 *
 * 导航规则（符合需求）:
 * - Enter（无 Shift）: 有下行 -> 下行同列 start；无下行 -> 不操作
 * - Shift+Enter: 插入 <br>（单元格内软换行）
 * - ArrowRight: 光标在末尾时 -> 右格 start / 行尾则下一行首 start / 无下行不动
 * - ArrowLeft: 光标在开头时 -> 左格 end / 行首则上一行尾 end / 无上行不动
 * - ArrowDown: 光标在末尾时 -> 下行同列 start / 无下行不动
 * - ArrowUp: 光标在开头时 -> 上行同列 end / 无上行不动
 */
const handleTableCellKeyDown = ({
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

  // Shift+Enter: 单元格内插入软换行 <br>
  // Chrome 会将尾部 <br> 后的光标规范化回 <br> 之前，导致后续输入位置错误。
  // 插入 <br> + 零宽空格（\u200B）作为光标锚点，normalizeEditableHtml 会在 onBlur 时清除。
  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault()
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount) return
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

  // Enter（无 Shift）: 切换到下一行同列
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    const nextRow = row + 1
    if (nextRow < rowCount) {
      // 有下行：焦点切换到下一行同列开头
      requestFocus?.(tableCellId(block.id, nextRow, col), "start")
    }
    // 无下行：不操作（仅阻止默认换行行为）
    return
  }

  // ArrowRight: 光标在单元格末尾时跳转到右边单元格
  if (event.key === "ArrowRight") {
    if (!isCaretAtEnd(element)) return
    event.preventDefault()
    const nextCol = col + 1
    if (nextCol < colCount) {
      // 右边有单元格：切换到右边单元格开头
      requestFocus?.(tableCellId(block.id, row, nextCol), "start")
    } else {
      // 在行尾：切换到下一行第一个单元格开头
      const nextRow = row + 1
      if (nextRow < rowCount) {
        requestFocus?.(tableCellId(block.id, nextRow, 0), "start")
      }
      // 无下行：不动
    }
    return
  }

  // ArrowLeft: 光标在单元格开头时跳转到左边单元格
  if (event.key === "ArrowLeft") {
    if (!isCaretAtStart(element)) return
    event.preventDefault()
    const prevCol = col - 1
    if (prevCol >= 0) {
      // 左边有单元格：切换到左边单元格末尾
      requestFocus?.(tableCellId(block.id, row, prevCol), "end")
    } else {
      // 在行首：切换到上一行最后一个单元格末尾
      const prevRow = row - 1
      if (prevRow >= 0) {
        const lastCol = (block.rows[prevRow]?.length ?? 1) - 1
        requestFocus?.(tableCellId(block.id, prevRow, lastCol), "end")
      }
      // 无上行：不动
    }
    return
  }

  // ArrowDown: 光标在单元格末尾时切换到下行同列
  if (event.key === "ArrowDown") {
    if (!isCaretAtEnd(element)) return
    event.preventDefault()
    const nextRow = row + 1
    if (nextRow < rowCount) {
      requestFocus?.(tableCellId(block.id, nextRow, col), "start")
    }
    // 无下行：不动
    return
  }

  // ArrowUp: 光标在单元格开头时切换到上行同列
  if (event.key === "ArrowUp") {
    if (!isCaretAtStart(element)) return
    event.preventDefault()
    const prevRow = row - 1
    if (prevRow >= 0) {
      requestFocus?.(tableCellId(block.id, prevRow, col), "end")
    }
    // 无上行：不动
    return
  }
}

/** 表格渲染入口（具名导出，供 NoteContentBlocks renderBlock 调用） */
export const renderTableBlock = (
  block: NoteTableBlockData,
  ctx: EditContext
): ReactElement => <NoteTableBlock key={block.id} block={block} ctx={ctx} />

/** 表格块组件 */
const NoteTableBlock = ({
  block,
  ctx
}: NoteTableBlockProps): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  // 跟踪当前焦点单元格，用于 toolbar 行列操作的目标定位
  const [focusedCell, setFocusedCell] = useState<{
    row: number
    col: number
  } | null>(null)

  const rowCount = block.rows.length
  const colCount = block.rows[0]?.length ?? 0

  // 默认操作位置：有焦点用焦点位置，无焦点用末尾行列
  const activeRow = focusedCell?.row ?? rowCount - 1
  const activeCol = focusedCell?.col ?? colCount - 1

  // 在当前行下方插入新行
  const handleAddRow = useCallback(() => {
    onBlocksChange?.(insertTableRow(blocks, block.id, activeRow + 1))
  }, [blocks, block.id, activeRow, onBlocksChange])

  // 删除当前焦点所在行
  const handleDeleteRow = useCallback(() => {
    onBlocksChange?.(deleteTableRow(blocks, block.id, activeRow))
  }, [blocks, block.id, activeRow, onBlocksChange])

  // 在当前列右侧插入新列
  const handleAddColumn = useCallback(() => {
    onBlocksChange?.(insertTableColumn(blocks, block.id, activeCol + 1))
  }, [blocks, block.id, activeCol, onBlocksChange])

  // 删除当前焦点所在列
  const handleDeleteColumn = useCallback(() => {
    onBlocksChange?.(deleteTableColumn(blocks, block.id, activeCol))
  }, [blocks, block.id, activeCol, onBlocksChange])

  // 可编辑模式：toolbar + table
  if (editable) {
    return (
      <div className="hn-note-block-row" key={block.id}>
        {renderBlockActionMenu(block, ctx)}
        <div className="hn-note-block-content">
          <div className="hn-note-table-wrapper">
            <div className="hn-note-table-toolbar">
              <button
                type="button"
                onClick={handleAddRow}
                aria-label="在下方新增行"
              >
                + 行
              </button>
              <button
                type="button"
                onClick={handleDeleteRow}
                aria-label="删除当前行"
                disabled={rowCount <= 1}
              >
                - 行
              </button>
              <button
                type="button"
                onClick={handleAddColumn}
                aria-label="在右侧新增列"
              >
                + 列
              </button>
              <button
                type="button"
                onClick={handleDeleteColumn}
                aria-label="删除当前列"
                disabled={colCount <= 1}
              >
                - 列
              </button>
            </div>
            <table className="hn-note-table">
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  // biome-ignore lint: 表格行是位置数据，索引键语义正确
                  <tr
                    key={`row-${rowIndex}`}
                    className={
                      rowIndex === 0
                        ? "hn-note-table-header-row"
                        : undefined
                    }
                  >
                    {row.map((cell, colIndex) => (
                      // biome-ignore lint: 表格单元格是位置数据，索引键语义正确
                      <td
                        key={`cell-${rowIndex}-${colIndex}`}
                        className={
                          rowIndex === 0
                            ? "hn-note-table-header-cell"
                            : undefined
                        }
                      >
                        <div
                          role="textbox"
                          tabIndex={0}
                          {...editableProps(
                            (event) => {
                              const normalized = normalizeEditableHtml(
                                event.currentTarget.innerHTML
                              )
                              if (normalized === cell) return
                              onBlocksChange?.(
                                updateTableCell(
                                  blocks,
                                  block.id,
                                  rowIndex,
                                  colIndex,
                                  normalized
                                )
                              )
                            },
                            "hn-note-table-cell"
                          )}
                          onKeyDown={(event) =>
                            handleTableCellKeyDown({
                              ctx,
                              event,
                              block,
                              row: rowIndex,
                              col: colIndex
                            })
                          }
                          onFocus={() =>
                            setFocusedCell({ row: rowIndex, col: colIndex })
                          }
                          data-editable-block-id={tableCellId(
                            block.id,
                            rowIndex,
                            colIndex
                          )}
                          {...richText(cell)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // 只读模式：仅渲染表格，无 toolbar
  return (
    <div className="hn-note-block-row" key={block.id}>
      <div className="hn-note-block-content">
        <table className="hn-note-table">
          <tbody>
            {block.rows.map((row, rowIndex) => (
              // biome-ignore lint: 表格行是位置数据，索引键语义正确
              <tr
                key={`row-${rowIndex}`}
                className={
                  rowIndex === 0 ? "hn-note-table-header-row" : undefined
                }
              >
                {row.map((cell, colIndex) => (
                  // biome-ignore lint: 表格单元格是位置数据，索引键语义正确
                  <td
                    key={`cell-${rowIndex}-${colIndex}`}
                    className={
                      rowIndex === 0
                        ? "hn-note-table-header-cell"
                        : undefined
                    }
                    {...richText(cell)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
