import type { FormEvent, ReactElement } from "react"

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
import type {
  NoteHeadingBlock,
  NoteParagraphBlock
} from "./types"
import { assertNever } from "./utils"

type EditTextBlock = NoteHeadingBlock | NoteParagraphBlock

const orderedListPrefixPattern = /^\d+\. $/u

type TextListKind = "unorderedList" | "orderedList"

const listKindFromShortcut = (text: string): TextListKind | undefined => {
  if (text === "- ") return "unorderedList"
  if (orderedListPrefixPattern.test(text)) return "orderedList"
  return undefined
}

type NoteTextBlockProps = {
  readonly block: EditTextBlock
  readonly ctx: EditContext
}

export const NoteTextBlock = ({
  block,
  ctx
}: NoteTextBlockProps): ReactElement => {
  const handleInput = (event: FormEvent<HTMLElement>): void => {
    const visibleText = event.currentTarget.textContent?.replaceAll("\u00a0", " ")
    if (!ctx.onBlocksChange) return

    if (visibleText === "> ") {
      event.currentTarget.textContent = ""
      ctx.onBlocksChange(
        ctx.getBlocks().map((candidate) =>
          candidate.id === block.id
            ? { id: block.id, kind: "quote", text: "" }
            : candidate
        )
      )
      ctx.requestFocus?.(block.id, "start")
      return
    }

    const listKind = visibleText ? listKindFromShortcut(visibleText) : undefined
    if (!listKind) return

    event.currentTarget.textContent = ""
    ctx.onBlocksChange(
      ctx.getBlocks().map((candidate) =>
        candidate.id === block.id
          ? { id: block.id, kind: listKind, text: "" }
          : candidate
      )
    )
    ctx.requestFocus?.(block.id, "start")
  }

  const editableText = renderEditableTextLayout({
    block,
    onInput: handleInput,
    onKeyDown: (event) =>
      handleEditableBlockKeyDown({
        ctx,
        event,
        mode: "rich-text",
        sourceId: block.id
      }),
    onTextChange: (text) =>
      ctx.onBlocksChange?.(updateText(ctx.getBlocks(), block.id, text))
  })

  switch (block.kind) {
    case "heading":
      return renderHeadingBlockLayout({
        block,
        ctx,
        actionMenu: renderBlockActionMenu(block, ctx),
        editableText
      })
    case "paragraph":
      return renderParagraphBlockLayout({
        block,
        ctx,
        actionMenu: renderBlockActionMenu(block, ctx),
        editableText
      })
    default:
      return assertNever(block)
  }
}
