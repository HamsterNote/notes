import "./NoteSaveStatus.css"
import type { EditorSessionState } from "./types"

/**
 * 保存状态界面（OpenSpec 7.3）。只消费 EditorSession 暴露的权威状态，不自建保存
 * 逻辑或状态机：dirty/saving/error/conflict 的判定、CAS 单飞与冲突决策全部留在
 * EditorSession 内，本组件负责把它们可观察地呈现出来。
 */
export type NoteSaveStatusProps = Readonly<{
  /** EditorSession.state 的快照；组件不修改也不推断它之外的保存语义。 */
  state: EditorSessionState
  /**
   * 触发一次正常保存（由接线方转调 EditorSession.save()）。允许返回 Promise；
   * 组件会吞掉 rejected 以防止 unhandled rejection，但绝不以此代替权威 state。
   */
  onSave: () => void | Promise<unknown>
  /** 宿主侧额外禁用（例如整体只读），不影响状态文案的呈现。 */
  disabled?: boolean
  /** 显式主题只切换 hn-* token 修饰类，与 NoteEditor 的 theme 约定一致；缺省继承祖先 token。 */
  theme?: "light" | "dark"
  className?: string
}>

/** error 可能是宿主回调抛出的任意值；只在能安全提取时展示细节，绝不改变错误定性。 */
function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.length > 0) return error
  return undefined
}

export function NoteSaveStatus(props: NoteSaveStatusProps) {
  const { state, disabled } = props
  const saving = state.status === "saving"

  // 显式点击触发一次正常 CAS 保存；会话单飞语义保证 saving 中不会产生第二个并发
  // 保存，这里再用 disabled 防止重复点击。rejected 只吞掉，权威错误由 state 呈现。
  const handleSave = () => {
    try {
      const result = props.onSave()
      if (result && typeof result.then === "function") {
        void result.catch(() => {
          // 防止 unhandled rejection；错误呈现以 EditorSession 的 state 为准。
        })
      }
    } catch {
      // 同步抛错同样不向外传播；接线方/会话负责把它变成可观察的 error 状态。
    }
  }

  let tone: "clean" | "dirty" | "attention"
  let message: string
  let detail: string | undefined
  if (state.status === "conflict") {
    // 冲突不自动合并、不自动重试、绝不静默覆盖任一侧；等待用户或宿主决策。
    tone = "attention"
    message = "检测到保存冲突：这份笔记在其他地方已有更新。"
    detail = "你的修改仍完整保留在本地，不会自动合并或覆盖对方内容。可以再次尝试保存；如需采用对方版本，请重新载入笔记。"
  } else if (state.status === "error") {
    // 错误绝不呈现为已保存；失败内容保持为脏，等待显式重试。
    tone = "attention"
    message = "保存失败，修改尚未保存。"
    detail = errorDetail(state.error)
  } else if (saving) {
    tone = "dirty"
    message = "正在保存…"
  } else if (state.dirty) {
    tone = "dirty"
    message = "有未保存的修改"
  } else {
    tone = "clean"
    message = "已保存"
  }

  // clean idle 不需要动作；其余状态给出显式保存/重试按钮，saving 中禁用。
  const showButton = saving || state.dirty || state.status === "error" || state.status === "conflict"
  const buttonLabel = saving ? "保存中…" : state.status === "error" || state.status === "conflict" ? "重试保存" : "保存"

  const rootClass = [
    "hn-save-status",
    `hn-save-status--${tone}`,
    props.theme === "dark" ? "hn-save-status--dark" : props.theme === "light" ? "hn-save-status--light" : "",
    props.className ?? ""
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className={rootClass} data-status={state.status} data-dirty={state.dirty ? "true" : "false"}>
      {/* 状态文案进入 polite live region，屏幕阅读器随保存进展获得通知；按钮在 region 外避免操作控件被整段朗读。 */}
      <p className="hn-save-status__message" role="status" aria-live="polite">
        {saving && <span className="hn-save-status__spinner" aria-hidden="true" />}
        {tone === "attention" && (
          <span className="hn-save-status__glyph" aria-hidden="true">
            ⚠
          </span>
        )}
        <span className="hn-save-status__text">
          {message}
          {detail && <span className="hn-save-status__detail">{detail}</span>}
        </span>
      </p>
      {showButton && (
        <button
          type="button"
          className="hn-save-status__button"
          disabled={saving || disabled === true}
          aria-busy={saving || undefined}
          onClick={handleSave}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  )
}
