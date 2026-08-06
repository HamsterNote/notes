import {
  noteBlockRegionIds,
  removeRegionsAfter,
  retainRegionsAfter,
  retainRegionsFrom,
} from "./noteNestedMutation"
import type { NoteBlock } from "./types"

type BoundarySplit = {
  readonly found: boolean
  readonly blocks: readonly NoteBlock[]
}

export const mergeBoundaryBlocks = (
  prefix: readonly NoteBlock[],
  inserted: readonly NoteBlock[],
  tail: readonly NoteBlock[],
): readonly NoteBlock[] => {
  const left = prefix[prefix.length - 1]
  const right = tail[0]
  if (!left || !right || left.id !== right.id) return [...prefix, ...inserted, ...tail]
  if (left.kind === "table" && right.kind === "table") {
    return [
      ...prefix.slice(0, -1),
      { ...left, rows: [...left.rows, ...right.rows] },
      ...tail.slice(1),
    ]
  }
  if (left.kind === "collapsible" && right.kind === "collapsible") {
    return [
      ...prefix.slice(0, -1),
      {
        ...left,
        blocks: mergeBoundaryBlocks(left.blocks, inserted, right.blocks),
      },
      ...tail.slice(1),
    ]
  }
  return [...prefix, ...inserted, ...tail]
}

const splitThroughRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
): BoundarySplit => {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!block) continue
    if (block.kind === "collapsible") {
      if (regionId === `${block.id}:title`) {
        return {
          found: true,
          blocks: [...blocks.slice(0, index), { ...block, blocks: [] }],
        }
      }
      const nested = splitThroughRegion(block.blocks, regionId)
      if (nested.found) {
        return {
          found: true,
          blocks: [...blocks.slice(0, index), { ...block, blocks: nested.blocks }],
        }
      }
    }
    const trimmed = removeRegionsAfter(block, regionId)
    if (trimmed) {
      return { found: true, blocks: [...blocks.slice(0, index), trimmed] }
    }
  }
  return { found: false, blocks }
}

const splitAfterRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
): BoundarySplit => {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!block) continue
    if (block.kind === "collapsible") {
      if (regionId === `${block.id}:title`) {
        return { found: true, blocks }
      }
      const nested = splitAfterRegion(block.blocks, regionId)
      if (nested.found) {
        return {
          found: true,
          blocks: [
            { ...block, blocks: nested.blocks },
            ...blocks.slice(index + 1),
          ],
        }
      }
    }
    const trailing = retainRegionsAfter(block, regionId)
    if (trailing !== block) {
      return {
        found: true,
        blocks: [...(trailing ? [trailing] : []), ...blocks.slice(index + 1)],
      }
    }
  }
  return { found: false, blocks }
}

const splitFromRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
): BoundarySplit => {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!block) continue
    if (block.kind === "collapsible") {
      if (regionId === `${block.id}:title`) return { found: true, blocks: blocks.slice(index) }
      const nested = splitFromRegion(block.blocks, regionId)
      if (nested.found) {
        return {
          found: true,
          blocks: [
            { ...block, blocks: nested.blocks },
            ...blocks.slice(index + 1),
          ],
        }
      }
    }
    if (noteBlockRegionIds(block).includes(regionId)) {
      const trailing = retainRegionsFrom(block, regionId)
      return {
        found: true,
        blocks: [...(trailing ? [trailing] : []), ...blocks.slice(index + 1)],
      }
    }
  }
  return { found: false, blocks }
}

export const prefixThroughRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
): readonly NoteBlock[] | null => {
  const split = splitThroughRegion(blocks, regionId)
  return split.found ? split.blocks : null
}

export const tailAfterRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
): readonly NoteBlock[] | null => {
  const split = splitAfterRegion(blocks, regionId)
  return split.found ? split.blocks : null
}

export const tailFromRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
): readonly NoteBlock[] | null => {
  const split = splitFromRegion(blocks, regionId)
  return split.found ? split.blocks : null
}
