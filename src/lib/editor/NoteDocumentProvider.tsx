import { EditorContent } from "@tiptap/react"
import { createContext, useContext, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { DocumentSession, type DocumentView } from "./documentSession"
import { HnnDataDrawer } from "./HnnDataDrawer"
import { HostReferenceUI } from "./HostReferenceUI"
import { PictureUploadControls } from "./NoteEditor"
import { ViewToolbar } from "./ViewToolbar"
import type { NoteDocumentProviderProps, NoteEditorViewProps, NotePublicState } from "./documentTypes"
import { isSafeHnnUrl } from "../hnn/urlPolicy"

const SessionContext = createContext<DocumentSession | null>(null)

export function NoteDocumentProvider(props: NoteDocumentProviderProps): ReactElement {
  const [session, setSession] = useState<DocumentSession | null>(null)
  const current = useRef<DocumentSession | null>(null)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  useLayoutEffect(() => {
    const created = new DocumentSession(latest.current)
    current.current = created
    setSession(created)
    if (created.getState().lifecycle === "load-error") {
      try { latest.current.onInitialLoadError?.(created.getState().error, { documentId: latest.current.documentId, loadKey: latest.current.loadKey }) } catch { /* Host error reporting is isolated. */ }
    }
    return () => { current.current?.dispose(); current.current = null; created.dispose() }
  }, [])
  useLayoutEffect(() => {
    const active = current.current
    if (!active) return
    if (active.identity.documentId === props.documentId && Object.is(active.identity.loadKey, props.loadKey)) {
      active.updateCallbacks(props)
      return
    }
    if (!active.canReplace()) return
    const candidate = new DocumentSession(props)
    if (candidate.getState().lifecycle === "load-error") {
      try { props.onInitialLoadError?.(candidate.getState().error, { documentId: props.documentId, loadKey: props.loadKey }) } catch { /* Preserve the active session. */ }
      candidate.dispose()
      return
    }
    active.dispose("replaced")
    current.current = candidate
    setSession(candidate)
  }, [props])
  return <SessionContext.Provider value={session}>
    {session && <ControllerBinding session={session} controllerRef={props.controllerRef} />}
    {props.children}
  </SessionContext.Provider>
}

function ControllerBinding({ session, controllerRef }: {
  session: DocumentSession; controllerRef: NoteDocumentProviderProps["controllerRef"]
}): null {
  useImperativeHandle(controllerRef, () => session.controller, [session])
  return null
}

function useDocumentState(session: DocumentSession | null): NotePublicState | null {
  const [state, setState] = useState<NotePublicState | null>(() => session?.getState() ?? null)
  useLayoutEffect(() => {
    setState(session?.getState() ?? null)
    return session?.controller.subscribe(setState)
  }, [session])
  return state
}

export function NoteEditorView({
  viewId,
  theme = "light",
  files,
  currentFileKey,
  paneId,
  busy,
  onSelectFile,
  onRequestRemove,
  layout
}: NoteEditorViewProps): ReactElement {
  const session = useContext(SessionContext)
  const state = useDocumentState(session)
  const [record, setRecord] = useState<DocumentView | null>(null)
  const [occupied, setOccupied] = useState({ top: 0, bottom: 0 })
  useLayoutEffect(() => {
    if (!session || session.getState().lifecycle !== "ready") { setRecord(null); return }
    const attached = session.attachView(viewId)
    setRecord(attached)
    return () => session.detachView(viewId, attached)
  }, [session, viewId])
  const bridge = useMemo(() => session ? {
    read: () => session.readDraft(viewId),
    write: (payload: Parameters<DocumentSession["writeDraft"]>[1]) => session.writeDraft(viewId, payload),
    open: (kind: "card" | "drawing") => session.beginDraft(viewId, kind),
    change: () => session.updateDraft("editing", true),
    validating: () => session.updateDraft("validating", false),
    invalid: () => session.updateDraft("invalid", false),
    canInput: () => session.draftInputAllowed(),
    commit: (commit: () => boolean) => session.commitDraft(commit),
    close: () => session.endDraft()
  } : undefined, [session, viewId])
  const locked = !state || state.inputFrozen || state.draft.phase !== "none"
  return <div className={`hn-editor hn-editor--${theme}`} data-view-id={viewId}
    onClickCapture={(event) => {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest("a[href]")
      const href = anchor?.getAttribute("href")
      if (href?.startsWith("hnmagic:") && isSafeHnnUrl(href)) event.preventDefault()
    }}>
    <div inert={locked} style={layout ? { boxSizing: "border-box", paddingTop: occupied.top, paddingBottom: occupied.bottom } : undefined}>
      <EditorContent editor={record?.editor ?? null} />
      {record?.references && <HostReferenceUI editor={record.editor} installer={record.references} />}
      {/* Reserve toolbar space after every flow control, including upload
          retry/cancel actions, so the floating bar cannot cover those actions. */}
      {record?.pictureUpload && <PictureUploadControls installer={record.pictureUpload} theme={theme} disabled={locked} />}
    </div>
    {record && session && <>
      <HnnDataDrawer editor={record.editor} theme={theme} coordinator={bridge} inputFrozen={state?.inputFrozen ?? false} />
      <ViewToolbar
        files={files}
        currentFileKey={currentFileKey}
        paneId={paneId}
        busy={busy}
        onSelectFile={onSelectFile}
        onRequestRemove={onRequestRemove}
        layout={layout}
        locked={locked}
        saveDisabled={state?.lifecycle !== "ready"}
        status={state ? ({ clean: "已保存", dirty: "待保存", pending: "保存中", blocked: "暂不能保存", failure: "保存失败" })[state.save] : ""}
        onUndo={() => session.history(viewId, false)}
        onRedo={() => session.history(viewId, true)}
        onSave={() => {
          session.controller.requestSave({ reason: "editor-button", expectedSessionId: session.identity.sessionId })
        }}
        onOccupiedSpaceChange={(space) => setOccupied((current) =>
          current.top === space.top && current.bottom === space.bottom ? current : space)}
      />
    </>}
  </div>
}
