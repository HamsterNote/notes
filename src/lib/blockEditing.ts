import type { BlockConvertTarget } from "./blockConversion"
import { convertBlockFormat } from "./blockConversion"
import type {
  NoteBlock,
  NoteChecklistItem,
  NoteHeadingBlock,
  NoteOrderedListBlock,
  NoteParagraphBlock,
  NoteTodoBlock,
  NoteUnorderedListBlock
} from "./types"
import { assertNever } from "./utils"

export { convertBlockFormat, convertTextBlockFormat } from "./blockConversion"

type TextBlock =
  | NoteHeadingBlock
  | NoteParagraphBlock
  | NoteUnorderedListBlock
  | NoteOrderedListBlock

type SplitTextBlockAtHtmlInput = {
  readonly afterHtml: string
  readonly beforeHtml: string
  readonly block: TextBlock
  readonly nextId: string
}

type InsertSplitBlockInput = {
  readonly afterHtml: string
  readonly beforeHtml: string
  readonly blocks: readonly NoteBlock[]
  readonly nextId: string
  readonly sourceId: string
}

type DeleteEmptyTextBlockInput = {
  readonly blocks: readonly NoteBlock[]
  readonly currentHtml: string
  readonly sourceId: string
}

const boundaryBreakPattern = /^(?:\s*<br>\s*)+|(?:\s*<br>\s*)+$/giu

const toStoredTextBlock = (block: TextBlock, text: string): TextBlock => {
  switch (block.kind) {
    case "heading":
      return {
        id: block.id,
        kind: "heading",
        level: block.level,
        text
      }
    case "paragraph":
      return {
        id: block.id,
        kind: "paragraph",
        text,
        ...(block.tone === undefined ? {} : { tone: block.tone })
      }
    case "unorderedList":
      return { id: block.id, kind: "unorderedList", text }
    case "orderedList":
      return { id: block.id, kind: "orderedList", text }
    default:
      return assertNever(block)
  }
}

const toPlainStoredTextBlock = (block: TextBlock, text: string): TextBlock => {
  switch (block.kind) {
    case "heading":
      return {
        id: block.id,
        kind: "heading",
        level: block.level,
        text
      }
    case "paragraph":
      return {
        id: block.id,
        kind: "paragraph",
        text
      }
    case "unorderedList":
      return { id: block.id, kind: "unorderedList", text }
    case "orderedList":
      return { id: block.id, kind: "orderedList", text }
    default:
      return assertNever(block)
  }
}

export const normalizeEditableHtml = (html: string): string => {
  const normalized = html
    .trim()
    .replace(/\u200B/gu, "")
    .replace(/<\s*br\s*\/?>/giu, "<br>")
    .replace(/<\s*(?:div|p)\b[^>]*>/giu, "<br>")
    .replace(/<\s*\/\s*(?:div|p)\s*>/giu, "")

  return normalized.replace(boundaryBreakPattern, "")
}

export const isVisibleHtmlEmpty = (html: string): boolean => {
  const visibleText = normalizeEditableHtml(html)
    .replace(/<br>/giu, "")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .trim()

  return visibleText.length === 0
}

export const splitTextBlockAtHtml = ({
  afterHtml,
  beforeHtml,
  block,
  nextId
}: SplitTextBlockAtHtmlInput): readonly [TextBlock, TextBlock] => {
  const beforeText = normalizeEditableHtml(beforeHtml)
  const afterText = normalizeEditableHtml(afterHtml)
  const updatedBlock = toStoredTextBlock(block, beforeText)
  const insertedBlock = toStoredTextBlock({ ...block, id: nextId }, afterText)

  return [updatedBlock, insertedBlock]
}

type SplitListItemsInput = {
  readonly afterHtml: string
  readonly beforeHtml: string
  readonly items: readonly NoteChecklistItem[]
  readonly nextId: string
  readonly sourceId: string
}

const splitListItems = ({
  afterHtml,
  beforeHtml,
  items,
  nextId,
  sourceId
}: SplitListItemsInput): readonly NoteChecklistItem[] => {
  const itemIndex = items.findIndex((item) => item.id === sourceId)
  if (itemIndex < 0) return items

  const item = items[itemIndex]
  if (item === undefined) return items
  const nextItems = items.slice()
  nextItems.splice(
    itemIndex,
    1,
    { ...item, text: normalizeEditableHtml(beforeHtml) },
    {
      id: nextId,
      checked: false,
      text: normalizeEditableHtml(afterHtml)
    }
  )
  return nextItems
}

const findTodoItemBlock = (
  blocks: readonly NoteBlock[],
  sourceId: string
): NoteTodoBlock | undefined =>
  blocks.find((block): block is NoteTodoBlock => {
    if (block.kind !== "todo") return false
    return block.items.some((item) => item.id === sourceId)
  })

const updateTodoItemText = (
  block: NoteTodoBlock,
  sourceId: string,
  text: string
): NoteTodoBlock => ({
  ...block,
  items: block.items.map((item) =>
    item.id === sourceId ? { ...item, text } : item
  )
})

const removeTodoItem = (
  block: NoteTodoBlock,
  sourceId: string
): NoteTodoBlock => ({
  ...block,
  items: block.items.filter((item) => item.id !== sourceId)
})

type InsertBlockAfterInput = {
  readonly blocks: readonly NoteBlock[]
  readonly blockId: string
  readonly todoItemId?: string | undefined
  readonly nextId: string
  readonly target: BlockConvertTarget
}

export const insertBlockAfter = ({
  blocks,
  blockId,
  todoItemId,
  nextId,
  target
}: InsertBlockAfterInput): NoteBlock[] => {
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index < 0) return [...blocks]

  const newBlock = convertBlockFormat(
    { id: nextId, kind: "paragraph", text: "" },
    target,
    todoItemId
  )

  const nextBlocks = [...blocks]
  nextBlocks.splice(index + 1, 0, newBlock)
  return nextBlocks
}

export const insertSplitBlock = ({
  afterHtml,
  beforeHtml,
  blocks,
  nextId,
  sourceId
}: InsertSplitBlockInput): NoteBlock[] => {
  return blocks.flatMap<NoteBlock>((block): NoteBlock[] => {
    switch (block.kind) {
      case "heading":
      case "paragraph": {
        if (block.id !== sourceId) return [block]
        const [sourceBlock, insertedBlock] = splitTextBlockAtHtml({
          afterHtml,
          beforeHtml,
          block,
          nextId
        })
        return [
          toPlainStoredTextBlock(sourceBlock, sourceBlock.text),
          {
            id: insertedBlock.id,
            kind: "paragraph",
            text: insertedBlock.text
          }
        ]
      }
      case "unorderedList":
      case "orderedList":
        if (block.id !== sourceId) return [block]
        return [
          { ...block, text: normalizeEditableHtml(beforeHtml) },
          { ...block, id: nextId, text: normalizeEditableHtml(afterHtml) }
        ]
      case "todo":
      case "checklist":
        return [
          {
            ...block,
            items: splitListItems({
              afterHtml,
              beforeHtml,
              items: block.items,
              nextId,
              sourceId
            })
          }
        ]
      case "quote":
        if (block.id !== sourceId) return [block]
        return [
          { ...block, text: normalizeEditableHtml(beforeHtml) },
          { ...block, id: nextId, text: normalizeEditableHtml(afterHtml) }
        ]
      case "callout":
      case "code":
      case "table":
      case "formula":
      case "picture":
      case "drawing":
      case "directory":
        return [block]
      case "collapsible":
        // 标题行不参与 Enter 拆分，保持块不变
        return [block]
      default:
        return assertNever(block)
    }
  })
}

export const deleteEmptyTextBlock = ({
  blocks,
  currentHtml,
  sourceId
}: DeleteEmptyTextBlockInput): NoteBlock[] => {
  const normalizedText = normalizeEditableHtml(currentHtml)

  const todoItemBlock = findTodoItemBlock(blocks, sourceId)
  if (todoItemBlock) {
    if (!isVisibleHtmlEmpty(normalizedText)) {
      return blocks.map((block) =>
        block.id === todoItemBlock.id
          ? updateTodoItemText(todoItemBlock, sourceId, normalizedText)
          : block
      )
    }
    if (todoItemBlock.items.length > 1) {
      return blocks.map((block) =>
        block.id === todoItemBlock.id
          ? removeTodoItem(todoItemBlock, sourceId)
          : block
      )
    }
    // 单 item 空内容时：整块降级为 paragraph，保留原 block.id（与列表行为一致）
    return blocks.map((block) =>
      block.id === todoItemBlock.id
        ? { id: todoItemBlock.id, kind: "paragraph", text: "" }
        : block
    )
  }

  if (!isVisibleHtmlEmpty(normalizedText)) {
    return blocks.map((block) => {
      if (block.id !== sourceId) {
        return block
      }

      switch (block.kind) {
        case "heading":
        case "paragraph":
          return toPlainStoredTextBlock(block, normalizedText)
        case "quote":
        case "callout":
        case "unorderedList":
        case "orderedList":
          return { ...block, text: normalizedText }
        case "code":
          return { ...block, code: currentHtml }
        case "todo":
        case "table":
        case "formula":
        case "picture":
        case "drawing":
        case "directory":
          return block
        case "collapsible":
        case "checklist":
          // 标题非空时更新 title 字段
          return { ...block, title: normalizedText }
        default:
          return assertNever(block)
      }
    })
  }

  const sourceBlock = blocks.find((block) => block.id === sourceId)
  if (
    sourceBlock?.kind === "unorderedList" ||
    sourceBlock?.kind === "orderedList"
  ) {
    return blocks.map((block) =>
      block.id === sourceId
        ? { id: sourceId, kind: "paragraph", text: "" }
        : block
    )
  }
  if (
    (sourceBlock?.kind === "quote" && sourceBlock.author?.trim()) ||
    (sourceBlock?.kind === "callout" && sourceBlock.title.trim()) ||
    (sourceBlock?.kind === "code" && sourceBlock.filename?.trim())
  ) {
    return blocks.map((block) => {
      if (block.id !== sourceId) return block
      if (block.kind === "quote" || block.kind === "callout") {
        return { ...block, text: "" }
      }
      return block.kind === "code" ? { ...block, code: "" } : block
    })
  }

  if (blocks.length === 1) {
    return [
      {
        id: sourceId,
        kind: "paragraph",
        text: ""
      }
    ]
  }

  return blocks.filter((block) => block.id !== sourceId)
}
