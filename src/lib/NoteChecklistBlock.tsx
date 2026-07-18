import type { ReactElement } from "react"

import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText,
  toggleChecklistItem,
  updateChecklistItemText
} from "./NoteContentEditing"
import type {
  NoteChecklistBlock as NoteChecklistBlockData,
  NoteChecklistItem as NoteChecklistItemData
} from "./types"

type NoteChecklistItemProps = {
  readonly block: NoteChecklistBlockData
  readonly item: NoteChecklistItemData
  readonly ctx: EditContext
  readonly showTitle: boolean
}

const NoteChecklistItem = ({
  block,
  item,
  ctx,
  showTitle
}: NoteChecklistItemProps): ReactElement => {
  const { editable, blocks, onBlocksChange, selectMode, selectedBlockId } = ctx
  const sortable = editable && onBlocksChange !== undefined

  return (
    <div
      className={[
        "hn-note-block",
        "hn-note-checklist-item",
        sortable ? "hn-note-sortable-block" : "",
        selectMode ? "hn-note-selectable-block" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      id={item.id}
      key={item.id}
      data-note-block-id={block.id}
      {...(sortable
        ? {
            "data-note-sortable-id": item.id
          }
        : {})}
      {...(editable
        ? {
            "data-note-drag-kind": "checklist-item",
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
        <div className="hn-note-section-header hn-note-structured-header hn-note-checklist-title">
          <span className="hn-note-chip">Checklist</span>
          <h3>{block.title}</h3>
        </div>
      ) : null}
      {renderBlockActionMenu(block, ctx, {
        kind: "checklist-item",
        blockId: block.id,
        itemId: item.id
      })}
      <div className="hn-note-checklist-content hn-note-checklist-item">
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
              onBlocksChange?.(toggleChecklistItem(blocks, block.id, item.id))
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
            {...editableProps((event) =>
              onBlocksChange?.(
                updateChecklistItemText(
                  blocks,
                  block.id,
                  item.id,
                  event.currentTarget.innerHTML
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

type NoteChecklistBlockProps = {
  readonly block: NoteChecklistBlockData
  readonly ctx: EditContext
}

export const NoteChecklistBlock = ({
  block,
  ctx
}: NoteChecklistBlockProps): ReactElement => {
  const { editable, onBlocksChange, selectMode, selectedBlockId } = ctx
  const sortable = editable && onBlocksChange !== undefined

  if (block.items.length === 0) {
    return (
      <div
        className={[
          "hn-note-block hn-note-checklist-empty",
          sortable ? "hn-note-sortable-block" : "",
          selectMode ? "hn-note-selectable-block" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        id={block.id}
        data-note-block-id={block.id}
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
        {block.title ? (
          <div className="hn-note-section-header hn-note-structured-header hn-note-checklist-title">
            <span className="hn-note-chip">Checklist</span>
            <h3>{block.title}</h3>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
      {block.items.map((item, index) => (
        <NoteChecklistItem
          key={item.id}
          block={block}
          item={item}
          ctx={ctx}
          showTitle={index === 0}
        />
      ))}
    </>
  )
}
