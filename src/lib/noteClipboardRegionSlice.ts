import { quoteLineId, quoteTextLines } from "./blockSourceConversion"
import { sliceFromBlock, type NoteClipboardSlice } from "./noteClipboardSlices"
import type { NoteBlock } from "./types"

const sliceFromNestedRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
): NoteClipboardSlice | null => {
  for (const block of blocks) {
    const slice = sliceFromRegion(block, regionId)
    if (slice) return slice
  }
  return null
}

const sliceFromRegion = (
  block: NoteBlock,
  regionId: string,
): NoteClipboardSlice | null => {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "orderedList":
    case "unorderedList":
    case "code":
      return block.id === regionId ? sliceFromBlock(block) : null
    case "todo":
    case "checklist": {
      if (regionId === `${block.id}:title`) {
        return sliceFromBlock({ ...block, items: [] })
      }
      const item = block.items.find((candidate) => candidate.id === regionId)
      return item ? sliceFromBlock({ ...block, title: "", items: [item] }) : null
    }
    case "quote": {
      if (regionId === `${block.id}:author` && block.author) {
        return sliceFromBlock({ ...block, text: "", author: block.author })
      }
      const lines = quoteTextLines(block.text)
      const index = lines.findIndex((_, lineIndex) => quoteLineId(block.id, lineIndex) === regionId)
      if (index < 0) return null
      return sliceFromBlock({ id: block.id, kind: "quote", text: lines[index] ?? "" })
    }
    case "callout":
      if (regionId === `${block.id}:title`) return sliceFromBlock({ ...block, text: "" })
      return regionId === block.id ? sliceFromBlock({ ...block, title: "" }) : null
    case "collapsible":
      if (regionId === `${block.id}:title`) return sliceFromBlock({ ...block, blocks: [] })
      return block.collapsed ? null : sliceFromNestedRegion(block.blocks, regionId)
    case "table":
    case "formula":
    case "picture":
    case "card":
    case "drawing":
    case "directory":
      return null
  }
}

export const clipboardSliceFromRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
): NoteClipboardSlice | null => sliceFromNestedRegion(blocks, regionId)
