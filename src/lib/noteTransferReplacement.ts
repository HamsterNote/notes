import { noteRegionProfile } from "./noteRegionCodec"
import type { StableNoteCaret } from "./noteSelectionRestore"
import { deleteSelectedNoteFlow } from "./noteSnapshotMutation"
import { parseStructuredClipboard } from "./noteStructuredClipboard"
import { replaceSelectedNoteFlowWithStructure } from "./noteStructuredPaste"
import { caretAfterNoteFlowMutation, type SelectedNoteFlow } from "./noteTextFlow"
import {
  plainTextToRestrictedHtml,
  sanitizeBodyHtml,
  sanitizeTitleHtml,
} from "./restrictedHtml"
import type { NoteContentUndoRedoSnapshot } from "./types"

export type NoteTransferData = Pick<DataTransfer, "getData">

export type NoteTransferReplacement = {
  readonly snapshot: NoteContentUndoRedoSnapshot
  readonly caret: StableNoteCaret | null
}

export const replaceNoteFlowFromTransfer = (
  flow: SelectedNoteFlow,
  snapshot: NoteContentUndoRedoSnapshot,
  transfer: NoteTransferData,
): NoteTransferReplacement | null => {
  const structured = parseStructuredClipboard(
    transfer.getData("application/x-hamsternote-fragment+json"),
  )
  if (structured) return replaceSelectedNoteFlowWithStructure(flow, snapshot, structured)

  const text = transfer.getData("text/plain")
  const html = transfer.getData("text/html")
  const incoming = noteRegionProfile(flow.start) === "code"
    ? plainTextToRestrictedHtml(text)
    : html || plainTextToRestrictedHtml(text)
  const startId = flow.start.getAttribute("data-note-region-id")
  const replacement = startId === "title" || startId === "summary"
    ? sanitizeTitleHtml(incoming)
    : sanitizeBodyHtml(incoming)
  const next = deleteSelectedNoteFlow(flow, snapshot, replacement)
  return next
    ? { snapshot: next, caret: caretAfterNoteFlowMutation(flow, replacement, next) }
    : null
}
