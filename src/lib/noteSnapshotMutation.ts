import { quoteLineId } from "./blockSourceConversion"
import { prefixBeforeAtomic, removeAtomicRange, tailAfterAtomic } from "./noteAtomicMutation"
import {
  mergeBoundaryBlocks,
  prefixThroughRegion,
  tailFromRegion,
} from "./noteBoundarySplice"
import { createNoteId } from "./noteId"
import {
  removeRegionsAfter,
  retainRegionsAfter,
  topLevelRegionIndex,
} from "./noteNestedMutation"
import {
  fragmentForRegion,
  noteRegionProfile,
  replacementForRegion,
} from "./noteRegionCodec"
import type { SelectedNoteFlow } from "./noteTextFlow"
import { NOTE_ATOMIC_ATTRIBUTE, NOTE_REGION_ATTRIBUTE } from "./noteTextFlow"
import { updateQuoteLine } from "./quoteLineEditing"
import { sanitizeBodyHtml, sanitizeTitleHtml } from "./restrictedHtml"
import type { NoteBlock, NoteContentUndoRedoSnapshot } from "./types"

export type NoteRegionUpdate = readonly [regionId: string, html: string]

export const updateRegion = (
  blocks: readonly NoteBlock[],
  regionId: string,
  html: string,
): readonly NoteBlock[] =>
  blocks.map((block) => {
    if (regionId === `${block.id}:title`) {
      switch (block.kind) {
        case "todo":
        case "checklist":
        case "callout":
        case "collapsible":
          return { ...block, title: html }
        case "heading":
        case "paragraph":
        case "unorderedList":
        case "orderedList":
        case "quote":
        case "code":
        case "table":
        case "formula":
        case "picture":
        case "card":
        case "drawing":
        case "directory":
          return block
      }
    }
    if (regionId === `${block.id}:author` && block.kind === "quote") {
      return { ...block, author: html }
    }
    if (block.id === regionId) {
      switch (block.kind) {
        case "heading":
        case "paragraph":
        case "unorderedList":
        case "orderedList":
        case "callout":
          return { ...block, text: html }
        case "quote":
          return updateQuoteLine([block], block.id, 0, html)[0] ?? block
        case "collapsible":
          return { ...block, title: html }
        case "code":
          return { ...block, code: html }
        case "todo":
        case "checklist":
        case "table":
        case "formula":
        case "picture":
        case "card":
        case "drawing":
        case "directory":
          return block
      }
    }
    if (block.kind === "todo") {
      return {
        ...block,
        items: block.items.map((item) =>
          item.id === regionId ? { ...item, text: html } : item,
        ),
      }
    }
    if (block.kind === "checklist") {
      return {
        ...block,
        items: block.items.map((item) =>
          item.id === regionId ? { ...item, text: html } : item,
        ),
      }
    }
    if (block.kind === "quote") {
      const lineIndex = block.text
        .split("\n")
        .findIndex((_, index) => quoteLineId(block.id, index) === regionId)
      return lineIndex < 0
        ? block
        : (updateQuoteLine([block], block.id, lineIndex, html)[0] ?? block)
    }
    if (block.kind === "collapsible") {
      return { ...block, blocks: updateRegion(block.blocks, regionId, html) }
    }
    return block
  })

export const applyNoteRegionUpdates = (
  snapshot: NoteContentUndoRedoSnapshot,
  updates: readonly NoteRegionUpdate[],
): NoteContentUndoRedoSnapshot => {
  let current = snapshot
  for (const [regionId, html] of updates) {
    if (regionId === "title") {
      current = { ...current, title: sanitizeTitleHtml(html) }
      continue
    }
    if (regionId === "summary") {
      current = { ...current, summary: sanitizeTitleHtml(html) }
      continue
    }
    current = {
      ...current,
      blocks: updateRegion(
        current.blocks,
        regionId.replace("block:", ""),
        sanitizeBodyHtml(html),
      ),
    }
  }
  return current
}

export const removeThroughRegion = (
  blocks: readonly NoteBlock[],
  endRegionId: string,
): readonly NoteBlock[] => {
  const endIndex = blocks.findIndex((block) => block.id === endRegionId)
  if (endIndex >= 0) return blocks.slice(endIndex + 1)
  const nestedIndex = topLevelRegionIndex(blocks, endRegionId)
  if (nestedIndex < 0) return blocks
  const endBlock = blocks[nestedIndex]
  if (!endBlock) return blocks
  const trailing = retainRegionsAfter(endBlock, endRegionId)
  return [...(trailing ? [trailing] : []), ...blocks.slice(nestedIndex + 1)]
}

export const deleteSelectedNoteFlow = (
  flow: SelectedNoteFlow,
  snapshot: NoteContentUndoRedoSnapshot,
  replacement = "",
): NoteContentUndoRedoSnapshot | null => {
  const startId = flow.start.getAttribute(NOTE_REGION_ATTRIBUTE)
  const endId = flow.end.getAttribute(NOTE_REGION_ATTRIBUTE)
  const startAtomicId = flow.start.getAttribute(NOTE_ATOMIC_ATTRIBUTE)
  const endAtomicId = flow.end.getAttribute(NOTE_ATOMIC_ATTRIBUTE)
  if ((!startId && !startAtomicId) || (!endId && !endAtomicId)) return null
  const target = startId ? flow.start : flow.end
  const targetProfile = noteRegionProfile(target)
  const prefix = startId
    ? fragmentForRegion(flow.start, flow.range, true, targetProfile)
    : ""
  const suffix = endId
    ? fragmentForRegion(flow.end, flow.range, false, targetProfile)
    : ""
  const merged = `${prefix}${replacementForRegion(replacement, targetProfile)}${suffix}`
  let next: NoteContentUndoRedoSnapshot | null = null
  if (startAtomicId && endId) {
    const prefixBlocks = prefixBeforeAtomic(snapshot.blocks, startAtomicId)
    if (!prefixBlocks) return null
    const rawEndId = endId.replace("block:", "")
    const updated = updateRegion(snapshot.blocks, rawEndId, merged)
    const tail = tailFromRegion(updated, rawEndId)
    if (!tail) return null
    next = { ...snapshot, blocks: mergeBoundaryBlocks(prefixBlocks, [], tail) }
  } else if (startId && endAtomicId) {
    const rawStartId = startId.replace("block:", "")
    const nextBlocks = updateRegion(snapshot.blocks, rawStartId, merged)
    const prefixBlocks = prefixThroughRegion(nextBlocks, rawStartId)
    const tail = tailAfterAtomic(nextBlocks, endAtomicId)
    if (!prefixBlocks || !tail) return null
    next = { ...snapshot, blocks: mergeBoundaryBlocks(prefixBlocks, [], tail) }
  } else if (startAtomicId && endAtomicId) {
    const inserted: readonly NoteBlock[] = replacement
      ? [{ id: createNoteId(), kind: "paragraph", text: replacement }]
      : []
    const blocks = removeAtomicRange(snapshot.blocks, startAtomicId, endAtomicId, inserted)
    if (!blocks) return null
    next = { ...snapshot, blocks }
  } else if (!startId || !endId) {
    return null
  } else if (startId === "title") {
    next = {
      title: merged,
      blocks: removeThroughRegion(snapshot.blocks, endId.replace("block:", "")),
    }
  } else if (startId === "summary") {
    next = {
      title: snapshot.title,
      summary: merged,
      blocks: removeThroughRegion(snapshot.blocks, endId.replace("block:", "")),
    }
  } else {
    const rawStartId = startId.replace("block:", "")
    const rawEndId = endId.replace("block:", "")
    const nextBlocks = updateRegion(snapshot.blocks, rawStartId, merged)
    const startIndex = topLevelRegionIndex(nextBlocks, rawStartId)
    const endIndex = topLevelRegionIndex(nextBlocks, rawEndId)
    if (startIndex < 0 || endIndex < 0) return null
    if (startIndex === endIndex) {
      const block = nextBlocks[startIndex]
      if (!block) return null
      const trimmed = removeRegionsAfter(block, rawStartId, rawEndId)
      if (!trimmed) return null
      next = {
        ...snapshot,
        blocks: [...nextBlocks.slice(0, startIndex), trimmed, ...nextBlocks.slice(startIndex + 1)],
      }
    } else {
      const startBlock = nextBlocks[startIndex]
      const endBlock = nextBlocks[endIndex]
      if (!startBlock || !endBlock) return null
      const trimmedStart = removeRegionsAfter(startBlock, rawStartId)
      if (!trimmedStart) return null
      const trimmedEnd = retainRegionsAfter(endBlock, rawEndId)
      next = {
        ...snapshot,
        blocks: [
          ...nextBlocks.slice(0, startIndex),
          trimmedStart,
          ...(trimmedEnd ? [trimmedEnd] : []),
          ...nextBlocks.slice(endIndex + 1),
        ],
      }
    }
  }
  if (next.title || next.summary || next.blocks.length > 0) return next
  return {
    title: "",
    blocks: [{ id: createNoteId(), kind: "paragraph", text: "" }],
  }
}
