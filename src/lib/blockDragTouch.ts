import { isRendererOwnedDragElement } from "./blockContainerDom"
import {
  blockDragInteractiveSelector,
  blockLongPressDelay,
  blockTouchMoveTolerance
} from "./blockDragDom"

type PointerPoint = Readonly<{ x: number; y: number }>

type PendingTouch = {
  readonly pointerId: number
  readonly sourceElement: HTMLElement
  readonly start: PointerPoint
  readonly timer: number
}

type TouchDragControls = {
  readonly begin: (source: HTMLElement, pointerId: number) => void
  readonly clearSelection: () => void
  readonly finish: (commit: boolean) => void
  readonly isDragging: () => boolean
  readonly isPointerActive: (pointerId: number) => boolean
  readonly preview: (clientY: number) => void
  readonly suppressClick: () => void
}

type BindTouchBlockDragInput = {
  readonly body: HTMLElement
  readonly controls: TouchDragControls
  readonly enabled: boolean
}

export const bindTouchBlockDrag = ({
  body,
  controls,
  enabled
}: BindTouchBlockDragInput): (() => void) => {
  let pendingTouch: PendingTouch | null = null

  const clearPendingTouch = (): void => {
    if (pendingTouch === null) return
    window.clearTimeout(pendingTouch.timer)
    pendingTouch = null
  }
  const handleTouchStart = (event: PointerEvent): void => {
    if (
      !enabled ||
      event.pointerType !== "touch" ||
      pendingTouch !== null ||
      controls.isDragging()
    ) {
      return
    }
    if (!(event.target instanceof Element)) return
    if (event.target.closest(blockDragInteractiveSelector) !== null) return
    const element = event.target.closest<HTMLElement>("[data-note-drag-kind]")
    if (
      element === null ||
      !body.contains(element) ||
      !isRendererOwnedDragElement(body, element)
    ) {
      return
    }

    const start = { x: event.clientX, y: event.clientY }
    const timer = window.setTimeout(() => {
      const pending = pendingTouch
      if (pending === null || pending.pointerId !== event.pointerId) return
      pendingTouch = null
      controls.begin(pending.sourceElement, pending.pointerId)
    }, blockLongPressDelay)
    pendingTouch = {
      pointerId: event.pointerId,
      sourceElement: element,
      start,
      timer
    }
  }
  const handleTouchMove = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return
    if (pendingTouch?.pointerId === event.pointerId) {
      const distance = Math.hypot(
        event.clientX - pendingTouch.start.x,
        event.clientY - pendingTouch.start.y
      )
      if (distance > blockTouchMoveTolerance) clearPendingTouch()
      return
    }
    if (!controls.isPointerActive(event.pointerId) || !controls.isDragging()) return
    event.preventDefault()
    controls.clearSelection()
    controls.preview(event.clientY)
  }
  const preventActiveTouchPan = (event: TouchEvent): void => {
    if (controls.isDragging()) event.preventDefault()
  }
  const handleTouchEnd = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return
    if (pendingTouch?.pointerId === event.pointerId) {
      clearPendingTouch()
      return
    }
    if (!controls.isPointerActive(event.pointerId) || !controls.isDragging()) return
    event.preventDefault()
    if (event.type === "pointerup") controls.suppressClick()
    controls.finish(event.type === "pointerup")
  }
  const preventActiveContextMenu = (event: MouseEvent): void => {
    if (controls.isDragging()) event.preventDefault()
  }

  body.addEventListener("pointerdown", handleTouchStart)
  document.addEventListener("pointermove", handleTouchMove, { passive: false })
  document.addEventListener("touchmove", preventActiveTouchPan, {
    capture: true,
    passive: false
  })
  document.addEventListener("pointerup", handleTouchEnd)
  document.addEventListener("pointercancel", handleTouchEnd)
  body.addEventListener("contextmenu", preventActiveContextMenu)
  return () => {
    clearPendingTouch()
    body.removeEventListener("pointerdown", handleTouchStart)
    document.removeEventListener("pointermove", handleTouchMove)
    document.removeEventListener("touchmove", preventActiveTouchPan, true)
    document.removeEventListener("pointerup", handleTouchEnd)
    document.removeEventListener("pointercancel", handleTouchEnd)
    body.removeEventListener("contextmenu", preventActiveContextMenu)
  }
}
