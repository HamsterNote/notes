import { installInteractionToolbar } from "./interactionToolbar"
import { Editor, Extension } from "@tiptap/core"
import { closeHistory, history, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history"
import { EditorState, type Transaction } from "@tiptap/pm/state"
import type { Node as PmNode } from "@tiptap/pm/model"
import { decodeHnn, encodeHnn } from "../hnn/codec"
import { createHnnNodeId } from "../hnn/nodeId"
import { registerHnnTransactionPermission } from "../hnn/transactionPermission"
import { createHnnSessionExtensions, flushHnnPendingEdits, hnnRuntimeSchema } from "../hnn/extensions"
import { installBlockReorder } from "./blockReorder"
import { openBlockMenu } from "./blockMenu"
import { installHnnClipboardHistoryBoundary } from "./nativeClipboard"
import { installHostReferences, isValidReferenceLookup, type HostReferenceInstaller } from "./hostReferences"
import { installPictureUpload, type PictureUploadInstaller } from "./pictureUpload"
import { isManagedHnnPicturePath } from "../hnn/urlPolicy"
import { notifyPictureResolverChange } from "./pictureResolution"
import type { HnnDrawerSession } from "./HnnDataDrawer"
import type {
  ActiveIdentity, DetachViewResult, FreezeOutcome, HostMetadataSnapshot,
  NoteDocumentController, NoteDocumentProviderProps, NotePublicState,
  PublicDraftState, RequestSaveResult, SavePending, SaveReason, SaveTerminal,
  UpdateHostSnapshotResult, ReferenceInvalidationResult, ReferenceInvalidationScope
} from "./documentTypes"

type Options = Omit<NoteDocumentProviderProps, "children" | "controllerRef">
export type DocumentView = {
  editor: Editor
  instanceId: symbol
  references: HostReferenceInstaller | undefined
  pictureUpload: PictureUploadInstaller | undefined
  cleanup: Array<() => void>
}

export type DocumentPictureDialog = Readonly<{
  viewId: string
  nodeId: string
  anchor: HTMLElement
  uploadId?: string
}>

function createSessionUuid(): string {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID()
  if (typeof crypto?.getRandomValues === "function") return createHnnNodeId()
  throw new Error("DocumentSession requires crypto.randomUUID or crypto.getRandomValues to generate secure UUIDv4 identifiers")
}

function copyHost(value: HostMetadataSnapshot): HostMetadataSnapshot {
  if (!value || typeof value !== "object" || !Number.isSafeInteger(value.changeId)
    || !value.value || typeof value.value !== "object"
    || typeof value.value.title !== "string" || typeof value.value.summary !== "string"
    || Object.keys(value).sort().join(",") !== "changeId,value"
    || Object.keys(value.value).sort().join(",") !== "summary,title") {
    throw new TypeError("Invalid host metadata snapshot")
  }
  return { changeId: value.changeId, value: { title: value.value.title, summary: value.value.summary } }
}
function sameHost(a: HostMetadataSnapshot, b: HostMetadataSnapshot): boolean {
  return a.value.title === b.value.title && a.value.summary === b.value.summary
}

/** Owns document/history; view plugin state and selection remain local to each editor. */
export class DocumentSession {
  readonly controller: NoteDocumentController
  readonly identity: ActiveIdentity
  readonly views = new Map<string, DocumentView>()
  private authority: EditorState | undefined
  private baseline: PmNode | undefined
  private host: HostMetadataSnapshot = { changeId: 0, value: { title: "", summary: "" } }
  private hostBaseline = this.host
  private lifecycle: NotePublicState["lifecycle"] = "validating"
  private error: unknown
  private encodingError: unknown
  private listeners = new Set<(state: NotePublicState) => void>()
  private pending: SavePending | undefined
  private failure: Extract<SaveTerminal, { kind: "failure" }> | undefined
  private writeAbort: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private freezeQueue: Promise<unknown> = Promise.resolve()
  private pendingAcquires = 0
  private freezing = false
  private requests = new Map<string, string | null>()
  private draft: PublicDraftState = { phase: "none" }
  private pictureDialog: DocumentPictureDialog | null = null
  private draftPayload: HnnDrawerSession | null = null
  private applyingHostDocument = false
  private completingDraft = false
  private lastEditView: symbol | undefined
  private dispatching = false
  private pendingEdits = 0
  private abortCause: "disposed" | "replaced" = "disposed"

  constructor(private options: Options) {
    this.identity = { documentId: options.documentId, loadKey: options.loadKey, sessionId: createSessionUuid() }
    try {
      if (typeof options.loadKey === "number" && !Number.isFinite(options.loadKey)) throw new TypeError("Invalid loadKey")
      this.host = copyHost(options.initialHostSnapshot)
      this.hostBaseline = copyHost(this.host)
      const doc = decodeHnn(options.initialDocument)
      this.authority = EditorState.create({ schema: hnnRuntimeSchema, doc, plugins: [history()] })
      this.baseline = doc
      this.lifecycle = "ready"
    } catch (error) {
      this.lifecycle = "load-error"
      this.error = error
    }
    this.controller = {
      replacePictureReferences: input => this.replacePictureReferences(input),
      applyHostDocument: input => this.applyHostDocument(input),
      getState: () => this.getState(),
      subscribe: (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
      updateHostSnapshot: (snapshot, context) => this.updateHost(snapshot, context.expectedSessionId),
      requestSave: (input) => this.requestSave(input.reason, input.expectedSessionId),
      setInputFrozen: (frozen, input) => {
        const { expectedSessionId, requestId } = input
        const leaseId = "leaseId" in input ? input.leaseId : undefined
        if (frozen) this.pendingAcquires++
        const result = this.freezeQueue.then(() => this.freeze(frozen, expectedSessionId, requestId, leaseId))
          .finally(() => {
            if (frozen) this.pendingAcquires--
            this.flushUploads()
          })
        this.freezeQueue = result.catch(() => undefined)
        return result
      },
      canDetachView: (viewId, context) => this.canDetach(viewId, context.expectedSessionId),
      invalidateReferences: (input) => this.invalidateReferences(input.expectedSessionId, input.scope)
    }
  }

  updateCallbacks(options: Options): void {
    const changed = ["onReferenceCandidates", "onReferenceActivate", "onReferenceResolve"] as const
    const presenceChanged = changed.some((key) => !!this.options[key] !== !!options[key])
    const uploadChanged = !!this.options.onPictureUpload !== !!options.onPictureUpload
    const resolverChanged = this.options.onPictureResolve !== options.onPictureResolve
    this.options = options
    if (uploadChanged) {
      for (const record of this.views.values()) this.configurePictureUpload(record)
      this.notify()
    }
    if (resolverChanged) {
      for (const record of this.views.values()) notifyPictureResolverChange(record.editor)
    }
    if (presenceChanged) {
      for (const record of this.views.values()) this.configureReferences(record)
      this.notify()
    }
  }
  private get sessionId(): string | null { return this.lifecycle === "ready" ? this.identity.sessionId : null }
  private invalidateReferences(expected: string, scope: ReferenceInvalidationScope): ReferenceInvalidationResult {
    const sessionId = this.sessionId
    if (this.lifecycle === "disposed") return { sessionId: null, kind: "abort", reason: "disposed" }
    if (this.lifecycle !== "ready") return { sessionId, kind: "noop", reason: "not-ready" }
    if (expected !== sessionId) return { sessionId, kind: "noop", reason: "stale" }
    if (!scope || (scope.kind !== "document" && (scope.kind !== "reference" || !isValidReferenceLookup(scope.reference)))) {
      return { sessionId, kind: "failure", reason: "invalid-scope" }
    }
    const reference = scope.kind === "reference" ? { kind: scope.reference.kind, resourceId: scope.reference.resourceId } : undefined
    for (const [viewId, record] of [...this.views]) {
      if (this.getState().lifecycle === "disposed") break
      if (this.views.get(viewId) !== record) continue
      record.references?.invalidate(reference)
    }
    return this.getState().lifecycle === "disposed" ? { sessionId: null, kind: "abort", reason: "disposed" } : { sessionId, kind: "accepted" }
  }
  private get frozen(): boolean { return [...this.requests.values()].some((lease) => lease !== null) }
  getState(): NotePublicState {
    const body = !!this.authority && !!this.baseline && !this.authority.doc.eq(this.baseline)
    const host = !sameHost(this.host, this.hostBaseline)
    const blocked = this.encodingError !== undefined || this.draft.phase !== "none"
    return {
      lifecycle: this.lifecycle, identity: this.sessionId ? { ...this.identity } : null,
      encoding: this.encodingError === undefined ? "valid" : "error", dirty: { body, host },
      save: blocked ? "blocked" : this.pending ? "pending" : this.failure ? "failure" : body || host ? "dirty" : "clean",
      inputFrozen: this.frozen, undoPolicy: "shared", draft: { ...this.draft },
      views: [...this.views.keys()].map((viewId) => ({
        viewId, owner: this.draft.phase !== "none" && this.draft.ownerViewId === viewId,
        canDetach: this.draft.phase === "none" || this.draft.ownerViewId !== viewId
      })),
      ...(this.error === undefined ? {} : { error: this.error })
    }
  }
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try { listener(this.getState()) } catch { /* Observer errors do not undo model commits. */ }
    }
  }
  canReplace(): boolean {
    const state = this.getState()
    return this.lifecycle !== "disposed" && !state.dirty.body && !state.dirty.host
      && this.draft.phase === "none" && !this.pictureDialog && !this.pending && !this.pendingAcquires && !this.freezing && !this.frozen && !this.hasUploads()
  }
  resourceUsage(): { views: number; requests: number; activeLeases: number; undoEvents: number; redoEvents: number; sessionMappingEntries: number } {
    return {
      views: this.views.size, requests: this.requests.size,
      activeLeases: [...this.requests.values()].filter((lease) => lease !== null).length,
      undoEvents: this.authority ? Number(undoDepth(this.authority)) : 0,
      redoEvents: this.authority ? Number(redoDepth(this.authority)) : 0,
      // Transactions are synchronous or rejected stale; no unbounded rebase ledger is retained.
      sessionMappingEntries: 0
    }
  }
  private canDetach(viewId: string, expected: string): DetachViewResult {
    const sessionId = this.sessionId
    if (this.lifecycle !== "ready") return { sessionId, kind: "noop", reason: "not-ready" }
    if (expected !== sessionId) return { sessionId, kind: "noop", reason: "stale" }
    if (!this.views.has(viewId)) return { sessionId, kind: "noop", reason: "unknown-view" }
    if (this.draft.phase !== "none" && this.draft.ownerViewId === viewId) return { sessionId, kind: "blocked", reason: "draft-owner" }
    if (this.pictureDialog?.viewId === viewId) return { sessionId, kind: "blocked", reason: "draft-owner" }
    return { sessionId, kind: "allowed" }
  }

  attachView(viewId: string): DocumentView {
    if (!this.authority || this.lifecycle !== "ready" || this.views.has(viewId)) throw new Error("View is not attachable")
    const sharedCommands = Extension.create({
      name: "sharedDocumentHistory",
      addCommands: () => ({ undo: () => () => this.history(viewId, false), redo: () => () => this.history(viewId, true) }),
      addKeyboardShortcuts: () => ({
        "Mod-z": () => this.history(viewId, false),
        "Mod-Shift-z": () => this.history(viewId, true),
        "Mod-y": () => this.history(viewId, true)
      })
    })
    const editor = new Editor({
      extensions: [...createHnnSessionExtensions(false, {
        documentId: this.identity.documentId,
        loadKey: this.identity.loadKey,
        getResolver: () => this.options.onPictureResolve
      }), sharedCommands],
      content: this.authority.doc.toJSON() as Record<string, unknown>,
      // All commands and NodeViews use the same closed schema, including NodeType identity.
      onBeforeCreate: ({ editor: current }) => {
        current.schema = hnnRuntimeSchema
        current.extensionManager.schema = hnnRuntimeSchema
      },
      editorProps: {
        attributes: { class: "hn-editor-content", role: "textbox", "aria-label": `笔记内容编辑区 ${viewId}`, "aria-multiline": "true" }
      }
    })
    editor.view.setProps({ dispatchTransaction: (tr) => { this.dispatch(viewId, tr) } })
    editor.view.updateState(EditorState.create({ schema: hnnRuntimeSchema, doc: this.authority.doc, plugins: editor.state.plugins }))
    const record: DocumentView = { editor, instanceId: Symbol(viewId), references: undefined, pictureUpload: undefined, cleanup: [] }
    this.views.set(viewId, record)
    record.cleanup.push(registerHnnTransactionPermission(editor, () => this.canInput()))
    record.cleanup.push(installHnnClipboardHistoryBoundary(editor))
    record.cleanup.push(installBlockReorder(editor, {
      openMenu: (anchor, getPos, onClosed) => {
        if (!this.canInput()) return undefined
        const menu = openBlockMenu({ editor, anchor, getPos, onClosed, capabilities: {
          canUploadPicture: () => !!record.pictureUpload && this.canStartUpload(viewId) && !this.pictureDialog,
          openPictureDialog: (nodeId, dialogAnchor) => this.openPictureDialog(viewId, nodeId, dialogAnchor)
        } })
        return menu ? (restoreFocus?: boolean) => menu.close(restoreFocus) : undefined
      }
    }))
    record.cleanup.push(installInteractionToolbar(editor, {
      canUploadPicture: () => !!record.pictureUpload && this.canStartUpload(viewId) && !this.pictureDialog,
      openPictureDialog: (nodeId, anchor) => this.openPictureDialog(viewId, nodeId, anchor)
    }))
    this.configureReferences(record)
    this.configurePictureUpload(record)
    this.refreshEditable()
    return record
  }
  private canStartUpload(viewId?: string): boolean {
    return this.canInput() && this.draft.phase === "none" && !this.freezing && !this.pendingAcquires
      && (!this.pictureDialog || this.pictureDialog.viewId === viewId)
  }
  private hasUploads(): boolean {
    return [...this.views.values()].some((record) => !!record.pictureUpload?.getState().items.length)
  }
  private flushUploads(): void {
    for (const [viewId, record] of [...this.views]) {
      if (this.canStartUpload(viewId)) record.pictureUpload?.flushCompletions()
    }
  }
  private picturePosition(record: DocumentView, nodeId: string): number | null {
    let position: number | null = null
    record.editor.state.doc.forEach((node, offset) => {
      if (node.attrs["nodeId"] === nodeId) position = offset + node.nodeSize
    })
    return position
  }
  pictureDialogForView(viewId: string): DocumentPictureDialog | null {
    return this.pictureDialog?.viewId === viewId ? this.pictureDialog : null
  }
  openPictureDialog(viewId: string, nodeId: string, anchor: HTMLElement): boolean {
    const record = this.views.get(viewId)
    if (!record?.pictureUpload || this.pictureDialog || !this.canStartUpload(viewId)) return false
    if (this.picturePosition(record, nodeId) === null) return false
    this.pictureDialog = { viewId, nodeId, anchor }
    this.notify()
    return true
  }
  confirmPictureDialog(viewId: string, file: File): string | null {
    const dialog = this.pictureDialog
    const record = this.views.get(viewId)
    if (!dialog || dialog.viewId !== viewId || dialog.uploadId || !record?.pictureUpload || !this.canStartUpload(viewId)) return null
    const position = this.picturePosition(record, dialog.nodeId)
    if (position === null) return null
    const uploadId = record.pictureUpload.enqueue([file], position)[0] ?? null
    if (uploadId) {
      this.pictureDialog = { ...dialog, uploadId }
      this.notify()
    }
    return uploadId
  }
  closePictureDialog(viewId: string): void {
    const dialog = this.pictureDialog
    if (!dialog || dialog.viewId !== viewId) return
    if (dialog.uploadId) this.views.get(viewId)?.pictureUpload?.cancel(dialog.uploadId)
    this.pictureDialog = null
    this.notify()
    this.flushUploads()
  }
  private configurePictureUpload(record: DocumentView): void {
    if (!this.options.onPictureUpload || this.lifecycle !== "ready") {
      const viewId = [...this.views].find(([, value]) => value === record)?.[0]
      if (viewId && this.pictureDialog?.viewId === viewId) this.closePictureDialog(viewId)
      record.pictureUpload?.destroy()
      record.pictureUpload = undefined
      return
    }
    if (record.pictureUpload) return
    const current = () => this.lifecycle === "ready" && [...this.views.values()].includes(record)
    const currentViewId = () => [...this.views].find(([, value]) => value === record)?.[0]
    record.pictureUpload = installPictureUpload(record.editor, {
      upload: (file, context) => {
        const handler = this.options.onPictureUpload
        if (!current() || !handler) return Promise.reject(new Error("Picture upload is no longer available"))
        return handler(file, context)
      },
      canStart: () => {
        const viewId = currentViewId()
        return !!viewId && current() && this.canStartUpload(viewId)
      },
      canCommit: () => {
        const viewId = currentViewId()
        return !!viewId && current() && this.canStartUpload(viewId)
      },
      dispatch: (tr) => {
        if (!current()) return false
        const entry = [...this.views].find(([, value]) => value === record)
        if (!entry) return false
        if (tr.docChanged || this.canInput()) return this.dispatch(entry[0], tr)
        // Upload decorations are view-local and can be cancelled while a modal owns input.
        const editor = record.editor
        if (!tr.before.eq(editor.state.doc)) return false
        const applied = editor.state.applyTransaction(tr)
        if (!applied.transactions.includes(tr)) return false
        editor.view.updateState(applied.state)
        this.emitTransaction(editor, tr, applied.transactions.slice(1))
        return true
      }
    })
  }
  private configureReferences(record: DocumentView): void {
    record.references?.destroy()
    record.references = undefined
    const editor = record.editor
    const { onReferenceCandidates: candidates, onReferenceActivate: activate, onReferenceResolve: resolve } = this.options
    if (candidates || activate || resolve) {
      const installed = installHostReferences(editor, {
        documentId: this.identity.documentId,
        ...(candidates ? { candidates: (kind, query, context) => {
          const result = this.options.onReferenceCandidates?.(kind, query, context) ?? []
          if (!(result instanceof Promise)) return result
          this.pendingEdits++
          // Aborted work no longer owns a future insertion, even if the host never settles.
          let ended = false
          const end = () => { if (!ended) { ended = true; this.pendingEdits-- } }
          context.signal.addEventListener("abort", end, { once: true })
          return result.finally(() => { end(); context.signal.removeEventListener("abort", end) })
        } } : {}),
        ...(activate ? { activate: (reference, context) => this.options.onReferenceActivate?.(reference, context) } : {}),
        ...(resolve ? { resolve: (reference, context) => this.options.onReferenceResolve?.(reference, context) ?? null } : {})
      })
      if (this.lifecycle !== "ready" || editor.isDestroyed) { installed.destroy(); return }
      record.references = {
        ...installed,
        selectCandidate: (...args) => this.canInput() && !this.freezing && installed.selectCandidate(...args)
      }
    }
  }
  detachView(viewId: string, record: DocumentView): void {
    if (this.views.get(viewId) !== record) return
    if (this.pictureDialog?.viewId === viewId) this.closePictureDialog(viewId)
    record.pictureUpload?.destroy()
    record.references?.destroy()
    for (const cleanup of record.cleanup) cleanup()
    this.views.delete(viewId)
    record.editor.destroy()
    this.notify()
  }
  private canInput(): boolean {
    return this.lifecycle === "ready" && !this.frozen && (this.draft.phase === "none" || this.completingDraft)
  }
  dispatch(viewId: string, transaction: Transaction): boolean {
    const record = this.views.get(viewId)
    const authority = this.authority
    if (!record || !authority || !this.canInput() || this.dispatching) return false
    const editor = record.editor
    if (!transaction.before.eq(editor.state.doc) || !transaction.before.eq(authority.doc)) {
      this.error = new Error("Stale transaction rejected atomically")
      this.notify()
      return false
    }
    this.dispatching = true
    try {
      if (transaction.docChanged && this.lastEditView !== record.instanceId) closeHistory(transaction)
      const applied = editor.state.applyTransaction(transaction)
      if (!applied.transactions.includes(transaction)) return false
      // Local plugins append normalization steps before the authoritative history accepts them.
      let next = authority.apply(authority.tr.setSelection(editor.state.selection.getBookmark().resolve(authority.doc)).setStoredMarks(editor.state.storedMarks).setMeta("addToHistory", false))
      for (const tr of applied.transactions) {
        next = next.apply(tr)
      }
      const sameSelection = transaction.selectionSet && !transaction.docChanged
        && applied.state.selection.eq(editor.state.selection)
      this.authority = next
      editor.view.updateState(applied.state)
      // Explicit selection commands supersede pending native selectionchange,
      // even when undo already restored the same model selection. updateState
      // skips that DOM write for equal selections; focus forces it for this view.
      if (sameSelection && editor.view.hasFocus()) editor.view.focus()
      this.emitTransaction(editor, transaction, applied.transactions.slice(1))
      for (const peer of this.views.values()) {
        if (peer === record) continue
        const remote = peer.editor.state.tr
        for (const tr of applied.transactions) for (const step of tr.steps) remote.step(step)
        remote.setStoredMarks(peer.editor.state.storedMarks)
        remote.setMeta("addToHistory", false)
        // Replicate the authority's accepted structure, without reinterpreting
        // an empty result as a fresh select-all deletion in the peer's selection.
        remote.setMeta("preventClearDocument", true)
        const peerState = peer.editor.state.applyTransaction(remote).state
        peer.editor.view.updateState(peerState)
        this.emitTransaction(peer.editor, remote, [])
      }
      if (applied.transactions.some((tr) => tr.docChanged)) {
        this.lastEditView = record.instanceId
        try {
          const snapshot = encodeHnn(next.doc)
          this.encodingError = undefined
          this.error = undefined
          try { if (!this.applyingHostDocument) this.options.onChange(snapshot, { ...this.identity }) } catch { /* Host observer is not a producer. */ }
        } catch (error) { this.encodingError = error; this.error = error }
        this.schedule()
      }
    } finally { this.dispatching = false }
    this.notify()
    return true
  }
  private emitTransaction(editor: Editor, transaction: Transaction, appendedTransactions: Transaction[]): void {
    editor.emit("transaction", { editor, transaction, appendedTransactions })
    if (transaction.selectionSet) editor.emit("selectionUpdate", { editor, transaction })
    if (transaction.docChanged) editor.emit("update", { editor, transaction, appendedTransactions })
    const focus = transaction.getMeta("focus") as { event: FocusEvent } | undefined
    const blur = transaction.getMeta("blur") as { event: FocusEvent } | undefined
    if (focus) editor.emit("focus", { editor, transaction, event: focus.event })
    if (blur) editor.emit("blur", { editor, transaction, event: blur.event })
  }
  private editableTarget(expected: string, allowPictureDraft = false) {
    if (expected !== this.sessionId || !this.canInput() || this.freezing || this.pendingAcquires || (!allowPictureDraft && (this.pictureDialog || this.hasUploads()))) return null
    return [...this.views.entries()][0] ?? null
  }
  replacePictureReferences(input: Parameters<NonNullable<NoteDocumentController["replacePictureReferences"]>>[0]): ReturnType<NonNullable<NoteDocumentController["replacePictureReferences"]>> {
    const sessionId = this.identity.sessionId
    if (!input || !Array.isArray(input.replacements)) return { sessionId, kind: "rejected", reason: "invalid-replacement" }
    const target = this.editableTarget(input.expectedSessionId)
    if (!target || !this.authority) return { sessionId, kind: "rejected", reason: "stale-or-locked" }
    const [viewId, record] = target
    const ids = new Set<string>()
    const changes: { position: number; attrs: Record<string, unknown> }[] = []
    for (const value of input.replacements as readonly unknown[]) {
      if (!value || typeof value !== "object") return { sessionId, kind: "rejected", reason: "invalid-replacement" }
      const replacement = value as Record<string, unknown>
      const { nodeId, expectedSrc, src } = replacement
      if (typeof nodeId !== "string" || typeof expectedSrc !== "string" || typeof src !== "string" || ids.has(nodeId) || !isManagedHnnPicturePath(src)) return { sessionId, kind: "rejected", reason: "invalid-replacement" }
      ids.add(nodeId)
      let matched = 0
      this.authority.doc.descendants((node, position) => {
        if (node.type.name !== "picture" || node.attrs["nodeId"] !== nodeId) return
        matched++
        if (node.attrs["src"] === expectedSrc) changes.push({ position, attrs: { ...node.attrs, src } })
      })
      if (matched !== 1 || changes.length !== ids.size) return { sessionId, kind: "rejected", reason: "reference-changed" }
    }
    const effective = changes.filter(change => this.authority!.doc.nodeAt(change.position)?.attrs["src"] !== change.attrs["src"])
    if (!effective.length) return { sessionId, kind: "noop" }
    const tr = record.editor.state.tr
    for (const change of effective) tr.setNodeMarkup(change.position, undefined, change.attrs)
    // Validate the complete candidate before touching live state or history.
    // Individually valid references can together exceed the encoded shell budget.
    try { encodeHnn(tr.doc) }
    catch { return { sessionId, kind: "rejected", reason: "invalid-document" } }
    closeHistory(tr)
    const applied = this.dispatch(viewId, tr)
    // Isolate both sides: typing immediately after recovery must not absorb it.
    if (applied) this.dispatch(viewId, closeHistory(record.editor.state.tr))
    return { sessionId, kind: applied ? "applied" : "rejected" }
  }
  applyHostDocument(input: Parameters<NonNullable<NoteDocumentController["applyHostDocument"]>>[0]): ReturnType<NonNullable<NoteDocumentController["applyHostDocument"]>> {
    const sessionId = this.identity.sessionId
    if (!input) return { sessionId, kind: "rejected", reason: "invalid-document" }
    // Remote accepted edits must still map pending picture anchors. They do not
    // authorize a local reference migration or complete an in-flight upload.
    const target = this.editableTarget(input.expectedSessionId, true)
    if (!target || !this.authority) return { sessionId, kind: "rejected", reason: "stale-or-locked" }
    let document: PmNode
    try { document = decodeHnn(input.document) } catch { return { sessionId, kind: "rejected", reason: "invalid-document" } }
    if (this.authority.doc.eq(document)) return { sessionId, kind: "noop" }
    const [viewId, record] = target
    const before = record.editor.state.doc.content
    const start = before.findDiffStart(document.content)!
    const end = before.findDiffEnd(document.content)!
    const overlap = start - Math.min(end.a, end.b)
    const oldEnd = overlap > 0 ? end.a + overlap : end.a
    const newEnd = overlap > 0 ? end.b + overlap : end.b
    const tr = record.editor.state.tr.replace(start, oldEnd, document.slice(start, newEnd)).setMeta("addToHistory", false)
    this.applyingHostDocument = true
    try { return { sessionId, kind: this.dispatch(viewId, tr) ? "applied" : "rejected" } }
    finally { this.applyingHostDocument = false }
  }
  history(viewId: string, forward: boolean): boolean {
    const record = this.views.get(viewId)
    if (!record || !this.authority || !this.canInput() || this.freezing) return false
    if (this.options.onHistoryRequest) return this.options.onHistoryRequest(forward ? "redo" : "undo", { ...this.identity })
    const state = this.authority.apply(this.authority.tr.setSelection(record.editor.state.selection.getBookmark().resolve(this.authority.doc)).setMeta("addToHistory", false))
    return (forward ? redo : undo)(state, (tr) => { this.dispatch(viewId, tr) })
  }
  private refreshEditable(): void {
    for (const record of this.views.values()) record.editor.setEditable(this.canInput(), false)
    this.notify()
  }
  private schedule(): void {
    clearTimeout(this.timer)
    if (this.failure || this.lifecycle !== "ready") return
    this.timer = setTimeout(() => this.requestSave("autosave", this.identity.sessionId), 600)
  }
  private updateHost(snapshot: HostMetadataSnapshot, expected: string): UpdateHostSnapshotResult {
    const sessionId = this.sessionId
    if (this.lifecycle !== "ready") return { sessionId, kind: "blocked", reason: "not-ready" }
    if (expected !== sessionId) return { sessionId, kind: "noop", reason: "stale" }
    if (this.frozen || this.freezing) return { sessionId, kind: "blocked", reason: "input-frozen" }
    let copy: HostMetadataSnapshot
    try { copy = copyHost(snapshot) } catch { return { sessionId, kind: "failure", reason: "invalid-snapshot" } }
    if (copy.changeId === this.host.changeId && sameHost(copy, this.host)) return { sessionId, kind: "noop", reason: "unchanged" }
    if (copy.changeId <= this.host.changeId) return { sessionId, kind: "failure", reason: "non-monotonic-change-id" }
    this.host = copy
    this.schedule()
    this.notify()
    return { sessionId, kind: "accepted", changeId: copy.changeId }
  }
  private preflight(): SaveTerminal | undefined {
    if (this.lifecycle === "disposed") return { kind: "abort", sessionId: null, cause: this.abortCause }
    if (this.lifecycle !== "ready") return { kind: "noop", sessionId: null, cause: "not-ready" }
    if (this.encodingError !== undefined) return { kind: "blocked", sessionId: this.sessionId, cause: "encoding-error" }
    if (this.draft.phase !== "none") return { kind: "blocked", sessionId: this.sessionId, cause: "draft-open" }
    return undefined
  }
  private requestSave(reason: SaveReason, expected: string): RequestSaveResult {
    if (this.lifecycle === "disposed") return { kind: "abort", sessionId: null, cause: this.abortCause }
    if (this.lifecycle !== "ready") return { kind: "noop", sessionId: null, cause: "not-ready" }
    if (expected !== this.sessionId) return { kind: "noop", sessionId: this.sessionId, cause: "stale" }
    clearTimeout(this.timer)
    const blocked = this.preflight()
    if (blocked) return blocked
    if (this.pending) return this.pending
    if (reason === "autosave" && this.failure) return this.failure
    const dirty = this.getState().dirty
    if (!dirty.body && !dirty.host) return { kind: "clean", sessionId: this.identity.sessionId }
    const operationId = createSessionUuid()
    this.failure = undefined
    const completion = Promise.resolve().then(() => this.drain(reason, operationId)).then((result) => {
      this.pending = undefined
      if (result.kind === "failure") this.failure = result
      this.notify()
      // Notification can edit or synchronously dispose; no stale clean/saved receipt escapes.
      const blocked = this.preflight()
      if (blocked) return blocked
      const current = this.getState().dirty
      if ((result.kind === "saved" || result.kind === "clean") && (current.body || current.host)) {
        const latest = this.requestSave(reason, this.identity.sessionId)
        return latest.kind === "pending" ? latest.completion : latest
      }
      return result
    })
    const pending: SavePending = { kind: "pending", sessionId: this.identity.sessionId, operationId, completion }
    this.pending = pending
    this.notify()
    return pending
  }
  private async drain(reason: SaveReason, operationId: string): Promise<SaveTerminal> {
    let writesCompleted = 0
    while (true) {
      const blocked = this.preflight()
      if (blocked) return blocked
      const dirty = this.getState().dirty
      if (!dirty.body && !dirty.host) return { kind: "saved", sessionId: this.identity.sessionId, operationId, writesCompleted }
      const capturedDoc = this.authority!.doc
      const capturedHost = copyHost(this.host)
      const abort = new AbortController()
      this.writeAbort = abort
      try {
        const cancelled = new Promise<"abort">((resolve) => abort.signal.addEventListener("abort", () => resolve("abort"), { once: true }))
        const written = Promise.resolve(this.options.onSave({ document: encodeHnn(capturedDoc), hostSnapshot: copyHost(capturedHost) }, {
          identity: { ...this.identity }, operationId, reason, signal: abort.signal
        })).then(() => "written" as const)
        if (await Promise.race([written, cancelled]) === "abort" || this.lifecycle !== "ready") {
          return { kind: "abort", sessionId: null, cause: this.abortCause }
        }
        this.baseline = capturedDoc
        this.hostBaseline = capturedHost
        writesCompleted++
      } catch (error) {
        if (this.getState().lifecycle === "disposed") return { kind: "abort", sessionId: null, cause: this.abortCause }
        this.error = error
        return { kind: "failure", sessionId: this.sessionId, operationId, error }
      } finally { this.writeAbort = undefined }
    }
  }
  private async freeze(frozen: boolean, expected: string, requestId: string, leaseId?: string): Promise<FreezeOutcome> {
    const identity = this.sessionId ? { ...this.identity } : null
    const result = { identity, requestId }
    if (this.lifecycle === "disposed") return { identity: null, requestId, kind: "abort", reason: "disposed" }
    if (this.lifecycle !== "ready") return { ...result, kind: "noop", reason: "not-ready" }
    if (expected !== this.sessionId) return { ...result, kind: "noop", reason: "stale" }
    if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 128) return {
      ...result, kind: "failure", reason: "invalid-request", error: new TypeError("Invalid requestId")
    }
    const owned = this.requests.get(requestId)
    if (!frozen) {
      if (!leaseId || owned !== leaseId) return { ...result, kind: "noop", reason: "stale-lease" }
      this.requests.set(requestId, null)
      this.refreshEditable()
      if (this.getState().lifecycle === "disposed") return { identity: null, requestId, kind: "abort", reason: "disposed" }
      return { ...result, kind: "applied", action: "released", leaseId, inputFrozen: this.frozen }
    }
    if (owned === null) return { ...result, kind: "noop", reason: "request-ended" }
    if (owned) return { ...result, kind: "noop", reason: "already-owned", leaseId: owned, inputFrozen: true }
    this.freezing = true
    try {
      for (const { editor } of this.views.values()) {
        if (!flushHnnPendingEdits(editor)) return {
          ...result, kind: "failure", reason: "pending-edit", error: new Error("Formula edit is not ready to commit")
        }
      }
      for (const { editor } of this.views.values()) {
        const active = editor.view.dom.ownerDocument.activeElement
        // NodeView inputs live inside contenteditable=false islands; hasFocus() excludes them.
        if (active instanceof HTMLElement && editor.view.dom.contains(active)) active.blur()
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (this.getState().lifecycle === "disposed") return { identity: null, requestId, kind: "abort", reason: "disposed" }
      if ([...this.views.values()].some(({ editor }) => editor.view.composing)) return {
        ...result, kind: "failure", reason: "composition-commit", error: new Error("Composition still pending")
      }
      if (this.pendingEdits || this.hasUploads() || this.pictureDialog) return {
        ...result, kind: "failure", reason: "pending-edit", error: new Error("Reference or picture edit still pending")
      }
      const nextLease = createSessionUuid()
      this.requests.set(requestId, nextLease)
      this.refreshEditable()
      if (this.getState().lifecycle === "disposed") return { identity: null, requestId, kind: "abort", reason: "disposed" }
      return { ...result, kind: "applied", action: "acquired", leaseId: nextLease, inputFrozen: true }
    } catch (error) {
      if (this.getState().lifecycle === "disposed") return { identity: null, requestId, kind: "abort", reason: "disposed" }
      return { ...result, kind: "failure", reason: "other", error }
    } finally { this.freezing = false }
  }
  beginDraft(viewId: string, kind: "card" | "drawing"): boolean {
    if (!this.canInput() || this.freezing || this.pictureDialog) return false
    this.draft = { phase: "editing", draftId: createSessionUuid(), kind, ownerViewId: viewId, changed: false }
    this.refreshEditable()
    return true
  }
  updateDraft(phase: "editing" | "validating" | "invalid", changed: boolean): void {
    if (this.draft.phase === "none" || this.frozen || this.freezing) return
    this.draft = { ...this.draft, phase, changed: this.draft.changed || changed }
    this.notify()
  }
  draftInputAllowed(): boolean { return this.lifecycle === "ready" && !this.frozen && !this.freezing }
  readDraft(viewId: string): HnnDrawerSession | null {
    return this.draft.phase !== "none" && this.draft.ownerViewId === viewId ? this.draftPayload : null
  }
  writeDraft(viewId: string, payload: HnnDrawerSession | null): void {
    if (this.draft.phase !== "none" && this.draft.ownerViewId === viewId) this.draftPayload = payload
  }
  commitDraft(commit: () => boolean): boolean {
    if (!this.draftInputAllowed()) return false
    this.completingDraft = true
    try { return commit() } finally { this.completingDraft = false }
  }
  endDraft(): void {
    this.draft = { phase: "none" }
    this.draftPayload = null
    this.refreshEditable()
    this.flushUploads()
    const { dirty } = this.getState()
    if (!this.pending && (dirty.body || dirty.host)) this.schedule()
  }
  dispose(cause: "disposed" | "replaced" = "disposed"): void {
    if (this.lifecycle === "disposed") return
    this.abortCause = cause
    this.lifecycle = "disposed"
    clearTimeout(this.timer)
    this.requests.clear()
    this.writeAbort?.abort()
    for (const [viewId, record] of this.views) this.detachView(viewId, record)
    this.authority = undefined
    this.baseline = undefined
    this.draft = { phase: "none" }
    this.draftPayload = null
    this.notify()
    this.listeners.clear()
  }
}
