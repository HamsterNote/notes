import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from "react"

import type { BlockConvertTarget } from "./BlockActionMenu"
import {
  convertTextBlockFormat,
  createNextBlockId,
  deleteEmptyTextBlock,
  isVisibleHtmlEmpty,
  splitTextBlockAtHtml
} from "./blockEditing"
import { type EditContext, updateText } from "./NoteContentEditing"
import { renderParagraphBlockLayout } from "./NoteParagraphBlock"
import {
  renderBlockActionMenuLayout,
  renderEditableTextLayout,
  renderHeadingBlockLayout
} from "./NoteTextBlockLayouts"
import type { NoteBlock, NoteHeadingBlock, NoteParagraphBlock } from "./types"

type EditTextBlock = NoteHeadingBlock | NoteParagraphBlock

const isTextBlock = (block: NoteBlock): block is EditTextBlock =>
  block.kind === "heading" || block.kind === "paragraph"

const handleTextBlockKeyDown = (
  event: ReactKeyboardEvent<HTMLElement>,
  block: EditTextBlock,
  ctx: EditContext
): void => {
  const { blocks, onBlocksChange, requestFocus } = ctx
  if (!onBlocksChange) return

  const element = event.currentTarget

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!element.contains(range.commonAncestorContainer)) return
    if (!range.collapsed) range.deleteContents()

    const afterRange = document.createRange()
    afterRange.selectNodeContents(element)
    afterRange.setStart(range.endContainer, range.endOffset)
    const afterContainer = document.createElement("div")
    afterContainer.appendChild(afterRange.extractContents())
    const nextId = createNextBlockId(blocks, block.id)
    const splitBlocks = splitTextBlockAtHtml({
      afterHtml: afterContainer.innerHTML,
      beforeHtml: element.innerHTML,
      block,
      nextId
    })
    const nextBlocks = blocks.flatMap((candidate) =>
      candidate.id === block.id ? splitBlocks : [candidate]
    )
    onBlocksChange(nextBlocks)
    requestFocus?.(nextId, "start")
    return
  }

  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault()
    document.execCommand("insertHTML", false, "<br>")
    return
  }

  if (event.key !== "Backspace") return
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  if (!selection.isCollapsed || selection.anchorOffset !== 0) return
  if (!isVisibleHtmlEmpty(element.innerHTML)) return

  event.preventDefault()
  const nextBlocks = deleteEmptyTextBlock({
    blocks,
    currentHtml: element.innerHTML,
    sourceId: block.id
  })
  const sourceIndex = blocks.findIndex((b) => b.id === block.id)
  const prevTextBlock = blocks.slice(0, sourceIndex).reverse().find(isTextBlock)
  const nextTextBlock = blocks.slice(sourceIndex + 1).find(isTextBlock)
  const wasRemoved = nextBlocks.length < blocks.length

  onBlocksChange(nextBlocks)

  if (!wasRemoved) {
    requestFocus?.(block.id, "start")
  } else if (prevTextBlock) {
    requestFocus?.(prevTextBlock.id, "end")
  } else if (nextTextBlock) {
    requestFocus?.(nextTextBlock.id, "start")
  }
}

const makeOnConvert = (block: EditTextBlock, ctx: EditContext) => {
  const { blocks, onBlocksChange } = ctx
  if (!onBlocksChange) return () => {}
  return (target: BlockConvertTarget) => {
    const converted = convertTextBlockFormat(block, target)
    onBlocksChange(blocks.map((b) => (b.id === block.id ? converted : b)))
  }
}

const renderEditableText = (
  block: EditTextBlock,
  ctx: EditContext
): ReactElement =>
  renderEditableTextLayout({
    block,
    onKeyDown: (event) => handleTextBlockKeyDown(event, block, ctx),
    onTextChange: (text) =>
      ctx.onBlocksChange?.(updateText(ctx.blocks, block.id, text))
  })

const renderBlockActionMenu = (
  block: EditTextBlock,
  ctx: EditContext
): ReactElement | null => {
  if (!ctx.editable) return null
  return renderBlockActionMenuLayout({
    block,
    ctx,
    onConvert: makeOnConvert(block, ctx)
  })
}

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
