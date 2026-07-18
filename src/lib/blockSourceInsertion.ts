import type { BlockConvertTarget } from "./blockConversion"
import { insertBlockAfter } from "./blockEditing"
import {
  type BlockSource,
  quoteLineId,
  quoteTextLines
} from "./blockSourceConversion"
import type { NoteBlock } from "./types"

type InsertBlockAfterSourceInput = {
  readonly blocks: readonly NoteBlock[]
  readonly focusId: string
  readonly nextId: string
  readonly source: BlockSource
  readonly target: BlockConvertTarget
}

type InsertBlockAfterSourceResult = {
  readonly blocks: NoteBlock[]
  readonly focusId: string
}

export const insertBlockAfterSource = ({
  blocks,
  focusId,
  nextId,
  source,
  target
}: InsertBlockAfterSourceInput): InsertBlockAfterSourceResult => {
  if (source.kind === "checklist-item" && target.kind === "checklist") {
    const nextBlocks = blocks.map((block) => {
      if (block.kind !== "checklist" || block.id !== source.blockId) return block
      const sourceIndex = block.items.findIndex(
        (item) => item.id === source.itemId
      )
      if (sourceIndex < 0) return block
      const items = block.items.slice()
      items.splice(sourceIndex + 1, 0, {
        id: focusId,
        checked: false,
        text: ""
      })
      return { ...block, items }
    })
    return { blocks: nextBlocks, focusId }
  }

  if (source.kind === "quote-line" && target.kind === "quote") {
    const nextBlocks = blocks.map((block) => {
      if (block.kind !== "quote" || block.id !== source.blockId) return block
      const lines = quoteTextLines(block.text).slice()
      if (source.lineIndex < 0 || source.lineIndex >= lines.length) return block
      lines.splice(source.lineIndex + 1, 0, "")
      return { ...block, text: lines.join("\n") }
    })
    return {
      blocks: nextBlocks,
      focusId: quoteLineId(source.blockId, source.lineIndex + 1)
    }
  }

  return {
    blocks: insertBlockAfter({
      blocks,
      blockId: source.blockId,
      ...(target.kind === "checklist" ? { checklistItemId: focusId } : {}),
      nextId,
      target
    }),
    focusId
  }
}
