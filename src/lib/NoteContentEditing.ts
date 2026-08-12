import {
  sanitizeBodyHtml,
  sanitizeCodeHighlightHtml,
  sanitizeTitleHtml
} from "./restrictedHtml"
import type { NoteBlock, NoteTheme } from "./types"
import type { FocusCaret } from "./useBlockEditing"


export type EditContext = {
  readonly editable: boolean
  readonly theme: NoteTheme
  readonly themeColor: string | undefined
  readonly blocks: readonly NoteBlock[]
  readonly getBlocks: () => readonly NoteBlock[]
  readonly openBlockMenuId: string | null
  readonly onBlocksChange: ((blocks: NoteBlock[]) => void) | undefined
  readonly onPictureUpload:
    | ((base64: string, filename: string) => Promise<string>)
    | undefined
  readonly requestFocus:
    ((blockId: string, caret: FocusCaret) => void) | undefined
  readonly onBlockMenuOpenChange: (blockId: string, open: boolean) => void
  readonly externalItemsClickable: boolean
  /**
   * 是否处于内容块选择模式。
   * 选择模式下各块渲染为只读，子块渲染器可据此在自身边界上
    * 标记 data-note-select-id 等选择属性（如 todo 的每个条目）。
   */
  readonly selectMode?: boolean
  /** 当前被选中的内容块/条目 id，用于驱动 aria-selected 高亮。 */
  readonly selectedBlockId?: string | null
}

const editableCommitters = new WeakMap<HTMLElement, () => void>()

const syncTitlePlaceholderVisibility = (editable: HTMLElement): void => {
  const onlyChild = editable.firstChild
  const isEmpty =
    onlyChild === null ||
    (onlyChild === editable.lastChild && onlyChild.nodeName === "BR")
  editable.toggleAttribute("data-placeholder-visible", isEmpty)
}

/**
 * 立即提交指定 contenteditable 的当前 DOM 内容。
 * Markdown 快捷转换会在元素仍保持焦点时调用此入口，从而复用该 editable
 * 原本的 blur 持久化路径，包括条目、折叠标题、表格单元格和嵌套块。
 */
export const commitEditableContent = (editable: HTMLElement) => {
  editableCommitters.get(editable)?.()
}

export const editableProps = (
  onCommit: (editable: HTMLElement) => void,
  baseClassName?: string,
  profile: "body" | "title" = "body"
) => {
  let currentEditable: HTMLElement | null = null
  const commit = (editable: HTMLElement) => {
    const sanitized = profile === "title"
      ? sanitizeTitleHtml(editable.innerHTML)
      : sanitizeBodyHtml(editable.innerHTML)
    if (sanitized !== editable.innerHTML) editable.innerHTML = sanitized
    if (profile === "title") syncTitlePlaceholderVisibility(editable)
    onCommit(editable)
  }

  return {
    contentEditable: true,
    suppressContentEditableWarning: true,
    className: baseClassName
      ? `${baseClassName} hn-note-editable`
      : "hn-note-editable",
    spellCheck: false,
    ref: (editable: HTMLElement | null) => {
      if (currentEditable) editableCommitters.delete(currentEditable)
      currentEditable = editable
      if (editable) {
        editableCommitters.set(editable, () => commit(editable))
        if (profile === "title") syncTitlePlaceholderVisibility(editable)
      }
    },
    onInput: profile === "title"
      ? (event: React.FormEvent<HTMLElement>) => {
          syncTitlePlaceholderVisibility(event.currentTarget)
        }
      : undefined,
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      // 焦点移向 SelectionPopover（如链接输入框）时跳过同步：
      // 避免 React 因 dangerouslySetInnerHTML 引用变化而替换 DOM 节点，
      // 导致 SelectionPopover 内保存的选区 Range 指向已被销毁的节点
      const related = event.relatedTarget as HTMLElement | null
      if (related?.closest(".hn-note-popover")) return
      commit(event.currentTarget)
    }
  }
}

/**
 * 缓存 richText 返回值，相同字符串返回相同对象引用。
 * 防止 React 因 dangerouslySetInnerHTML 引用变化而重设 innerHTML，
 * 从而避免 contenteditable 元素的光标位置在重渲染时被重置。
 */
const richTextCache = new Map<
  string,
  { readonly dangerouslySetInnerHTML: { readonly __html: string } }
>()
const richTextCacheLimit = 500

export const richText = (
  value: string,
  profile: "body" | "code" | "title" = "body"
) => {
  const sanitized = profile === "title"
    ? sanitizeTitleHtml(value)
    : profile === "code"
      ? sanitizeCodeHighlightHtml(value)
      : sanitizeBodyHtml(value)
  const cacheKey = `${profile}\u0000${sanitized}`
  let cached = richTextCache.get(cacheKey)
  if (!cached) {
    if (richTextCache.size >= richTextCacheLimit) {
      const oldestKey = richTextCache.keys().next().value
      if (oldestKey !== undefined) richTextCache.delete(oldestKey)
    }
    cached = { dangerouslySetInnerHTML: { __html: sanitized } }
    richTextCache.set(cacheKey, cached)
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
      block.kind === "callout" ||
      block.kind === "unorderedList" ||
      block.kind === "orderedList"
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

export const updateCollapsibleTitle = (
  blocks: readonly NoteBlock[],
  id: string,
  title: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "collapsible") return block
    return { ...block, title }
  })

export const toggleCollapsible = (
  blocks: readonly NoteBlock[],
  id: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "collapsible") return block
    return { ...block, collapsed: !block.collapsed }
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

export const updateFormula = (
  blocks: readonly NoteBlock[],
  id: string,
  formula: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "formula") return block
    return { ...block, formula }
  })

/** 更新画板块的 DrawingValue JSON 字符串。 */
export const updateDrawing = (
  blocks: readonly NoteBlock[],
  id: string,
  data: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "drawing") return block
    return { ...block, data }
  })

export const updateCodeLanguage = (
  blocks: readonly NoteBlock[],
  id: string,
  language: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "code") return block
    return { ...block, language }
  })

export const updateCodeFilename = (
  blocks: readonly NoteBlock[],
  id: string,
  filename: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "code") return block
    return { ...block, filename }
  })

export const toggleTodoItem = (
  blocks: readonly NoteBlock[],
  blockId: string,
  itemId: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== blockId || block.kind !== "todo") return block
    return {
      ...block,
      items: block.items.map((item) =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )
    }
  })

export const updateTodoItemText = (
  blocks: readonly NoteBlock[],
  blockId: string,
  itemId: string,
  text: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== blockId || block.kind !== "todo") return block
    return {
      ...block,
      items: block.items.map((item) =>
        item.id === itemId ? { ...item, text } : item
      )
    }
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
