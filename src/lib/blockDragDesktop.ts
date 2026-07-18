import {
  Drag,
  DragOperationType,
  type Finger
} from "@system-ui-js/multi-drag"

import {
  blockDragThreshold,
  getDraggableElements,
  getStaticBlockPose
} from "./blockDragDom"

type PointerPoint = Readonly<{ x: number; y: number }>

type DesktopBlockDragControls = {
  readonly begin: (sourceElement: HTMLElement, pointerId: number) => void
  readonly finish: (commit: boolean) => void
  readonly preview: (clientY: number) => void
}

type BindDesktopBlockDragInput = {
  readonly body: HTMLElement
  readonly controls: DesktopBlockDragControls
}

export const bindDesktopBlockDrag = ({
  body,
  controls
}: BindDesktopBlockDragInput): (() => void) => {
  const drags: Drag[] = []
  const cleanups: (() => void)[] = []
  const clickTimers: number[] = []

  getDraggableElements(body).forEach((element) => {
    const handle = Array.from(
      element.querySelectorAll<HTMLButtonElement>(
        '[data-block-menu-mode="convert"]'
      )
    ).find(
      (candidate) => candidate.closest("[data-note-drag-kind]") === element
    )
    if (handle === undefined) return

    let startPoint: PointerPoint | null = null
    let pointerId: number | null = null
    let dragged = false
    let cancelled = false
    let suppressClick = false
    const drag = new Drag(handle, {
      getPose: getStaticBlockPose,
      setPose: () => undefined,
      setPoseOnEnd: () => undefined
    })
    const handleStart = (fingers: Finger[]): void => {
      const finger = fingers[0]
      startPoint = finger?.getLastOperation()?.point ?? null
      pointerId = finger?.pointerId ?? null
      dragged = false
      cancelled = false
    }
    const handleMove = (fingers: Finger[]): void => {
      const point = fingers[0]?.getLastOperation()?.point
      if (point === undefined || startPoint === null || pointerId === null) return
      if (
        !dragged &&
        Math.hypot(point.x - startPoint.x, point.y - startPoint.y) >=
          blockDragThreshold
      ) {
        dragged = true
        controls.begin(element, pointerId)
      }
      if (dragged) controls.preview(point.y)
    }
    const handleEnd = (): void => {
      if (dragged && !cancelled) {
        suppressClick = true
        clickTimers.push(
          window.setTimeout(() => {
            suppressClick = false
          }, 0)
        )
      }
      if (dragged) controls.finish(!cancelled)
      startPoint = null
      pointerId = null
    }
    const suppressDraggedClick = (event: MouseEvent): void => {
      if (!suppressClick) return
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }
    const handleCancel = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return
      cancelled = true
      if (dragged) controls.finish(false)
    }

    handle.addEventListener("click", suppressDraggedClick, true)
    document.addEventListener("pointercancel", handleCancel, true)
    drag.addEventListener(DragOperationType.Start, handleStart)
    drag.addEventListener(DragOperationType.Move, handleMove)
    drag.addEventListener(DragOperationType.End, handleEnd)
    drags.push(drag)
    cleanups.push(() => {
      handle.removeEventListener("click", suppressDraggedClick, true)
      document.removeEventListener("pointercancel", handleCancel, true)
    })
  })

  return () => {
    cleanups.forEach((cleanup) => {
      cleanup()
    })
    drags.forEach((drag) => {
      drag.destroy()
    })
    clickTimers.forEach((timer) => {
      window.clearTimeout(timer)
    })
  }
}
