import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement
} from "react"
import { createPortal } from "react-dom"
import type { Editor } from "@tiptap/core"
import type { HostReferenceInstaller } from "./hostReferences"
import {
  createHostReferenceInteractions,
  type HostReferenceInteractionState,
  type HostReferenceInteractions
} from "./hostReferenceInteractions"
import type { HostCandidateState } from "./types"
import "./HostReferenceUI.css"

/**
 * 7.2 宿主引用候选菜单（mention/resource）。
 * - 触发/键盘/取消/精确替换等交互全部在 headless 交互桥（hostReferenceInteractions）
 *   中实现；本组件只负责渲染候选浮层与把点击选择转交桥；
 * - 视觉遵 DESIGN.md §14：fixed 定位于光标下方的 listbox，沿用现有桌面 popover 表面
 *   （#1e293b、10px 圆角、阴影、0.12s 透明度淡入），不引入新色板或动效语言；
 * - 候选 pending/error/empty 以非交互状态行可观察呈现；选项 role=option +
 *   aria-selected，键盘高亮由桥驱动（focus 保留在编辑器）；
 * - pointerdown/mousedown preventDefault：点击候选不打断编辑器焦点与选区，
 *   存储的触发 range 不会在选中前丢失。
 */

export type HostReferenceUIProps = Readonly<{
  editor: Editor
  /** 由接线层（NoteEditor）随会话创建/销毁的宿主引用 installer。 */
  installer: HostReferenceInstaller
  className?: string
}>

const IDLE_INTERACTION: HostReferenceInteractionState = Object.freeze({ trigger: null, activeIndex: 0 })
const noopSubscribe = (): (() => void) => () => undefined

/** 与 CSS max-height: 18rem 对齐的菜单限高基准（px）。 */
const MENU_MAX_HEIGHT_PX = 288
/** 菜单距视口边缘的最小间距（与水平钳制的 12px 一致）。 */
const VIEWPORT_MARGIN_PX = 12
/** 菜单与光标行之间的垂直间隙。 */
const CARET_GAP_PX = 6

/** 光标坐标 → fixed 定位首帧回退值（只做水平钳制）；真实垂直定位由测量后重算。 */
function caretPosition(editor: Editor, pos: number): { left: number; top: number } {
  try {
    const coords = editor.view.coordsAtPos(pos)
    const maxLeft = Math.max(12, window.innerWidth - 272)
    return { left: Math.max(12, Math.min(coords.left, maxLeft)), top: coords.bottom + CARET_GAP_PX }
  } catch {
    return { left: 12, top: 12 }
  }
}

interface MenuPlacement {
  readonly left: number
  readonly top: number
  readonly maxHeight: number
}

/**
 * 光标坐标 + 菜单内容高 → 最终 fixed 定位（PR#11-#19）：
 * 垂直优先光标下方；下方放不下且上方更宽则翻转到光标上方；两侧都不够则限高 +
 * 菜单内部滚动，整体绝不越出视口上下缘（与 menuPopover bug-7.5-3 同策）。
 * 水平沿用既有 12px 钳制；jsdom/异常回退左上角安全值。
 */
function computeMenuPlacement(editor: Editor, pos: number, contentHeight: number): MenuPlacement {
  try {
    const coords = editor.view.coordsAtPos(pos)
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - 272)
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(coords.left, maxLeft))
    const belowSpace = window.innerHeight - coords.bottom - CARET_GAP_PX - VIEWPORT_MARGIN_PX
    const aboveSpace = coords.top - CARET_GAP_PX - VIEWPORT_MARGIN_PX
    const flip = contentHeight > belowSpace && aboveSpace > belowSpace
    const available = Math.max(flip ? aboveSpace : belowSpace, 0)
    const maxHeight = Math.min(MENU_MAX_HEIGHT_PX, available)
    const effectiveHeight = Math.min(contentHeight, maxHeight)
    const unclampedTop = flip ? coords.top - CARET_GAP_PX - effectiveHeight : coords.bottom + CARET_GAP_PX
    // 最终钳制：菜单整体（含翻转后）绝不越出视口上下缘。
    const top = Math.min(
      Math.max(unclampedTop, VIEWPORT_MARGIN_PX),
      Math.max(window.innerHeight - VIEWPORT_MARGIN_PX - effectiveHeight, VIEWPORT_MARGIN_PX)
    )
    return { left, top, maxHeight }
  } catch {
    return { left: VIEWPORT_MARGIN_PX, top: VIEWPORT_MARGIN_PX, maxHeight: MENU_MAX_HEIGHT_PX }
  }
}

function statusText(status: HostCandidateState["status"]): string {
  switch (status) {
    case "error":
      return "加载失败"
    case "empty":
      return "无匹配结果"
    default:
      return "正在搜索…"
  }
}

export function HostReferenceUI(props: HostReferenceUIProps): ReactElement | null {
  const { editor, installer } = props
  // 桥随 editor/installer 身份重建；接线层按 sessionKey remount 时整体随卸载销毁。
  // useLayoutEffect：session 切换时旧桥在 commit 阶段同步销毁（先于 paint 与新一帧
  // 交互），不留旧 document capture 监听拦截旧编辑器按键的窗口；destroy 幂等。
  const [bridge, setBridge] = useState<HostReferenceInteractions | null>(null)
  useLayoutEffect(() => {
    const created = createHostReferenceInteractions(editor, installer)
    setBridge(created)
    return () => created.destroy()
  }, [editor, installer])

  const subscribeInteraction = useCallback(
    (listener: () => void) => (bridge ? bridge.subscribe(listener) : noopSubscribe()),
    [bridge]
  )
  const getInteraction = useCallback(
    () => bridge?.getState() ?? IDLE_INTERACTION,
    [bridge]
  )
  const interaction = useSyncExternalStore(subscribeInteraction, getInteraction, () => IDLE_INTERACTION)

  const subscribeCandidates = useCallback(
    (listener: () => void) => installer.subscribeCandidates(() => listener()),
    [installer]
  )
  const getCandidates = useCallback(() => installer.getCandidateState(), [installer])
  const candidateState = useSyncExternalStore(subscribeCandidates, getCandidates, getCandidates)

  // 菜单打开期间跟随滚动/缩放重算 fixed 位置，避免浮层停滞在旧坐标。
  const open = interaction.trigger !== null
  const [positionTick, setPositionTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const bump = (): void => setPositionTick((tick) => tick + 1)
    window.addEventListener("scroll", bump, true)
    window.addEventListener("resize", bump)
    return () => {
      window.removeEventListener("scroll", bump, true)
      window.removeEventListener("resize", bump)
    }
  }, [open])

  const trigger = interaction.trigger
  const items = trigger && candidateState.status === "ready" && candidateState.kind === trigger.kind ? candidateState.items : []
  const active = items.length > 0 ? Math.min(interaction.activeIndex, items.length - 1) : -1

  const menuRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)

  // 定位（PR#11-#19）：渲染后量真实内容高，一次算清水平钳制 + 垂直翻转/限高。
  // useLayoutEffect 在 paint 前完成，无可见跳动；值未变时不 setState（防自激）。
  // 打开/换触发位/候选数与状态变化/滚动缩放后重算，响应式与内部滚动设计不变。
  useLayoutEffect(() => {
    if (!trigger) {
      setPlacement(null)
      return
    }
    const menu = menuRef.current
    if (!menu) return
    const next = computeMenuPlacement(editor, trigger.from, menu.scrollHeight)
    setPlacement((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight ? prev : next
    )
  }, [editor, trigger, items.length, candidateState.status, positionTick])

  // 键盘高亮跟随（PR#11-#20）：只滚菜单自身——手动 scrollTop，不用
  // scrollIntoView（它会连带滚动外层容器乃至整页）；焦点始终留在编辑器。
  // 无选项（pending/empty/error）时不触碰 scrollTop，loading 切换不跳动。
  useLayoutEffect(() => {
    if (!bridge || active < 0) return
    const menu = menuRef.current
    if (!menu) return
    const option = menu.querySelector<HTMLElement>(`#${bridge.optionId(active)}`)
    if (!option) return
    const optionTop = option.offsetTop
    const optionBottom = optionTop + option.offsetHeight
    if (optionTop < menu.scrollTop) {
      menu.scrollTop = optionTop
    } else if (optionBottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = optionBottom - menu.clientHeight
    }
  }, [bridge, active, items.length])

  if (!bridge || !trigger) return null

  const fallback = caretPosition(editor, trigger.from)
  const style: CSSProperties = placement
    ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
    : { left: fallback.left, top: fallback.top }
  const menuClass = props.className ? `hn-reference-menu ${props.className}` : "hn-reference-menu"

  return createPortal(
    // 点击候选 preserve 编辑器 caret：阻止 pointer/mouse 默认行为，编辑器不 blur、选区不动。
    <div
      ref={menuRef}
      className={menuClass}
      role="listbox"
      id={bridge.menuId}
      aria-label={trigger.kind === "mention" ? "提及候选" : "资源候选"}
      style={style}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length === 0 ? (
        <div className="hn-reference-empty" role="status">
          {statusText(candidateState.status)}
        </div>
      ) : (
        items.map((candidate, index) => (
          <div
            key={candidate.resourceId}
            id={bridge.optionId(index)}
            role="option"
            aria-selected={index === active}
            className="hn-reference-option"
            onClick={() => bridge.selectCandidate(candidate)}
          >
            {trigger.kind === "mention" && (
              <span className="hn-reference-option-mark" aria-hidden="true">
                @
              </span>
            )}
            <span>{candidate.name}</span>
          </div>
        ))
      )}
    </div>,
    document.body
  )
}
