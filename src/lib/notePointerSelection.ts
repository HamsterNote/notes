import { NOTE_ATOMIC_ATTRIBUTE, NOTE_REGION_ATTRIBUTE } from "./noteTextFlow"

type SelectionPoint = {
  readonly kind: "atomic" | "region"
  readonly node: Node
  readonly offset: number
  readonly unit: HTMLElement
}

type ActivePointerSelection = {
  readonly anchor: SelectionPoint
  readonly pointerId: number
  bridged: boolean
}

const blockedTargetSelector = [
  "button",
  "input",
  "select",
  "textarea",
  "[data-note-editor-panel]"
].join(",")

const atomicSelectedAttribute = "data-note-atomic-selected"

const closestElement = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement

const noteSelectionPoint = (
  container: HTMLElement,
  clientX: number,
  clientY: number
): SelectionPoint | null => {
  const caret = document.caretPositionFromPoint(clientX, clientY)
  if (!caret || !container.contains(caret.offsetNode)) return null
  const element = closestElement(caret.offsetNode)
  const atomic = element?.closest<HTMLElement>(`[${NOTE_ATOMIC_ATTRIBUTE}]`)
  if (atomic && container.contains(atomic)) {
    return {
      kind: "atomic",
      node: caret.offsetNode,
      offset: caret.offset,
      unit: atomic
    }
  }
  const region = element?.closest<HTMLElement>(`[${NOTE_REGION_ATTRIBUTE}]`)
  if (!region || !container.contains(region)) return null
  return {
    kind: "region",
    node: caret.offsetNode,
    offset: caret.offset,
    unit: region
  }
}

const targetAllowsTextSelection = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(blockedTargetSelector) === null

const atomicBoundary = (
  unit: HTMLElement,
  after: boolean
): Pick<SelectionPoint, "node" | "offset"> | null => {
  const parent = unit.parentNode
  if (!parent) return null
  const index = Array.from(parent.childNodes).indexOf(unit)
  if (index < 0) return null
  return { node: parent, offset: index + (after ? 1 : 0) }
}

const follows = (source: Node, target: Node): boolean =>
  Boolean(source.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)

const syncAtomicSelection = (container: HTMLElement): void => {
  const selection = window.getSelection()
  const range = selection && selection.rangeCount > 0 && !selection.isCollapsed
    ? selection.getRangeAt(0)
    : null
  const belongsToContainer = range !== null &&
    container.contains(range.commonAncestorContainer)

  for (const unit of container.querySelectorAll<HTMLElement>(
    `[${NOTE_ATOMIC_ATTRIBUTE}]`
  )) {
    const unitRange = document.createRange()
    unitRange.selectNode(unit)
    const selected = belongsToContainer &&
      range.compareBoundaryPoints(Range.START_TO_START, unitRange) <= 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, unitRange) >= 0
    if (selected) {
      unit.setAttribute(atomicSelectedAttribute, "true")
    } else {
      unit.removeAttribute(atomicSelectedAttribute)
    }
  }
}

/**
 * Chromium 将每个 contenteditable 视为独立编辑宿主，原生鼠标选区无法跨宿主。
 * 仅当指针越过笔记区域边界时接管 Selection，同一区域内仍保留浏览器原生行为。
 */
export const bindNotePointerSelection = (
  container: HTMLElement
): (() => void) => {
  let active: ActivePointerSelection | null = null

  const finish = (event: PointerEvent): void => {
    if (active?.pointerId === event.pointerId) active = null
  }

  const handlePointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      event.pointerType !== "mouse" ||
      !targetAllowsTextSelection(event.target)
    ) {
      active = null
      return
    }
    const anchor = noteSelectionPoint(container, event.clientX, event.clientY)
    active = anchor
      ? { anchor, pointerId: event.pointerId, bridged: false }
      : null
  }

  const handlePointerMove = (event: PointerEvent): void => {
    if (
      !active ||
      active.pointerId !== event.pointerId ||
      (event.buttons & 1) === 0
    ) {
      return
    }
    const focus = noteSelectionPoint(container, event.clientX, event.clientY)
    if (!focus) return
    if (!active.bridged && focus.unit === active.anchor.unit) return

    const focusFollowsAnchor = follows(active.anchor.unit, focus.unit)
    const anchor = active.anchor.kind === "atomic"
      ? atomicBoundary(active.anchor.unit, !focusFollowsAnchor)
      : active.anchor
    const normalizedFocus = focus.kind === "atomic"
      ? atomicBoundary(focus.unit, focusFollowsAnchor)
      : focus
    if (!anchor || !normalizedFocus) return

    active.bridged = true
    event.preventDefault()
    window.getSelection()?.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      normalizedFocus.node,
      normalizedFocus.offset
    )
    syncAtomicSelection(container)
  }

  container.addEventListener("pointerdown", handlePointerDown, true)
  document.addEventListener("pointermove", handlePointerMove, true)
  document.addEventListener("pointerup", finish, true)
  document.addEventListener("pointercancel", finish, true)

  const handleSelectionChange = (): void => syncAtomicSelection(container)
  document.addEventListener("selectionchange", handleSelectionChange)

  return () => {
    active = null
    for (const unit of container.querySelectorAll<HTMLElement>(
      `[${atomicSelectedAttribute}]`
    )) {
      unit.removeAttribute(atomicSelectedAttribute)
    }
    container.removeEventListener("pointerdown", handlePointerDown, true)
    document.removeEventListener("pointermove", handlePointerMove, true)
    document.removeEventListener("pointerup", finish, true)
    document.removeEventListener("pointercancel", finish, true)
    document.removeEventListener("selectionchange", handleSelectionChange)
  }
}
