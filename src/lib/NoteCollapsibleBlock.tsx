import type { ReactElement, ReactNode } from "react"

import { renderBlockActionMenu } from "./NoteBlockEditingControls"
import { renderBlock } from "./NoteContentBlocks"
import {
  type EditContext,
  editableProps,
  richText,
  toggleCollapsible,
  updateCollapsibleTitle
} from "./NoteContentEditing"
import { NoteListBlock } from "./NoteListBlock"
import { NoteQuoteBlock } from "./NoteQuoteBlock"
import { NoteTodoBlock } from "./NoteTodoBlock"
import type { NoteBlock, NoteCollapsibleBlock as NoteCollapsibleBlockData } from "./types"

type NoteCollapsibleBlockProps = {
  readonly block: NoteCollapsibleBlockData
  readonly ctx: EditContext
}

const renderChildBlock = (
  block: NoteBlock,
  containerId: string,
  ctx: EditContext
): ReactNode => {
  if (block.kind === "todo") {
    return (
      <NoteTodoBlock
        key={block.id}
        block={block}
        containerId={containerId}
        ctx={ctx}
      />
    )
  }
  if (block.kind === "unorderedList" || block.kind === "orderedList") {
    return (
      <NoteListBlock
        key={block.id}
        block={block}
        containerId={containerId}
        ctx={ctx}
      />
    )
  }
  if (block.kind === "quote") {
    return (
      <NoteQuoteBlock
        key={block.id}
        block={block}
        containerId={containerId}
        ctx={ctx}
      />
    )
  }
  return (
    <div
      className="hn-note-block hn-note-sortable-block"
      id={block.id}
      key={block.id}
      data-note-block-id={block.id}
      data-note-drag-container-id={containerId}
      data-note-drag-kind="block"
      data-note-sortable-id={block.id}
    >
      {renderBlock(block, ctx)}
    </div>
  )
}

export const NoteCollapsibleBlock = ({
  block,
  ctx
}: NoteCollapsibleBlockProps): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  const subCtx: EditContext = {
    ...ctx,
    blocks: block.blocks,
    getBlocks: () => {
      const parentBlocks = ctx.getBlocks()
      const current = parentBlocks.find((b) => b.id === block.id)
      return current && current.kind === "collapsible"
        ? current.blocks
        : block.blocks
    },
    onBlocksChange: onBlocksChange
      ? (nextSubBlocks) => {
          const parentBlocks = ctx.getBlocks()
          onBlocksChange(
            parentBlocks.map((b) =>
              b.id === block.id && b.kind === "collapsible"
                ? { ...b, blocks: nextSubBlocks }
                : b
            )
          )
        }
      : undefined
  }

  const handleToggle = () => {
    if (!onBlocksChange) return
    onBlocksChange(toggleCollapsible(blocks, block.id))
  }

  return (
    <>
      {renderBlockActionMenu(block, ctx)}
      <div
        className={`hn-note-collapsible${block.collapsed ? " hn-note-collapsible--collapsed" : ""}`}
      >
        <div className="hn-note-collapsible-header">
          <button
            type="button"
            className="hn-note-collapsible-toggle"
            onClick={handleToggle}
            aria-label={block.collapsed ? "展开" : "收起"}
            aria-expanded={!block.collapsed}
            tabIndex={-1}
          >
            <span className="hn-note-collapsible-caret" aria-hidden="true">
              ▶
            </span>
          </button>
          {editable ? (
            <div
              {...editableProps((editable) =>
                onBlocksChange?.(
                  updateCollapsibleTitle(
                    blocks,
                    block.id,
                    editable.innerHTML
                  )
                )
              )}
              className="hn-note-collapsible-title"
              data-editable-block-id={block.id}
              {...richText(block.title)}
            />
          ) : (
            <div
              className="hn-note-collapsible-title"
              {...richText(block.title)}
            />
          )}
        </div>
        {!block.collapsed && (
          <div
            className="hn-note-collapsible-body"
            data-note-block-container-id={block.id}
          >
            {block.blocks.map((childBlock) =>
              renderChildBlock(childBlock, block.id, subCtx)
            )}
          </div>
        )}
      </div>
    </>
  )
}
