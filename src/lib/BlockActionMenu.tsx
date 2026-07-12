import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import "./styles.css"

import { focusEditableBlock } from "./useBlockEditing"

// ===== 类型导出 =====

/** 格式转换目标：标题（带层级）或正文，与 blockEditing.TextBlockTarget 对齐 */
export type BlockConvertTarget =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 }
  | { readonly kind: "paragraph" }

export type BlockActionMenuProps = {
  /** 菜单是否打开，由父组件统一控制，便于和 SelectionPopover 互斥 */
  readonly open: boolean
  /** 受控开闭回调：handle、Escape、外部点击、格式选择都会通过它关闭菜单 */
  readonly onOpenChange: (open: boolean) => void
  /** 所属区块 ID（渲染为 data-block-id 供 Wave 4.2 定位） */
  readonly blockId: string
  /** 当前区块类型 */
  readonly kind: "heading" | "paragraph"
  /** 标题层级，kind === "heading" 时由父组件传入 */
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5
  /**
   * 格式转换回调。
   * 父组件（Wave 4.2）应接入 blockEditing.convertTextBlockFormat 执行不可变更新。
   */
  readonly onConvert: (target: BlockConvertTarget) => void
}

// ===== 常量 =====

/** 菜单居中断点：视口宽度 <=800px 时菜单水平居中（DESIGN.md 规定的边界） */
const MENU_CENTER_BREAKPOINT = 800
/** handle 按钮与菜单之间的间距（px） */
const HANDLE_MENU_GAP = 8
/** 菜单层级，与 SelectionPopover 复用同一固定层 */
const MENU_Z_INDEX = 9999

type HeadingMenuItem = {
  readonly kind: "heading"
  readonly level: 1 | 2 | 3 | 4 | 5
  readonly label: string
}

type ParagraphMenuItem = {
  readonly kind: "paragraph"
  readonly label: string
}

/** 单个菜单项（判别联合：标题项有 level，正文项无） */
type MenuItem = HeadingMenuItem | ParagraphMenuItem

/** 菜单项列表：H1 → H5 → 正文，顺序固定 */
const MENU_ITEMS: readonly MenuItem[] = [
  { kind: "heading", level: 1, label: "H1" },
  { kind: "heading", level: 2, label: "H2" },
  { kind: "heading", level: 3, label: "H3" },
  { kind: "heading", level: 4, label: "H4" },
  { kind: "heading", level: 5, label: "H5" },
  { kind: "paragraph", label: "正文" }
]

// ===== 组件 =====

/**
 * 区块操作菜单：左侧 handle 按钮 + portal 菜单。
 *
 * - handle 点击/Enter 切换菜单开闭。
 * - 菜单通过 createPortal 渲染到 document.body，脱离 overflow 容器。
 * - 宽屏定位在 handle 右侧；窄屏水平居中。
 * - 支持 ↑/↓ 键盘导航、Enter/Space 激活、Escape / 外部点击关闭。
 * - 当前格式标记为 aria-disabled 且显示勾选，禁止重复选择。
 */
export const BlockActionMenu = ({
  open,
  onOpenChange,
  blockId,
  kind,
  headingLevel,
  onConvert
}: BlockActionMenuProps) => {
  /** 菜单定位样式（fixed 坐标），打开时由 getBoundingClientRect 计算 */
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ display: "none" })

  // handle 按钮内部引用：用于定位计算与焦点归还
  const handleRef = useRef<HTMLButtonElement | null>(null)
  // 菜单容器引用：用于点击外部检测
  const menuRef = useRef<HTMLDivElement | null>(null)
  // 菜单项按钮引用数组：用于 ↑/↓ 键盘导航时移动焦点
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const setHandleNode = useCallback((node: HTMLButtonElement | null) => {
    handleRef.current = node
  }, [])

  /** 判断某菜单项是否匹配当前区块格式 */
  const isCurrentItem = (item: MenuItem): boolean => {
    if (item.kind === "heading") {
      return kind === "heading" && headingLevel === item.level
    }
    return kind === "paragraph"
  }

  /** 根据 handle 按钮位置计算菜单的 fixed 定位坐标 */
  const computeMenuStyle = (): CSSProperties => {
    const handle = handleRef.current
    if (!handle) return { display: "none" }

    const rect = handle.getBoundingClientRect()

    // 宽屏（>800px）：菜单紧贴 handle 右侧，顶部对齐
    if (window.innerWidth > MENU_CENTER_BREAKPOINT) {
      return {
        position: "fixed",
        top: rect.top,
        left: rect.right + HANDLE_MENU_GAP,
        zIndex: MENU_Z_INDEX
      }
    }

    // 窄屏（<=800px）：菜单水平居中，位于 handle 下方
    return {
      position: "fixed",
      top: rect.bottom + HANDLE_MENU_GAP,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: MENU_Z_INDEX
    }
  }

  /** handle 点击 / Enter：切换菜单开闭 */
  const handleToggle = () => {
    if (open) {
      onOpenChange(false)
    } else {
      setMenuStyle(computeMenuStyle())
      onOpenChange(true)
    }
  }

  const handleSelect = (item: MenuItem) => {
    // 当前格式不可重复选择
    if (isCurrentItem(item)) return

    if (item.kind === "heading") {
      onConvert({ kind: "heading", level: item.level })
    } else {
      onConvert({ kind: "paragraph" })
    }

    onOpenChange(false)
    setTimeout(() => focusEditableBlock(blockId, "end"), 0)
  }

  // 菜单打开时：将焦点移至当前格式项（让用户知道当前位置），找不到则聚焦第一项
  useEffect(() => {
    if (!open) return

    // 内联判断，使依赖项显式化（避免 exhaustive-deps 告警）
    const currentIndex = MENU_ITEMS.findIndex((item) => {
      if (item.kind === "heading")
        return kind === "heading" && headingLevel === item.level
      return kind === "paragraph"
    })
    const focusIndex = currentIndex >= 0 ? currentIndex : 0
    itemRefs.current[focusIndex]?.focus()
  }, [open, kind, headingLevel])

  // 菜单打开时：监听外部点击 / Escape / 滚动 / 窗口尺寸变化 → 关闭
  useEffect(() => {
    if (!open) return

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      // 点击 handle 自身：由 handleToggle 处理，不在此关闭
      if (handleRef.current?.contains(target)) return
      // 点击菜单内部：不关闭（由菜单项 onClick 处理）
      if (menuRef.current?.contains(target)) return
      onOpenChange(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onOpenChange(false)
        handleRef.current?.focus()
      }
    }

    // 滚动或窗口尺寸变化时关闭菜单：handle 位置已变，fixed 定位会错位
    const handleClose = () => onOpenChange(false)

    document.addEventListener("mousedown", handleOutsideClick)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("scroll", handleClose, true)
    window.addEventListener("resize", handleClose)
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("scroll", handleClose, true)
      window.removeEventListener("resize", handleClose)
    }
  }, [open, onOpenChange])

  /** 菜单容器键盘导航：↑/↓ 在菜单项之间循环移动焦点 */
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return

    event.preventDefault()

    const activeButton =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null
    const currentIndex = itemRefs.current.indexOf(activeButton)
    const delta = event.key === "ArrowDown" ? 1 : -1
    const count = itemRefs.current.length
    if (count === 0) return

    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + delta + count) % count
    const nextItem = itemRefs.current[nextIndex]
    nextItem?.focus()
  }

  // ===== 渲染 =====

  const currentLabel = kind === "heading" ? `标题 ${headingLevel ?? 1}` : "正文"
  const handleAriaLabel = `更改区块格式，当前为${currentLabel}`

  // 菜单 DOM（仅在 open 时构建，通过 portal 渲染到 document.body）
  const menu = open ? (
    <div
      ref={menuRef}
      className="hn-note-block-menu"
      role="menu"
      aria-label="区块格式选项"
      style={menuStyle}
      onKeyDown={handleMenuKeyDown}
    >
      {MENU_ITEMS.map((item, index) => {
        const isCurrent = isCurrentItem(item)

        return (
          <button
            key={item.label}
            ref={(el) => {
              itemRefs.current[index] = el
            }}
            type="button"
            role="menuitem"
            className={[
              "hn-note-block-menu-item",
              isCurrent ? "hn-note-block-menu-item--active" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            aria-disabled={isCurrent}
            aria-current={isCurrent ? "true" : undefined}
            tabIndex={-1}
            onClick={() => handleSelect(item)}
          >
            {/* 当前格式显示勾选标记，视觉 + 语义双重指示 */}
            {isCurrent ? (
              <span className="hn-note-block-menu-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
            <span className="hn-note-block-menu-item-label">{item.label}</span>
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <>
      <button
        ref={setHandleNode}
        type="button"
        className={[
          "hn-note-block-handle",
          open ? "hn-note-block-handle--open" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={handleAriaLabel}
        data-block-id={blockId}
        onClick={handleToggle}
      />
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
