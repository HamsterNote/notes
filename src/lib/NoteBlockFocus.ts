import type { NoteBlock } from "./types"
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
