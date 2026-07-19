import type { NoteBlock, NoteTodoBlock } from "./types"
import { assertNever } from "./utils"

type FocusPosition = "start" | "end"

type DeletionFocusInput = {
  readonly after: readonly NoteBlock[]
  readonly before: readonly NoteBlock[]
  readonly sourceId: string
}

export type DeletionFocusTarget = {
  readonly id: string
  readonly position: FocusPosition
}

const editableIds = (blocks: readonly NoteBlock[]): string[] =>
  blocks.flatMap((block) => {
    switch (block.kind) {
      case "todo":
        return block.items.map((item) => item.id)
      case "unorderedList":
      case "orderedList":
        return [block.id]
      case "heading":
      case "paragraph":
      case "quote":
      case "code":
      case "callout":
      case "formula":
      case "collapsible":
        return [block.id]
      case "picture":
      case "directory":
        return []
      case "checklist":
        return block.items.map((item) => item.id)
      case "table":
        return block.rows.flatMap((row, rowIndex) =>
          row.map((_, colIndex) => `${block.id}-r${rowIndex}-c${colIndex}`)
        )
      default:
        return assertNever(block)
    }
  })

export const resolveDeletionFocus = ({
  after,
  before,
  sourceId
}: DeletionFocusInput): DeletionFocusTarget | undefined => {
  const afterIds = editableIds(after)
  if (afterIds.includes(sourceId)) return { id: sourceId, position: "start" }

  const beforeIds = editableIds(before)
  const sourceIndex = beforeIds.indexOf(sourceId)
  const previousId = sourceIndex > 0 ? beforeIds[sourceIndex - 1] : undefined
  if (previousId) return { id: previousId, position: "end" }

  const nextId = sourceIndex >= 0 ? beforeIds[sourceIndex + 1] : undefined
  const fallbackId = nextId ?? afterIds[0]
  return fallbackId ? { id: fallbackId, position: "start" } : undefined
}

// Backspace 专用焦点解析：单 item todo 在空 item 上按 Backspace 会原地降级为
// paragraph（保留 block.id）。此时 sourceId（item.id）虽已消失，但语义并非
// 「删除块」——焦点必须留在新 paragraph 起点，而非按删除兜底跳到前一个块末尾。
// 其余情形（真删除、多 item 移除一个等）沿用 resolveDeletionFocus。
export const resolveBackspaceFocus = ({
  after,
  before,
  sourceId
}: DeletionFocusInput): DeletionFocusTarget | undefined => {
  const todoHost = before.find(
    (block): block is NoteTodoBlock =>
      block.kind === "todo" && block.items.some((item) => item.id === sourceId)
  )
  if (
    todoHost &&
    after.some((block) => block.id === todoHost.id && block.kind === "paragraph")
  ) {
    return { id: todoHost.id, position: "start" }
  }
  return resolveDeletionFocus({ after, before, sourceId })
}
