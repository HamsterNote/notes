import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from "react"

import {
  BlockActionMenu,
  type BlockConvertTarget,
  type PictureUploadPayload
} from "./BlockActionMenu"
import {
  deleteEmptyTextBlock,
  insertSplitBlock,
  isVisibleHtmlEmpty
} from "./blockEditing"
import {
  type BlockSource,
  convertBlockSource,
  replaceBlockSourceWithPicture
} from "./blockSourceConversion"
import {
  deleteBlockSource,
  duplicateBlockSource
} from "./blockSourceOperations"
import { insertBlockAfterSource } from "./blockSourceInsertion"
import { resolveDeletionFocus } from "./NoteBlockFocus"
import type { EditContext } from "./NoteContentEditing"
import { createNoteId } from "./noteId"
import type { NoteBlock } from "./types"

/**
 * 生成受控菜单 open 状态使用的稳定 key，避免 source id 与 add 后缀冲突。
 * 这个 key 只用于 openBlockMenuId 内部状态，不暴露给用户/持久化数据。
 */
export const blockMenuStateKey = (
  mode: "add" | "convert",
  source: BlockSource
): string => {
  const namespace =
    source.kind === "todo-item"
      ? `todo-item:${source.blockId}:${source.itemId}`
      : source.kind === "quote-line"
        ? `quote-line:${source.blockId}:${source.lineId}`
        : `block:${source.blockId}`
  return `block-action:${mode}:${namespace}`
}

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
    const nextId = createNoteId()
    const nextBlocks = insertSplitBlock({
      afterHtml:
        mode === "plain-text"
          ? afterContainer.textContent ?? ""
          : afterContainer.innerHTML,
      beforeHtml:
        mode === "plain-text" ? element.textContent ?? "" : element.innerHTML,
      blocks,
      nextId,
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
    source.kind === "todo-item"
      ? source.itemId
      : source.kind === "quote-line"
        ? source.lineId
        : source.blockId

  const addMenuId = blockMenuStateKey("add", source)
  const convertMenuId = blockMenuStateKey("convert", source)

  const isTodoTarget = (target: BlockConvertTarget): boolean =>
    target.kind === "todo"

  const onConvert = (target: BlockConvertTarget) => {
    const replacementId =
      source.kind === "quote-line" && source.lineIndex > 0
        ? createNoteId()
        : sourceId
    const focusId = isTodoTarget(target) ? createNoteId() : replacementId
    ctx.onBlocksChange?.(
      convertBlockSource({
        blocks: ctx.blocks,
        ...(isTodoTarget(target) ? { todoItemId: focusId } : {}),
        replacementId,
        source,
        target
      })
    )
    return focusId
  }
  const uploadPicture = ctx.onPictureUpload
  const updateBlocks = ctx.onBlocksChange
  const onPictureUpload =
    uploadPicture && updateBlocks
      ? async ({
          base64,
          filename,
          width,
          height
        }: PictureUploadPayload): Promise<void> => {
          const url = await uploadPicture(base64, filename)
          updateBlocks(
            replaceBlockSourceWithPicture({
              blocks: ctx.getBlocks(),
              source,
              url,
              filename,
              width,
              height
            })
          )
          ctx.onBlockMenuOpenChange(convertMenuId, false)
        }
      : undefined

  const onAdd = (target: BlockConvertTarget) => {
    const nextId = createNoteId()
    const focusId = isTodoTarget(target) ? createNoteId() : nextId
    const result = insertBlockAfterSource({
      blocks: ctx.getBlocks(),
      focusId,
      nextId,
      source,
      target
    })
    ctx.onBlocksChange?.(result.blocks)
    return result.focusId
  }

  // convert 模式专用：删除当前承载块，复用 NoteBlockFocus 解析焦点
  const onDelete = (): string | undefined => {
    const result = deleteBlockSource({ blocks: ctx.getBlocks(), source })
    ctx.onBlocksChange?.(result.blocks)
    // 删除后焦点：若存在目标，由 BlockActionMenu 通过 focusEditableBlock 调度
    return result.focusTarget?.id
  }

  // convert 模式专用：在当前承载块下方插入深拷贝（新 id），返回新块 id 供聚焦
  const onDuplicate = (): string | undefined => {
    const result = duplicateBlockSource({ blocks: ctx.getBlocks(), source })
    ctx.onBlocksChange?.(result.blocks)
    return result.focusBlockId
  }

  return (
    <>
      <BlockActionMenu
        mode="add"
        open={ctx.openBlockMenuId === addMenuId}
        onOpenChange={(open) => ctx.onBlockMenuOpenChange(addMenuId, open)}
        blockId={sourceId}
        kind={block.kind}
        {...(block.kind === "heading" ? { headingLevel: block.level } : {})}
        onSelect={onAdd}
      />
      <BlockActionMenu
        mode="convert"
        open={ctx.openBlockMenuId === convertMenuId}
        onOpenChange={(open) => ctx.onBlockMenuOpenChange(convertMenuId, open)}
        blockId={sourceId}
        kind={block.kind}
        {...(block.kind === "heading" ? { headingLevel: block.level } : {})}
        onSelect={onConvert}
        {...(onPictureUpload ? { onPictureUpload } : {})}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
      />
    </>
  )
}
