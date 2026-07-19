import {
  type CSSProperties,
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import "./styles.css"

import { isRangeInNoteEditableScope, isRangeCrossMultipleEditableRoots } from "./editableSelection"
import {
  EMPTY_SELECTION_FORMAT_STATE,
  applyInlineCode,
  applyInlineFormula,
  clearSelectionFormatting,
  crossBlockClearFormatting,
  crossBlockToggleInlineCode,
  getSelectionFormatState,
  runCrossBlockFormatCommand,
  runNativeFormatCommand,
  syncEditableBlockFromRange,
  syncEditableBlocksFromRange,
  type SelectionFormatState
} from "./inlineSelectionFormatting"

type SelectionPopoverProps = {
  readonly containerRef: RefObject<HTMLElement | null>
  readonly portalContainerRef?: RefObject<HTMLElement | null> | undefined
  readonly onMagicLinkConfigure?: (() => Promise<string>) | undefined
  /**
   * createLink 执行后，将 contentEditable 的 innerHTML 同步回 React 状态。
   * 参数：(blockId, innerHtml)。
   * 解决：execCommand("createLink") 修改了 DOM 但未同步 React 状态，
   * 后续 onBlur 触发时会因 dangerouslySetInnerHTML 引用变化而替换 DOM，
   * 导致保存的选区 Range 失效。
   */
  readonly onContentChange?: ((blockId: string, innerHtml: string) => void) | undefined
  /**
   * 跨块格式化后批量同步：参数为受影响 root 的 (blockId, innerHtml) 数组。
   * 单块场景继续走 onContentChange；跨块场景使用本批量入口，避免多次调用
   * onContentChange 时 NoteContent 闭包内 blocks 取到 stale 值。
   */
  readonly onBatchContentChange?:
    | ((updates: ReadonlyArray<readonly [string, string]>) => void)
    | undefined
}

type PopoverPosition = {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly flip: boolean
}

type PopoverMode = "format" | "link"

// 选区距视口顶部小于该阈值时，popover 翻转到选区下方，避免被裁切
const FLIP_THRESHOLD = 88
// popover 与选区之间的间距
const POPPER_GAP = 8

const computePosition = (range: Range): PopoverPosition => {
  const rect = range.getBoundingClientRect()
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left + rect.width / 2,
    flip: rect.top < FLIP_THRESHOLD
  }
}

export const SelectionPopover = ({
  containerRef,
  portalContainerRef,
  onMagicLinkConfigure,
  onContentChange,
  onBatchContentChange
}: SelectionPopoverProps) => {
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const [mode, setMode] = useState<PopoverMode>("format")
  const [linkUrl, setLinkUrl] = useState("")
  const [configuring, setConfiguring] = useState(false)
  // 当前选区的格式激活态（bold / italic / underline / strikeThrough / code / formula）
  // 在 selectionchange 与每次格式化动作后刷新；popover 隐藏时重置为空态
  const [activeFormats, setActiveFormats] = useState<SelectionFormatState>(
    EMPTY_SELECTION_FORMAT_STATE
  )
  // 当前选区是否跨多个 contenteditable 根；用于在跨块时禁用 createLink 等单 selection 操作。
  const [crossBlock, setCrossBlock] = useState(false)

  // 保存进入链接配置时的选区 Range，用于恢复选区后执行 createLink
  const savedRangeRef = useRef<Range | null>(null)
  // 链接输入框 ref，用于自动聚焦
  const inputRef = useRef<HTMLInputElement | null>(null)
  // mode 的 ref 镜像：selectionchange 监听器内读取最新值，避免闭包过期
  const modeRef = useRef<PopoverMode>(mode)
  modeRef.current = mode
  // 最近一次有效选区的 Range 克隆；格式化 helper 执行后若选区丢失，
  // 用它作为 syncEditableBlockFromRange 的兜底入参，保证 onContentChange 仍被触发
  const lastRangeRef = useRef<Range | null>(null)

  // 监听选区变化：仅在笔记容器内、非折叠、含可见文字时展示 popover。
  // 链接配置模式下跳过同步，避免输入框获焦导致选区丢失而关闭 popover。
  useEffect(() => {
    const sync = () => {
      if (modeRef.current === "link") return

      const container = containerRef.current
      const selection = window.getSelection()

      if (
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed ||
        !container
      ) {
        setPosition(null)
        setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
        setCrossBlock(false)
        return
      }

      const range = selection.getRangeAt(0)

      if (!isRangeInNoteEditableScope(range, container)) {
        setPosition(null)
        setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
        setCrossBlock(false)
        return
      }

      const text = selection.toString()

      if (!text.trim()) {
        setPosition(null)
        setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
        setCrossBlock(false)
        return
      }

      // 克隆当前有效 Range 作为格式化后的同步兜底；helper 可能改变选区，
      // 届时 window.getSelection()?.getRangeAt(0) 不可用时回退到此引用
      lastRangeRef.current = range.cloneRange()
      setPosition(computePosition(range))
      setActiveFormats(getSelectionFormatState())
      setCrossBlock(isRangeCrossMultipleEditableRoots(range))
    }

    document.addEventListener("selectionchange", sync)
    return () => document.removeEventListener("selectionchange", sync)
  }, [containerRef])

  // popover 展示期间：滚动或 Escape 关闭（含链接模式状态重置）。
  // 注意 Docked 模式（移动端底部栏内）跳过 scroll 关闭：
  // 移动端触摸滚动时浏览器通常保留选区高亮，但不会触发 selectionchange，
  // 若仍按 scroll 关闭会导致“选区高亮还在、底部工具栏却消失”的体验割裂。
  // Escape 等键盘事件在两种模式下都关闭。
  useEffect(() => {
    if (!position) return

    const close = () => {
      setMode("format")
      setLinkUrl("")
      setConfiguring(false)
      savedRangeRef.current = null
      lastRangeRef.current = null
      setPosition(null)
      setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
      setCrossBlock(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }

    const isDocked = Boolean(portalContainerRef?.current)
    if (!isDocked) {
      window.addEventListener("scroll", close, true)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("scroll", close, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [position, portalContainerRef])

  // 进入链接配置模式：聚焦输入框
  useEffect(() => {
    if (mode === "link" && inputRef.current) {
      inputRef.current.focus()
    }
  }, [mode])

  if (!position) return null

  // 格式化动作后把 contentEditable 的 DOM 变更同步回 React 状态。
  // 优先使用 helper 执行后的新鲜选区；若选区已丢失（如公式占位插入后光标
  // 落在 contenteditable=false 节点旁），回退到 lastRangeRef 保存的选区，
  // 确保 onContentChange 总能被触发。
  // 跨块选区走 syncEditableBlocksFromRange，遍历每个受影响 root 多次回调。
  // 若宿主提供 onBatchContentChange，则一次性收集所有 (blockId, innerHtml) 后批量回调，
  // 避免 NoteContent 内 onContentChange 闭包 blocks 取到 stale 值。
  const syncAfterFormat = () => {
    if (!onContentChange && !onBatchContentChange) return
    const container = containerRef.current
    const selection = window.getSelection()
    let range: Range | null =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    if (range === null) {
      range = lastRangeRef.current
    }
    if (range === null) return
    if (crossBlock && container) {
      if (onBatchContentChange) {
        const updates: Array<readonly [string, string]> = []
        syncEditableBlocksFromRange(range, container, (blockId, innerHtml) => {
          updates.push([blockId, innerHtml])
        })
        if (updates.length > 0) onBatchContentChange(updates)
      } else if (onContentChange) {
        syncEditableBlocksFromRange(range, container, onContentChange)
      }
    } else if (onContentChange) {
      syncEditableBlockFromRange(range, onContentChange)
    }
  }

  // 格式化动作后刷新 popover 位置与激活态：选区仍有效则重新定位，否则隐藏
  const refreshPositionAndState = () => {
    const selection = window.getSelection()
    const container = containerRef.current

    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      container &&
      isRangeInNoteEditableScope(selection.getRangeAt(0), container)
    ) {
      setPosition(computePosition(selection.getRangeAt(0)))
      setCrossBlock(isRangeCrossMultipleEditableRoots(selection.getRangeAt(0)))
    } else {
      setPosition(null)
    }
    setActiveFormats(getSelectionFormatState())
  }

  // 原生格式命令（bold / italic / underline / strikeThrough）：
  // 单块选区 -> runNativeFormatCommand；跨块选区 -> runCrossBlockFormatCommand 按 root 逐段执行
  const format = (command: "bold" | "italic" | "underline" | "strikeThrough") => {
    const container = containerRef.current
    if (crossBlock && container) {
      runCrossBlockFormatCommand(container, command)
    } else {
      runNativeFormatCommand(command)
    }
    syncAfterFormat()
    refreshPositionAndState()
  }

  // 行内代码：选区外包裹 <code>，已在 <code> 内则解包（单块走 applyInlineCode；跨块走 crossBlockToggleInlineCode）
  const handleInlineCode = () => {
    const container = containerRef.current
    if (crossBlock && container) {
      crossBlockToggleInlineCode(container)
    } else {
      applyInlineCode()
    }
    syncAfterFormat()
    refreshPositionAndState()
  }

  // 行内公式：把选中文本替换为 data-hn-inline-formula 占位 span（由 helper 实现）
  // 跨块时禁用（按钮 disabled），避免多块内容塌陷到单个 span。
  const handleInlineFormula = () => {
    if (crossBlock) return
    applyInlineFormula()
    syncAfterFormat()
    refreshPositionAndState()
  }

  // 清除格式：removeFormat + 手动解包 code / formula 等自定义包裹
  // 跨块走 crossBlockClearFormatting 按 root 独立扫描。
  const handleClearFormatting = () => {
    const container = containerRef.current
    if (crossBlock && container) {
      crossBlockClearFormatting(container)
    } else {
      clearSelectionFormatting()
    }
    syncAfterFormat()
    refreshPositionAndState()
  }

  // 进入链接配置模式：保存当前选区 Range（克隆以避免后续 DOM 变更影响）
  const enterLinkMode = () => {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange()
    }
    setLinkUrl("")
    setMode("link")
  }

  // 点击"魔法链接"按钮：调用宿主提供的 async 回调，返回值作为链接 URL
  const handleMagicLinkConfigure = async () => {
    if (!onMagicLinkConfigure) return
    setConfiguring(true)
    try {
      const result = await onMagicLinkConfigure()
      setLinkUrl(result)
    } finally {
      setConfiguring(false)
    }
  }

  // 确认应用链接：恢复保存的选区，执行 createLink（选中文本作为链接文案，url 作为 href）
  // 之后通过 syncEditableBlockFromRange 同步 DOM 变更到 React 状态，避免 onBlur
  // 因 innerHTML 差异替换 DOM 节点
  const applyLink = () => {
    const url = linkUrl.trim()
    const savedRange = savedRangeRef.current
    if (!url || !savedRange) {
      close()
      return
    }
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(savedRange)
    }
    document.execCommand("createLink", false, url)

    // createLink 后立即同步 contentEditable 的 innerHTML 到 React 状态，
    // 使 block.text 包含 <a> 标签，防止后续重渲染因 dangerouslySetInnerHTML
    // 引用变化而替换 DOM，从而避免保存的选区 Range 失效
    if (onContentChange) {
      syncEditableBlockFromRange(savedRange, onContentChange)
    }

    close()
  }

  const close = () => {
    setMode("format")
    setLinkUrl("")
    setConfiguring(false)
    savedRangeRef.current = null
    lastRangeRef.current = null
    setPosition(null)
    setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
  }

  const onLinkFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    applyLink()
  }

  const style: CSSProperties = position.flip
    ? {
        top: position.bottom + POPPER_GAP,
        left: position.left,
        transform: "translate(-50%, 0)"
      }
    : {
        top: position.top - POPPER_GAP,
        left: position.left,
        transform: "translate(-50%, -100%)"
      }

  const popover = (
    <div
      className={`hn-note-popover hn-note-popover--edit${portalContainerRef ? " hn-note-popover--docked" : ""}`}
      style={portalContainerRef ? undefined : style}
      role="toolbar"
      aria-label="文字操作"
      onMouseDown={(event) => {
        // 格式模式：阻止 mousedown 默认行为，避免抢走 contentEditable 焦点、折叠选区。
        // 链接模式：不阻止，让输入框可正常获焦（选区已保存，不受影响）。
        if (mode === "format") event.preventDefault()
      }}
    >
      {mode === "format" ? (
        <>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.bold ? " hn-note-popover-btn--active" : ""}`}
            onClick={() => format("bold")}
            title="粗体"
            aria-label="粗体"
            aria-pressed={activeFormats.bold}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--bold">
              B
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.italic ? " hn-note-popover-btn--active" : ""}`}
            onClick={() => format("italic")}
            title="斜体"
            aria-label="斜体"
            aria-pressed={activeFormats.italic}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--italic">
              I
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.underline ? " hn-note-popover-btn--active" : ""}`}
            onClick={() => format("underline")}
            title="下划线"
            aria-label="下划线"
            aria-pressed={activeFormats.underline}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--underline">
              U
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.strikeThrough ? " hn-note-popover-btn--active" : ""}`}
            onClick={() => format("strikeThrough")}
            title="删除线"
            aria-label="删除线"
            aria-pressed={activeFormats.strikeThrough}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--strikethrough">
              S
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.code ? " hn-note-popover-btn--active" : ""}`}
            onClick={handleInlineCode}
            title="行内代码"
            aria-label="行内代码"
            aria-pressed={activeFormats.code}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--code">
              {"</>"}
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.formula ? " hn-note-popover-btn--active" : ""}`}
            onClick={handleInlineFormula}
            title="行内公式"
            aria-label="行内公式"
            aria-pressed={activeFormats.formula}
            disabled={crossBlock}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--formula">
              fx
            </span>
          </button>
          <button
            type="button"
            className="hn-note-popover-btn"
            onClick={handleClearFormatting}
            title="清除格式"
            aria-label="清除格式"
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--clear">
              T
            </span>
          </button>
          <span className="hn-note-popover-divider" />
          <button
            type="button"
            className="hn-note-popover-btn hn-note-popover-btn--link"
            onClick={enterLinkMode}
            title="链接"
            aria-label="为选中文字添加链接"
            disabled={crossBlock}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
          </button>
        </>
      ) : (
        <form className="hn-note-popover-link-form" onSubmit={onLinkFormSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="hn-note-popover-link-input"
            placeholder="输入链接 URL"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            disabled={configuring}
          />
          {onMagicLinkConfigure ? (
            <button
              type="button"
              className="hn-note-popover-btn hn-note-popover-btn--magic"
              onClick={() => {
                void handleMagicLinkConfigure()
              }}
              disabled={configuring}
              title="魔法链接"
            >
              {configuring ? "…" : "魔法链接"}
            </button>
          ) : null}
          <button
            type="submit"
            className="hn-note-popover-btn hn-note-popover-btn--confirm"
            disabled={!linkUrl.trim() || configuring}
            title="确认"
          >
            ✓
          </button>
          <button
            type="button"
            className="hn-note-popover-btn hn-note-popover-btn--cancel"
            onClick={close}
            title="取消"
          >
            ✕
          </button>
        </form>
      )}
    </div>
  )

  return createPortal(popover, portalContainerRef?.current ?? document.body)
}
