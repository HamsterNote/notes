import { EditorContent } from "@tiptap/react"
import { Component, useCallback, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode, type SyntheticEvent } from "react"
import { decodeHnn, encodeHnn, type HnnDocument } from "../hnn/codec"
import { isSafeHnnUrl } from "../hnn/urlPolicy"
import { HnnDataDrawer } from "./HnnDataDrawer"
import { HostReferenceUI } from "./HostReferenceUI"
import type { HostReferenceInstaller } from "./hostReferences"
import { MarkdownExport, type MarkdownExportProps } from "./MarkdownExport"
import { NoteSaveStatus } from "./NoteSaveStatus"
import type { PictureUploadInstaller } from "./pictureUpload"
import { createEditorSession, type EditorSession } from "./session"
import { encodeNoteEditorSessionKey } from "./sessionKey"
import type {
  EditorSessionOptions,
  EditorSessionState,
  InitialLoadErrorHandler,
  NoteSave,
  PictureUploadState
} from "./types"

/**
 * 内部 NoteEditor props。7.1 会以其为公开类型基础（故导出类型但不导出组件根入口）；
 * onExportMarkdown 这类纯 UI 触点只放在组件 props 上，不进入 EditorSessionOptions，
 * 会话因此不携带任何纯 UI 依赖。
 */
export type NoteEditorProps = EditorSessionOptions & Readonly<{
  /** 显式主题只切换 hn-* token 修饰类，不进入会话或保存语义；缺省为 light。 */
  theme?: "light" | "dark"
  /**
   * Markdown 显式导出回调（任务 7.6）。缺省不呈现导出入口，默认保存始终为 HNN；
   * 导出仅在用户显式点击并经降级诊断确认后调用。
   */
  onExportMarkdown?: MarkdownExportProps["onExport"]
}>

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
  onPictureUpload: EditorSessionOptions["onPictureUpload"]
  onReferenceCandidates: EditorSessionOptions["onReferenceCandidates"]
  onReferenceActivate: EditorSessionOptions["onReferenceActivate"]
  onReferenceResolve: EditorSessionOptions["onReferenceResolve"]
  onExportMarkdown: MarkdownExportProps["onExport"] | undefined
}>

/** 已提交 key 的最新宿主回调集合：只在 commit 后刷新，会话经 wrapper 运行期读取。 */
type CommittedCallbacks = Readonly<{
  onSave: NoteSave | undefined
  onChange: EditorSessionOptions["onChange"]
  onPictureUpload: EditorSessionOptions["onPictureUpload"]
  onExportMarkdown: MarkdownExportProps["onExport"] | undefined
}>

/**
 * 原子挂载态：sessionKey 与 session 在创建会话的同一个 layout effect 里成对提交。
 * Drawer 的 key 与 editor 都必须取自这同一个对象——任何 render 都不允许出现
 * “最新 accepted key 配旧 session” 的错位组合（Gate 6.3 会话切换安全约束）。
 */
type MountedSession = Readonly<{
  sessionKey: string
  session: EditorSession
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
  onPictureUpload: EditorSessionOptions["onPictureUpload"]
  onReferenceCandidates: EditorSessionOptions["onReferenceCandidates"]
  onReferenceActivate: EditorSessionOptions["onReferenceActivate"]
  onReferenceResolve: EditorSessionOptions["onReferenceResolve"]
  onExportMarkdown: MarkdownExportProps["onExport"] | undefined
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
    onPictureUpload: props.onPictureUpload,
    onReferenceCandidates: props.onReferenceCandidates,
    onReferenceActivate: props.onReferenceActivate,
    onReferenceResolve: props.onReferenceResolve,
    onExportMarkdown: props.onExportMarkdown,
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
 * 保存状态桥（任务 7.3）：只把 EditorSession 的权威 state 订阅到纯展示组件，
 * 保存动作直接转调 session.save()——不自建任何保存状态机。key 随会话切换
 * remount，旧会话的状态与订阅整体丢弃（切换隔离）。
 */
function SessionSaveStatus(props: Readonly<{ session: EditorSession; theme: "light" | "dark" }>) {
  const { session } = props
  const [state, setState] = useState<EditorSessionState>(() => session.state)
  useLayoutEffect(() => {
    // 会话实例变化（remount）先同步一次快照，再订阅后续通知，不错过间隙更新。
    setState(session.state)
    return session.subscribe(() => setState(session.state))
  }, [session])
  return <NoteSaveStatus state={state} onSave={() => session.save()} theme={props.theme} />
}

function uploadErrorText(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.length > 0) return error
  return undefined
}

/**
 * 图片上传控件（任务 6.7）：显式 picker 按钮 + 每文件上传中/失败重试/取消列表。
 * - 只有用户点击「插入图片」才打开系统文件选择，组件绝不自动打开；
 * - input 显式 accept="image/*" multiple；Markdown/HNN 等文件既不能被 picker
 *   选中，drop 时也被上传插件按 MIME 过滤（仅 image/* 入队）；
 * - 上传状态订阅自会话内 installer；占位 decoration 与状态只存在于内存，不进 HNN。
 */
function PictureUploadControls(props: Readonly<{ installer: PictureUploadInstaller; theme: "light" | "dark" }>) {
  const { installer } = props
  const [state, setState] = useState<PictureUploadState>(() => installer.getState())
  useLayoutEffect(() => {
    setState(installer.getState())
    return installer.subscribe(setState)
  }, [installer])
  const inputRef = useRef<HTMLInputElement | null>(null)

  const openPicker = useCallback(() => inputRef.current?.click(), [])
  const handleFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      installer.enqueue(event.currentTarget.files ?? [])
      // 重置 value：同一文件再次选择也能触发 change。
      event.currentTarget.value = ""
    },
    [installer]
  )

  return (
    <div className={`hn-editor-uploads hn-editor-uploads--${props.theme}`}>
      <button type="button" className="hn-editor-uploads__picker" onClick={openPicker}>
        插入图片
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        className="hn-editor-uploads__input"
        onChange={handleFiles}
      />
      {state.items.length > 0 && (
        <ul className="hn-editor-uploads__list" aria-label="图片上传进度">
          {state.items.map((item) => (
            <li className="hn-editor-uploads__item" data-status={item.status} key={item.uploadId}>
              <span className="hn-editor-uploads__name">{item.fileName}</span>
              {item.status === "uploading" ? (
                <span className="hn-editor-uploads__status" role="status">
                  上传中（第 {item.attempt} 次尝试）…
                </span>
              ) : (
                <span className="hn-editor-uploads__error" role="alert">
                  上传失败{uploadErrorText(item.error) ? `：${uploadErrorText(item.error)}` : ""}
                </span>
              )}
              {item.status === "failed" && (
                <button
                  type="button"
                  className="hn-editor-uploads__retry"
                  aria-label={`重试上传 ${item.fileName}`}
                  onClick={() => installer.retry(item.uploadId)}
                >
                  重试
                </button>
              )}
              <button
                type="button"
                className="hn-editor-uploads__cancel"
                aria-label={`取消上传 ${item.fileName}`}
                onClick={() => installer.cancel(item.uploadId)}
              >
                取消
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * 内部呈现层（Phase 5–7）。键变化通过 React remount 使旧会话 abort + destroy；同键的
 * initialDocument/initialRevision 更新不会触碰既有 session。会话控件（保存状态 7.3、
 * 图片上传 6.7、Markdown 导出 7.6）全部从同一原子挂载态取 session/sessionKey，portal
 * 与异步回写不跨会话。
 */
function NoteEditorSession(props: NoteEditorProps) {
  const callbacks = useRef<CommittedCallbacks>({
    onSave: undefined,
    onChange: undefined,
    onPictureUpload: undefined,
    onExportMarkdown: undefined
  })
  const [acceptedInitial, setAcceptedInitial] = useState<AcceptedInitial | null>(null)
  const [mounted, setMounted] = useState<MountedSession | null>(null)
  // 上传/导出能力只镜像“已接受且 commit”的 callback 状态：未接受候选（含 invalid 新
  // key）永远不会改写它们，旧会话的控件界面、在途上传与待确认诊断因此原样保留。
  const [uploadEnabled, setUploadEnabled] = useState(false)
  const [exportEnabled, setExportEnabled] = useState(false)
  // 引用能力 UI 以 installer 身份进 state（而非布尔）：fn→fn 同 key 更新时 installer
  // 不重建（身份不变，setState bail-out，桥与在途请求零打扰）；activate 有无翻转或
  // 能力增删时身份变化，HostReferenceUI 收到新 props 自行重建桥。与 mounted 同样在
  // 创建/同步两个带 guard 的 effect 里成对提交，未接受候选（invalid 新 key、切换中）
  // 不会刷新它，旧会话的候选/激活/解析界面原样保留。
  const [referencesInstaller, setReferencesInstaller] = useState<HostReferenceInstaller | null>(null)
  const sessionKey = encodeNoteEditorSessionKey(props.documentId, props.loadKey)
  const acceptInitial = useCallback((initial: AcceptedInitial) => {
    setAcceptedInitial((current) => current?.sessionKey === initial.sessionKey ? current : initial)
  }, [])

  // 已提交同 key 的 callback 可在 commit 后更新；不同 key 只能由 InitialValidator 成功
  // 后采用，故无效候选 render 无法污染旧 session 的 callback（无效新 key 保留旧 doc、
  // 旧 session 与旧全部 callbacks）。
  useLayoutEffect(() => {
    if (acceptedInitial?.sessionKey === sessionKey) {
      callbacks.current = {
        onSave: props.onSave,
        onChange: props.onChange,
        onPictureUpload: props.onPictureUpload,
        onExportMarkdown: props.onExportMarkdown
      }
    }
  }, [acceptedInitial?.sessionKey, props.onChange, props.onPictureUpload, props.onExportMarkdown, props.onSave, sessionKey])

  useLayoutEffect(() => {
    if (!acceptedInitial) return
    // 初始 callback 只能来自已接受候选，不能读取此时可能已变成 D 的当前 props。
    callbacks.current = {
      onSave: acceptedInitial.onSave,
      onChange: acceptedInitial.onChange,
      onPictureUpload: acceptedInitial.onPictureUpload,
      onExportMarkdown: acceptedInitial.onExportMarkdown
    }
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
    // 上传能力不进会话 options：初始与后续同 key 变化统一走 configurePictureUpload，
    // 避免两条安装路径语义分叉。
    created.configurePictureUpload(acceptedInitial.onPictureUpload)
    // 引用能力同理统一走 configureHostReferences：初始 callback 只能来自已接受候选，
    // documentId 由会话构造时捕获，与当前可能已失效的 props 无关。
    created.configureHostReferences({
      ...(acceptedInitial.onReferenceCandidates === undefined ? {} : { candidates: acceptedInitial.onReferenceCandidates }),
      ...(acceptedInitial.onReferenceActivate === undefined ? {} : { activate: acceptedInitial.onReferenceActivate }),
      ...(acceptedInitial.onReferenceResolve === undefined ? {} : { resolve: acceptedInitial.onReferenceResolve })
    })
    // 创建会话时一次性提交原子挂载态：key 与 session 永远来自同一次创建；能力 UI 与
    // 挂载态同帧提交，portal/异步不跨会话。
    setMounted({ sessionKey: acceptedInitial.sessionKey, session: created })
    setUploadEnabled(acceptedInitial.onPictureUpload !== undefined)
    setExportEnabled(acceptedInitial.onExportMarkdown !== undefined)
    setReferencesInstaller(created.hostReferences ?? null)
    return () => {
      created.destroy()
    }
    // acceptedInitial 只会由通过纯校验的候选更新；同 key 的初始 props 必须忽略。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedInitial?.sessionKey])

  // 同 key 已提交 callback 的能力同步（6.7/7.2/7.6）：callback 不是 initial-only 输入。
  // 新增 onPictureUpload 即刻安装上传插件（不重建 editor、不丢 doc/selection/history/
  // baseline）；移除即 abort 在途上传并清理状态；再添加同 session 重启。引用三回调：
  // fn→fn 仅未来请求走新 handler（installer 不重建，在途候选/解析/激活稳定）；能力增删
  // 或 activate 有无翻转才保守重建 installer。导出仅切换入口显隐（卸载即 abort 在途
  // 写出）。guard 双重比对 mounted/acceptedInitial 与当前 key，未接受候选（invalid
  // 新 key、切换中）不会走到这里，旧会话能力与界面保持不变。
  useLayoutEffect(() => {
    if (!mounted || mounted.sessionKey !== sessionKey) return
    if (acceptedInitial?.sessionKey !== sessionKey) return
    mounted.session.configurePictureUpload(props.onPictureUpload)
    mounted.session.configureHostReferences({
      ...(props.onReferenceCandidates === undefined ? {} : { candidates: props.onReferenceCandidates }),
      ...(props.onReferenceActivate === undefined ? {} : { activate: props.onReferenceActivate }),
      ...(props.onReferenceResolve === undefined ? {} : { resolve: props.onReferenceResolve })
    })
    setUploadEnabled(props.onPictureUpload !== undefined)
    setExportEnabled(props.onExportMarkdown !== undefined)
    setReferencesInstaller(mounted.session.hostReferences ?? null)
  }, [
    acceptedInitial?.sessionKey,
    mounted,
    props.onPictureUpload,
    props.onExportMarkdown,
    props.onReferenceCandidates,
    props.onReferenceActivate,
    props.onReferenceResolve,
    sessionKey
  ])

  // Markdown 导出回调同样经 wrapper 读取已提交 callback：导出入口的显隐由已提交的
  // exportEnabled 能力状态驱动，真正被调用的永远是已提交 key 的回调；同 key 移除
  // callback 后入口随之卸载，此分支只是防御，绝不静默成功。
  const handleExportMarkdown = useCallback<NonNullable<MarkdownExportProps["onExport"]>>(
    (result, context) => {
      const handler = callbacks.current.onExportMarkdown
      if (!handler) throw new Error("当前会话未启用 Markdown 导出")
      return handler(result, context)
    },
    []
  )

  const themeName = props.theme === "dark" ? "dark" : "light"
  /**
   * 永久导航安全边界不依赖候选/解析/激活能力：三回调全无时不安装 installer，
   * 但 hnmagic 锚点仍不能启动浏览器协议处理器。capture 先于 PM DOM 处理；仅限
   * 当前编辑器内容中的合法魔法链接，不影响普通链接、Drawer 或其他宿主区域。
   * 有激活桥时只 preventDefault，继续传播交桥调用宿主，绝不自行调用两次。
   */
  const guardMagicNavigation = (event: SyntheticEvent): boolean => {
    const editor = mounted?.session.editor
    if (!editor || editor.isDestroyed || !(event.target instanceof Element)) return false
    const anchor = event.target.closest("a[href]")
    if (!anchor || !editor.view.dom.contains(anchor)) return false
    const href = anchor.getAttribute("href")
    if (!href?.startsWith("hnmagic:") || !isSafeHnnUrl(href)) return false
    event.preventDefault()
    return true
  }
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
        onPictureUpload={props.onPictureUpload}
        onReferenceCandidates={props.onReferenceCandidates}
        onReferenceActivate={props.onReferenceActivate}
        onReferenceResolve={props.onReferenceResolve}
        onExportMarkdown={props.onExportMarkdown}
        onVerified={acceptInitial}
      />
    </InitialValidationBoundary>}
    {/* 编辑壳：透明无框（DESIGN.md §1），仅承载显式 light/dark token 修饰类，不参与会话生命周期。 */}
    <div
      className={themeName === "dark" ? "hn-editor hn-editor--dark" : "hn-editor hn-editor--light"}
      onClickCapture={guardMagicNavigation}
      onAuxClickCapture={guardMagicNavigation}
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        if (!guardMagicNavigation(event)) return
        // 有回调时 document capture 的交互桥已经消费；无桥（或无激活能力）时
        // 必须阻止 Enter/Space 继续变成 PM 编辑键，readonly 同样禁用协议导航。
        if (!referencesInstaller?.hasActivate) event.stopPropagation()
      }}
    >
      <EditorContent editor={mounted?.session.editor ?? null} />
      {/* 宿主引用候选菜单（7.2）：挂在 EditorContent 旁，随会话 key 隔离 remount；桥
          生命周期由组件自行管理（layout effect 建/毁）。installer 身份进 state：
          fn→fn 更新身份不变（桥零打扰），能力增删/activate 翻转身份变化触发桥重建；
          三回调全无时 referencesInstaller 为 null，不挂载任何候选/激活/解析界面。 */}
      {mounted && referencesInstaller && (
        <HostReferenceUI
          key={`refs:${mounted.sessionKey}`}
          editor={mounted.session.editor}
          installer={referencesInstaller}
        />
      )}
      {/* card/drawing 底部 Drawer（portal 到 body）。key 与 editor 取自同一原子挂载态：
          会话切换 A→B 时 React 按 key remount，A 的 portal/草稿/request/anchor 随卸载整体
          丢弃（不提交、不触发旧保存、焦点不还旧 anchor），B 再以全新状态注册自己的 bridge。 */}
      {mounted && (
        <HnnDataDrawer
          key={mounted.sessionKey}
          editor={mounted.session.editor}
          theme={themeName}
        />
      )}
      {/* 会话控件栏（6.7 上传 / 7.3 保存状态 / 7.6 Markdown 导出）：key 与 session 取自
          同一原子挂载态，切换时整体 remount，状态/订阅/在途操作不跨会话。 */}
      {mounted && (
        <div className="hn-editor-controls">
          <SessionSaveStatus key={`save:${mounted.sessionKey}`} session={mounted.session} theme={themeName} />
          {uploadEnabled && mounted.session.pictureUpload && (
            <PictureUploadControls
              key={`upload:${mounted.sessionKey}`}
              installer={mounted.session.pictureUpload}
              theme={themeName}
            />
          )}
          {exportEnabled && (
            <MarkdownExport
              key={mounted.sessionKey}
              sessionKey={mounted.sessionKey}
              snapshot={() => encodeHnn(mounted.session.editor.state.doc)}
              onExport={handleExportMarkdown}
              theme={themeName}
            />
          )}
        </div>
      )}
    </div>
  </>
}

/** 内部组件，Phase 7 前不得从 src/lib/index.ts 公开。 */
export function NoteEditor(props: NoteEditorProps) {
  return <NoteEditorSession {...props} />
}
