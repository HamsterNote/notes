// @vitest-environment jsdom
import { createRef } from "react"
import { describe, expect, it } from "vitest"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController,
  type NoteDocumentProviderProps, type NotePublicState, type SaveTerminal,
  type RequestSaveResult, type FreezeOutcome, type UpdateHostSnapshotResult,
  type DetachViewResult, type NoteSave, type ReferenceInvalidationScope, type ReferenceInvalidationResult } from "./index"

function impossible(value: never): never { throw new Error(String(value)) }
function terminal(result: SaveTerminal): string {
  switch (result.kind) {
    case "saved": return result.operationId
    case "clean": return result.sessionId
    case "blocked": return result.cause
    case "failure": return String(result.error)
    case "noop": return result.cause
    case "abort": return result.cause
    default: return impossible(result)
  }
}
function freeze(result: FreezeOutcome): string {
  switch (result.kind) {
    case "applied": return result.action + result.leaseId + String(result.inputFrozen)
    case "noop": return result.reason === "already-owned" ? result.leaseId : result.reason
    case "failure": return result.reason + String(result.error)
    case "abort": return result.reason
    default: return impossible(result)
  }
}
function metadata(result: UpdateHostSnapshotResult): string {
  switch (result.kind) {
    case "accepted": return String(result.changeId)
    case "noop": case "blocked": case "failure": return result.reason
    default: return impossible(result)
  }
}
function detach(result: DetachViewResult): string {
  switch (result.kind) {
    case "allowed": return "allowed"
    case "blocked": case "noop": return result.reason
    default: return impossible(result)
  }
}
async function save(result: RequestSaveResult): Promise<string> {
  return terminal(result.kind === "pending" ? await result.completion : result)
}
function consume(controller: NoteDocumentController) {
  const state: NotePublicState = controller.getState()
  const expectedSessionId = state.identity?.sessionId ?? ""
  const unsubscribe = controller.subscribe((next) => { void next.dirty.body; void next.draft.phase })
  void save(controller.requestSave({ expectedSessionId, reason: "host-close" }))
  void controller.setInputFrozen(true, { expectedSessionId, requestId: "R" }).then(freeze)
  void controller.setInputFrozen(false, { expectedSessionId, requestId: "R", leaseId: "L" }).then(freeze)
  metadata(controller.updateHostSnapshot({ changeId: 1, value: { title: "T", summary: "S" } }, { expectedSessionId }))
  detach(controller.canDetachView("A", { expectedSessionId }))
  const scope: ReferenceInvalidationScope = { kind: "reference", reference: { kind: "mention", resourceId: "highlight" } }
  const result: ReferenceInvalidationResult | undefined = controller.invalidateReferences?.({ expectedSessionId, scope })
  void result
  // Structural adapters compiled against 3.1.1 need no new member.
  const old: NoteDocumentController = {
    getState: controller.getState.bind(controller), subscribe: controller.subscribe.bind(controller),
    updateHostSnapshot: controller.updateHostSnapshot.bind(controller), requestSave: controller.requestSave.bind(controller),
    setInputFrozen: controller.setInputFrozen.bind(controller), canDetachView: controller.canDetachView.bind(controller)
  }
  void old
  // @ts-expect-error The controller does not expose PM handles.
  void controller.editor
  // @ts-expect-error Expected session identity is mandatory.
  controller.requestSave({ reason: "host-save" })
  unsubscribe()
}

describe("3.1 root type contract", () => {
  it("keeps legacy NoteSave and defines all new host-only properties", () => {
    const ref = createRef<NoteDocumentController>()
    const props: NoteDocumentProviderProps = {
      documentId: "A", loadKey: 1, initialDocument: {},
      initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
      onSave: async (payload, context) => {
        await Promise.resolve()
        void payload.document.schemaVersion; void payload.hostSnapshot.changeId
        void context.identity.sessionId; void context.operationId; void context.reason; void context.signal
      },
      onChange: (document, identity) => { void document; void identity }, controllerRef: ref,
      onReferenceCandidates: () => [], onReferenceResolve: () => null,
      onReferenceActivate: () => undefined, onInitialLoadError: () => undefined,
      onPictureUpload: async (file, { uploadId, attempt, signal }) => {
        await Promise.resolve()
        void uploadId; void attempt; void signal; void file
        return { src: "https://example.com/image.png" }
      },
      children: <><NoteEditorView viewId="A" /><NoteEditorView viewId="B" theme="dark" /></>
    }
    const legacy: NoteSave = async (_document, context) => {
      await Promise.resolve()
      return context.baseRevision ? { kind: "saved", revision: "next" } : { kind: "conflict" }
    }
    const element = <NoteDocumentProvider {...props} />
    expect(element.type).toBe(NoteDocumentProvider)
    expect(typeof legacy).toBe("function")
    expect(typeof consume).toBe("function")
    // @ts-expect-error Schema injection is not a Provider prop.
    const invalid: NoteDocumentProviderProps = { ...props, schema: {} }
    void invalid
  })
})
