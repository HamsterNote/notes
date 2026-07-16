import { useCallback, useMemo, useRef } from "react"
import useUndo from "use-undo"
import type {
  NoteBlock,
  NoteContentUndoRedoController,
  NoteContentUndoRedoSnapshot,
  UseNoteContentUndoRedoResult,
} from "./types"

export const DISABLED_CONTROLLER: NoteContentUndoRedoController = {
  undo: () => false,
  redo: () => false,
  canUndo: () => false,
  canRedo: () => false,
  resetHistory: () => {
    /* no-op */
  },
}

export function isDisabledController(
  controller: NoteContentUndoRedoController,
): boolean {
  return controller === DISABLED_CONTROLLER
}

/**
 * React hook that powers `NoteContent` undo/redo history through `use-undo`.
 *
 * Tracks title, summary, and blocks snapshots. Returns the current `present`
 * snapshot, setters, boolean availability, undo/redo methods, and a
 * `controller` to pass into `NoteContent`'s `undoRedoController` prop.
 *
 * The generic hook only covers the content fields that `NoteContent` renders.
 * If you need history to include outer fields such as `tagLabel`, build a
 * custom `NoteContentUndoRedoController` like the Demo does.
 *
 * @example
 * const undoRedo = useNoteContentUndoRedo({ title: "A", blocks: [] })
 * const noteRef = useRef<NoteContentUndoRedoHandle>(null)
 *
 * return (
 *   <>
 *     <button onClick={() => noteRef.current?.undo()}>Undo</button>
 *     <NoteContent
 *       ref={noteRef}
 *       undoRedoController={undoRedo.controller}
 *       title={undoRedo.present.title}
 *       blocks={undoRedo.present.blocks}
 *       onTitleChange={undoRedo.setTitle}
 *       onBlocksChange={undoRedo.setBlocks}
 *     />
 *   </>
 * )
 */
export function useNoteContentUndoRedo(
  initialSnapshot: NoteContentUndoRedoSnapshot,
): UseNoteContentUndoRedoResult {
  const [state, actions] = useUndo(initialSnapshot)
  const presentRef = useRef(state.present)
  presentRef.current = state.present
  const setPresent = useCallback(
    (nextSnapshot: NoteContentUndoRedoSnapshot) => {
      presentRef.current = nextSnapshot
      actions.set(nextSnapshot)
    },
    [actions],
  )

  const setTitle = useCallback(
    (title: string) => {
      setPresent({ ...presentRef.current, title })
    },
    [setPresent],
  )

  const setSummary = useCallback(
    (summary: string | undefined) => {
      if (summary === undefined) {
        setPresent({
          title: presentRef.current.title,
          blocks: presentRef.current.blocks,
        })
      } else {
        setPresent({ ...presentRef.current, summary })
      }
    },
    [setPresent],
  )

  const setBlocks = useCallback(
    (blocks: readonly NoteBlock[]) => {
      setPresent({ ...presentRef.current, blocks })
    },
    [setPresent],
  )

  const canUndo = state.past.length > 0
  const canRedo = state.future.length > 0

  const undo = useCallback(() => {
    const available = actions.canUndo
    if (available) actions.undo()
    return available
  }, [actions])

  const redo = useCallback(() => {
    const available = actions.canRedo
    if (available) actions.redo()
    return available
  }, [actions])

  const resetHistory = useCallback(
    (nextSnapshot?: NoteContentUndoRedoSnapshot) => {
      actions.reset(nextSnapshot ?? state.present)
    },
    [actions, state.present],
  )

  const controller: NoteContentUndoRedoController = useMemo(
    () => ({
      undo: () => {
        const available = actions.canUndo
        if (available) actions.undo()
        return available
      },
      redo: () => {
        const available = actions.canRedo
        if (available) actions.redo()
        return available
      },
      canUndo: () => actions.canUndo,
      canRedo: () => actions.canRedo,
      resetHistory: () => {
        actions.reset(state.present)
      },
    }),
    [actions, state.present],
  )

  return {
    present: state.present,
    setTitle,
    setSummary,
    setBlocks,
    canUndo,
    canRedo,
    undo,
    redo,
    resetHistory,
    controller,
  }
}
