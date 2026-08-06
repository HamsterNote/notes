import { quoteLineId, quoteTextLines } from "./blockSourceConversion"
import type { NoteBlock } from "./types"

export const noteBlockRegionIds = (block: NoteBlock): readonly string[] => {
  switch (block.kind) {
    case "todo":
    case "checklist":
      return [`${block.id}:title`, ...block.items.map((item) => item.id)]
    case "quote":
      return [
        ...quoteTextLines(block.text).map((_, index) => quoteLineId(block.id, index)),
        ...(block.author ? [`${block.id}:author`] : []),
      ]
    case "callout":
      return [`${block.id}:title`, block.id]
    case "collapsible":
      return [
        `${block.id}:title`,
        ...(block.collapsed ? [] : block.blocks.flatMap(noteBlockRegionIds)),
      ]
    case "heading":
    case "paragraph":
    case "unorderedList":
    case "orderedList":
    case "code":
      return [block.id]
    case "table":
    case "formula":
    case "picture":
    case "card":
    case "drawing":
    case "directory":
      return []
  }
}

export const topLevelRegionIndex = (
  blocks: readonly NoteBlock[],
  regionId: string,
): number => blocks.findIndex((block) => noteBlockRegionIds(block).includes(regionId))

const removeQuoteRegion = (block: Extract<NoteBlock, { readonly kind: "quote" }>, regionId: string): NoteBlock => {
  if (regionId === `${block.id}:author`) {
    return { id: block.id, kind: "quote", text: block.text }
  }
  const lines = quoteTextLines(block.text)
  const lineIndex = lines.findIndex((_, index) => quoteLineId(block.id, index) === regionId)
  return lineIndex < 0
    ? block
    : { ...block, text: lines.filter((_, index) => index !== lineIndex).join("\n") }
}

const removeBlockRegion = (block: NoteBlock, regionId: string): NoteBlock => {
  if (!noteBlockRegionIds(block).includes(regionId)) return block
  switch (block.kind) {
    case "todo":
    case "checklist":
      return regionId === `${block.id}:title`
        ? { ...block, title: "" }
        : { ...block, items: block.items.filter((item) => item.id !== regionId) }
    case "quote":
      return removeQuoteRegion(block, regionId)
    case "callout":
      return regionId === `${block.id}:title` ? { ...block, title: "" } : { ...block, text: "" }
    case "collapsible":
      return regionId === `${block.id}:title`
        ? { ...block, title: "" }
        : { ...block, blocks: block.blocks.map((child) => removeBlockRegion(child, regionId)) }
    case "heading":
    case "paragraph":
    case "unorderedList":
    case "orderedList":
      return { ...block, text: "" }
    case "code":
      return { ...block, code: "" }
    case "table":
    case "formula":
    case "picture":
    case "card":
    case "drawing":
    case "directory":
      return block
  }
}

export const removeRegionsAfter = (
  block: NoteBlock,
  startRegionId: string,
  endRegionId?: string,
): NoteBlock | null => {
  const regions = noteBlockRegionIds(block)
  const startIndex = regions.indexOf(startRegionId)
  const endIndex = endRegionId ? regions.indexOf(endRegionId) : regions.length - 1
  if (startIndex < 0 || endIndex < startIndex) return null
  let current = block
  for (let index = endIndex; index > startIndex; index -= 1) {
    const regionId = regions[index]
    if (regionId) current = removeBlockRegion(current, regionId)
  }
  return current
}

export const retainRegionsAfter = (
  block: NoteBlock,
  endRegionId: string,
): NoteBlock | null => {
  const regions = noteBlockRegionIds(block)
  const endIndex = regions.indexOf(endRegionId)
  if (endIndex < 0) return block
  if (endIndex === regions.length - 1) return null
  let current = block
  for (let index = endIndex; index >= 0; index -= 1) {
    const regionId = regions[index]
    if (regionId) current = removeBlockRegion(current, regionId)
  }
  return current
}

export const retainRegionsFrom = (
  block: NoteBlock,
  regionId: string,
): NoteBlock | null => {
  const regions = noteBlockRegionIds(block)
  const regionIndex = regions.indexOf(regionId)
  if (regionIndex < 0) return block
  let current = block
  for (let index = regionIndex - 1; index >= 0; index -= 1) {
    const removedRegionId = regions[index]
    if (removedRegionId) current = removeBlockRegion(current, removedRegionId)
  }
  return current
}
