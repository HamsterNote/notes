import {
  appendSliceHtml,
  clipboardSlicePlainText,
  clipboardSlicesToBlocks,
  type NoteClipboardSlice,
  parseClipboardSlice,
  sliceFromBlock,
} from "./noteClipboardSlices"
import { clipboardSliceFromRegion } from "./noteClipboardRegionSlice"
import { topLevelRegionIndex } from "./noteNestedMutation"
import { restrictedHtmlToPlainText, selectedRegionFragment } from "./noteRegionCodec"
import { sanitizeBodyHtml } from "./restrictedHtml"
import type { SelectedNoteFlow } from "./noteTextFlow"
import { NOTE_ATOMIC_ATTRIBUTE, NOTE_REGION_ATTRIBUTE } from "./noteTextFlow"
import type { NoteBlock, NoteContentUndoRedoSnapshot } from "./types"

const INTERNAL_CLIPBOARD_VERSION = 2
const MAX_INTERNAL_CLIPBOARD_LENGTH = 2_000_000
const MAX_INTERNAL_CLIPBOARD_SLICES = 256

export type NoteStructuredClipboard = {
  readonly version: typeof INTERNAL_CLIPBOARD_VERSION
  readonly leadingHtml: string
  readonly trailingHtml: string
  readonly slices: readonly NoteClipboardSlice[]
  readonly html: string
  readonly text: string
}

const topLevelBlockId = (unit: HTMLElement): string | null => {
  const boundaryId = unit.closest<HTMLElement>("[data-note-block-id]")
    ?.getAttribute("data-note-block-id")
  if (boundaryId) return boundaryId
  const regionId = unit.getAttribute(NOTE_REGION_ATTRIBUTE)
  return regionId?.startsWith("block:") ? regionId.slice(6).split(":")[0] ?? null : null
}

const topLevelAtomicBlockId = (
  blocks: readonly NoteBlock[],
  atomicId: string,
): string | null => {
  const targetId = atomicId.startsWith("block:")
    ? atomicId.slice(6)
    : /^table:(.+):row:\d+$/.exec(atomicId)?.[1] ?? null
  if (!targetId) return null
  for (const block of blocks) {
    if (block.id === targetId) return block.id
    if (block.kind === "collapsible" && findBlock(block.blocks, targetId)) return block.id
  }
  return null
}

const semanticTopLevelBlockId = (
  unit: HTMLElement,
  snapshot: NoteContentUndoRedoSnapshot,
): string | null => {
  const atomicId = unit.getAttribute(NOTE_ATOMIC_ATTRIBUTE)
  if (atomicId) return topLevelAtomicBlockId(snapshot.blocks, atomicId)
  const regionId = unit.getAttribute(NOTE_REGION_ATTRIBUTE)
  if (!regionId?.startsWith("block:")) return null
  const index = topLevelRegionIndex(snapshot.blocks, regionId.slice(6))
  return index < 0 ? null : snapshot.blocks[index]?.id ?? null
}

const rowSlice = (
  atomicId: string,
  blocks: readonly NoteBlock[],
): NoteClipboardSlice | null => {
  const match = /^table:(.+):row:(\d+)$/.exec(atomicId)
  if (!match) return null
  const rowIndex = Number(match[2])
  for (const block of blocks) {
    if (block.kind === "table" && block.id === match[1]) {
      const cells = block.rows[rowIndex]
      return cells ? { kind: "table-row", cells } : null
    }
    if (block.kind === "collapsible") {
      const nested = rowSlice(atomicId, block.blocks)
      if (nested) return nested
    }
  }
  return null
}

const findBlock = (blocks: readonly NoteBlock[], blockId: string): NoteBlock | null => {
  for (const block of blocks) {
    if (block.id === blockId) return block
    if (block.kind === "collapsible") {
      const nested = findBlock(block.blocks, blockId)
      if (nested) return nested
    }
  }
  return null
}

const atomicSlice = (
  atomicId: string,
  snapshot: NoteContentUndoRedoSnapshot,
): NoteClipboardSlice | null => {
  if (!atomicId.startsWith("block:")) return rowSlice(atomicId, snapshot.blocks)
  const block = findBlock(snapshot.blocks, atomicId.slice(6))
  return block ? sliceFromBlock(block) : null
}

const sliceFromUnit = (
  unit: HTMLElement,
  snapshot: NoteContentUndoRedoSnapshot,
): NoteClipboardSlice | null => {
  const atomicId = unit.getAttribute(NOTE_ATOMIC_ATTRIBUTE)
  if (atomicId) return atomicSlice(atomicId, snapshot)
  const regionId = unit.getAttribute(NOTE_REGION_ATTRIBUTE)
  return regionId?.startsWith("block:")
    ? clipboardSliceFromRegion(snapshot.blocks, regionId.slice(6))
    : null
}

const middleSlices = (
  flow: SelectedNoteFlow,
  snapshot: NoteContentUndoRedoSnapshot,
): readonly NoteClipboardSlice[] => {
  const startBlockId = semanticTopLevelBlockId(flow.start, snapshot) ?? topLevelBlockId(flow.start)
  const endBlockId = semanticTopLevelBlockId(flow.end, snapshot) ?? topLevelBlockId(flow.end)
  const startIndex = snapshot.blocks.findIndex((block) => block.id === startBlockId)
  const endIndex = snapshot.blocks.findIndex((block) => block.id === endBlockId)
  if (startIndex >= 0 && endIndex >= 0 && startIndex !== endIndex) {
    const emittedMiddleBlocks = new Set<string>()
    return flow.units.flatMap((unit, index) => {
      if (unit.hasAttribute(NOTE_REGION_ATTRIBUTE) && (index === 0 || index === flow.units.length - 1)) {
        return []
      }
      const blockId = semanticTopLevelBlockId(unit, snapshot) ?? topLevelBlockId(unit)
      const blockIndex = snapshot.blocks.findIndex((block) => block.id === blockId)
      if (blockIndex > startIndex && blockIndex < endIndex) {
        if (!blockId || emittedMiddleBlocks.has(blockId)) return []
        emittedMiddleBlocks.add(blockId)
        const block = snapshot.blocks[blockIndex]
        const slice = block ? sliceFromBlock(block) : null
        return slice ? [slice] : []
      }
      const slice = sliceFromUnit(unit, snapshot)
      return slice ? [slice] : []
    })
  }
  return flow.units.flatMap((unit, index) => {
    const isTextEdge = unit.hasAttribute(NOTE_REGION_ATTRIBUTE)
      && (index === 0 || index === flow.units.length - 1)
    const slice = isTextEdge ? null : sliceFromUnit(unit, snapshot)
    return slice ? [slice] : []
  })
}

export const createStructuredClipboard = (
  flow: SelectedNoteFlow,
  snapshot: NoteContentUndoRedoSnapshot,
): NoteStructuredClipboard => {
  const leadingHtml = flow.start.hasAttribute(NOTE_REGION_ATTRIBUTE)
    ? selectedRegionFragment(flow.start, flow.range, true)
    : ""
  const trailingHtml = flow.end.hasAttribute(NOTE_REGION_ATTRIBUTE)
    ? selectedRegionFragment(flow.end, flow.range, false)
    : ""
  const slices = middleSlices(flow, snapshot)
  const semantic = document.createElement("div")
  const leading = document.createElement("span")
  leading.innerHTML = leadingHtml
  semantic.append(leading)
  for (const slice of slices) appendSliceHtml(semantic, slice)
  const trailing = document.createElement("span")
  trailing.innerHTML = trailingHtml
  semantic.append(trailing)
  return {
    version: INTERNAL_CLIPBOARD_VERSION,
    leadingHtml,
    trailingHtml,
    slices,
    html: semantic.innerHTML,
    text: [
      restrictedHtmlToPlainText(leadingHtml),
      ...slices.map(clipboardSlicePlainText),
      restrictedHtmlToPlainText(trailingHtml),
    ].filter(Boolean).join("\n"),
  }
}

export const clipboardSlicesAsBlocks = (
  clipboard: NoteStructuredClipboard,
) => clipboardSlicesToBlocks(clipboard.slices)

export const parseStructuredClipboard = (value: string): NoteStructuredClipboard | null => {
  if (!value || value.length > MAX_INTERNAL_CLIPBOARD_LENGTH) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== "object") return null
    const version = "version" in parsed ? parsed.version : undefined
    const leadingHtml = "leadingHtml" in parsed ? parsed.leadingHtml : undefined
    const trailingHtml = "trailingHtml" in parsed ? parsed.trailingHtml : undefined
    const html = "html" in parsed ? parsed.html : undefined
    const text = "text" in parsed ? parsed.text : undefined
    const rawSlices = "slices" in parsed ? parsed.slices : undefined
    if (
      version !== INTERNAL_CLIPBOARD_VERSION ||
      typeof leadingHtml !== "string" ||
      typeof trailingHtml !== "string" ||
      typeof html !== "string" ||
      typeof text !== "string" ||
      !Array.isArray(rawSlices) ||
      rawSlices.length > MAX_INTERNAL_CLIPBOARD_SLICES
    ) return null
    const slices = rawSlices.map(parseClipboardSlice)
    if (slices.some((slice) => slice === null)) return null
    const sanitizedLeading = sanitizeBodyHtml(leadingHtml)
    const sanitizedTrailing = sanitizeBodyHtml(trailingHtml)
    const parsedSlices = slices.flatMap((slice) => slice ?? [])
    const semantic = document.createElement("div")
    const leading = document.createElement("span")
    leading.innerHTML = sanitizedLeading
    semantic.append(leading)
    for (const slice of parsedSlices) appendSliceHtml(semantic, slice)
    const trailing = document.createElement("span")
    trailing.innerHTML = sanitizedTrailing
    semantic.append(trailing)
    return {
      version: INTERNAL_CLIPBOARD_VERSION,
      leadingHtml: sanitizedLeading,
      trailingHtml: sanitizedTrailing,
      slices: parsedSlices,
      html: semantic.innerHTML,
      text: [
        restrictedHtmlToPlainText(sanitizedLeading),
        ...parsedSlices.map(clipboardSlicePlainText),
        restrictedHtmlToPlainText(sanitizedTrailing),
      ].filter(Boolean).join("\n"),
    }
  } catch {
    return null
  }
}
