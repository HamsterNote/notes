import type { Editor } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import type { AnchoredMenuItem } from "../hnn/menuPopover"
import { getBlockCommands, type BlockMenuCapabilities } from "./blockMenu"
import { editorLayout } from "./interactionLayout"
import { TEXT_FORMATS, textFormatState, toggleTextFormat } from "./textFormatting"
import { indentList, isList, listConversionItems, listIndentCandidate, resolveListTarget } from "./listCommands"
import { openLinkEditor, resolveLinkTarget } from "./linkEditing"

/** Per-view ephemeral UI. Never restores an old range or writes the document on show. */
export function installInteractionToolbar(editor: Editor, capabilities: BlockMenuCapabilities): () => void {
  const view = editor.view
  const layout = editorLayout()
  const key = new PluginKey("hnnInteractionToolbar")
  const element = document.createElement("div")
  element.className = "hn-editor-interaction-toolbar"
  element.setAttribute("role", "toolbar")
  element.setAttribute("aria-label", "文字与块操作")
  element.hidden = true
  let disposed = false
  let suppressed = false
  let escaped = false
  let selecting = false
  let dragging = false
  let composing = false
  let expanded: "convert" | "insert" | null = null
  let previousSelection = view.state.selection
  let previousBlock: unknown
  let previousDoc = view.state.doc
  let renderedState: typeof view.state | null = null
  let renderedMobile: boolean | null = null
  let frame: number | null = null
  let closeLinkEditor: (() => void) | null = null

  const ownsFocus = () => view.hasFocus() || element.contains(document.activeElement)
  const hide = () => { element.hidden = true }
  const suppress = (escape = false) => { suppressed = true; escaped = escape; expanded = null; hide() }
  const topBlock = () => {
    const { selection, doc } = view.state
    const pos = selection.$head.depth > 0 ? selection.$head.before(1) : selection.from
    const node = doc.nodeAt(pos)
    const dom = view.nodeDOM(pos)
    return node && dom instanceof HTMLElement ? { pos, node, dom } : null
  }
  const viewport = () => {
    const vv = window.visualViewport
    return { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0,
      width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight }
  }
  const position = (): void => {
    if (element.hidden) return
    const mobile = layout.isMobile()
    const block = topBlock()
    if (!block) { hide(); return }
    let rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">
    try {
      if (mobile) rect = block.dom.getBoundingClientRect()
      else {
        const { from, to } = view.state.selection
        const first = view.coordsAtPos(from)
        const last = view.coordsAtPos(to)
        rect = { left: Math.min(first.left, last.left), right: Math.max(first.right, last.right),
          top: Math.min(first.top, last.top), bottom: Math.max(first.bottom, last.bottom) }
      }
    } catch { hide(); return }
    const vp = viewport()
    // A scroll container may clip an anchor even while its rect is inside the window.
    let clipTop = vp.top, clipBottom = vp.top + vp.height
    let clipLeft = vp.left, clipRight = vp.left + vp.width
    for (let ancestor = block.dom.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor)
      const bounds = ancestor.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) {
        clipTop = Math.max(clipTop, bounds.top); clipBottom = Math.min(clipBottom, bounds.bottom)
      }
      if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) {
        clipLeft = Math.max(clipLeft, bounds.left); clipRight = Math.min(clipRight, bounds.right)
      }
    }
    if (rect.bottom <= clipTop || rect.top >= clipBottom || rect.right <= clipLeft || rect.left >= clipRight) {
      hide(); return
    }
    const leftEdge = vp.left + 8
    const rightEdge = vp.left + vp.width - 8
    const topEdge = vp.top + 8
    const bottomEdge = vp.top + vp.height - 8
    if (rect.bottom <= topEdge || rect.top >= bottomEdge || rect.right <= leftEdge || rect.left >= rightEdge) {
      hide(); return
    }
    element.style.maxWidth = `${Math.max(0, vp.width - 16)}px`
    element.style.maxHeight = `${Math.max(0, vp.height - 16)}px`
    const size = element.getBoundingClientRect()
    const below = bottomEdge - rect.bottom - 4
    const above = rect.top - topEdge - 4
    const flip = below < size.height && above > below
    const space = Math.max(0, flip ? above : below)
    element.style.maxHeight = `${Math.min(vp.height - 16, space)}px`
    const height = Math.min(size.height, space)
    if (height < 28) { hide(); return }
    element.style.left = `${Math.max(leftEdge, Math.min(rect.left, rightEdge - size.width))}px`
    element.style.top = `${flip ? rect.top - height - 4 : rect.bottom + 4}px`
    element.dataset["placement"] = flip ? "above" : "below"
  }
  const schedule = () => {
    if (!disposed && frame === null) frame = window.requestAnimationFrame(() => { frame = null; refresh() })
  }
  const render = (mobile: boolean, block: NonNullable<ReturnType<typeof topBlock>>): void => {
    const hadFocus = element.contains(document.activeElement)
    const focusLabel = hadFocus ? document.activeElement?.textContent : null
    element.replaceChildren()
    const captured = view.state
    const valid = () => !disposed && !editor.isDestroyed && view.editable && !view.composing && !composing &&
      ownsFocus() && captured.doc === view.state.doc && captured.selection.eq(view.state.selection)
    const row = document.createElement("div")
    row.className = "hn-editor-toolbar-row"
    element.appendChild(row)
    const add = (parent: HTMLElement, item: AnchoredMenuItem, pressed?: boolean, refocus = true) => {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = item.label
      button.disabled = !!item.disabled
      button.tabIndex = -1
      if (item.description) {
        button.title = item.description
        button.setAttribute("aria-description", item.description)
      }
      if (item.disabled && item.disabledReason) {
        button.title = item.disabledReason
        button.setAttribute("aria-description", item.disabledReason)
      }
      if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed))
      // Mouse interaction must not collapse the native selection or close the soft keyboard.
      button.addEventListener("mousedown", event => event.preventDefault())
      button.addEventListener("click", () => {
        if (!valid() || button.disabled) { suppress(); return }
        item.onActivate?.()
        if (!disposed && !editor.isDestroyed && view.editable) {
          if (refocus) view.focus()
          refresh(true)
        }
      })
      parent.appendChild(button)
    }
    const id: unknown = block.node.attrs["nodeId"]
    const commands = getBlockCommands(editor, () => {
      const current = topBlock()
      return current && current.node.attrs["nodeId"] === id ? current.pos : undefined
    }, capabilities, element)
    const listTarget = resolveListTarget(editor)
    const inList = [view.state.selection.$from, view.state.selection.$to].some($pos => {
      for (let depth = $pos.depth; depth > 0; depth--) if (isList($pos.node(depth))) return true
      return false
    })
    for (const [kind, label] of [["convert", "转换为"], ["insert", "插入"]] as const) {
      if (!mobile && kind === "insert") continue
      add(row, { label, onActivate: () => { expanded = expanded === kind ? null : kind } }, expanded === kind, false)
    }
    for (const format of TEXT_FORMATS) {
      const state = textFormatState(editor, format.name)
      add(row, { label: format.label, disabled: state.disabled, disabledReason: "当前选择不支持文字格式",
        onActivate: () => { toggleTextFormat(editor, format.name) } }, state.pressed)
    }
    add(row, { label: "链接", disabled: !resolveLinkTarget(editor), disabledReason: "请选择同一文本块的纯文字或单个链接",
      onActivate: () => {
        closeLinkEditor?.()
        const anchor = Array.from(row.querySelectorAll("button")).find(button => button.textContent === "链接")!
        closeLinkEditor = openLinkEditor(editor, anchor, () => { closeLinkEditor = null })
      } }, undefined, false)
    if (mobile && commands) for (const item of commands.moveItems) if (item !== "divider") add(row, item)
    if (listTarget && !listTarget.paragraphs) {
      for (const [lift, label] of [[false, "缩进"], [true, "反缩进"]] as const) {
        add(row, { label, disabled: !listIndentCandidate(editor, lift), disabledReason: "当前项不能调整层级",
          onActivate: () => { indentList(editor, lift) } })
      }
    }
    if (expanded && commands) {
      const subrow = document.createElement("div")
      subrow.className = "hn-editor-toolbar-row"
      subrow.setAttribute("aria-label", expanded === "convert" ? "转换选项" : "插入选项")
      element.appendChild(subrow)
      const entries = expanded === "convert"
        ? [...commands.conversionItems.filter(item => item !== "divider" &&
          !["转换为有序列表", "转换为无序列表", "转换为待办列表", ...(inList ? ["转换为正文"] : [])].includes(item.label)),
          ...listConversionItems(editor).filter(item => item.label !== "转换为正文" || inList)]
        : commands.insertItems
      for (const item of entries) {
        if (item === "divider") continue
        add(subrow, { ...item, label: item.label.replace(/^(转换为|插入)/u, ""), onActivate: () => {
          expanded = null
          item.onActivate?.()
        } })
      }
    }
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
    const current = buttons.find(button => button.textContent === focusLabel) ?? buttons[0]
    if (current) current.tabIndex = 0
    if (hadFocus) current?.focus({ preventScroll: true })
  }
  function refresh(force = false): void {
    if (disposed || editor.isDestroyed) return
    const block = topBlock()
    const selection = view.state.selection
    const blockId: unknown = block?.node.attrs["nodeId"]
    if (!selection.eq(previousSelection) || blockId !== previousBlock) {
      suppressed = false
      escaped = false
      expanded = null
    }
    if (previousDoc !== view.state.doc && element.contains(document.activeElement)) suppress()
    previousSelection = selection
    previousBlock = blockId
    previousDoc = view.state.doc
    const mobile = layout.isMobile()
    const text = selection instanceof TextSelection && !selection.empty &&
      TEXT_FORMATS.some(format => !textFormatState(editor, format.name).disabled)
    const listTarget = resolveListTarget(editor)
    // During a native focus transition activeElement is briefly body. Let focusin settle
    // before deciding whether the user left this editor + toolbar surface.
    if (!ownsFocus()) {
      queueMicrotask(() => { if (!disposed && !ownsFocus()) hide() })
      return
    }
    if (view.dom.hasAttribute("data-hnn-slash-open") || !view.editable || view.composing || composing || suppressed || selecting || dragging ||
        !block || (!mobile && !text && !resolveLinkTarget(editor)?.href && (!listTarget || listTarget.paragraphs))) { hide(); return }
    const parent = view.dom.closest(".hn-editor") ?? view.dom.parentElement
    if (parent && element.parentElement !== parent) parent.appendChild(element)
    if (force || renderedState !== view.state || renderedMobile !== mobile || element.childElementCount === 0) {
      render(mobile, block)
      renderedState = view.state
      renderedMobile = mobile
    }
    element.hidden = false
    position()
  }
  const onPointerDown = (event: Event) => {
    if (element.contains(event.target as Node)) return
    if (!view.dom.contains(event.target as Node)) { suppress(); return }
    if (!escaped) suppressed = false
    if (!layout.isMobile() && (event as PointerEvent).pointerType === "mouse") { selecting = true; hide() }
  }
  const onPointerEnd = () => { selecting = false; dragging = false; schedule() }
  const onDrag = () => { dragging = true; suppress() }
  const onCompositionStart = () => { composing = true; hide() }
  const onCompositionEnd = () => { composing = false; schedule() }
  const onFocus = () => { queueMicrotask(() => {
    if (!disposed && view.hasFocus() && !escaped) suppressed = false
    refresh()
  }) }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !element.hidden) {
      event.preventDefault()
      event.stopPropagation()
      suppress(true)
      view.focus()
      return
    }
    if (!element.contains(event.target as Node)) return
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
    let index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === "ArrowRight") index = (index + 1) % buttons.length
    else if (event.key === "ArrowLeft") index = (index - 1 + buttons.length) % buttons.length
    else if (event.key === "Home") index = 0
    else if (event.key === "End") index = buttons.length - 1
    else return // Native buttons handle Enter/Space.
    event.preventDefault()
    buttons.forEach((button, i) => { button.tabIndex = i === index ? 0 : -1 })
    buttons[index]?.focus({ preventScroll: true })
    buttons[index]?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }
  const onPopoverOpen = (event: Event) => {
    const root = view.dom.closest(".hn-editor") ?? view.dom.parentElement
    if (event.target !== root || (event as CustomEvent).detail !== "slash") return
    expanded = null
    closeLinkEditor?.()
    hide()
  }
  const onPopoverClose = (event: Event) => {
    const root = view.dom.closest(".hn-editor") ?? view.dom.parentElement
    if (event.target === root && (event as CustomEvent).detail === "slash") schedule()
  }
  document.addEventListener("hn-editor-popover-open", onPopoverOpen)
  document.addEventListener("hn-editor-popover-close", onPopoverClose)
  const removeLayout = layout.subscribe(() => {
    hide(); expanded = null; selecting = false; dragging = false; renderedMobile = null; refresh(true)
  })
  document.addEventListener("pointerdown", onPointerDown, true)
  document.addEventListener("pointerup", onPointerEnd)
  document.addEventListener("pointercancel", onPointerEnd)
  document.addEventListener("focusin", onFocus)
  document.addEventListener("focusout", onFocus)
  view.dom.addEventListener("hnn-reorder-start", onDrag)
  view.dom.addEventListener("compositionstart", onCompositionStart)
  view.dom.addEventListener("compositionend", onCompositionEnd)
  view.dom.addEventListener("keydown", onKeyDown, true)
  element.addEventListener("keydown", onKeyDown)
  window.addEventListener("scroll", schedule, true)
  window.addEventListener("resize", schedule)
  window.visualViewport?.addEventListener("resize", schedule)
  window.visualViewport?.addEventListener("scroll", schedule)
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule)
  observer?.observe(view.dom)
  editor.registerPlugin(new Plugin({ key, view: () => ({ update: () => refresh() }) }))
  return () => {
    document.removeEventListener("hn-editor-popover-open", onPopoverOpen)
    document.removeEventListener("hn-editor-popover-close", onPopoverClose)
    disposed = true
    closeLinkEditor?.()
    if (frame !== null) window.cancelAnimationFrame(frame)
    removeLayout()
    observer?.disconnect()
    document.removeEventListener("pointerdown", onPointerDown, true)
    document.removeEventListener("pointerup", onPointerEnd)
    document.removeEventListener("pointercancel", onPointerEnd)
    document.removeEventListener("focusin", onFocus)
    document.removeEventListener("focusout", onFocus)
    view.dom.removeEventListener("hnn-reorder-start", onDrag)
    view.dom.removeEventListener("compositionstart", onCompositionStart)
    view.dom.removeEventListener("compositionend", onCompositionEnd)
    view.dom.removeEventListener("keydown", onKeyDown, true)
    element.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("scroll", schedule, true)
    window.removeEventListener("resize", schedule)
    window.visualViewport?.removeEventListener("resize", schedule)
    window.visualViewport?.removeEventListener("scroll", schedule)
    element.remove()
    if (!editor.isDestroyed) editor.unregisterPlugin(key)
  }
}
