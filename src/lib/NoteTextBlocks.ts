import type { ReactElement } from "react"

import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import { type EditContext, updateText } from "./NoteContentEditing"
import { renderParagraphBlockLayout } from "./NoteParagraphBlock"
import {
  renderEditableTextLayout,
  renderHeadingBlockLayout
} from "./NoteTextBlockLayouts"
import type { NoteHeadingBlock, NoteParagraphBlock } from "./types"

type EditTextBlock = NoteHeadingBlock | NoteParagraphBlock

const renderEditableText = (
  block: EditTextBlock,
  ctx: EditContext
): ReactElement =>
  renderEditableTextLayout({
    block,
    onKeyDown: (event) =>
      handleEditableBlockKeyDown({
        ctx,
        event,
        mode: "rich-text",
        sourceId: block.id
      }),
    onTextChange: (text) =>
      ctx.onBlocksChange?.(updateText(ctx.blocks, block.id, text))
  })

export const renderHeadingBlock = (
  block: NoteHeadingBlock,
  ctx: EditContext
): ReactElement =>
  renderHeadingBlockLayout({
    block,
    ctx,
    actionMenu: renderBlockActionMenu(block, ctx),
    editableText: renderEditableText(block, ctx)
  })

export const renderParagraphBlock = (
  block: NoteParagraphBlock,
  ctx: EditContext
): ReactElement =>
  renderParagraphBlockLayout({
    block,
    ctx,
    actionMenu: renderBlockActionMenu(block, ctx),
    editableText: renderEditableText(block, ctx)
  })
