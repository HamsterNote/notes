import { type RefObject, useEffect, useRef } from "react"

import { bindDesktopBlockDrag } from "./blockDragDesktop"
import {
  blockDragClasses,
  blockDragInteractiveSelector,
  blockLongPressDelay,
  blockTouchMoveTolerance,
  getBlockBoundaryTarget,
  getBlockDragSource,
  getDragGroup
} from "./blockDragDom"
import { getBlockDragTarget } from "./blockDragTarget"
import {
  type BlockBoundaryDestination,
  type BlockDragSource,
  moveBlockSource,
  moveBlockSourceToBoundary
} from "./blockSourceMove"
import type { NoteBlock } from "./types"
import { useDraggedTouchClickSuppression } from "./useDraggedTouchClickSuppression"

type UseBlockDragInput = {
  readonly bodyRef: RefObject<HTMLDivElement | null>
  readonly blocks: readonly NoteBlock[]
  readonly onBlocksChange: ((blocks: NoteBlock[]) => void) | undefined
  readonly touchEnabled: boolean
}

type PointerPoint = Readonly<{ x: number; y: number }>

type PendingTouch = {
  readonly pointerId: number
  readonly sourceElement: HTMLElement
  readonly start: PointerPoint
  readonly timer: number
}

export const useBlockDrag = ({
  bodyRef,
  blocks,
  onBlocksChange,
  touchEnabled
}: UseBlockDragInput): void => {
  const blocksRef = useRef(blocks)
  const onBlocksChangeRef = useRef(onBlocksChange)
  const suppressNextTouchClick = useDraggedTouchClickSuppression()
  blocksRef.current = blocks
  onBlocksChangeRef.current = onBlocksChange
  const blockBindingKey = blocks
    .map((block) => {
      if (block.kind === "checklist") {
        return `${block.id}:${block.kind}:${block.items.map((item) => item.id).join(",")}`
      }
      if (block.kind === "quote") {
        return `${block.id}:${block.kind}:${block.text}`
      }
      return `${block.id}:${block.kind}`
    })
    .join("\u0000")
  const enabled = onBlocksChange !== undefined

  useEffect(() => {
    const body = bodyRef.current
    if (body === null || !enabled) return
    void blockBindingKey

    let activePointerId: number | null = null
    let sourceIndex = -1
    let destinationIndex = -1
    let sourceElement: HTMLElement | null = null
    let source: BlockDragSource | null = null
    let boundaryDestination: BlockBoundaryDestination | null = null
    let dragElements: HTMLElement[] = []
    let previewElement: HTMLElement | null = null
    let pendingTouch: PendingTouch | null = null

    const clearPreview = (): void => {
      previewElement?.classList.remove(
        blockDragClasses.before,
        blockDragClasses.after
      )
      previewElement = null
    }

    const clearPendingTouch = (): void => {
      if (pendingTouch === null) return
      window.clearTimeout(pendingTouch.timer)
      pendingTouch = null
    }

    const clearActiveSelection = (): void => {
      const selection = window.getSelection()
      if (sourceElement !== null && selection && selection.rangeCount > 0) {
        selection.removeAllRanges()
      }
    }

    const beginDrag = (nextSource: HTMLElement, pointerId: number): void => {
      if (activePointerId !== null) return
      const nextSourceDescriptor = getBlockDragSource(nextSource)
      const elements = getDragGroup(body, nextSource)
      const nextSourceIndex = elements.indexOf(nextSource)
      if (nextSourceDescriptor === null || nextSourceIndex < 0) return

      clearPreview()
      sourceIndex = nextSourceIndex
      destinationIndex = nextSourceIndex
      sourceElement = nextSource
      source = nextSourceDescriptor
      boundaryDestination = null
      dragElements = elements
      activePointerId = pointerId
      nextSource.classList.add(blockDragClasses.dragging)
      clearActiveSelection()
    }

    const previewAt = (clientY: number): void => {
      if (sourceElement === null) return
      const boundaryTarget =
        source?.kind === "block"
          ? null
          : getBlockBoundaryTarget(body, sourceElement, clientY)
      if (boundaryTarget !== null) {
        clearPreview()
        boundaryDestination = boundaryTarget.destination
        previewElement = boundaryTarget.element
        boundaryTarget.element.classList.add(
          boundaryTarget.destination.placement === "after"
            ? blockDragClasses.after
            : blockDragClasses.before
        )
        return
      }

      const elements = dragElements
      if (elements.length === 0) return

      let targetIndex = elements.findIndex(
        (element) => clientY <= element.getBoundingClientRect().bottom
      )
      if (targetIndex < 0) targetIndex = elements.length - 1
      const targetElement = elements[targetIndex]
      if (targetElement === undefined) return
      const rect = targetElement.getBoundingClientRect()
      const target = getBlockDragTarget({
        itemCount: elements.length,
        pointerOffset: clientY - rect.top,
        sourceIndex,
        targetIndex,
        targetSize: rect.height
      })
      if (target === null) return

      clearPreview()
      boundaryDestination = null
      destinationIndex = target.destinationIndex
      previewElement = targetElement
      targetElement.classList.add(
        target.insertionIndex === targetIndex
          ? blockDragClasses.before
          : blockDragClasses.after
      )
    }

    const finishDrag = (commit: boolean): void => {
      clearPreview()
      clearPendingTouch()
      sourceElement?.classList.remove(blockDragClasses.dragging)
      const completedSourceIndex = sourceIndex
      const completedDestinationIndex = destinationIndex
      const completedSource = source
      const completedBoundaryDestination = boundaryDestination
      sourceElement = null
      source = null
      boundaryDestination = null
      dragElements = []
      sourceIndex = -1
      destinationIndex = -1
      activePointerId = null

      if (
        !commit ||
        completedSource === null
      )
        return
      const currentBlocks = blocksRef.current
      const nextBlocks =
        completedBoundaryDestination !== null && completedSource.kind !== "block"
          ? moveBlockSourceToBoundary({
              blocks: currentBlocks,
              destination: completedBoundaryDestination,
              source: completedSource,
              sourceIndex: completedSourceIndex
            })
          : completedSourceIndex === completedDestinationIndex
            ? currentBlocks
            : moveBlockSource({
                blocks: currentBlocks,
                destinationIndex: completedDestinationIndex,
                source: completedSource,
                sourceIndex: completedSourceIndex
              })
      if (nextBlocks !== currentBlocks) {
        onBlocksChangeRef.current?.(nextBlocks.slice())
      }
    }

    const unbindDesktopDrag = bindDesktopBlockDrag({
      body,
      controls: {
        begin: beginDrag,
        finish: finishDrag,
        preview: previewAt
      }
    })

    const handleTouchStart = (event: PointerEvent): void => {
      if (
        !touchEnabled ||
        event.pointerType !== "touch" ||
        pendingTouch !== null ||
        activePointerId !== null
      )
        return
      if (!(event.target instanceof Element)) return
      if (event.target.closest(blockDragInteractiveSelector) !== null) return
      const element = event.target.closest<HTMLElement>("[data-note-drag-kind]")
      if (element === null || element.parentElement !== body) return

      const start = { x: event.clientX, y: event.clientY }
      const timer = window.setTimeout(() => {
        const pending = pendingTouch
        if (pending === null || pending.pointerId !== event.pointerId) return
        pendingTouch = null
        beginDrag(pending.sourceElement, pending.pointerId)
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
      if (event.pointerId !== activePointerId || sourceElement === null) return
      event.preventDefault()
      clearActiveSelection()
      previewAt(event.clientY)
    }
    const preventActiveTouchPan = (event: TouchEvent): void => {
      if (sourceElement !== null) event.preventDefault()
    }
    const handleTouchEnd = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") return
      if (pendingTouch?.pointerId === event.pointerId) {
        clearPendingTouch()
        return
      }
      if (event.pointerId !== activePointerId || sourceElement === null) return
      event.preventDefault()
      if (event.type === "pointerup") suppressNextTouchClick()
      finishDrag(event.type === "pointerup")
    }
    const preventActiveContextMenu = (event: MouseEvent): void => {
      if (sourceElement !== null) event.preventDefault()
    }

    body.addEventListener("pointerdown", handleTouchStart)
    document.addEventListener("pointermove", handleTouchMove, { passive: false })
    document.addEventListener("touchmove", preventActiveTouchPan, {
      capture: true,
      passive: false
    })
    document.addEventListener("pointerup", handleTouchEnd)
    document.addEventListener("pointercancel", handleTouchEnd)
    document.addEventListener("selectionchange", clearActiveSelection)
    body.addEventListener("contextmenu", preventActiveContextMenu)
    return () => {
      finishDrag(false)
      unbindDesktopDrag()
      body.removeEventListener("pointerdown", handleTouchStart)
      document.removeEventListener("pointermove", handleTouchMove)
      document.removeEventListener("touchmove", preventActiveTouchPan, true)
      document.removeEventListener("pointerup", handleTouchEnd)
      document.removeEventListener("pointercancel", handleTouchEnd)
      document.removeEventListener("selectionchange", clearActiveSelection)
      body.removeEventListener("contextmenu", preventActiveContextMenu)
    }
  }, [
    blockBindingKey,
    bodyRef,
    enabled,
    suppressNextTouchClick,
    touchEnabled
  ])
}
