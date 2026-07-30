import type { NoteBlock } from "./types"
import { mergeBoundaryBlocks } from "./noteBoundarySplice"

const isAtomicBlock = (block: NoteBlock): boolean =>
  block.kind === "picture"
  || block.kind === "drawing"
  || block.kind === "card"
  || block.kind === "directory"
  || block.kind === "formula"

type BlockSplit = {
  readonly found: boolean
  readonly blocks: readonly NoteBlock[]
}

const splitBefore = (
  blocks: readonly NoteBlock[],
  atomicId: string,
): BlockSplit => {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!block) continue
    if (atomicId === `block:${block.id}` && isAtomicBlock(block)) {
      return { found: true, blocks: blocks.slice(0, index) }
    }
    const rowMatch = /^table:(.+):row:(\d+)$/.exec(atomicId)
    if (block.kind === "table" && rowMatch?.[1] === block.id) {
      const rowIndex = Number(rowMatch[2])
      return {
        found: Number.isInteger(rowIndex) && rowIndex < block.rows.length,
        blocks: [
          ...blocks.slice(0, index),
          ...(rowIndex > 0 ? [{ ...block, rows: block.rows.slice(0, rowIndex) }] : []),
        ],
      }
    }
    if (block.kind === "collapsible") {
      const nested = splitBefore(block.blocks, atomicId)
      if (nested.found) {
        return {
          found: true,
          blocks: [
            ...blocks.slice(0, index),
            { ...block, blocks: nested.blocks },
          ],
        }
      }
    }
  }
  return { found: false, blocks }
}

const splitAfter = (
  blocks: readonly NoteBlock[],
  atomicId: string,
): BlockSplit => {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!block) continue
    if (atomicId === `block:${block.id}` && isAtomicBlock(block)) {
      return { found: true, blocks: blocks.slice(index + 1) }
    }
    const rowMatch = /^table:(.+):row:(\d+)$/.exec(atomicId)
    if (block.kind === "table" && rowMatch?.[1] === block.id) {
      const rowIndex = Number(rowMatch[2])
      const rows = block.rows.slice(rowIndex + 1)
      return {
        found: Number.isInteger(rowIndex) && rowIndex < block.rows.length,
        blocks: [
          ...(rows.length > 0 ? [{ ...block, rows }] : []),
          ...blocks.slice(index + 1),
        ],
      }
    }
    if (block.kind === "collapsible") {
      const nested = splitAfter(block.blocks, atomicId)
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
  }
  return { found: false, blocks }
}

const atomicLocation = (
  blocks: readonly NoteBlock[],
  atomicId: string,
): readonly [blockIndex: number, rowIndex: number | null] | null => {
  if (atomicId.startsWith("block:")) {
    const index = blocks.findIndex((block) => block.id === atomicId.slice(6))
    return index < 0 ? null : [index, null]
  }
  const match = /^table:(.+):row:(\d+)$/.exec(atomicId)
  if (!match) return null
  const blockIndex = blocks.findIndex((block) => block.id === match[1])
  const rowIndex = Number(match[2])
  return blockIndex < 0 || !Number.isInteger(rowIndex) ? null : [blockIndex, rowIndex]
}

export const removeAtomicRange = (
  blocks: readonly NoteBlock[],
  startAtomicId: string,
  endAtomicId: string,
  inserted: readonly NoteBlock[],
): readonly NoteBlock[] | null => {
  const start = atomicLocation(blocks, startAtomicId)
  const end = atomicLocation(blocks, endAtomicId)
  if (start && end) {
    const [startBlockIndex, startRowIndex] = start
    const [endBlockIndex, endRowIndex] = end
    if (
    startBlockIndex === endBlockIndex
    && startRowIndex !== null
    && endRowIndex !== null
    ) {
      const table = blocks[startBlockIndex]
      if (!table || table.kind !== "table" || endRowIndex < startRowIndex) return null
      const rows = [
        ...table.rows.slice(0, startRowIndex),
        ...table.rows.slice(endRowIndex + 1),
      ]
      return [
        ...blocks.slice(0, startBlockIndex),
        ...inserted,
        ...(rows.length === 0 ? [] : [{ ...table, rows }]),
        ...blocks.slice(startBlockIndex + 1),
      ]
    }
  }
  const prefix = splitBefore(blocks, startAtomicId)
  const tail = splitAfter(blocks, endAtomicId)
  return prefix.found && tail.found
    ? mergeBoundaryBlocks(prefix.blocks, inserted, tail.blocks)
    : null
}

export const tailAfterAtomic = (
  blocks: readonly NoteBlock[],
  atomicId: string,
): readonly NoteBlock[] | null => {
  const nested = splitAfter(blocks, atomicId)
  if (nested.found) return nested.blocks
  const location = atomicLocation(blocks, atomicId)
  if (!location) return null
  const [blockIndex, rowIndex] = location
  if (rowIndex === null) return blocks.slice(blockIndex + 1)
  const block = blocks[blockIndex]
  if (!block || block.kind !== "table") return null
  const remainingRows = block.rows.slice(rowIndex + 1)
  return [
    ...(remainingRows.length === 0 ? [] : [{ ...block, rows: remainingRows }]),
    ...blocks.slice(blockIndex + 1),
  ]
}

export const prefixBeforeAtomic = (
  blocks: readonly NoteBlock[],
  atomicId: string,
): readonly NoteBlock[] | null => {
  const nested = splitBefore(blocks, atomicId)
  if (nested.found) return nested.blocks
  const location = atomicLocation(blocks, atomicId)
  if (!location) return null
  const [blockIndex, rowIndex] = location
  if (rowIndex === null) return blocks.slice(0, blockIndex)
  const block = blocks[blockIndex]
  if (!block || block.kind !== "table") return null
  const remainingRows = block.rows.slice(0, rowIndex)
  return [
    ...blocks.slice(0, blockIndex),
    ...(remainingRows.length === 0 ? [] : [{ ...block, rows: remainingRows }]),
  ]
}
