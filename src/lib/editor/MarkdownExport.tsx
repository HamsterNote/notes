import { Button, Drawer } from "@hamster-note/components"
import "@hamster-note/components/styles.css"
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from "react"
import type { HnnDocument } from "../hnn/codec"
import {
  exportMarkdown,
  type MarkdownDiagnostic,
  type MarkdownExportResult
} from "../hnn/markdown"
import "./MarkdownExport.css"

/** 宿主写出上下文：独立 AbortSignal 随取消/会话切换/卸载中止；宿主忽略 abort 时库内也会丢弃陈旧结果。 */
export type MarkdownExportContext = Readonly<{
  signal: AbortSignal
}>

/**
 * Markdown 导出界面（OpenSpec 7.6）。默认保存始终是 HNN，本组件只在用户显式点击
 * 「导出 Markdown」时捕获一次快照并运行纯函数 codec：无诊断直接交给宿主写出；
 * 有降级诊断则展示诊断与预览，用户显式确认前绝不调用 onExport。取消不写出、
 * 不触碰文档/save baseline/history；确认写出的始终是当次已诊断的那份结果，
 * 绝不偷偷重抓新内容。会话切换或卸载时 abort 在途写出并丢弃陈旧 UI 回写。
 */
export type MarkdownExportProps = Readonly<{
  /** 返回当前文档的 HNN 快照；仅在用户点击导出时调用一次，不暴露 editor/schema。 */
  snapshot: () => HnnDocument
  /** 宿主写出回调；仅在无诊断直接导出或用户显式确认诊断之后调用。 */
  onExport: (result: MarkdownExportResult, context: MarkdownExportContext) => void | Promise<void>
  /** 编辑会话标识：变化时中止在途导出、丢弃待确认诊断与一切陈旧结果。 */
  sessionKey: string
  /** 显式主题只切换 hn-* token 修饰类；缺省继承祖先 token。 */
  theme?: "light" | "dark"
  /** 宿主侧额外禁用触发入口，不影响进行中的导出语义。 */
  disabled?: boolean
  className?: string
}>

/** 在途写出操作：不可复用令牌 + 独立 AbortController + 发起时会话标识（与 EditorSession 保存同一取消策略）。 */
type ExportAttempt = Readonly<{
  token: symbol
  controller: AbortController
  /** settle 时与当前会话比对：提交切换即刻失效，不等 effect 运行。 */
  sessionKey: string
}>

/** 显式判别结果：Promise.reject(undefined)/throw undefined 也必须落入失败分支。 */
type ExportOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: unknown }>

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.length > 0) return error
  return "未知错误"
}

/** 诊断定位：path/nodeId/line/column/offset 实际存在哪些就展示哪些。 */
function diagnosticLocation(item: MarkdownDiagnostic): string {
  const parts: string[] = []
  if (item.path !== undefined) parts.push(`路径 ${item.path}`)
  if (item.nodeId !== undefined) parts.push(`节点 ${item.nodeId}`)
  if (item.line !== undefined && item.column !== undefined) {
    parts.push(`第 ${item.line} 行第 ${item.column} 列`)
  } else if (item.line !== undefined) {
    parts.push(`第 ${item.line} 行`)
  } else if (item.column !== undefined) {
    // column 也可能独立出现；实际存在的字段都要展示。
    parts.push(`第 ${item.column} 列`)
  }
  if (item.offset !== undefined) parts.push(`偏移 ${item.offset}`)
  return parts.join(" · ")
}

type DrawerStyle = CSSProperties & { readonly "--hn-drawer-size": string }

/** 组件库 Drawer 用 --hn-drawer-size 控制 bottom 高度：60vh 随视口变化（DESIGN.md §15）。 */
const DRAWER_STYLE: DrawerStyle = { "--hn-drawer-size": "60vh" }

export function MarkdownExport(props: MarkdownExportProps): ReactElement {
  // 先解构出回调 props：useCallback 依赖精确字段，避免整个 props 对象进入依赖数组。
  const { snapshot, onExport } = props
  // pending 非空即诊断确认 Drawer 打开；其内容就是点击那一刻捕获并诊断的结果。
  const [pending, setPending] = useState<MarkdownExportResult | null>(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const attemptRef = useRef<ExportAttempt | null>(null)
  const mountedRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const sessionKeyRef = useRef(props.sessionKey)

  /** 中止在途写出并清空待确认/进行中/已完成 UI；可选把焦点还给触发按钮。 */
  const reset = useCallback((restoreFocus: boolean) => {
    const attempt = attemptRef.current
    if (attempt) {
      attempt.controller.abort()
      attemptRef.current = null
    }
    setExporting(false)
    setPending(null)
    setError(null)
    setNotice(null)
    if (restoreFocus) {
      const trigger = triggerRef.current
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  // layout effect：卸载时同步 abort，早于任何迟到的 promise settle（微任务）。
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      attemptRef.current?.controller.abort()
      attemptRef.current = null
    }
  }, [])

  // 会话切换：layout effect 在 commit 阶段同步 abort 并丢弃待确认诊断与陈旧 UI；
  // settle 内的 attempt.sessionKey 双重比对保证「提交切换就失效」，旧 promise 即使在
  // 任何 effect 之前 settle 也不会回写到新会话。
  useLayoutEffect(() => {
    if (sessionKeyRef.current === props.sessionKey) return
    sessionKeyRef.current = props.sessionKey
    reset(false)
  }, [props.sessionKey, reset])

  /** 单飞写出：result 永远是当次已诊断的那份，绝不重新调用 snapshot。 */
  const runExport = useCallback(
    (result: MarkdownExportResult) => {
      if (attemptRef.current) return
      const attempt: ExportAttempt = {
        token: Symbol("markdown-export"),
        controller: new AbortController(),
        sessionKey: props.sessionKey
      }
      attemptRef.current = attempt
      setExporting(true)
      setError(null)
      setNotice(null)

      const settle = (outcome: ExportOutcome) => {
        // 取消/会话切换/卸载后到达的结果一律丢弃，即使宿主忽略了 abort；
        // attempt.sessionKey 比对让提交切换在 effect 运行之前就使旧 settle 失效。
        if (!mountedRef.current) return
        if (attempt.sessionKey !== sessionKeyRef.current) return
        if (attemptRef.current?.token !== attempt.token) return
        attemptRef.current = null
        setExporting(false)
        if (outcome.ok) {
          setPending(null)
          setNotice("导出完成")
          const trigger = triggerRef.current
          if (trigger?.isConnected) trigger.focus()
        } else {
          // 错误可观察：Drawer 打开时保留诊断供重试或取消；直接导出路径走行内 alert。
          setError(`导出失败：${describeError(outcome.error)}`)
        }
      }

      try {
        const maybePromise = onExport(result, { signal: attempt.controller.signal })
        if (maybePromise && typeof maybePromise.then === "function") {
          // 两个分支都在此处理：任何拒绝（含 reject(undefined)）都进失败分支，无 unhandled。
          void maybePromise.then(
            () => settle({ ok: true }),
            (error: unknown) => settle({ ok: false, error })
          )
        } else {
          settle({ ok: true })
        }
      } catch (error) {
        // throw undefined 等任意同步抛出同样按失败判别。
        settle({ ok: false, error })
      }
    },
    [onExport, props.sessionKey]
  )

  const handleClick = useCallback(() => {
    if (attemptRef.current || pending) return
    setError(null)
    setNotice(null)
    let result: MarkdownExportResult
    try {
      // 唯一一次快照捕获；codec 为纯函数，throw（严格校验失败）也必须可观察。
      result = exportMarkdown(snapshot())
    } catch (failure) {
      setError(`导出失败：${describeError(failure)}`)
      return
    }
    if (result.diagnostics.length > 0) {
      // 先聚焦触发按钮：组件库 modal 钩子在打开瞬间记录 activeElement，关闭时还原。
      triggerRef.current?.focus()
      setPending(result)
    } else {
      // 无诊断：用户已显式发起导出，可直接写出。
      runExport(result)
    }
  }, [pending, snapshot, runExport])

  const confirm = useCallback(() => {
    if (pending) runExport(pending)
  }, [pending, runExport])

  const themeClass =
    props.theme === "dark" ? "hn-markdown-export--dark" : props.theme === "light" ? "hn-markdown-export--light" : ""
  const rootClass = ["hn-markdown-export", themeClass, props.className ?? ""].filter(Boolean).join(" ")

  return (
    <div className={rootClass}>
      <button
        ref={triggerRef}
        type="button"
        className="hn-markdown-export__trigger"
        disabled={props.disabled === true || exporting || pending !== null}
        aria-haspopup="dialog"
        aria-expanded={pending !== null}
        onClick={handleClick}
      >
        导出 Markdown
      </button>
      {/* 常驻 polite live region：导出进展与完成通知；空内容不打扰。 */}
      <span className="hn-markdown-export__status" role="status">
        {exporting && pending === null ? "正在导出…" : (notice ?? "")}
      </span>
      {/* 直接导出路径的失败（Drawer 未打开）在行内 assertive 播报。 */}
      {error !== null && pending === null && (
        <p className="hn-markdown-export__error" role="alert">
          {error}
        </p>
      )}
      <Drawer
        open={pending !== null}
        onClose={() => reset(true)}
        placement="bottom"
        title="导出 Markdown"
        description="部分内容无法被 Markdown 完整表达，已替换为可读形式。请检查诊断与预览，确认后才会写出。"
        className={`${themeClass} hn-markdown-export-drawer`}
        style={DRAWER_STYLE}
      >
        {pending && (
          <div className="hn-markdown-export-drawer-body">
            <p className="hn-markdown-export-drawer-error" role="alert" hidden={error === null}>
              {error ?? ""}
            </p>
            <p className="hn-markdown-export-drawer-lead">
              以下 {pending.diagnostics.length} 处内容无法无损表达，导出结果中已以可读形式降级；确认后才会写出，取消不会改动笔记。
            </p>
            <ul className="hn-markdown-export-diagnostics">
              {pending.diagnostics.map((item, index) => {
                const location = diagnosticLocation(item)
                return (
                  <li className="hn-markdown-export-diagnostic" key={`${item.code}-${index}`}>
                    <span className="hn-markdown-export-diagnostic-message">{item.message}</span>
                    <span className="hn-markdown-export-diagnostic-meta">
                      {[item.code, location].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                )
              })}
            </ul>
            {/* 预览即待写出的那份结果：降级影响直接可读；tabIndex 让键盘用户可滚动查看。 */}
            <pre className="hn-markdown-export-preview" tabIndex={0} aria-label="导出结果预览">
              {pending.markdown}
            </pre>
            <footer className="hn-markdown-export-drawer-footer">
              <span className="hn-markdown-export-drawer-actions">
                {/* 取消始终可用：在途写出会被 abort，其陈旧结果随后被丢弃。 */}
                <Button variant="secondary" onClick={() => reset(true)}>
                  取消
                </Button>
                <Button variant="primary" onClick={confirm} disabled={exporting}>
                  {exporting ? "导出中…" : "确认导出"}
                </Button>
              </span>
            </footer>
          </div>
        )}
      </Drawer>
    </div>
  )
}
