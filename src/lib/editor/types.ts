import type { HnnDocument } from "../hnn/codec"

/** 宿主必须以 documentId 与 baseRevision 实施 CAS；中止只隔离库内状态。 */
export type NoteSaveContext = Readonly<{
  documentId: string
  baseRevision?: string
  signal: AbortSignal
}>

export type NoteSaveResult =
  | Readonly<{ kind: "saved"; revision?: string }>
  | Readonly<{ kind: "conflict" }>

export type NoteSave = (snapshot: HnnDocument, context: NoteSaveContext) => Promise<NoteSaveResult>

export type InitialLoadErrorContext = Readonly<{
  documentId: string
  loadKey: string | number
}>

/** 初始 HNN 严格校验失败时通知候选会话；不会替换仍在运行的旧会话。 */
export type InitialLoadErrorHandler = (error: unknown, context: InitialLoadErrorContext) => void

export type EditorSessionStatus = "idle" | "saving" | "error" | "conflict"

export type EditorSessionState = Readonly<{
  dirty: boolean
  status: EditorSessionStatus
  error?: unknown
}>

/** 这些属性刻意不包含 extensions、schema 或 history，HNN 文档结构始终由库封闭定义。 */
export type EditorSessionOptions = Readonly<{
  documentId: string
  /** 仅接受有限 number；NaN 和正负 Infinity 在创建会话时会硬失败。 */
  loadKey: string | number
  initialDocument: unknown
  initialRevision?: string
  onSave?: NoteSave
  onChange?: (snapshot: HnnDocument) => void
  onInitialLoadError?: InitialLoadErrorHandler
}>
