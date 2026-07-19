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

import { isRangeInSingleEditableRoot } from "./editableSelection"

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

// 预设文字颜色：与 popover 中的色块按钮一一对应，
// 点击调用 document.execCommand("foreColor", false, hex) 将颜色作为内联样式写入选区
const TEXT_COLORS = [
  { name: "红色", hex: "#ef4444" },
  { name: "蓝色", hex: "#3b82f6" },
  { name: "绿色", hex: "#22c55e" },
  { name: "黑色", hex: "#000000" },
  { name: "灰色", hex: "#6b7280" }
] as const

// 读取当前选区的文字颜色，用于在对应色块上高亮。
// jsdom 未实现 queryCommandValue，需做空值与异常兜底，避免测试与 SSR 崩溃。
const queryActiveColor = (): string => {
  if (typeof document.queryCommandValue !== "function") return ""
  try {
    const value = document.queryCommandValue("foreColor")
    return typeof value === "string" ? value : ""
  } catch {
    return ""
  }
}

export const SelectionPopover = ({
  containerRef,
  portalContainerRef,
  onMagicLinkConfigure,
  onContentChange
}: SelectionPopoverProps) => {
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const [mode, setMode] = useState<PopoverMode>("format")
  const [linkUrl, setLinkUrl] = useState("")
  const [configuring, setConfiguring] = useState(false)
  // 当前选区文字颜色（由 queryCommandValue("foreColor") 读取），
  // 用于在对应色块上高亮；jsdom 下为空字符串，不会命中任何预设色块
  const [activeColor, setActiveColor] = useState<string>("")

  // 保存进入链接配置时的选区 Range，用于恢复选区后执行 createLink
  const savedRangeRef = useRef<Range | null>(null)
  // 链接输入框 ref，用于自动聚焦
  const inputRef = useRef<HTMLInputElement | null>(null)
  // mode 的 ref 镜像：selectionchange 监听器内读取最新值，避免闭包过期
  const modeRef = useRef<PopoverMode>(mode)
  modeRef.current = mode

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
        return
      }

      const range = selection.getRangeAt(0)

      if (!isRangeInSingleEditableRoot(range, container)) {
        setPosition(null)
        return
      }

      const text = selection.toString()

      if (!text.trim()) {
        setPosition(null)
        return
      }

      setActiveColor(queryActiveColor())
      setPosition(computePosition(range))
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
      setPosition(null)
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

  // 执行格式化命令并重新定位；execCommand 虽已废弃，
  // 但仍是 contentEditable 富文本选区操作的最简且兼容性最好的方案
  const format = (command: "bold" | "italic" | "underline") => {
    document.execCommand(command)

    const selection = window.getSelection()
    const container = containerRef.current

    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      container &&
      isRangeInSingleEditableRoot(selection.getRangeAt(0), container)
    ) {
      setPosition(computePosition(selection.getRangeAt(0)))
    } else {
      setPosition(null)
    }
  }

  // 应用文字颜色：与 format 一致的选区校验与重定位逻辑，
  // 仅 command 改为 foreColor 并带上颜色 hex 作为第三参数
  const applyColor = (colorHex: string) => {
    document.execCommand("foreColor", false, colorHex)
    setActiveColor(colorHex)

    const selection = window.getSelection()
    const container = containerRef.current

    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      container &&
      isRangeInSingleEditableRoot(selection.getRangeAt(0), container)
    ) {
      setPosition(computePosition(selection.getRangeAt(0)))
    } else {
      setPosition(null)
    }
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
  // 之后同步 DOM 变更到 React 状态，避免 onBlur 因 innerHTML 差异替换 DOM 节点
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
      const container = savedRange.commonAncestorContainer
      const el =
        container.nodeType === Node.ELEMENT_NODE
          ? (container as HTMLElement)
          : container.parentElement
      const blockEl = el?.closest("[data-editable-block-id]")
      if (blockEl) {
        const blockId = blockEl.getAttribute("data-editable-block-id")
        if (blockId) onContentChange(blockId, blockEl.innerHTML)
      }
    }

    close()
  }

  const close = () => {
    setMode("format")
    setLinkUrl("")
    setConfiguring(false)
    savedRangeRef.current = null
    setPosition(null)
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
            className="hn-note-popover-btn"
            onClick={() => format("bold")}
            title="粗体"
            aria-label="粗体"
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--bold">
              B
            </span>
          </button>
          <button
            type="button"
            className="hn-note-popover-btn"
            onClick={() => format("italic")}
            title="斜体"
            aria-label="斜体"
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--italic">
              I
            </span>
          </button>
          <button
            type="button"
            className="hn-note-popover-btn"
            onClick={() => format("underline")}
            title="下划线"
            aria-label="下划线"
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--underline">
              U
            </span>
          </button>
          <span className="hn-note-popover-divider" />
          {TEXT_COLORS.map((color) => (
            <button
              key={color.hex}
              type="button"
              className={`hn-note-popover-color${
                activeColor === color.hex ? " hn-note-popover-color--active" : ""
              }`}
              style={{ backgroundColor: color.hex }}
              onClick={() => applyColor(color.hex)}
              title={`文字颜色：${color.name}`}
              aria-label={`文字颜色：${color.name}`}
              data-active={activeColor === color.hex}
            />
          ))}
          <span className="hn-note-popover-divider" />
          <button
            type="button"
            className="hn-note-popover-btn hn-note-popover-btn--link"
            onClick={enterLinkMode}
            title="链接"
            aria-label="为选中文字添加链接"
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
