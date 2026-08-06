import { createNoteId } from "./noteId"
import { prefixBeforeAtomic, tailAfterAtomic } from "./noteAtomicMutation"
import {
  mergeBoundaryBlocks,
  prefixThroughRegion,
  tailAfterRegion,
} from "./noteBoundarySplice"
import type { StableNoteCaret } from "./noteSelectionRestore"
import {
  fragmentForRegion,
  noteRegionProfile,
  replacementForRegion,
} from "./noteRegionCodec"
import {
  deleteSelectedNoteFlow,
  removeThroughRegion,
  updateRegion,
} from "./noteSnapshotMutation"
import {
  clipboardSlicesAsBlocks,
  type NoteStructuredClipboard,
} from "./noteStructuredClipboard"
import { createStructuredTailBlock } from "./noteStructuredTail"
import type { SelectedNoteFlow } from "./noteTextFlow"
import {
  caretAfterNoteFlowMutation,
  NOTE_ATOMIC_ATTRIBUTE,
  NOTE_REGION_ATTRIBUTE,
} from "./noteTextFlow"
import {
  restrictedHtmlTextLength,
  sanitizeBodyHtml,
  sanitizeTitleHtml,
} from "./restrictedHtml"
import type { NoteContentUndoRedoSnapshot } from "./types"

export type StructuredPasteResult = {
  readonly snapshot: NoteContentUndoRedoSnapshot
  readonly caret: StableNoteCaret | null
}

export const replaceSelectedNoteFlowWithStructure = (
  flow: SelectedNoteFlow,
  snapshot: NoteContentUndoRedoSnapshot,
  clipboard: NoteStructuredClipboard,
): StructuredPasteResult | null => {
  const startId = flow.start.getAttribute(NOTE_REGION_ATTRIBUTE)
  const endId = flow.end.getAttribute(NOTE_REGION_ATTRIBUTE)
  const startAtomicId = flow.start.getAttribute(NOTE_ATOMIC_ATTRIBUTE)
  const endAtomicId = flow.end.getAttribute(NOTE_ATOMIC_ATTRIBUTE)
  if ((!startId && !startAtomicId) || (!endId && !endAtomicId)) return null
  const targetProfile = startId ? noteRegionProfile(flow.start) : "rich"
  const prefix = startId
    ? fragmentForRegion(flow.start, flow.range, true, targetProfile)
    : ""
  const endProfile = endId ? noteRegionProfile(flow.end) : "rich"
  const suffix = endId
    ? fragmentForRegion(flow.end, flow.range, false, endProfile)
    : ""
  const sanitizedLeading = startId === "title" || startId === "summary"
    ? sanitizeTitleHtml(clipboard.leadingHtml)
    : sanitizeBodyHtml(clipboard.leadingHtml)
  const trailing = sanitizeBodyHtml(clipboard.trailingHtml)
  const atoms = clipboardSlicesAsBlocks(clipboard)
  if (atoms.length === 0) {
    const replacement = `${sanitizedLeading}${trailing}`
    const next = deleteSelectedNoteFlow(flow, snapshot, replacement)
    return next
      ? {
          snapshot: next,
          caret: caretAfterNoteFlowMutation(flow, replacement, next),
        }
      : null
  }
  const leading = replacementForRegion(sanitizedLeading, targetProfile)
  const tailId = createNoteId()
  const tail = createStructuredTailBlock(
    snapshot.blocks,
    endId?.replace("block:", "") ?? null,
    tailId,
    trailing,
    suffix,
  )
  const leadingBlock = leading
    ? [{ id: createNoteId(), kind: "paragraph" as const, text: leading }]
    : []
  if (startAtomicId && endId) {
    const before = prefixBeforeAtomic(snapshot.blocks, startAtomicId)
    const after = tailAfterRegion(snapshot.blocks, endId.replace("block:", ""))
    if (!before || !after) return null
    return {
      snapshot: {
        ...snapshot,
        blocks: mergeBoundaryBlocks(
          before,
          [
          ...leadingBlock,
          ...atoms,
          tail,
          ],
          after,
        ),
      },
      caret: {
        regionId: `block:${tailId}`,
        offset: restrictedHtmlTextLength(trailing),
      },
    }
  }
  if (startAtomicId && endAtomicId) {
    const before = prefixBeforeAtomic(snapshot.blocks, startAtomicId)
    const after = tailAfterAtomic(snapshot.blocks, endAtomicId)
    if (!before || !after) return null
    return {
      snapshot: {
        ...snapshot,
        blocks: [...before, ...leadingBlock, ...atoms, tail, ...after],
      },
      caret: {
        regionId: `block:${tailId}`,
        offset: restrictedHtmlTextLength(trailing),
      },
    }
  }
  if (startId && endAtomicId) {
    const after = tailAfterAtomic(snapshot.blocks, endAtomicId)
    if (!after) return null
    if (startId === "title") {
      return {
        snapshot: {
          title: `${prefix}${leading}`,
          blocks: [...atoms, tail, ...after],
        },
        caret: {
          regionId: `block:${tailId}`,
          offset: restrictedHtmlTextLength(trailing),
        },
      }
    }
    if (startId === "summary") {
      return {
        snapshot: {
          title: snapshot.title,
          summary: `${prefix}${leading}`,
          blocks: [...atoms, tail, ...after],
        },
        caret: {
          regionId: `block:${tailId}`,
          offset: restrictedHtmlTextLength(trailing),
        },
      }
    }
    const rawStartId = startId.replace("block:", "")
    const updated = updateRegion(snapshot.blocks, rawStartId, `${prefix}${leading}`)
    const before = prefixThroughRegion(updated, rawStartId)
    if (!before) return null
    return {
      snapshot: {
        ...snapshot,
        blocks: mergeBoundaryBlocks(before, [...atoms, tail], after),
      },
      caret: {
        regionId: `block:${tailId}`,
        offset: restrictedHtmlTextLength(trailing),
      },
    }
  }
  if (!startId || !endId) return null
  const rawEndId = endId.replace("block:", "")
  const remaining = removeThroughRegion(snapshot.blocks, rawEndId)
  if (startId === "title") {
    return {
      snapshot: {
        title: `${prefix}${leading}`,
        blocks: [...atoms, tail, ...remaining],
      },
      caret: {
        regionId: `block:${tailId}`,
        offset: restrictedHtmlTextLength(trailing),
      },
    }
  }
  if (startId === "summary") {
    return {
      snapshot: {
        title: snapshot.title,
        summary: `${prefix}${leading}`,
        blocks: [...atoms, tail, ...remaining],
      },
      caret: {
        regionId: `block:${tailId}`,
        offset: restrictedHtmlTextLength(trailing),
      },
    }
  }
  const rawStartId = startId.replace("block:", "")
  const updated = updateRegion(snapshot.blocks, rawStartId, `${prefix}${leading}`)
  const before = prefixThroughRegion(updated, rawStartId)
  const after = tailAfterRegion(updated, rawEndId)
  if (!before || !after) return null
  return {
    snapshot: {
      ...snapshot,
      blocks: mergeBoundaryBlocks(before, [...atoms, tail], after),
    },
    caret: {
      regionId: `block:${tailId}`,
      offset: restrictedHtmlTextLength(trailing),
    },
  }
}
