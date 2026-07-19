import { type RefObject, useEffect, useRef } from "react"
import { getBlockContainerTarget } from "./blockContainerDom"
import {
  type BlockContainerDestination,
  moveBlockToContainer
} from "./blockContainerMove"
import { getBlockBindingKey } from "./blockDragBindingKey"
import { bindDesktopBlockDrag } from "./blockDragDesktop"
import {
  blockDragClasses,
  getBlockBoundaryTarget,
  getBlockDragSource,
  getDragGroup
} from "./blockDragDom"
import { getBlockDragTarget } from "./blockDragTarget"
import { bindTouchBlockDrag } from "./blockDragTouch"
import {
  type BlockBoundaryDestination,
  type BlockDragSource,
  moveBlockSource,
  moveBlockSourceToBoundary
} from "./blockSourceMove"
import type { NoteBlock } from "./types"
import { useDraggedClickSuppression } from "./useDraggedTouchClickSuppression"

type UseBlockDragInput = {
  readonly bodyRef: RefObject<HTMLDivElement | null>
  readonly blocks: readonly NoteBlock[]
  readonly onBlocksChange: ((blocks: NoteBlock[]) => void) | undefined
  readonly touchEnabled: boolean
}

export const useBlockDrag = ({
  bodyRef,
  blocks,
  onBlocksChange,
  touchEnabled
}: UseBlockDragInput): void => {
  const blocksRef = useRef(blocks)
  const onBlocksChangeRef = useRef(onBlocksChange)
  const suppressNextClick = useDraggedClickSuppression(bodyRef)
  blocksRef.current = blocks
  onBlocksChangeRef.current = onBlocksChange
  const blockBindingKey = getBlockBindingKey(blocks)
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
    let containerDestination: BlockContainerDestination | null = null
    let dragElements: HTMLElement[] = []
    let previewElement: HTMLElement | null = null

    const clearPreview = (): void => {
      previewElement?.classList.remove(
        blockDragClasses.before,
        blockDragClasses.after
      )
      previewElement = null
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
      containerDestination = null
      dragElements = elements
      activePointerId = pointerId
      nextSource.classList.add(blockDragClasses.dragging)
      clearActiveSelection()
    }

    const previewAt = (clientY: number): void => {
      if (sourceElement === null) return
      if (source?.kind === "block") {
        const target = getBlockContainerTarget(body, sourceElement, clientY)
        if (target !== null) {
          clearPreview()
          containerDestination = target.destination
          boundaryDestination = null
          previewElement = target.element
          target.element.classList.add(
            target.destination.placement === "after"
              ? blockDragClasses.after
              : blockDragClasses.before
          )
          return
        }
      } else {
        const target = getBlockBoundaryTarget(body, sourceElement, clientY)
        if (target !== null) {
          clearPreview()
          boundaryDestination = target.destination
          containerDestination = null
          previewElement = target.element
          target.element.classList.add(
            target.destination.placement === "after"
              ? blockDragClasses.after
              : blockDragClasses.before
          )
          return
        }
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
      containerDestination = null
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
      sourceElement?.classList.remove(blockDragClasses.dragging)
      const completedSourceIndex = sourceIndex
      const completedDestinationIndex = destinationIndex
      const completedSource = source
      const completedBoundaryDestination = boundaryDestination
      const completedContainerDestination = containerDestination
      sourceElement = null
      source = null
      boundaryDestination = null
      containerDestination = null
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
        completedContainerDestination !== null && completedSource.kind === "block"
          ? moveBlockToContainer({
              blocks: currentBlocks,
              destination: completedContainerDestination,
              sourceBlockId: completedSource.blockId,
              sourceContainerId: completedSource.containerId
            })
          : completedBoundaryDestination !== null &&
              completedSource.kind !== "block"
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
        preview: previewAt,
        suppressClick: suppressNextClick
      }
    })
    const unbindTouchDrag = bindTouchBlockDrag({
      body,
      enabled: touchEnabled,
      controls: {
        begin: beginDrag,
        clearSelection: clearActiveSelection,
        finish: finishDrag,
        isDragging: () => sourceElement !== null,
        isPointerActive: (pointerId) => pointerId === activePointerId,
        preview: previewAt,
        suppressClick: suppressNextClick
      }
    })
    document.addEventListener("selectionchange", clearActiveSelection)
    return () => {
      finishDrag(false)
      unbindDesktopDrag()
      unbindTouchDrag()
      document.removeEventListener("selectionchange", clearActiveSelection)
    }
  }, [
    blockBindingKey,
    bodyRef,
    enabled,
    suppressNextClick,
    touchEnabled
  ])
}
