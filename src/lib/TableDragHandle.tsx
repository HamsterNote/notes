import {
  Drag,
  DragOperationType,
  type Finger,
  type Pose
} from "@system-ui-js/multi-drag"
import {
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef
} from "react"

import {
  getTablePointerTarget,
  showTableDropPreview,
  type TableDragAxis
} from "./tableDragPreview"

type TableDragHandleProps = {
  readonly axis: TableDragAxis
  readonly className: string
  readonly index: number
  readonly label: string
  readonly symbol: string
  readonly onActivate: (event: ReactMouseEvent<HTMLButtonElement>) => void
  readonly onDragStart: (button: HTMLButtonElement) => void
  readonly onMove: (sourceIndex: number, destinationIndex: number) => void
}

const dragThreshold = 4

const getStaticPose = (element: HTMLElement): Pose => ({
  position: { x: 0, y: 0 },
  width: element.offsetWidth,
  height: element.offsetHeight,
  rotation: 0,
  scale: 1
})

export const TableDragHandle = ({
  axis,
  className,
  index,
  label,
  symbol,
  onActivate,
  onDragStart,
  onMove
}: TableDragHandleProps): ReactElement => {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const moveRef = useRef(onMove)
  const suppressClickRef = useRef(false)
  moveRef.current = onMove

  useEffect(() => {
    const button = buttonRef.current
    if (button === null) return
    const table = button.closest<HTMLTableElement>("table")
    if (table === null) return

    let startPoint: Readonly<{ x: number; y: number }> | null = null
    let destinationIndex = index
    let dragged = false
    let cancelled = false
    let activePointerId: number | null = null
    let clearDropPreview: (() => void) | null = null
    const drag = new Drag(button, {
      getPose: getStaticPose,
      setPose: () => undefined,
      setPoseOnEnd: () => undefined
    })

    const handleStart = (fingers: Finger[]): void => {
      clearDropPreview?.()
      clearDropPreview = null
      const finger = fingers[0]
      startPoint = finger?.getLastOperation()?.point ?? null
      activePointerId = finger?.pointerId ?? null
      destinationIndex = index
      dragged = false
      cancelled = false
    }
    const handleMove = (fingers: Finger[]): void => {
      const point = fingers[0]?.getLastOperation()?.point
      if (point === undefined || startPoint === null) return
      if (Math.hypot(point.x - startPoint.x, point.y - startPoint.y) >= dragThreshold) {
        dragged = true
        button.classList.add("hn-note-table-drag-handle--dragging")
      }
      if (!dragged) return

      clearDropPreview?.()
      clearDropPreview = null
      destinationIndex = index
      const target = getTablePointerTarget({ axis, point, sourceIndex: index, table })
      if (target === null) return

      destinationIndex = target.destinationIndex
      clearDropPreview = showTableDropPreview(
        table,
        axis,
        target.insertionIndex
      )
    }
    const handleEnd = (): void => {
      button.classList.remove("hn-note-table-drag-handle--dragging")
      clearDropPreview?.()
      clearDropPreview = null
      if (!dragged) return
      if (!cancelled) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
      if (!cancelled && destinationIndex !== index) {
        moveRef.current(index, destinationIndex)
      }
    }
    const handlePointerCancel = (event: PointerEvent): void => {
      if (event.pointerId !== activePointerId) return
      cancelled = true
      button.classList.remove("hn-note-table-drag-handle--dragging")
      clearDropPreview?.()
      clearDropPreview = null
      destinationIndex = index
      activePointerId = null
      startPoint = null
    }

    document.addEventListener("pointercancel", handlePointerCancel, true)
    drag.addEventListener(DragOperationType.Start, handleStart)
    drag.addEventListener(DragOperationType.Move, handleMove)
    drag.addEventListener(DragOperationType.End, handleEnd)
    return () => {
      document.removeEventListener("pointercancel", handlePointerCancel, true)
      clearDropPreview?.()
      drag.destroy()
    }
  }, [axis, index])

  return (
    <button
      ref={buttonRef}
      type="button"
      className={className}
      aria-label={label}
      title={`${label}，拖动移动${axis === "row" ? "行" : "列"}`}
      onPointerDown={(event) => onDragStart(event.currentTarget)}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onActivate(event)
      }}
    >
      {symbol}
    </button>
  )
}
