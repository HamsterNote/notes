import type { ReactElement } from "react"

import { normalizeEditableHtml } from "./blockEditing"
import { renderBlockActionMenu } from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText
} from "./NoteContentEditing"
import { TableDragHandle } from "./TableDragHandle"
import { TableOperationMenu } from "./TableOperationMenu"
import { updateTableCell } from "./tableEditing"
import {
  handleTableCellKeyDown,
  tableCellId
} from "./tableKeyboardNavigation"
import type { NoteTableBlock as NoteTableBlockData } from "./types"
import { useTableMoveFocus } from "./useTableMoveFocus"
import { useTableOperationMenus } from "./useTableOperationMenus"

type NoteTableBlockProps = {
  readonly block: NoteTableBlockData
  readonly ctx: EditContext
}

export const renderTableBlock = (
  block: NoteTableBlockData,
  ctx: EditContext
): ReactElement => <NoteTableBlock key={block.id} block={block} ctx={ctx} />

const NoteTableBlock = ({
  block,
  ctx
}: NoteTableBlockProps): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx
  const { focusedCell, setFocusedCell, captureDragStartFocus, moveTable } =
    useTableMoveFocus(block, ctx)
  const focusedRow = focusedCell?.row ?? null
  const focusedCol = focusedCell?.col ?? null
  const {
    openMenu,
    closeMenu,
    openRowMenu,
    openColumnMenu,
    openColumnEdgeMenu,
    openRowEdgeMenu
  } = useTableOperationMenus(block, ctx)

  if (editable) {
    return (
      <div className="hn-note-block-row" key={block.id}>
        {renderBlockActionMenu(block, ctx)}
        <div className="hn-note-block-content">
          <div className="hn-note-table-wrapper">
            <table className="hn-note-table">
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: 表格行是位置数据，索引键语义正确
                    key={`row-${rowIndex}`}
                    className={
                      rowIndex === 0
                        ? "hn-note-table-header-row"
                        : undefined
                    }
                  >
                    {row.map((cell, colIndex) => (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: 表格单元格是位置数据，索引键语义正确
                        key={`cell-${rowIndex}-${colIndex}`}
                        className={
                          rowIndex === 0
                            ? "hn-note-table-header-cell"
                            : undefined
                        }
                        data-table-row={rowIndex}
                        data-table-column={colIndex}
                      >
                        {/* 行操作按钮：仅焦点行第一列显示 */}
                        {colIndex === 0 && rowIndex === focusedRow && (
                          <TableDragHandle
                            axis="row"
                            className="hn-note-table-row-op hn-note-table-row-op--visible"
                            index={rowIndex}
                            label="行操作"
                            symbol="⋮"
                            onActivate={(event) => openRowMenu(event, rowIndex)}
                            onDragStart={captureDragStartFocus}
                            onMove={(sourceIndex, destinationIndex) =>
                              moveTable("row", { sourceIndex, destinationIndex })
                            }
                          />
                        )}

                        {/* 列操作按钮：仅焦点列的表头行显示 */}
                        {rowIndex === 0 && colIndex === focusedCol && (
                          <TableDragHandle
                            axis="column"
                            className="hn-note-table-col-op hn-note-table-col-op--visible"
                            index={colIndex}
                            label="列操作"
                            symbol="⋯"
                            onActivate={(event) =>
                              openColumnMenu(event, colIndex)
                            }
                            onDragStart={captureDragStartFocus}
                            onMove={(sourceIndex, destinationIndex) =>
                              moveTable("column", {
                                sourceIndex,
                                destinationIndex
                              })
                            }
                          />
                        )}

                        {/* 内部左边界用于向当前列前插入；首列左侧专属于行操作。 */}
                        {colIndex > 0 && (
                          <button
                            type="button"
                            className="hn-note-table-edge-btn hn-note-table-edge-btn--left"
                            aria-label="在此处添加列"
                            onClick={(event) =>
                              openColumnEdgeMenu(event, colIndex)
                            }
                          >
                            +
                          </button>
                        )}

                        {/* 每个单元格右边界覆盖内部列线和表格最右侧。 */}
                        <button
                          type="button"
                          className="hn-note-table-edge-btn hn-note-table-edge-btn--right"
                          aria-label="在此处添加列"
                          onClick={(event) =>
                            openColumnEdgeMenu(event, colIndex + 1)
                          }
                        >
                          +
                        </button>

                        {/* 内部上边界用于向当前行前插入；首行上方专属于列操作。 */}
                        {rowIndex > 0 && (
                          <button
                            type="button"
                            className="hn-note-table-edge-btn hn-note-table-edge-btn--top"
                            aria-label="在此处添加行"
                            onClick={(event) =>
                              openRowEdgeMenu(event, rowIndex)
                            }
                          >
                            +
                          </button>
                        )}

                        {/* 每个单元格下边界覆盖内部行线和表格最下侧。 */}
                        <button
                          type="button"
                          className="hn-note-table-edge-btn hn-note-table-edge-btn--bottom"
                          aria-label="在此处添加行"
                          onClick={(event) =>
                            openRowEdgeMenu(event, rowIndex + 1)
                          }
                        >
                          +
                        </button>

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
        {openMenu ? (
          <TableOperationMenu
            items={openMenu.items}
            triggerRect={openMenu.triggerRect}
            onClose={closeMenu}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="hn-note-block-row" key={block.id}>
      <div className="hn-note-block-content">
        <table className="hn-note-table">
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: 表格行是位置数据，索引键语义正确
                key={`row-${rowIndex}`}
                className={
                  rowIndex === 0 ? "hn-note-table-header-row" : undefined
                }
              >
                {row.map((cell, colIndex) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: 表格单元格是位置数据，索引键语义正确
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
