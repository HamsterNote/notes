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
import {
  buildReplacementFromShortcut,
  focusTargetIdFromShortcut,
  matchMarkdownShortcut
} from "./markdownShortcut"
import type { NoteHeadingBlock, NoteParagraphBlock } from "./types"
import { assertNever } from "./utils"

type EditTextBlock = NoteHeadingBlock | NoteParagraphBlock

type NoteTextBlockProps = {
  readonly block: EditTextBlock
  readonly ctx: EditContext
}

export const NoteTextBlock = ({
  block,
  ctx
}: NoteTextBlockProps): ReactElement => {
  // 输入事件处理：识别 Markdown 快捷键 marker。
  //
  // 当前块是 paragraph 或 heading 时，用户输入触发字符串（# / ## / [] / [x] /
  // > / ```）后会触发 onInput；我们在此处将整块替换为目标块，并 focus 到
  // 新块的可编辑元素上。所有触发字符串与转换规则由 `matchMarkdownShortcut`
  // 统一归纳，保持单项可测试入口。
  //
  // 设计取舍：
  //  - 命中后清空 contentEditable 的 DOM 文本，避免下次渲染前残留 marker；
  //    React 会用新块的 `richText` dangerouslySetInnerHTML 重置 innerHTML。
  //  - 不复用 source.text（参见 `buildReplacementFromShortcut` 注释），
  //    避免让新块带前缀污染。
  //  - requestFocus 目标由 `focusTargetIdFromShortcut` 决策；对 checklist
  //    来说项的 id 才是 contentEditable 根，对其它块则是块 id 本身。
  const handleInput = (event: FormEvent<HTMLElement>): void => {
    if (!ctx.onBlocksChange) return

    const match = matchMarkdownShortcut(event.currentTarget.textContent ?? "")
    if (match === null) return

    event.currentTarget.textContent = ""

    const replacement = buildReplacementFromShortcut(match, block.id)
    const focusId = focusTargetIdFromShortcut(match, replacement)

    ctx.onBlocksChange(
      ctx.getBlocks().map((candidate) =>
        candidate.id === block.id ? replacement : candidate
      )
    )
    ctx.requestFocus?.(focusId, "start")
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
