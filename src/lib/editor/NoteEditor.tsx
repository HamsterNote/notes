import { EditorContent } from "@tiptap/react"
import { Component, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { decodeHnn, encodeHnn, type HnnDocument } from "../hnn/codec"
import { createEditorSession, type EditorSession } from "./session"
import { encodeNoteEditorSessionKey } from "./sessionKey"
import type { EditorSessionOptions, InitialLoadErrorHandler, NoteSave } from "./types"

type NoteEditorProps = EditorSessionOptions

type VerifiedInitial = Readonly<{
  sessionKey: string
  documentId: string
  loadKey: string | number
  document: HnnDocument
  initialRevision?: string
}>

type AcceptedInitial = VerifiedInitial & Readonly<{
  onSave: NoteSave | undefined
  onChange: EditorSessionOptions["onChange"]
}>

/** HNN 已通过 codec 的容量与深度限制，接受候选时可安全冻结其独立 JSON 快照。 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

type ValidationBoundaryProps = Readonly<{
  children: ReactNode
  onInitialLoadError: InitialLoadErrorHandler | undefined
  documentId: string
  loadKey: string | number
}>

type ValidationBoundaryState = Readonly<{
  failed: boolean
}>

/**
 * 只隔离尚未采用的候选初始 HNN。边界外的已提交 EditorSession 不会因候选 decode
 * 失败被卸载；边界按 sessionKey 重建后，宿主可用一个新的 key 重新尝试加载。
 */
class InitialValidationBoundary extends Component<ValidationBoundaryProps, ValidationBoundaryState> {
  state: ValidationBoundaryState = { failed: false }
  #notified = false

  static getDerivedStateFromError(): ValidationBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    if (this.#notified) return
    this.#notified = true
    try {
      this.props.onInitialLoadError?.(error, { documentId: this.props.documentId, loadKey: this.props.loadKey })
    } catch {
      // 宿主错误通知失败不能重新抛出并导致稳定的旧会话卸载。
    }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

type InitialValidatorProps = Readonly<{
  sessionKey: string
  documentId: string
  loadKey: string | number
  initialDocument: unknown
  initialRevision?: string
  onSave: NoteSave | undefined
  onChange: EditorSessionOptions["onChange"]
  onVerified: (initial: AcceptedInitial) => void
}>

/** render 阶段只做 HNN 纯校验和快照，不创建任何 TipTap/ProseMirror 资源。 */
function InitialValidator(props: InitialValidatorProps) {
  const initial: AcceptedInitial = {
    sessionKey: props.sessionKey,
    documentId: props.documentId,
    loadKey: props.loadKey,
    // decode + encode 后再 clone，候选 props 不可能在会话创建前篡改已验证内容。
    document: deepFreeze(structuredClone(encodeHnn(decodeHnn(props.initialDocument)))),
    onSave: props.onSave,
    onChange: props.onChange,
    ...(props.initialRevision === undefined ? {} : { initialRevision: props.initialRevision })
  }

  useLayoutEffect(() => {
    props.onVerified(initial)
    // 初始输入仅在该新 key 首次提交时采用；同 key 后续 initial props 必须忽略。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionKey])

  return null
}

/**
 * Phase 5 内部最薄呈现层。键变化通过 React remount 使旧会话 abort + destroy；同键的
 * initialDocument/initialRevision 更新不会触碰既有 session。此组件暂不提供工具栏、
 * NodeView、上传、抽屉或拖拽等正式内容界面。
 */
function NoteEditorSession(props: NoteEditorProps) {
  const callbacks = useRef<{ onSave: NoteSave | undefined; onChange: EditorSessionOptions["onChange"] }>({ onSave: undefined, onChange: undefined })
  const [acceptedInitial, setAcceptedInitial] = useState<AcceptedInitial | null>(null)
  const [session, setSession] = useState<EditorSession | null>(null)
  const sessionKey = encodeNoteEditorSessionKey(props.documentId, props.loadKey)
  const acceptInitial = useCallback((initial: AcceptedInitial) => {
    setAcceptedInitial((current) => current?.sessionKey === initial.sessionKey ? current : initial)
  }, [])

  // 已提交同 key 的 callback 可在 commit 后更新；不同 key 只能由 InitialValidator 成功
  // 后采用，故无效候选 render 无法污染旧 session 的 callback。
  useLayoutEffect(() => {
    if (acceptedInitial?.sessionKey === sessionKey) callbacks.current = { onSave: props.onSave, onChange: props.onChange }
  }, [acceptedInitial?.sessionKey, props.onChange, props.onSave, sessionKey])

  useLayoutEffect(() => {
    if (!acceptedInitial) return
    // 初始 callback 只能来自已接受候选，不能读取此时可能已变成 D 的当前 props。
    callbacks.current = { onSave: acceptedInitial.onSave, onChange: acceptedInitial.onChange }
    const created = createEditorSession({
      documentId: acceptedInitial.documentId,
      loadKey: acceptedInitial.loadKey,
      initialDocument: acceptedInitial.document,
      ...(acceptedInitial.initialRevision === undefined ? {} : { initialRevision: acceptedInitial.initialRevision }),
      onSave: async (snapshot, context) => {
        if (!callbacks.current.onSave) throw new Error("未提供 onSave，不能保存文档")
        return callbacks.current.onSave(snapshot, context)
      },
      onChange: (snapshot) => callbacks.current.onChange?.(snapshot)
    })
    setSession(created)
    return () => {
      created.destroy()
    }
    // acceptedInitial 只会由通过纯校验的候选更新；同 key 的初始 props 必须忽略。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedInitial?.sessionKey])

  const needsValidation = acceptedInitial?.sessionKey !== sessionKey
  return <>
    {needsValidation && <InitialValidationBoundary
      key={sessionKey}
      onInitialLoadError={props.onInitialLoadError}
      documentId={props.documentId}
      loadKey={props.loadKey}
    >
      <InitialValidator
        sessionKey={sessionKey}
        documentId={props.documentId}
        loadKey={props.loadKey}
        initialDocument={props.initialDocument}
        {...(props.initialRevision === undefined ? {} : { initialRevision: props.initialRevision })}
        onSave={props.onSave}
        onChange={props.onChange}
        onVerified={acceptInitial}
      />
    </InitialValidationBoundary>}
    <EditorContent editor={session?.editor ?? null} />
  </>
}

/** 内部组件，Phase 7 前不得从 src/lib/index.ts 公开。 */
export function NoteEditor(props: NoteEditorProps) {
  return <NoteEditorSession {...props} />
}
