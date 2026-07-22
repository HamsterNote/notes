import type { ReactElement } from "react"

import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText,
  updateText
} from "./NoteContentEditing"
import type { NoteBlock, NoteOrderedListBlock, NoteUnorderedListBlock } from "./types"

type NoteListBlockData = NoteUnorderedListBlock | NoteOrderedListBlock

const isUnorderedListBlock = (
  block: NoteListBlockData
): block is NoteUnorderedListBlock => block.kind === "unorderedList"

const orderedListStart = (
  blocks: readonly NoteBlock[],
  blockId: string
): number => {
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index < 0) return 1
  let count = 0
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i]?.kind !== "orderedList") break
    count++
  }
  return count + 1
}

type NoteListBlockProps = {
  readonly block: NoteListBlockData
  readonly containerId?: string
  readonly ctx: EditContext
}

export const NoteListBlock = ({
  block,
  containerId,
  ctx
}: NoteListBlockProps): ReactElement => {
  const { blocks, editable, onBlocksChange, selectMode, selectedBlockId } = ctx
  const sortable = editable && onBlocksChange !== undefined
  const unordered = isUnorderedListBlock(block)
  const listClassName = unordered
    ? "hn-note-unordered-list"
    : "hn-note-ordered-list"
  const ListTag: "ul" | "ol" = unordered ? "ul" : "ol"
  const start = unordered ? undefined : orderedListStart(blocks, block.id)

  return (
    <div
      className={[
        "hn-note-block",
        "hn-note-list-block",
        sortable ? "hn-note-sortable-block" : "",
        selectMode ? "hn-note-selectable-block" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      id={block.id}
      data-note-block-id={block.id}
      {...(containerId === undefined
        ? {}
        : { "data-note-drag-container-id": containerId })}
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
      <ListTag
        className={[
          listClassName,
          block.text.trim().length === 0 ? "hn-note-list-empty" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        {...(start !== undefined && start > 1 ? { start } : {})}
      >
        <li className="hn-note-list-item">
          <div className="hn-note-list-item-content">
            {ctx.editable ? (
              <span
                {...editableProps((editable) =>
                  onBlocksChange?.(
                    updateText(ctx.getBlocks(), block.id, editable.innerHTML)
                  )
                )}
                onKeyDown={(event) =>
                  handleEditableBlockKeyDown({
                    ctx,
                    event,
                    mode: "rich-text",
                    sourceId: block.id
                  })
                }
                data-editable-block-id={block.id}
                role="textbox"
                tabIndex={0}
                {...richText(block.text)}
              />
            ) : (
              <span {...richText(block.text)} />
            )}
          </div>
        </li>
      </ListTag>
    </div>
  )
}
