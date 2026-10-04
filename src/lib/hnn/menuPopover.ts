/**
 * 锚定菜单 popover（DESIGN.md §9 块菜单 / §10 表格行列操作菜单共用的内部基础组件）。
 *
 * - 语义：容器 role="menu" + 可访问名称；条目为 role="menuitem" 的原生 button，
 *   roving tabindex 管理焦点（ArrowUp/ArrowDown 循环、Home/End 跳首尾，禁用项跳过），
 *   打开即聚焦首个可用条目，无需鼠标即可完成全部操作。
 * - 关闭路径全集：Escape（焦点归还锚点）、菜单外 pointerdown、window scroll/resize、
 *   Tab 移出、条目执行完成；所有路径只走一个 close 出口，onClose 恰好回调一次。
 *   例外：菜单被限高后的内部滚动是到达条目的唯一途径，不触发关闭（按事件目标区分）。
 * - 两步确认条目（confirmLabel，DESIGN.md §10 in-menu two-step）：首次激活只切换为
 *   确认文案（不执行、不关闭），再次激活才执行并关闭；焦点离开该条目或菜单因任何
 *   原因关闭即复位——“关闭即取消确认”。
 * - 定位：fixed 贴锚点，水平方向收进视口；量出菜单实际高度后决定垂直朝向——优先
 *   锚点下方，下方放不下且上方更宽则翻转到锚点上方，两侧都不够（视口过短）则限高
 *   + 内部滚动保证全部条目可达。菜单挂到锚点最近的 .hn-editor 根内，随宿主
 *   light/dark 主题类联动，不引入任何新依赖。
 */

/** 普通菜单条目；"divider" 字面量渲染为分隔线（role="separator"）。 */
export interface AnchoredMenuItem {
  readonly label: string
  /** 危险操作样式（DESIGN.md §10 红色删除项）。 */
  readonly danger?: boolean
  readonly disabled?: boolean
  /** 禁用原因：落到 title/aria，向用户解释而不是静默不可点。 */
  readonly disabledReason?: string
  /** 提供则启用 in-menu 两步确认：首次激活切到该文案，再次激活才执行。 */
  readonly confirmLabel?: string
  readonly onActivate?: () => void
}

export type AnchoredMenuEntry = AnchoredMenuItem | "divider"

export interface OpenAnchoredMenuOptions {
  /** 定位与焦点归还的锚点元素。 */
  readonly anchor: HTMLElement
  readonly items: readonly AnchoredMenuEntry[]
  /** 菜单容器的 aria-label。 */
  readonly ariaLabel: string
  /** 菜单因任何原因关闭后恰好调用一次（含 Esc/外部点击/滚动/执行完成）。 */
  readonly onClose?: () => void
}

export interface AnchoredMenuHandle {
  /** restoreFocus 为 true 时把焦点归还锚点（Esc 路径）；默认 false。 */
  close(restoreFocus?: boolean): void
  readonly element: HTMLElement
}

/** 锚点与菜单之间的垂直间距（px）。 */
const ANCHOR_GAP = 4

/** 菜单与视口边缘的最小距离（px）：翻转/钳制计算统一预留。 */
const VIEWPORT_MARGIN = 8

/** 视口过短限高时挂的类：启用内部滚动（styles.css 的 .hn-editor-menu--scroll）。 */
const MENU_SCROLL_CLASS = "hn-editor-menu--scroll"

export function openAnchoredMenu(options: OpenAnchoredMenuOptions): AnchoredMenuHandle {
  const { anchor, items, ariaLabel, onClose } = options

  const element = document.createElement("div")
  element.className = "hn-editor-menu"
  element.setAttribute("role", "menu")
  element.setAttribute("aria-label", ariaLabel)

  // 条目按钮与条目定义平行对齐（divider 只占 DOM 不进数组，避免索引空洞）；
  // 确认态只挂在一个条目上。
  const buttons: HTMLButtonElement[] = []
  const buttonItems: AnchoredMenuItem[] = []
  let confirmingIndex: number | null = null

  const clearConfirm = (): void => {
    if (confirmingIndex === null) return
    const index = confirmingIndex
    confirmingIndex = null
    const item = buttonItems[index]
    if (item) {
      buttons[index]!.textContent = item.label
      buttons[index]!.classList.remove("is-confirming")
    }
  }

  /** roving 焦点：从 from 出发沿 direction 找下一个可用条目（禁用项跳过）。 */
  const moveFocus = (from: number, direction: 1 | -1): void => {
    if (buttons.length === 0) return
    let index = from
    for (let attempts = 0; attempts < buttons.length; attempts++) {
      index = (index + direction + buttons.length) % buttons.length
      if (!buttons[index]!.disabled) {
        buttons.forEach((button, i) => button.setAttribute("tabindex", i === index ? "0" : "-1"))
        buttons[index]!.focus()
        return
      }
    }
  }

  const activate = (index: number): void => {
    const item = buttonItems[index]
    if (!item || item.disabled) return
    // 两步确认：首次只进入确认态，焦点留在原条目上等待第二次激活。
    if (item.confirmLabel !== undefined && confirmingIndex !== index) {
      clearConfirm()
      confirmingIndex = index
      buttons[index]!.textContent = item.confirmLabel
      buttons[index]!.classList.add("is-confirming")
      return
    }
    clearConfirm()
    close(false)
    item.onActivate?.()
  }

  items.forEach((entry) => {
    if (entry === "divider") {
      const divider = document.createElement("div")
      divider.className = "hn-editor-menu-divider"
      divider.setAttribute("role", "separator")
      element.appendChild(divider)
      return
    }
    const index = buttons.length
    const button = document.createElement("button")
    button.type = "button"
    button.className = "hn-editor-menu-item"
    if (entry.danger) button.classList.add("hn-editor-menu-item--danger")
    button.setAttribute("role", "menuitem")
    button.setAttribute("tabindex", "-1")
    button.textContent = entry.label
    if (entry.disabled) {
      button.disabled = true
      button.setAttribute("aria-disabled", "true")
      if (entry.disabledReason) button.title = entry.disabledReason
    }
    // mousedown 不夺走编辑器焦点；click 才激活，键盘 Enter/Space 走原生 click。
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", () => activate(index))
    button.addEventListener("focus", () => {
      if (confirmingIndex !== null && confirmingIndex !== index) clearConfirm()
    })
    buttons.push(button)
    buttonItems.push(entry)
    element.appendChild(button)
  })

  // 挂到锚点最近的 .hn-editor 根内：菜单样式与 light/dark 主题类随宿主联动。
  const host = anchor.closest(".hn-editor") ?? document.body
  host.appendChild(element)

  // 定位（bug-7.5-3 修复）：先挂进文档再量实际尺寸，然后一次算清水平钳制与
  // 垂直朝向。垂直优先锚点下方；下方放不下且上方更宽则翻转到锚点上方；
  // 两侧都不够（视口过短）则限高 + 内部滚动，全部条目保持可达。
  // （jsdom 下 rect/offset* 全 0：belowSpace 充足、走“贴锚点下缘”默认路径。）
  const anchorRect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const menuWidth = element.offsetWidth
  const menuHeight = element.offsetHeight

  let left = anchorRect.left
  if (left + menuWidth > viewportWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - menuWidth)
  }
  element.style.left = `${left}px`

  const belowSpace = viewportHeight - anchorRect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN
  const aboveSpace = anchorRect.top - ANCHOR_GAP - VIEWPORT_MARGIN
  const flip = menuHeight > belowSpace && aboveSpace > belowSpace
  const available = Math.max(flip ? aboveSpace : belowSpace, 0)
  if (menuHeight > available) {
    element.classList.add(MENU_SCROLL_CLASS)
    element.style.maxHeight = `${available}px`
  }
  const effectiveHeight = Math.min(menuHeight, available)
  const unclampedTop = flip ? anchorRect.top - ANCHOR_GAP - effectiveHeight : anchorRect.bottom + ANCHOR_GAP
  // 最终钳制：菜单整体（含翻转后）绝不越出视口上下缘。
  const top = Math.min(
    Math.max(unclampedTop, VIEWPORT_MARGIN),
    Math.max(viewportHeight - VIEWPORT_MARGIN - effectiveHeight, VIEWPORT_MARGIN)
  )
  element.style.top = `${top}px`

  let closed = false
  const close = (restoreFocus = false): void => {
    if (closed) return
    closed = true
    element.removeEventListener("keydown", onMenuKeyDown)
    document.removeEventListener("pointerdown", onDocumentPointerDown, true)
    window.removeEventListener("scroll", onWindowScroll, true)
    window.removeEventListener("resize", onWindowChange)
    element.remove()
    if (restoreFocus) anchor.focus({ preventScroll: true })
    onClose?.()
  }

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    const focused = buttons.findIndex((button) => button === document.activeElement)
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        moveFocus(focused, 1)
        return
      case "ArrowUp":
        event.preventDefault()
        moveFocus(focused, -1)
        return
      case "Home":
        event.preventDefault()
        moveFocus(-1, 1)
        return
      case "End":
        event.preventDefault()
        moveFocus(0, -1)
        return
      case "Escape":
        // 阻止冒泡到编辑器：Esc 只关闭菜单，焦点归还锚点。
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      case "Tab":
        // 不拦默认行为：焦点按自然顺序离开，菜单同步关闭。
        close(false)
        return
      default:
    }
  }
  const onDocumentPointerDown = (event: Event): void => {
    if (!(event.target instanceof window.Node)) return
    if (element.contains(event.target) || anchor.contains(event.target)) return
    close(false)
  }
  const onWindowChange = (): void => close(false)
  const onWindowScroll = (event: Event): void => {
    // 菜单限高后的内部滚动是到达条目的唯一途径：scroll 不冒泡，但 capture
    // 阶段能拿到真实滚动目标——目标在菜单内部则不关，外部滚动保持“滚动即关”。
    if (event.target instanceof window.Node && element.contains(event.target)) return
    close(false)
  }

  element.addEventListener("keydown", onMenuKeyDown)
  document.addEventListener("pointerdown", onDocumentPointerDown, true)
  window.addEventListener("scroll", onWindowScroll, true)
  window.addEventListener("resize", onWindowChange)

  // 打开即聚焦首个可用条目：键盘用户无需额外按键即可操作。
  moveFocus(-1, 1)

  return { close, element }
}
