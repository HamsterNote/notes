import { type CSSProperties, type RefObject, useEffect, useState } from "react"
import { createPortal } from "react-dom"

import "./styles.css"

type SelectionPopoverProps = {
  /** 选区检测锚定的容器：仅当选区落在该容器内时才弹出 popover */
  readonly containerRef: RefObject<HTMLElement | null>
  /**
   * 是否处于编辑模式。
   * - true：展示「粗体 / 斜体 / 下划线」格式化按钮，对 contentEditable 选区执行 execCommand。
   * - false：展示「复制」按钮，复制当前选中文本。
   */
  readonly editable: boolean
}

type PopoverPosition = {
  /** 选区顶边（viewport 坐标），用于将 popover 悬浮在选区上方 */
  readonly top: number
  /** 选区底边，用于空间不足时翻转到选区下方 */
  readonly bottom: number
  /** 选区水平中点，popover 以此为中心 */
  readonly left: number
  /** 选区贴近视口顶部时翻转到下方展示 */
  readonly flip: boolean
}

// 选区距视口顶部小于该阈值时，popover 翻转到选区下方，避免被裁切
const FLIP_THRESHOLD = 88
// popover 与选区之间的间距
const POPPER_GAP = 8

export const SelectionPopover = ({
  containerRef,
  editable
}: SelectionPopoverProps) => {
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const [selectedText, setSelectedText] = useState("")

  // 监听选区变化：仅在笔记容器内、非折叠、含可见文字时展示 popover
  useEffect(() => {
    const sync = () => {
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

      // 选区必须完全在笔记容器内，避免侧边栏等区域选中也触发
      if (!container.contains(range.commonAncestorContainer)) {
        setPosition(null)
        return
      }

      const text = selection.toString()

      if (!text.trim()) {
        setPosition(null)
        return
      }

      setSelectedText(text)

      const rect = range.getBoundingClientRect()
      setPosition({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left + rect.width / 2,
        flip: rect.top < FLIP_THRESHOLD
      })
    }

    document.addEventListener("selectionchange", sync)
    return () => document.removeEventListener("selectionchange", sync)
  }, [containerRef])

  // popover 展示期间：任意滚动或 Escape 关闭
  useEffect(() => {
    if (!position) return

    const close = () => setPosition(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }

    window.addEventListener("scroll", close, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("scroll", close, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [position])

  if (!position) return null

  // 执行格式化命令并重新定位；execCommand 虽已废弃，
  // 但仍是 contentEditable 富文本选区操作的最简且兼容性最好的方案
  const format = (command: "bold" | "italic" | "underline") => {
    document.execCommand(command)

    const selection = window.getSelection()

    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      setPosition({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left + rect.width / 2,
        flip: rect.top < FLIP_THRESHOLD
      })
    } else {
      setPosition(null)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(selectedText)
    } catch {
      // 剪贴板 API 不可用（如非 https）时降级到 execCommand
      document.execCommand("copy")
    }
    setPosition(null)
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
      className={`hn-note-popover${editable ? " hn-note-popover--edit" : " hn-note-popover--view"}`}
      style={style}
      role="toolbar"
      aria-label="文字操作"
      // 阻止 mousedown 默认行为：点击按钮时不会抢走 contentEditable 焦点、不会折叠选区
      onMouseDown={(event) => event.preventDefault()}
    >
      {editable ? (
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
        </>
      ) : (
        <button
          type="button"
          className="hn-note-popover-btn hn-note-popover-btn--copy"
          onClick={() => void copy()}
          title="复制选中文本"
        >
          复制
        </button>
      )}
    </div>
  )

  return createPortal(popover, document.body)
}
