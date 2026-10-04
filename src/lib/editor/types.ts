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
  /**
   * 图片上传宿主回调（D8/任务 6.7）。提供时会话才安装上传插件（picker/粘贴/拖入
   * 入口随之可用）；缺省时会话没有任何上传能力。构造时捕获，会话销毁时全部中止，
   * 陈旧结果在库内丢弃。
   */
  onPictureUpload?: PictureUploadHandler
  /**
   * 宿主引用候选查询（D11/任务 7.2）：mention/resource 的 `@`/`[[` 候选。缺省时无
   * 候选入口；文档只持久 resourceId/name，候选与解析结果绝不写入 HNN。
   */
  onReferenceCandidates?: HostCandidateProvider
  /**
   * 宿主引用激活（D11）：点击/键盘激活 mention/resource/externalItem 时调用，库绝不
   * 自行导航。缺省时引用不暴露任何 tab stop 或链接语义（DESIGN.md §16，无假链接）。
   */
  onReferenceActivate?: HostReferenceActivate
  /**
   * 宿主引用运行时解析（D11）：loading/resolved/missing/error 只读映射供占位呈现；
   * 缺省时一律受控 missing，不破坏文档。
   */
  onReferenceResolve?: HostReferenceResolve
  onInitialLoadError?: InitialLoadErrorHandler
}>

/**
 * 图片上传宿主契约（D8）。库仅处理 picture 节点的图片文件；每个文件一个稳定
 * `uploadId`，首次 `attempt` 为 1、retry 仅递增 `attempt`。宿主 MUST 按 `uploadId`
 * 幂等，并返回可持久化的 http/https `src` 与可选 `alt`。
 */
export type PictureUploadRequest = Readonly<{
  uploadId: string
  attempt: number
  signal: AbortSignal
}>

export type PictureUploadResult = Readonly<{
  src: string
  alt?: string
}>

export type PictureUploadHandler = (file: File, request: PictureUploadRequest) => Promise<PictureUploadResult>

/** 上传临时态只存在于内存/DOM 桥，绝不进入 HNN。 */
export type PictureUploadItemStatus = "uploading" | "failed"

export type PictureUploadItem = Readonly<{
  uploadId: string
  fileName: string
  attempt: number
  status: PictureUploadItemStatus
  error?: unknown
}>

export type PictureUploadState = Readonly<{
  items: readonly PictureUploadItem[]
}>

/**
 * 宿主引用（mention/resource/externalItem）的候选、激活与解析契约（D11）。
 * 文档内只保存 resourceId 与展示 name；真实内容由宿主 resolve 回调在运行时提供，
 * 库绝不把解析结果写入文档。
 */
export type HostReferenceKind = "mention" | "resource" | "externalItem"
export type HostCandidateKind = Extract<HostReferenceKind, "mention" | "resource">

export type HostReferenceContext = Readonly<{
  documentId: string
  signal: AbortSignal
}>

/** 候选只含最小资源标识与展示名，不允许 HTML/富内容。 */
export type HostReferenceCandidate = Readonly<{
  resourceId: string
  name: string
}>

export type HostCandidateProvider = (
  kind: HostCandidateKind,
  query: string,
  context: HostReferenceContext
) => readonly HostReferenceCandidate[] | Promise<readonly HostReferenceCandidate[]>

export type HostReferenceActivation = Readonly<{
  kind: HostReferenceKind
  resourceId: string
  name: string
}>

export type HostReferenceActivate = (
  reference: HostReferenceActivation,
  context: HostReferenceContext
) => void | Promise<void>

export type HostReferenceLookup = Readonly<{
  kind: HostReferenceKind
  resourceId: string
}>

/** 运行时最小展示信息：label 必填，description 可选；不接受 HTML。 */
export type HostReferenceResolution = Readonly<{
  label: string
  description?: string
}>

export type HostReferenceResolve = (
  reference: HostReferenceLookup,
  context: HostReferenceContext
) => HostReferenceResolution | null | Promise<HostReferenceResolution | null>

export type HostCandidateStatus = "idle" | "loading" | "ready" | "empty" | "error"

export type HostCandidateState = Readonly<{
  kind: HostCandidateKind | null
  query: string
  status: HostCandidateStatus
  items: readonly HostReferenceCandidate[]
  error?: unknown
}>

export type HostReferenceResolutionStatus = "loading" | "resolved" | "missing" | "error"

export type HostReferenceResolutionEntry = Readonly<{
  kind: HostReferenceKind
  resourceId: string
  status: HostReferenceResolutionStatus
  label?: string
  description?: string
  error?: unknown
}>

export type HostReferenceState = Readonly<{
  entries: readonly HostReferenceResolutionEntry[]
}>
