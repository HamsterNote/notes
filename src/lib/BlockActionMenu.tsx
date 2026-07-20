import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import "./styles.css"

import {
  type BlockConvertTarget,
  blockKindLabel,
  blockMenuItems,
  blockMenuItemTarget,
  isCurrentBlockMenuItem,
  type MenuItem
} from "./BlockActionMenuTypes"
import { PictureUploadMenuItem } from "./PictureUploadMenuItem"
import type { NoteBlock } from "./types"
import { focusEditableBlock } from "./useBlockEditing"

// ===== 类型导出 =====

export type { BlockConvertTarget } from "./BlockActionMenuTypes"

export type PictureUploadPayload = {
  readonly base64: string
  readonly filename: string
  readonly width: number | undefined
  readonly height: number | undefined
}

export type BlockActionMenuProps = {
  /** 菜单是否打开，由父组件统一控制，便于和 SelectionPopover 互斥 */
  readonly open: boolean
  /** 受控开闭回调：handle、Escape、外部点击、格式选择都会通过它关闭菜单 */
  readonly onOpenChange: (open: boolean) => void
  /** 所属区块 ID（渲染为 data-block-id 供 Wave 4.2 定位） */
  readonly blockId: string
  /** 当前区块类型 */
  readonly kind: NoteBlock["kind"]
  /** 标题层级，kind === "heading" 时由父组件传入 */
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5
  /**
   * 菜单项选择回调。
   * convert 模式下用于转换当前块格式，add 模式下用于在当前块下方插入新块。
   * 返回值是操作完成后需要聚焦的编辑元素 ID。
   */
  readonly onSelect: (target: BlockConvertTarget) => string
  readonly onPictureUpload?: (picture: PictureUploadPayload) => Promise<void>
  /** 菜单模式：convert（默认）表示转换当前块，add 表示插入新块 */
  readonly mode?: "convert" | "add"
  /**
   * convert 模式专用：点击主菜单"删除"项时触发。
   * 返回需要被聚焦的编辑元素 ID；无返回值则不主动改变焦点。
   */
  readonly onDelete?: () => string | undefined
  /**
   * convert 模式专用：点击主菜单"创建副本"项时触发。
   * 返回新副本块的 id，组件会自动把焦点切到此 id 的可编辑起点。
   */
  readonly onDuplicate?: () => string | undefined
}

// ===== 常量 =====

/** 菜单居中断点：视口宽度 <=800px 时菜单水平居中（DESIGN.md 规定的边界） */
const MENU_CENTER_BREAKPOINT = 800
/** handle 按钮与菜单之间的间距（px） */
const HANDLE_MENU_GAP = 8
/** 主菜单与子菜单之间的间距（px） */
const SUBMENU_GAP = 6
/** 菜单层级，与 SelectionPopover 复用同一固定层 */
const MENU_Z_INDEX = 9999

// convert 主菜单三个固定项的稳定 key（用于 ref 数组下标管理）
const CONVERT_MAIN_INDEX_CONVERT = 0
const CONVERT_MAIN_INDEX_DELETE = 1
const CONVERT_MAIN_INDEX_DUPLICATE = 2
const BLOCK_ACTION_MENU_TRIGGER = "hn:block-action-menu-trigger"

export const triggerBlockActionMenu = (
  handle: HTMLButtonElement,
  anchor: HTMLElement
): void => {
  handle.dispatchEvent(
    new CustomEvent(BLOCK_ACTION_MENU_TRIGGER, { detail: anchor })
  )
}

// ===== 组件 =====

/**
 * 区块操作菜单：左侧 handle 按钮 + portal 菜单。
 *
 * - handle 点击/Enter 切换菜单开闭。
 * - 菜单通过 createPortal 渲染到 document.body，脱离 overflow 容器。
 * - 宽屏定位在 handle 右侧；窄屏水平居中。
 * - 支持 ↑/↓ 键盘导航、Enter/Space 激活、Escape / 外部点击关闭。
 * - add 模式：扁平的 blockMenuItems 列表（与历史行为一致）。
 * - convert 模式：主菜单含"转换成 / 删除 / 创建副本"三项；
 *   "转换成"项点击或 Enter 后展开右侧子菜单，子菜单内含原 blockMenuItems + 图片上传。
 *   Escape 优先关子菜单，再次 Escape 关主菜单。
 */
export const BlockActionMenu = ({
  open,
  onOpenChange,
  blockId,
  kind,
  headingLevel,
  onSelect,
  onPictureUpload,
  mode = "convert",
  onDelete,
  onDuplicate
}: BlockActionMenuProps) => {
  /** 主菜单定位样式（fixed 坐标），打开时由 getBoundingClientRect 计算 */
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ display: "none" })
  /** 子菜单定位样式；仅 convert 模式且"转换成"项展开后使用 */
  const [submenuStyle, setSubmenuStyle] = useState<CSSProperties>({
    display: "none"
  })
  /** convert 模式下"转换成"子菜单是否展开（add 模式不渲染主菜单按钮） */
  const [submenuOpen, setSubmenuOpen] = useState(false)

  // handle 按钮内部引用：用于定位计算与焦点归还
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const externalAnchorRef = useRef<HTMLElement | null>(null)
  // 主菜单容器引用：用于点击外部检测
  const menuRef = useRef<HTMLDivElement | null>(null)
  // 子菜单容器引用：用于点击外部检测（convert 模式才存在）
  const submenuRef = useRef<HTMLDivElement | null>(null)
  // "转换成"主菜单项按钮引用：用于子菜单定位计算与焦点归还
  const convertButtonRef = useRef<HTMLButtonElement | null>(null)

  // 主菜单项按钮引用数组：用于 ↑/↓ 键盘导航时移动焦点
  const mainItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  // 子菜单项按钮引用数组：用于 ↑/↓ 键盘导航时移动焦点（含图片项）
  const subItemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const setHandleNode = useCallback((node: HTMLButtonElement | null) => {
    handleRef.current = node
  }, [])

  /** 判断某子菜单项是否匹配当前区块格式 */
  const isCurrentItem = (item: MenuItem): boolean =>
    isCurrentBlockMenuItem(item, kind, headingLevel)

  /** 根据 handle 按钮位置计算主菜单的 fixed 定位坐标 */
  const computeMenuStyle = (
    anchor: HTMLElement | null = handleRef.current
  ): CSSProperties => {
    if (!anchor) return { display: "none" }

    const rect = anchor.getBoundingClientRect()

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

  /** 根据"转换成"主菜单项位置计算子菜单的 fixed 定位坐标 */
  const computeSubmenuStyle = (): CSSProperties => {
    const convertButton = convertButtonRef.current
    if (!convertButton) return { display: "none" }

    const rect = convertButton.getBoundingClientRect()

    // 宽屏：子菜单紧贴"转换成"项右侧，顶部对齐
    if (window.innerWidth > MENU_CENTER_BREAKPOINT) {
      return {
        position: "fixed",
        top: rect.top,
        left: rect.right + SUBMENU_GAP,
        zIndex: MENU_Z_INDEX
      }
    }

    // 窄屏：子菜单水平居中，位于"转换成"项下方（仍保留主菜单可见可访问）
    return {
      position: "fixed",
      top: rect.bottom + SUBMENU_GAP,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: MENU_Z_INDEX
    }
  }

  /** handle 点击 / Enter：切换主菜单开闭 */
  const handleToggle = (anchor: HTMLElement | null = handleRef.current) => {
    if (open) {
      onOpenChange(false)
    } else {
      setMenuStyle(computeMenuStyle(anchor))
      onOpenChange(true)
    }
  }

  const handleExternalToggle = useEffectEvent((anchor: HTMLElement) => {
    externalAnchorRef.current = anchor
    handleToggle(anchor)
  })

  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    const handleExternalTrigger = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      if (!(event.detail instanceof HTMLElement)) return
      handleExternalToggle(event.detail)
    }
    handle.addEventListener(BLOCK_ACTION_MENU_TRIGGER, handleExternalTrigger)
    return () =>
      handle.removeEventListener(BLOCK_ACTION_MENU_TRIGGER, handleExternalTrigger)
  }, [])

  // 子菜单项被选中（与 add 模式直接选择走同一路径）
  const handleSubmenuSelect = (item: MenuItem) => {
    // convert 模式下禁止重复选择当前格式
    if (isCurrentItem(item)) return

    const focusId = onSelect(blockMenuItemTarget(item))

    onOpenChange(false)
    setTimeout(() => focusEditableBlock(focusId, "end"), 0)
  }

  /** convert 模式：点击主菜单"删除"项 */
  const handleDelete = () => {
    if (!onDelete) return
    const focusId = onDelete()
    onOpenChange(false)
    if (focusId) {
      setTimeout(() => focusEditableBlock(focusId, "end"), 0)
    }
  }

  /** convert 模式：点击主菜单"创建副本"项 */
  const handleDuplicate = () => {
    if (!onDuplicate) return
    const focusId = onDuplicate()
    onOpenChange(false)
    if (focusId) {
      setTimeout(() => focusEditableBlock(focusId, "end"), 0)
    }
  }

  /** 点击 / Enter "转换成"主菜单项：展开子菜单并定位焦点 */
  const openSubmenu = () => {
    setSubmenuStyle(computeSubmenuStyle())
    setSubmenuOpen(true)
  }

  /** 关闭子菜单并把焦点归还到"转换成"按钮（用于子菜单 Escape） */
  const closeSubmenu = useCallback(() => {
    setSubmenuOpen(false)
    convertButtonRef.current?.focus()
  }, [])

  // 主菜单打开时：add 模式聚焦容器，convert 模式聚焦第一项
  useEffect(() => {
    if (!open) return

    // 主菜单显示后修正 top，避免越界
    const menu = menuRef.current
    if (menu) {
      const rect = menu.getBoundingClientRect()
      const top = Math.min(
        Math.max(rect.top, HANDLE_MENU_GAP),
        Math.max(HANDLE_MENU_GAP, window.innerHeight - rect.height - HANDLE_MENU_GAP)
      )
      if (top !== rect.top) setMenuStyle((current) => ({ ...current, top }))
    }

    // add 模式：聚焦菜单容器，避免任一区块类型呈现为已选中
    // convert 模式：焦点落在主菜单第一项"转换成"
    if (mode === "add") {
      const timer = window.setTimeout(() => {
        menuRef.current?.focus()
      }, 0)
      return () => window.clearTimeout(timer)
    }

    // convert 模式：子菜单打开时复位（避免上次的子菜单状态泄漏）
    setSubmenuOpen(false)
    const timer = window.setTimeout(() => {
      mainItemRefs.current[CONVERT_MAIN_INDEX_CONVERT]?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, mode])

  // convert 模式下子菜单打开时聚焦容器，避免任一格式呈现为已选中
  useEffect(() => {
    if (!submenuOpen) return

    // 子菜单容器自身修正 top 越界
    const submenu = submenuRef.current
    if (submenu) {
      const rect = submenu.getBoundingClientRect()
      const top = Math.min(
        Math.max(rect.top, HANDLE_MENU_GAP),
        Math.max(HANDLE_MENU_GAP, window.innerHeight - rect.height - HANDLE_MENU_GAP)
      )
      if (top !== rect.top) {
        setSubmenuStyle((current) => ({ ...current, top }))
      }
    }

    const timer = window.setTimeout(() => {
      submenuRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [submenuOpen])

  // 菜单打开时：监听外部点击 / Escape / 滚动 / 窗口尺寸变化 → 关闭
  useEffect(() => {
    if (!open) return

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      // 点击 handle 自身：由 handleToggle 处理，不在此关闭
      if (handleRef.current?.contains(target)) return
      if (externalAnchorRef.current?.contains(target)) return
      // 点击主菜单内部：交给各 menuitem onClick 处理
      if (menuRef.current?.contains(target)) return
      // 点击子菜单内部：由子菜单项 onClick 处理
      if (submenuRef.current?.contains(target)) return
      onOpenChange(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()

      // convert 模式下子菜单打开时 Escape 仅关子菜单
      if (submenuOpen) {
        closeSubmenu()
        return
      }

      // 其它情况关主菜单并把焦点给 handle
      onOpenChange(false)
      const externalAnchor = externalAnchorRef.current
      if (externalAnchor?.isConnected) {
        externalAnchor.focus()
      } else {
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
  }, [open, onOpenChange, submenuOpen, closeSubmenu])

  /** 主菜单容器键盘导航：↑/↓ 在主菜单项之间循环移动焦点（convert 3 项 / add 14+项） */
  const handleMainMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    // 子菜单状态由子菜单 onKeyDown 单独处理，避免与主菜单冲突
    event.preventDefault()

    const activeButton =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null
    const refs = mainItemRefs.current
    const currentIndex = refs.indexOf(activeButton)
    const count = refs.length
    if (count === 0) return

    const delta = event.key === "ArrowDown" ? 1 : -1
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + delta + count) % count
    refs[nextIndex]?.focus()
  }

  /** 子菜单容器键盘导航：↑/↓ 在子菜单项之间循环移动焦点 */
  const handleSubmenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()

    const activeButton =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null
    const refs = subItemRefs.current
    const currentIndex = refs.indexOf(activeButton)
    const count = refs.length
    if (count === 0) return

    const delta = event.key === "ArrowDown" ? 1 : -1
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + delta + count) % count
    refs[nextIndex]?.focus()
  }

  /** Enter / Space 在"转换成"主菜单项上展开子菜单（避免上箭头等键误触） */
  const handleConvertMainItemKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return
    // 让 button 的 onClick 自然处理 Enter/Space，不重复触发；这里保留 hook 以便扩展
  }

  // ===== 渲染 =====

  const currentLabel = blockKindLabel(kind, headingLevel)
  const handleAriaLabel =
    mode === "convert"
      ? `更改区块格式，当前为${currentLabel}`
      : "在当前区块下方插入新行"

  // 渲染子菜单：仅 convert 模式且 submenuOpen 时挂载。子菜单内容固定为原
  // blockMenuItems + 可选 PictureUploadMenuItem。
  const renderSubmenu = () => {
    if (!submenuOpen) return null
    return (
      <div
        ref={submenuRef}
        className="hn-note-block-menu hn-note-block-menu-submenu"
        role="menu"
        aria-label="转换成"
        tabIndex={-1}
        style={submenuStyle}
        onKeyDown={handleSubmenuKeyDown}
      >
        {blockMenuItems.map((item, index) => {
          const isCurrent = isCurrentItem(item)
          return (
            <button
              key={item.label}
              ref={(el) => {
                subItemRefs.current[index] = el
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
              onClick={() => handleSubmenuSelect(item)}
            >
              {/* 文字标签在前，占满剩余宽度（flex:1），把右侧对勾推到行末右对齐 */}
              <span className="hn-note-block-menu-item-label">{item.label}</span>
              {isCurrent ? (
                <span className="hn-note-block-menu-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          )
        })}
        {onPictureUpload ? (
          <PictureUploadMenuItem
            buttonRef={(element) => {
              subItemRefs.current[blockMenuItems.length] = element
            }}
            onPictureUpload={onPictureUpload}
          />
        ) : null}
      </div>
    )
  }

  // 主菜单 DOM：add 模式 = 扁平列表（保持历史），convert 模式 = 三项主菜单 + 子菜单浮层
  const menu = open ? (
    <>
      <div
        ref={menuRef}
        className="hn-note-block-menu"
        role="menu"
        aria-label={mode === "convert" ? "区块格式选项" : "插入新区块类型"}
        tabIndex={mode === "add" ? -1 : undefined}
        style={menuStyle}
        onKeyDown={handleMainMenuKeyDown}
      >
        {mode === "convert" ? (
          <>
            {/* 主菜单项 1：转换成 → 展开右上角子菜单 */}
            <button
              ref={(el) => {
                mainItemRefs.current[CONVERT_MAIN_INDEX_CONVERT] = el
                convertButtonRef.current = el
              }}
              type="button"
              role="menuitem"
              className="hn-note-block-menu-item hn-note-block-menu-item--has-submenu"
              aria-haspopup="menu"
              aria-expanded={submenuOpen}
              tabIndex={-1}
              onClick={openSubmenu}
              onKeyDown={handleConvertMainItemKeyDown}
            >
              <span className="hn-note-block-menu-item-label">转换成</span>
              <span
                className="hn-note-block-menu-submenu-arrow"
                aria-hidden="true"
              >
                ›
              </span>
            </button>
            {/* 主菜单项 2：删除（red danger 风格） */}
            <button
              ref={(el) => {
                mainItemRefs.current[CONVERT_MAIN_INDEX_DELETE] = el
              }}
              type="button"
              role="menuitem"
              className="hn-note-block-menu-item hn-note-block-menu-item--danger"
              tabIndex={-1}
              onClick={handleDelete}
            >
              <span className="hn-note-block-menu-item-label">删除</span>
            </button>
            {/* 主菜单项 3：创建副本 */}
            <button
              ref={(el) => {
                mainItemRefs.current[CONVERT_MAIN_INDEX_DUPLICATE] = el
              }}
              type="button"
              role="menuitem"
              className="hn-note-block-menu-item"
              tabIndex={-1}
              onClick={handleDuplicate}
            >
              <span className="hn-note-block-menu-item-label">创建副本</span>
            </button>
          </>
        ) : (
          // ===== add 模式：扁平 blockMenuItems 列表（与历史完全一致） =====
          blockMenuItems.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => {
                mainItemRefs.current[index] = el
              }}
              type="button"
              role="menuitem"
              className={[
                "hn-note-block-menu-item",
                // add 模式无需标记当前项
                ""
              ]
                .filter(Boolean)
                .join(" ")}
              tabIndex={-1}
              onClick={() => {
                const focusId = onSelect(blockMenuItemTarget(item))
                onOpenChange(false)
                setTimeout(() => focusEditableBlock(focusId, "end"), 0)
              }}
            >
              <span className="hn-note-block-menu-item-label">{item.label}</span>
            </button>
          ))
        )}
      </div>
      {/* 子菜单浮层：convert 模式且展开时挂载到 document.body */}
      {mode === "convert" ? createPortal(renderSubmenu(), document.body) : null}
    </>
  ) : null

  // 菜单关闭时重置内部子菜单状态，避免下次打开残留展开
  useEffect(() => {
    if (!open && submenuOpen) setSubmenuOpen(false)
  }, [open, submenuOpen])

  // 限制 mainItemRefs 数组只在打开期间生长，避免 add 模式与 convert 模式互相残留
  useEffect(() => {
    if (!open) {
      mainItemRefs.current = []
      subItemRefs.current = []
    }
  }, [open])

  return (
    <>
      <button
        ref={setHandleNode}
        type="button"
        className={[
          "hn-note-block-handle",
          `hn-note-block-handle--${mode}`,
          open ? "hn-note-block-handle--open" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={handleAriaLabel}
        data-block-id={blockId}
        data-block-menu-mode={mode}
        onClick={() => {
          externalAnchorRef.current = null
          handleToggle()
        }}
      >
        <span
          className={
            mode === "convert" ? "hn-note-block-handle-glyph" : undefined
          }
          aria-hidden="true"
        >
          {mode === "convert" ? "⋮⋮" : "+"}
        </span>
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
