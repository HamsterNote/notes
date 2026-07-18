import type { Pose } from "@system-ui-js/multi-drag"

import type {
  BlockBoundaryDestination,
  BlockDragSource
} from "./blockSourceMove"

export const blockDragClasses = {
  after: "hn-note-block-drop-after",
  before: "hn-note-block-drop-before",
  dragging: "hn-note-sortable-block--dragging"
} as const

export const blockDragThreshold = 4
export const blockLongPressDelay = 500
export const blockTouchMoveTolerance = 8
export const blockDragInteractiveSelector =
  "button, input, select, textarea, a"

export const getStaticBlockPose = (element: HTMLElement): Pose => ({
  position: { x: 0, y: 0 },
  width: element.offsetWidth,
  height: element.offsetHeight,
  rotation: 0,
  scale: 1
})

export const getSortableBlocks = (body: HTMLElement): HTMLElement[] =>
  Array.from(body.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.hasAttribute("data-note-sortable-id")
  )

export const getDraggableElements = (body: HTMLElement): HTMLElement[] =>
  Array.from(body.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.hasAttribute("data-note-drag-kind")
  )

const getPersistedBlockId = (element: HTMLElement): string | null =>
  element.getAttribute("data-note-block-id") ??
  element.getAttribute("data-note-sortable-id")

const getBlockRepresentatives = (body: HTMLElement): HTMLElement[] => {
  const blockIds = new Set<string>()
  return getSortableBlocks(body).filter((element) => {
    const blockId = getPersistedBlockId(element)
    if (blockId === null || blockIds.has(blockId)) return false
    blockIds.add(blockId)
    return true
  })
}

const getPersistedBlockGroups = (body: HTMLElement): HTMLElement[][] => {
  const groups = new Map<string, HTMLElement[]>()
  for (const element of getSortableBlocks(body)) {
    const blockId = getPersistedBlockId(element)
    if (blockId === null) continue
    const group = groups.get(blockId)
    if (group) group.push(element)
    else groups.set(blockId, [element])
  }
  return Array.from(groups.values())
}

export const getDragGroup = (
  body: HTMLElement,
  sourceElement: HTMLElement
): HTMLElement[] => {
  if (sourceElement.getAttribute("data-note-drag-kind") === "block") {
    return getBlockRepresentatives(body)
  }
  const parent = sourceElement.parentElement
  if (parent === null) return []
  const kind = sourceElement.getAttribute("data-note-drag-kind")
  const parentId = sourceElement.getAttribute("data-note-drag-parent-id")
  return Array.from(parent.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.getAttribute("data-note-drag-kind") === kind &&
      element.getAttribute("data-note-drag-parent-id") === parentId
  )
}

export const getBlockDragSource = (
  element: HTMLElement
): BlockDragSource | null => {
  const kind = element.getAttribute("data-note-drag-kind")
  if (kind === "block") return { kind }
  const blockId = element.getAttribute("data-note-drag-parent-id")
  if (blockId === null) return null
  if (kind === "checklist-item" || kind === "quote-line") {
    return { kind, blockId, sourceId: element.id }
  }
  return null
}

export type BlockBoundaryTarget = {
  readonly destination: BlockBoundaryDestination
  readonly element: HTMLElement
}

export const getBlockBoundaryTarget = (
  body: HTMLElement,
  sourceElement: HTMLElement,
  clientY: number
): BlockBoundaryTarget | null => {
  const sourceWrapper = sourceElement.closest<HTMLElement>("[data-note-sortable-id]")
  if (sourceWrapper === null) return null
  const sourceGroup =
    sourceElement.parentElement === body
      ? getDragGroup(body, sourceElement)
      : [sourceWrapper]
  const sourceRects = sourceGroup.map((element) => element.getBoundingClientRect())
  const sourceTop = Math.min(...sourceRects.map((rect) => rect.top))
  const sourceBottom = Math.max(...sourceRects.map((rect) => rect.bottom))
  if (
    sourceBottom <= sourceTop ||
    (clientY >= sourceTop && clientY <= sourceBottom)
  ) {
    return null
  }

  const targetGroups = getPersistedBlockGroups(body)
  let targetIndex = targetGroups.findIndex(
    (group) => {
      const lastElement = group.at(-1)
      return (
        lastElement !== undefined &&
        clientY <= lastElement.getBoundingClientRect().bottom
      )
    }
  )
  if (targetIndex < 0) targetIndex = targetGroups.length - 1
  const targetGroup = targetGroups[targetIndex]
  const firstElement = targetGroup?.[0]
  const lastElement = targetGroup?.[targetGroup.length - 1]
  if (firstElement === undefined || lastElement === undefined) return null
  const targetBlockId = getPersistedBlockId(firstElement)
  if (targetBlockId === null) return null
  const top = firstElement.getBoundingClientRect().top
  const bottom = lastElement.getBoundingClientRect().bottom
  const placement = clientY >= top + (bottom - top) / 2 ? "after" : "before"
  const element = placement === "after" ? lastElement : firstElement
  return { destination: { placement, targetBlockId }, element }
}
