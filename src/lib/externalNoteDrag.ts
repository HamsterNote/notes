import {
  type Drag,
  type Finger,
  FingerOperationType
} from "@system-ui-js/multi-drag"

import { plainTextToRestrictedHtml } from "./restrictedHtml"
import type { NoteBlock, NoteParagraphBlock } from "./types"

export type NoteExternalItem = {
  readonly id: string
  readonly content: string
  readonly clickable: boolean
}

export type ExternalNoteDragInput = {
  readonly item: NoteExternalItem
  readonly drag: Drag
  readonly pointerId: number
}

export type ExternalNoteDragStartFailureReason =
  | "not-editable"
  | "missing-on-blocks-change"
  | "invalid-item"
  | "drag-already-active"
  | "missing-active-pointer"

export type ExternalNoteDragCancellationReason =
  | "cancelled-by-host"
  | "pointer-cancelled"
  | "released-outside-note"
  | "note-unmounted"
  | "note-became-readonly"

export type ExternalNoteDragCompletion =
  | {
      readonly status: "placed"
      readonly item: NoteExternalItem
      readonly block: NoteParagraphBlock
    }
  | {
      readonly status: "cancelled"
      readonly reason: ExternalNoteDragCancellationReason
    }

export type ExternalNoteDragSession = {
  readonly cancel: () => void
  readonly completion: Promise<ExternalNoteDragCompletion>
}

export type ExternalNoteDragStartResult =
  | { readonly ok: true; readonly session: ExternalNoteDragSession }
  | { readonly ok: false; readonly reason: ExternalNoteDragStartFailureReason }

export type ExternalNoteDragStartPreparation = {
  readonly drag: Drag
  readonly finger: Finger
  readonly item: NoteExternalItem
}

export type ExternalNoteDragStartupContext = {
  readonly editable: boolean
  readonly canCommit: boolean
  readonly activeDrags: ReadonlySet<Drag>
}

export type ExternalNoteDragPreparationResult =
  | {
      readonly ok: true
      readonly preparation: ExternalNoteDragStartPreparation
    }
  | { readonly ok: false; readonly reason: ExternalNoteDragStartFailureReason }

export const snapshotExternalNoteItem = (
  value: unknown
): NoteExternalItem | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  if (!("id" in value) || !("content" in value) || !("clickable" in value)) {
    return undefined
  }
  const { id, content, clickable } = value
  if (
    typeof id !== "string" ||
    id.trim().length === 0 ||
    typeof content !== "string" ||
    typeof clickable !== "boolean"
  ) {
    return undefined
  }
  return { id, content, clickable }
}

export const prepareExternalNoteDragStart = (
  input: ExternalNoteDragInput,
  context: ExternalNoteDragStartupContext
): ExternalNoteDragPreparationResult => {
  if (!context.editable) return { ok: false, reason: "not-editable" }
  if (!context.canCommit) {
    return { ok: false, reason: "missing-on-blocks-change" }
  }
  const item = snapshotExternalNoteItem(input.item)
  if (item === undefined) return { ok: false, reason: "invalid-item" }
  if (context.activeDrags.has(input.drag)) {
    return { ok: false, reason: "drag-already-active" }
  }
  const finger = input.drag.getFingers().find(
    (candidate) =>
      candidate.pointerId === input.pointerId &&
      !candidate.getIsDestroyed() &&
      candidate.getLastOperation(FingerOperationType.End) === undefined
  )
  if (finger === undefined) {
    return { ok: false, reason: "missing-active-pointer" }
  }
  return { ok: true, preparation: { drag: input.drag, finger, item } }
}

export const createExternalNoteBlock = (
  item: NoteExternalItem,
  blockId: string
): NoteParagraphBlock => ({
  id: blockId,
  kind: "paragraph",
  text: plainTextToRestrictedHtml(item.content),
  externalItem: item
})

export const insertExternalNoteBlock = (
  blocks: readonly NoteBlock[],
  block: NoteParagraphBlock,
  index: number
): NoteBlock[] => [
  ...blocks.slice(0, index),
  block,
  ...blocks.slice(index)
]
