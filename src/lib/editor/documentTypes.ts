import type { ReactNode, Ref } from "react"
import type { HnnDocument } from "../hnn/codec"
import type { HostCandidateProvider, HostReferenceActivate, HostReferenceLookup, HostReferenceResolve, InitialLoadErrorHandler, PictureUploadHandler } from "./types"

export type DraftKind = "card" | "drawing"
export type DraftPhase = "none" | "editing" | "validating" | "invalid"
export type PublicDraftState =
  | { phase: "none" }
  | { phase: Exclude<DraftPhase, "none">; draftId: string; kind: DraftKind; ownerViewId: string; changed: boolean }
export type NoteStateLifecycle = "validating" | "ready" | "load-error" | "disposed"
export type EncodingState = "valid" | "error"
export type ActiveIdentity = { documentId: string; loadKey: string | number; sessionId: string }
export type SaveState = "clean" | "dirty" | "pending" | "blocked" | "failure"
export type NotePublicState = {
  lifecycle: NoteStateLifecycle
  identity: ActiveIdentity | null
  encoding: EncodingState
  dirty: { body: boolean; host: boolean }
  save: SaveState
  inputFrozen: boolean
  undoPolicy: "shared"
  draft: PublicDraftState
  views: Array<{ viewId: string; owner: boolean; canDetach: boolean }>
  error?: unknown
}
export type HostMetadataSnapshot = { changeId: number; value: { title: string; summary: string } }
export type SaveReason = "autosave" | "editor-button" | "host-save" | "host-close" | "host-retry" | "load-switch"
export type SavePayload = { document: HnnDocument; hostSnapshot: HostMetadataSnapshot }
export type SaveContext = { identity: ActiveIdentity; operationId: string; reason: SaveReason; signal: AbortSignal }
export type OnSave = (payload: SavePayload, context: SaveContext) => Promise<void>
export type SaveTerminal =
  | { kind: "saved"; sessionId: string; operationId: string; writesCompleted?: number }
  | { kind: "clean"; sessionId: string }
  | { kind: "blocked"; sessionId: string | null; cause: "encoding-error" | "draft-open" }
  | { kind: "failure"; sessionId: string | null; operationId: string; error: unknown }
  | { kind: "noop"; sessionId: string | null; cause: "not-ready" | "stale" }
  | { kind: "abort"; sessionId: string | null; cause: "disposed" | "replaced" }
export type SavePending = { kind: "pending"; sessionId: string; operationId: string; completion: Promise<SaveTerminal> }
export type RequestSaveResult = SaveTerminal | SavePending
export type AcquireFreeze = { expectedSessionId: string; requestId: string }
export type ReleaseFreeze = AcquireFreeze & { leaseId: string }
export type FreezeOutcome = { identity: ActiveIdentity | null; requestId: string } & (
  | { kind: "applied"; action: "acquired"; leaseId: string; inputFrozen: true }
  | { kind: "applied"; action: "released"; leaseId: string; inputFrozen: boolean }
  | { kind: "noop"; reason: "already-owned"; leaseId: string; inputFrozen: true }
  | { kind: "noop"; reason: "not-ready" | "stale" | "stale-lease" | "request-ended" }
  | { kind: "abort"; reason: "disposed" }
  | { kind: "failure"; reason: "composition-commit" | "pending-edit" | "invalid-request" | "other"; error: unknown }
)
export type UpdateHostSnapshotResult = { sessionId: string | null } & (
  | { kind: "accepted"; changeId: number }
  | { kind: "noop"; reason: "stale" | "unchanged" }
  | { kind: "blocked"; reason: "input-frozen" | "not-ready" }
  | { kind: "failure"; reason: "invalid-snapshot" | "non-monotonic-change-id" }
)
export type DetachViewResult = { sessionId: string | null } & (
  | { kind: "allowed" }
  | { kind: "blocked"; reason: "draft-owner" }
  | { kind: "noop"; reason: "unknown-view" | "not-ready" | "stale" }
)
export type ReferenceInvalidationScope =
  | { kind: "reference"; reference: HostReferenceLookup }
  | { kind: "document" }
export type ReferenceInvalidationResult = { sessionId: string | null } & (
  | { kind: "accepted" }
  | { kind: "noop"; reason: "stale" | "not-ready" }
  | { kind: "abort"; reason: "disposed" }
  | { kind: "failure"; reason: "invalid-scope" }
)
export interface NoteDocumentController {
  getState(): NotePublicState
  subscribe(listener: (state: NotePublicState) => void): () => void
  updateHostSnapshot(snapshot: HostMetadataSnapshot, options: { expectedSessionId: string }): UpdateHostSnapshotResult
  requestSave(input: { reason: SaveReason; expectedSessionId: string }): RequestSaveResult
  setInputFrozen(frozen: true, options: AcquireFreeze): Promise<FreezeOutcome>
  setInputFrozen(frozen: false, options: ReleaseFreeze): Promise<FreezeOutcome>
  canDetachView(viewId: string, options: { expectedSessionId: string }): DetachViewResult
  /** Always present on 3.1.2 controllers; optional for older structural adapters. */
  invalidateReferences?(input: { expectedSessionId: string; scope: ReferenceInvalidationScope }): ReferenceInvalidationResult
}
export type NoteDocumentProviderProps = {
  documentId: string
  loadKey: string | number
  initialDocument: unknown
  initialHostSnapshot: HostMetadataSnapshot
  onSave: OnSave
  onChange(document: HnnDocument, identity: ActiveIdentity): void
  controllerRef?: Ref<NoteDocumentController>
  onReferenceCandidates?: HostCandidateProvider
  onReferenceResolve?: HostReferenceResolve
  onReferenceActivate?: HostReferenceActivate
  onPictureUpload?: PictureUploadHandler
  onInitialLoadError?: InitialLoadErrorHandler
  children: ReactNode
}
export type NoteEditorViewProps = { viewId: string; theme?: "light" | "dark" }
