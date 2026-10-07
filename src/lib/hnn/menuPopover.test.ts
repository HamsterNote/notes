// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { openAnchoredMenu, type AnchoredMenuHandle } from "./menuPopover"

/** 每个用例一个挂进 document 的锚点按钮；菜单应挂到最近的 .hn-editor 根内。 */
let host: HTMLElement
let anchor: HTMLButtonElement

beforeEach(() => {
  host = document.createElement("div")
  host.className = "hn-editor"
  anchor = document.createElement("button")
  anchor.textContent = "anchor"
  host.appendChild(anchor)
  document.body.appendChild(host)
  anchor.focus()
})

afterEach(() => {
  host.remove()
  document.body.innerHTML = ""
})

function keydown(target: EventTarget, key: string): void {
  target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
}

function openMenu(onClose?: () => void): { handle: AnchoredMenuHandle; acts: string[] } {
  const acts: string[] = []
  const handle = openAnchoredMenu({
    anchor,
    ariaLabel: "测试菜单",
    // exactOptionalPropertyTypes：未传 onClose 时属性整体缺省，而不是显式 undefined。
    ...(onClose ? { onClose } : {}),
    items: [
      { label: "动作一", onActivate: () => acts.push("one") },
      "divider",
      { label: "禁用项", disabled: true, disabledReason: "不可用原因" },
      { label: "动作二", onActivate: () => acts.push("two") },
      { label: "删除", danger: true, confirmLabel: "确认删除", onActivate: () => acts.push("del") }
    ]
  })
  return { handle, acts }
}

function menuElement(): HTMLElement {
  const element = host.querySelector<HTMLElement>(".hn-editor-menu")
  expect(element).not.toBeNull()
  return element!
}

function items(): HTMLButtonElement[] {
  return Array.from(menuElement().querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
}

describe("menuPopover：结构与语义", () => {
  it("渲染 role=menu + 可访问名称，条目为 role=menuitem，分隔线 role=separator", () => {
    openMenu()
    expect(menuElement().getAttribute("role")).toBe("menu")
    expect(menuElement().getAttribute("aria-label")).toBe("测试菜单")
    expect(items().map((b) => b.textContent)).toEqual(["动作一", "禁用项", "动作二", "删除"])
    expect(menuElement().querySelector('[role="separator"]')).not.toBeNull()
  })

  it("打开即聚焦首个可用条目，roving tabindex：其余条目 tabindex=-1", () => {
    openMenu()
    expect(document.activeElement).toBe(items()[0])
    expect(items()[0]!.getAttribute("tabindex")).toBe("0")
    expect(items()[1]!.getAttribute("tabindex")).toBe("-1")
    // 禁用项原生 disabled 且带原因说明，不静默不可点
    expect(items()[1]!.disabled).toBe(true)
    expect(items()[1]!.title).toBe("不可用原因")
  })

  it("ArrowDown/Up 循环移动并跳过禁用项；Home/End 跳首尾", () => {
    openMenu()
    const list = items()
    keydown(menuElement(), "ArrowDown") // 跳过禁用项落到动作二
    expect(document.activeElement).toBe(list[2])
    keydown(menuElement(), "ArrowDown")
    expect(document.activeElement).toBe(list[3])
    keydown(menuElement(), "ArrowDown") // 循环回首个
    expect(document.activeElement).toBe(list[0])
    keydown(menuElement(), "ArrowUp") // 反向循环到末项
    expect(document.activeElement).toBe(list[3])
    keydown(menuElement(), "Home")
    expect(document.activeElement).toBe(list[0])
    keydown(menuElement(), "End")
    expect(document.activeElement).toBe(list[3])
  })
})

describe("menuPopover：激活与两步确认", () => {
  it("点击条目执行并关闭，onClose 恰好一次", () => {
    const onClose = vi.fn()
    const { acts } = openMenu(onClose)
    items()[2]!.click()
    expect(acts).toEqual(["two"])
    expect(host.querySelector(".hn-editor-menu")).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("confirmLabel 条目：首次激活只切确认文案不执行，再次激活才执行并关闭", () => {
    const { acts } = openMenu()
    const danger = items()[3]!
    danger.click()
    // 首次：进入确认态，菜单保持打开，动作未执行
    expect(danger.textContent).toBe("确认删除")
    expect(danger.classList.contains("is-confirming")).toBe(true)
    expect(host.querySelector(".hn-editor-menu")).not.toBeNull()
    expect(acts).toEqual([])
    // 再次：执行并关闭
    danger.click()
    expect(acts).toEqual(["del"])
    expect(host.querySelector(".hn-editor-menu")).toBeNull()
  })

  it("焦点离开确认条目即复位确认态（关闭即取消的延伸）", () => {
    const { acts } = openMenu()
    const list = items()
    list[3]!.focus() // 键盘路径：先聚焦危险项
    list[3]!.click() // arm
    expect(list[3]!.classList.contains("is-confirming")).toBe(true)
    list[0]!.focus() // 焦点移走 → 复位
    expect(list[3]!.textContent).toBe("删除")
    expect(list[3]!.classList.contains("is-confirming")).toBe(false)
    expect(acts).toEqual([])
  })
})

describe("menuPopover：关闭路径全集", () => {
  it("Escape 关闭并把焦点归还锚点", () => {
    const onClose = vi.fn()
    openMenu(onClose)
    keydown(menuElement(), "Escape")
    expect(host.querySelector(".hn-editor-menu")).toBeNull()
    expect(document.activeElement).toBe(anchor)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("菜单外 pointerdown 关闭；菜单内/锚点上不关闭", () => {
    openMenu()
    document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    expect(host.querySelector(".hn-editor-menu")).toBeNull()

    openMenu()
    menuElement().dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    expect(host.querySelector(".hn-editor-menu")).not.toBeNull()
  })

  it("window scroll（capture，嵌套滚动也覆盖）与 resize 关闭", () => {
    openMenu()
    window.dispatchEvent(new window.Event("scroll"))
    expect(host.querySelector(".hn-editor-menu")).toBeNull()

    openMenu()
    window.dispatchEvent(new window.Event("resize"))
    expect(host.querySelector(".hn-editor-menu")).toBeNull()
  })

  it("Tab 关闭但不拦默认行为（焦点按自然顺序离开）", () => {
    openMenu()
    const event = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    menuElement().dispatchEvent(event)
    expect(host.querySelector(".hn-editor-menu")).toBeNull()
    expect(event.defaultPrevented).toBe(false)
  })

  it("handle.close 幂等：重复调用只关闭一次", () => {
    const onClose = vi.fn()
    const { handle } = openMenu(onClose)
    handle.close(false)
    handle.close(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(host.querySelector(".hn-editor-menu")).toBeNull()
  })
})

describe("menuPopover：底部溢出定位（bug-7.5-3 回归）", () => {
  const VIEW_W = 1280
  const VIEW_H = 900
  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight

  /** jsdom 无布局：锚点矩形与菜单尺寸全部打桩（offset* 只认菜单元素）。 */
  function stubLayout(
    anchorRect: { top: number; bottom: number; left: number },
    menu: { width: number; height: number }
  ): void {
    anchor.getBoundingClientRect = () =>
      ({
        top: anchorRect.top,
        bottom: anchorRect.bottom,
        left: anchorRect.left,
        right: anchorRect.left + 200,
        width: 200,
        height: anchorRect.bottom - anchorRect.top,
        x: anchorRect.left,
        y: anchorRect.top,
        toJSON: () => ({})
      })
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList?.contains("hn-editor-menu") ? menu.height : 0
    })
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList?.contains("hn-editor-menu") ? menu.width : 0
    })
    Object.defineProperty(window, "innerWidth", { value: VIEW_W, configurable: true })
    Object.defineProperty(window, "innerHeight", { value: VIEW_H, configurable: true })
  }

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true })
    Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true })
  })

  it("下方放不下且上方更宽：翻转到锚点上方，不出现限高，菜单完整落在视口内", () => {
    // 视口高 900：锚点贴底（770-800），菜单高 364（= 实测块菜单高度）。
    stubLayout({ top: 770, bottom: 800, left: 100 }, { width: 200, height: 364 })
    openMenu()
    const menu = menuElement()
    // belowSpace = 900-800-4-8 = 88 < 364；aboveSpace = 770-4-8 = 758 ≥ 364 → 翻转
    expect(menu.style.top).toBe("402px") // 770 - 4 - 364
    expect(menu.classList.contains("hn-editor-menu--scroll")).toBe(false)
    expect(menu.style.maxHeight).toBe("")
    // 菜单底缘 402+364=766 ≤ 视口高-8：完整可见
    expect(402 + 364).toBeLessThanOrEqual(VIEW_H - 8)
  })

  it("两侧都放不下（菜单比任何一侧都高）：贴更宽一侧限高 + 内部滚动，顶缘钳进视口", () => {
    stubLayout({ top: 770, bottom: 800, left: 100 }, { width: 200, height: 900 })
    openMenu()
    const menu = menuElement()
    expect(menu.classList.contains("hn-editor-menu--scroll")).toBe(true)
    expect(menu.style.maxHeight).toBe("758px") // aboveSpace 更宽 → 限高 758
    expect(menu.style.top).toBe("8px") // 770-4-758=8，恰为上边距钳制值
  })

  it("下方充足：保持贴锚点下缘的默认路径（不翻转、不限高）", () => {
    stubLayout({ top: 100, bottom: 130, left: 100 }, { width: 200, height: 121 })
    openMenu()
    const menu = menuElement()
    expect(menu.style.top).toBe("134px") // 130 + 4
    expect(menu.classList.contains("hn-editor-menu--scroll")).toBe(false)
  })

  it("菜单内部滚动不触发关闭；菜单外滚动与 resize 仍关闭", () => {
    stubLayout({ top: 770, bottom: 800, left: 100 }, { width: 200, height: 900 })
    openMenu()
    const menu = menuElement()
    // 内部滚动（scroll 不冒泡，但 capture 监听拿到的 target 是菜单自身）
    menu.dispatchEvent(new window.Event("scroll", { bubbles: true }))
    expect(host.querySelector(".hn-editor-menu")).not.toBeNull()
    // 菜单内条目上滚动同样豁免
    menu.querySelector("button")!.dispatchEvent(new window.Event("scroll", { bubbles: true }))
    expect(host.querySelector(".hn-editor-menu")).not.toBeNull()
    // 外部滚动（编辑区/窗口）保持“滚动即关”
    document.body.dispatchEvent(new window.Event("scroll", { bubbles: true }))
    expect(host.querySelector(".hn-editor-menu")).toBeNull()

    openMenu()
    window.dispatchEvent(new window.Event("resize"))
    expect(host.querySelector(".hn-editor-menu")).toBeNull()
  })
})
