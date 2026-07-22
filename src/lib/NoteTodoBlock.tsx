import type { ReactElement } from "react"

import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText,
  toggleTodoItem,
  updateTodoItemText
} from "./NoteContentEditing"
import type {
  NoteTodoBlock as NoteTodoBlockData,
  NoteTodoItem as NoteTodoItemData
} from "./types"

type NoteTodoItemProps = {
  readonly block: NoteTodoBlockData
  readonly item: NoteTodoItemData
  readonly ctx: EditContext
  readonly showTitle: boolean
  readonly containerId: string | undefined
}

const NoteTodoItem = ({
  block,
  item,
  ctx,
  showTitle,
  containerId
}: NoteTodoItemProps): ReactElement => {
  const { editable, blocks, onBlocksChange, selectMode, selectedBlockId } = ctx
  const sortable = editable && onBlocksChange !== undefined

  return (
    <div
      className={[
        "hn-note-block",
        "hn-note-todo-item",
        sortable ? "hn-note-sortable-block" : "",
        selectMode ? "hn-note-selectable-block" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      id={item.id}
      key={item.id}
      data-note-block-id={block.id}
      data-note-drag-container-id={containerId}
      {...(sortable
        ? {
            "data-note-sortable-id": item.id
          }
        : {})}
      {...(editable
        ? {
            "data-note-drag-kind": "todo-item",
            "data-note-drag-parent-id": block.id
          }
        : {})}
      {...(selectMode
        ? {
            "data-note-select-id": item.id,
            role: "option" as const,
            "aria-selected": selectedBlockId === item.id,
            tabIndex: 0
          }
        : {})}
    >
      {showTitle && block.title ? (
        <div className="hn-note-section-header hn-note-structured-header hn-note-todo-title">
          <span className="hn-note-chip">Todo</span>
          <h3>{block.title}</h3>
        </div>
      ) : null}
      {renderBlockActionMenu(block, ctx, {
        kind: "todo-item",
        blockId: block.id,
        itemId: item.id
      })}
      <div className="hn-note-todo-content hn-note-todo-item">
        {editable ? (
          <button
            type="button"
            aria-label={item.checked ? "标记为未完成" : "标记为已完成"}
            className={[
              "hn-note-checkbox",
              "hn-note-checkbox--editable",
              item.checked ? "hn-note-checkbox--checked" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() =>
              onBlocksChange?.(toggleTodoItem(blocks, block.id, item.id))
            }
          >
            {item.checked ? "●" : "○"}
          </button>
        ) : (
          <span
            aria-hidden="true"
            className={`hn-note-checkbox ${item.checked ? "hn-note-checkbox--checked" : ""}`}
          >
            {item.checked ? "●" : "○"}
          </span>
        )}
        {editable ? (
          <span
            {...editableProps((editable) =>
              onBlocksChange?.(
                updateTodoItemText(
                  blocks,
                  block.id,
                  item.id,
                  editable.innerHTML
                )
              )
            )}
            onKeyDown={(event) =>
              handleEditableBlockKeyDown({
                ctx,
                event,
                mode: "rich-text",
                sourceId: item.id
              })
            }
            data-editable-block-id={item.id}
            role="textbox"
            tabIndex={0}
            {...richText(item.text)}
          />
        ) : (
          <span {...richText(item.text)} />
        )}
      </div>
    </div>
  )
}

type NoteTodoBlockProps = {
  readonly block: NoteTodoBlockData
  readonly ctx: EditContext
  readonly containerId?: string
}

export const NoteTodoBlock = ({
  block,
  ctx,
  containerId
}: NoteTodoBlockProps): ReactElement => {
  const { editable, onBlocksChange, selectMode, selectedBlockId } = ctx
  const sortable = editable && onBlocksChange !== undefined

  if (block.items.length === 0) {
    return (
      <div
        className={[
          "hn-note-block hn-note-todo-empty",
          sortable ? "hn-note-sortable-block" : "",
          selectMode ? "hn-note-selectable-block" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        id={block.id}
        data-note-block-id={block.id}
        data-note-drag-container-id={containerId}
        {...(sortable
          ? {
              "data-note-sortable-id": block.id,
              "data-note-drag-kind": "block"
            }
          : {})}
        {...(selectMode
          ? {
              "data-note-select-id": block.id,
              role: "option" as const,
              "aria-selected": selectedBlockId === block.id,
              tabIndex: 0
            }
          : {})}
      >
        {editable ? renderBlockActionMenu(block, ctx) : null}
        {block.title ? (
          <div className="hn-note-section-header hn-note-structured-header hn-note-todo-title">
            <span className="hn-note-chip">Todo</span>
            <h3>{block.title}</h3>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
      {block.items.map((item, index) => (
        <NoteTodoItem
          key={item.id}
          block={block}
          containerId={containerId}
          item={item}
          ctx={ctx}
          showTitle={index === 0}
        />
      ))}
    </>
  )
}
