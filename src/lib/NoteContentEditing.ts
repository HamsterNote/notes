import type { FocusEvent } from "react"

import type { NoteBlock } from "./types"
import type { FocusCaret } from "./useBlockEditing"

export type EditContext = {
  readonly editable: boolean
  readonly blocks: readonly NoteBlock[]
  readonly openBlockMenuId: string | null
  readonly onBlocksChange: ((blocks: NoteBlock[]) => void) | undefined
  readonly requestFocus:
    ((blockId: string, caret: FocusCaret) => void) | undefined
  readonly onBlockMenuOpenChange: (blockId: string, open: boolean) => void
}

export const editableProps = (
  onBlur: (event: FocusEvent<HTMLElement>) => void,
  baseClassName?: string
) => ({
  contentEditable: true,
  suppressContentEditableWarning: true,
  className: baseClassName
    ? `${baseClassName} hn-note-editable`
    : "hn-note-editable",
  spellCheck: false,
  onBlur
})

/**
 * 缓存 richText 返回值，相同字符串返回相同对象引用。
 * 防止 React 因 dangerouslySetInnerHTML 引用变化而重设 innerHTML，
 * 从而避免 contenteditable 元素的光标位置在重渲染时被重置。
 */
const richTextCache = new Map<
  string,
  { readonly dangerouslySetInnerHTML: { readonly __html: string } }
>()

export const richText = (value: string) => {
  let cached = richTextCache.get(value)
  if (!cached) {
    cached = { dangerouslySetInnerHTML: { __html: value } }
    richTextCache.set(value, cached)
  }
  return cached
}

export const updateText = (
  blocks: readonly NoteBlock[],
  id: string,
  text: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id) return block
    if (
      block.kind === "heading" ||
      block.kind === "paragraph" ||
      block.kind === "quote" ||
      block.kind === "callout"
    ) {
      return { ...block, text }
    }
    return block
  })

export const updateCalloutTitle = (
  blocks: readonly NoteBlock[],
  id: string,
  title: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "callout") return block
    return { ...block, title }
  })

export const updateQuoteAuthor = (
  blocks: readonly NoteBlock[],
  id: string,
  author: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "quote") return block
    return { ...block, author }
  })

export const updateCode = (
  blocks: readonly NoteBlock[],
  id: string,
  code: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "code") return block
    return { ...block, code }
  })

export const toggleChecklistItem = (
  blocks: readonly NoteBlock[],
  blockId: string,
  itemId: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== blockId || block.kind !== "checklist") return block
    return {
      ...block,
      items: block.items.map((item) =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )
    }
  })

export const updateChecklistItemText = (
  blocks: readonly NoteBlock[],
  blockId: string,
  itemId: string,
  text: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== blockId || block.kind !== "checklist") return block
    return {
      ...block,
      items: block.items.map((item) =>
        item.id === itemId ? { ...item, text } : item
      )
    }
  })
