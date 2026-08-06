import {
  type Drag,
  type Finger,
  FingerOperationType
} from "@system-ui-js/multi-drag"
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef
} from "react"

import { blockDragClasses } from "./blockDragDom"
import {
  createExternalNoteBlock,
  type ExternalNoteDragCancellationReason,
  type ExternalNoteDragCompletion,
  type ExternalNoteDragInput,
  type ExternalNoteDragStartResult,
  insertExternalNoteBlock,
  prepareExternalNoteDragStart,
  type NoteExternalItem
} from "./externalNoteDrag"
import {
  type ExternalNoteDropTarget,
  getExternalNoteDropTarget
} from "./externalNoteDropTarget"
import { createNoteId } from "./noteId"
import type { NoteBlock } from "./types"

type ExternalNoteDragSessionState = {
  readonly drag: Drag
  readonly finger: Finger
  readonly item: NoteExternalItem
  readonly removeListeners: () => void
  readonly reject: (reason: unknown) => void
  readonly resolve: (completion: ExternalNoteDragCompletion) => void
  didMove: boolean
  settled: boolean
  target: ExternalNoteDropTarget | null
}

type UseExternalNoteDragInput = {
  readonly bodyRef: RefObject<HTMLDivElement | null>
  readonly blocks: readonly NoteBlock[]
  readonly canCommit: boolean
  readonly commitBlocks: (blocks: NoteBlock[]) => void
  readonly editable: boolean
}

const setTargetPreview = (
  session: ExternalNoteDragSessionState,
  target: ExternalNoteDropTarget | null
): void => {
  if (
    session.target?.element === target?.element &&
    session.target?.placement === target?.placement
  ) {
    return
  }
  if (session.target !== null) {
    session.target.element.classList.remove(
      session.target.placement === "before"
        ? blockDragClasses.externalBefore
        : blockDragClasses.externalAfter
    )
  }
  session.target = target
  if (target !== null) {
    target.element.classList.add(
      target.placement === "before"
        ? blockDragClasses.externalBefore
        : blockDragClasses.externalAfter
    )
  }
}

export const useExternalNoteDrag = ({
  bodyRef,
  blocks,
  canCommit,
  commitBlocks,
  editable
}: UseExternalNoteDragInput): {
  readonly startExternalDrag: (
    input: ExternalNoteDragInput
  ) => ExternalNoteDragStartResult
} => {
  const latestRef = useRef({ blocks, canCommit, commitBlocks, editable })
  const mountedRef = useRef(true)
  const sessionsRef = useRef(new Set<ExternalNoteDragSessionState>())
  const dragsRef = useRef(new Set<Drag>())

  useLayoutEffect(() => {
    latestRef.current = { blocks, canCommit, commitBlocks, editable }
  }, [blocks, canCommit, commitBlocks, editable])

  const settle = useCallback(
    (
      session: ExternalNoteDragSessionState,
      completion: ExternalNoteDragCompletion
    ): void => {
      if (session.settled) return
      session.settled = true
      session.removeListeners()
      sessionsRef.current.delete(session)
      dragsRef.current.delete(session.drag)
      setTargetPreview(session, null)
      session.resolve(completion)
    },
    []
  )

  const cancelAll = useCallback(
    (reason: ExternalNoteDragCancellationReason): void => {
      for (const session of [...sessionsRef.current]) {
        settle(session, { status: "cancelled", reason })
      }
    },
    [settle]
  )

  useEffect(() => {
    if (!editable || !canCommit) cancelAll("note-became-readonly")
  }, [canCommit, cancelAll, editable])

  useLayoutEffect(() => {
    mountedRef.current = true
    const sessions = sessionsRef.current
    return () => {
      mountedRef.current = false
      for (const session of [...sessions]) {
        settle(session, { status: "cancelled", reason: "note-unmounted" })
      }
    }
  }, [settle])

  const startExternalDrag = useCallback(
    (input: ExternalNoteDragInput): ExternalNoteDragStartResult => {
      if (!mountedRef.current) return { ok: false, reason: "not-editable" }
      if (sessionsRef.current.size > 0) {
        return { ok: false, reason: "drag-already-active" }
      }
      const preparation = prepareExternalNoteDragStart(input, {
        editable: latestRef.current.editable,
        canCommit: latestRef.current.canCommit,
        activeDrags: dragsRef.current
      })
      if (!preparation.ok) return preparation
      const { drag, finger, item } = preparation.preparation
      let resolveCompletion: (completion: ExternalNoteDragCompletion) => void =
        () => {}
      let rejectCompletion: (reason: unknown) => void = () => {}
      const completion = new Promise<ExternalNoteDragCompletion>((resolve, reject) => {
        resolveCompletion = resolve
        rejectCompletion = reject
      })
      const updateTarget = (point: {
        readonly x: number
        readonly y: number
      }): ExternalNoteDropTarget | null => {
        const body = bodyRef.current
        const target =
          body === null
            ? null
            : getExternalNoteDropTarget(body, latestRef.current.blocks, point)
        setTargetPreview(session, target)
        return target
      }
      const onMove = (operation: {
        readonly point: { readonly x: number; readonly y: number }
      }): void => {
        session.didMove = true
        updateTarget(operation.point)
      }
      const onEnd = (operation: {
        readonly point: { readonly x: number; readonly y: number }
        readonly event?: PointerEvent
      }): void => {
        if (operation.event?.type === "pointercancel") {
          settle(session, { status: "cancelled", reason: "pointer-cancelled" })
          return
        }
        const target = session.didMove ? updateTarget(operation.point) : null
        if (target === null) {
          settle(session, {
            status: "cancelled",
            reason: "released-outside-note"
          })
          return
        }
        const capabilities = latestRef.current
        if (!capabilities.editable || !capabilities.canCommit) {
          settle(session, {
            status: "cancelled",
            reason: "note-became-readonly"
          })
          return
        }
        const block = createExternalNoteBlock(item, createNoteId())
        const nextBlocks = insertExternalNoteBlock(
          capabilities.blocks,
          block,
          target.insertionIndex
        )
        if (session.settled) return
        session.settled = true
        session.removeListeners()
        sessionsRef.current.delete(session)
        dragsRef.current.delete(session.drag)
        setTargetPreview(session, null)
        try {
          capabilities.commitBlocks(nextBlocks)
          session.resolve({ status: "placed", item, block })
        } catch (error) {
          session.reject(error)
        }
      }
      const session: ExternalNoteDragSessionState = {
        drag,
        finger,
        item,
        reject: rejectCompletion,
        resolve: resolveCompletion,
        removeListeners: () => {
          finger.removeEventListener(FingerOperationType.Move, onMove)
          finger.removeEventListener(FingerOperationType.End, onEnd)
        },
        didMove: false,
        settled: false,
        target: null
      }
      finger.addEventListener(FingerOperationType.Move, onMove)
      finger.addEventListener(FingerOperationType.End, onEnd)
      sessionsRef.current.add(session)
      dragsRef.current.add(drag)
      return {
        ok: true,
        session: {
          completion,
          cancel: () =>
            settle(session, {
              status: "cancelled",
              reason: "cancelled-by-host"
            })
        }
      }
    },
    [bodyRef, settle]
  )

  return useMemo(() => ({ startExternalDrag }), [startExternalDrag])
}
