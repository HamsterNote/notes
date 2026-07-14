import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from "react"

import { BlockActionMenu, type BlockConvertTarget } from "./BlockActionMenu"
import {
  createNextBlockId,
  deleteEmptyTextBlock,
  insertSplitBlock,
  isVisibleHtmlEmpty
} from "./blockEditing"
import {
  type BlockSource,
  convertBlockSource
} from "./blockSourceConversion"
import { resolveDeletionFocus } from "./NoteBlockFocus"
import type { EditContext } from "./NoteContentEditing"
import type { NoteBlock } from "./types"

type EditableContentMode = "rich-text" | "plain-text"

type KeyDownInput = {
  readonly ctx: EditContext
  readonly event: ReactKeyboardEvent<HTMLElement>
  readonly mode: EditableContentMode
  readonly sourceId: string
}

const htmlBeforeCaret = (element: HTMLElement, range: Range): string => {
  const beforeRange = document.createRange()
  beforeRange.selectNodeContents(element)
  beforeRange.setEnd(range.startContainer, range.startOffset)
  const container = document.createElement("div")
  container.appendChild(beforeRange.cloneContents())
  return container.innerHTML
}

export const handleEditableBlockKeyDown = ({
  ctx,
  event,
  mode,
  sourceId
}: KeyDownInput): void => {
  const { blocks, onBlocksChange, requestFocus } = ctx
  if (!onBlocksChange) return

  const element = event.currentTarget
  const selection = window.getSelection()

  if (event.key === "Enter" && event.shiftKey && mode === "rich-text") {
    // shift + 回车：在 block 内插入软换行 <br>，不拆分 block
    event.preventDefault()
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const element = event.currentTarget
    if (!element.contains(range.commonAncestorContainer)) return
    if (!range.collapsed) range.deleteContents()

    // 用 Range API 手动插入 <br>（execCommand 已废弃且行末行为不一致）
    const br = document.createElement("br")
    range.insertNode(br)

    // 行末时浏览器会将末尾 <br> 视为 trailing BR 不渲染空行，
    // 需追加一个占位 <br>，光标置于两者之间确保空行可见
    if (!br.nextSibling) {
      br.after(document.createElement("br"))
    }

    // 将光标移到新插入的 <br> 之后
    range.setStartAfter(br)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    return
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!element.contains(range.commonAncestorContainer)) return
    if (!range.collapsed) range.deleteContents()

    const afterRange = document.createRange()
    afterRange.selectNodeContents(element)
    afterRange.setStart(range.endContainer, range.endOffset)
    const afterContainer = document.createElement("div")
    afterContainer.appendChild(afterRange.extractContents())
    const nextId = createNextBlockId(blocks, sourceId)
    const nextBlocks = insertSplitBlock({
      afterHtml:
        mode === "plain-text"
          ? afterContainer.textContent ?? ""
          : afterContainer.innerHTML,
      beforeHtml:
        mode === "plain-text" ? element.textContent ?? "" : element.innerHTML,
      blocks,
      sourceId
    })
    onBlocksChange(nextBlocks)
    requestFocus?.(nextId, "start")
    return
  }

  if (event.key !== "Backspace" || !selection || selection.rangeCount === 0)
    return
  const range = selection.getRangeAt(0)
  if (!selection.isCollapsed || !element.contains(range.commonAncestorContainer))
    return
  const beforeHtml = htmlBeforeCaret(element, range)
  if (!isVisibleHtmlEmpty(beforeHtml) || !isVisibleHtmlEmpty(element.innerHTML))
    return

  event.preventDefault()
  const nextBlocks = deleteEmptyTextBlock({
    blocks,
    currentHtml:
      mode === "plain-text" ? element.textContent ?? "" : element.innerHTML,
    sourceId
  })
  const focusTarget = resolveDeletionFocus({
    after: nextBlocks,
    before: blocks,
    sourceId
  })

  onBlocksChange(nextBlocks)
  if (focusTarget) requestFocus?.(focusTarget.id, focusTarget.position)
}

export const renderBlockActionMenu = (
  block: NoteBlock,
  ctx: EditContext,
  source: BlockSource = { kind: "block", blockId: block.id }
): ReactElement | null => {
  if (!ctx.editable) return null
  const sourceId =
    source.kind === "checklist-item"
      ? source.itemId
      : source.kind === "quote-line"
        ? source.lineId
        : source.blockId

  const onConvert = (target: BlockConvertTarget) => {
    ctx.onBlocksChange?.(convertBlockSource({ blocks: ctx.blocks, source, target }))
    return target.kind === "checklist" ? `${sourceId}-item` : sourceId
  }

  return (
    <BlockActionMenu
      open={ctx.openBlockMenuId === sourceId}
      onOpenChange={(open) => ctx.onBlockMenuOpenChange(sourceId, open)}
      blockId={sourceId}
      kind={block.kind}
      {...(block.kind === "heading" ? { headingLevel: block.level } : {})}
      onConvert={onConvert}
    />
  )
}
