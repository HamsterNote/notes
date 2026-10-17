import type { HnnDocument } from "../lib/hnn/codec"

export type Identity = {
  documentId: string
  loadKey: string | number
  sessionId: string
}
export type HostSnapshot = {
  changeId: number
  value: { title: string; summary: string }
}
export type DraftState =
  | { phase: "none" }
  | {
      phase: "editing" | "validating" | "invalid"
      draftId: string
      kind: "card" | "drawing"
      ownerViewId: string
      changed: boolean
    }
export type PublicState = {
  lifecycle: "ready" | "load-error" | "disposed"
  identity: Identity | null
  encoding: "valid" | "error"
  dirty: { body: boolean; host: boolean }
  save: "clean" | "dirty" | "pending" | "blocked" | "failure"
  inputFrozen: boolean
  undoPolicy: "view-local-baseline" | "shared"
  draft: DraftState
  views: Array<{ viewId: string; owner: boolean; canDetach: boolean }>
  error?: unknown
}
export type SaveReason =
  | "autosave"
  | "editor-button"
  | "host-save"
  | "host-close"
  | "host-retry"
  | "load-switch"
export type SavePayload = { document: HnnDocument; hostSnapshot: HostSnapshot }
export type SaveContext = {
  identity: Identity
  operationId: string
  reason: SaveReason
  signal: AbortSignal
}
export type SaveTerminal =
  | {
      kind: "saved"
      sessionId: string
      operationId: string
      writesCompleted: number
    }
  | { kind: "clean"; sessionId: string }
  | {
      kind: "blocked"
      sessionId: string
      cause: "encoding-error" | "draft-open"
    }
  | { kind: "failure"; sessionId: string; operationId: string; error: unknown }
  | { kind: "noop"; sessionId: string | null; cause: "not-ready" | "stale" }
  | { kind: "abort"; sessionId: string; cause: "disposed" }
export type SaveRequest =
  | SaveTerminal
  | {
      kind: "pending"
      sessionId: string
      operationId: string
      completion: Promise<SaveTerminal>
    }
export type AcquireFreeze = { expectedSessionId: string; requestId: string }
export type ReleaseFreeze = AcquireFreeze & { leaseId: string }
export type FreezeResult = { identity: Identity | null; requestId: string } & (
  | {
      kind: "applied"
      action: "acquired" | "released"
      leaseId: string
      inputFrozen: boolean
    }
  | {
      kind: "noop"
      reason: "already-owned"
      leaseId: string
      inputFrozen: true
    }
  | {
      kind: "noop"
      reason: "not-ready" | "stale" | "stale-lease" | "request-ended"
    }
  | { kind: "abort"; reason: "disposed" }
  | {
      kind: "failure"
      reason:
        "composition-commit" | "pending-edit" | "invalid-request" | "other"
      error: unknown
    }
)
export interface Controller {
  getState(): PublicState
  subscribe(listener: (state: PublicState) => void): () => void
  updateHostSnapshot(
    snapshot: HostSnapshot,
    options: { expectedSessionId: string }
  ):
    | { sessionId: string; kind: "accepted"; changeId: number }
    | { sessionId: string; kind: "noop"; reason: "stale" | "unchanged" }
    | {
        sessionId: string
        kind: "blocked"
        reason: "input-frozen" | "not-ready"
      }
    | {
        sessionId: string
        kind: "failure"
        reason: "invalid-snapshot" | "non-monotonic-change-id"
      }
  requestSave(input: {
    reason: SaveReason
    expectedSessionId: string
  }): SaveRequest
  setInputFrozen(frozen: true, options: AcquireFreeze): Promise<FreezeResult>
  setInputFrozen(frozen: false, options: ReleaseFreeze): Promise<FreezeResult>
  canDetachView(
    viewId: string,
    options: { expectedSessionId: string }
  ):
    | { sessionId: string; kind: "allowed" }
    | { sessionId: string; kind: "blocked"; reason: "draft-owner" }
    | {
        sessionId: string
        kind: "noop"
        reason: "unknown-view" | "not-ready" | "stale"
      }
}
