/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react"
import type { ComponentRef } from "react"
import { describe, expect, it } from "vitest"
import type {
  ExternalNoteDragStartResult,
  NoteContent,
  NoteContentHandle,
  NoteExternalItem,
  NoteContentUndoRedoController,
  NoteContentUndoRedoHandle,
  NoteContentUndoRedoSnapshot,
  UseNoteContentUndoRedoResult
} from "./index"
import { useNoteContentUndoRedo } from "./index"

describe("public API smoke test — src/lib/index.ts exports", () => {
  it("exports useNoteContentUndoRedo as a callable function", () => {
    expect(useNoteContentUndoRedo).toBeInstanceOf(Function)
  })

  it("useNoteContentUndoRedo returns correct shape matching UseNoteContentUndoRedoResult", () => {
    const { result } = renderHook(() =>
      useNoteContentUndoRedo({ title: "Test", blocks: [] })
    )

    const value: UseNoteContentUndoRedoResult = result.current

    expect(value).toHaveProperty("present")
    expect(value).toHaveProperty("setTitle")
    expect(value).toHaveProperty("setSummary")
    expect(value).toHaveProperty("setBlocks")
    expect(value).toHaveProperty("canUndo")
    expect(value).toHaveProperty("canRedo")
    expect(value).toHaveProperty("undo")
    expect(value).toHaveProperty("redo")
    expect(value).toHaveProperty("resetHistory")
    expect(value).toHaveProperty("controller")
  })

  it("controller satisfies NoteContentUndoRedoController", () => {
    const { result } = renderHook(() =>
      useNoteContentUndoRedo({ title: "T", blocks: [] })
    )

    const controller: NoteContentUndoRedoController = result.current.controller

    expect(typeof controller.undo).toBe("function")
    expect(typeof controller.redo).toBe("function")
    expect(typeof controller.canUndo).toBe("function")
    expect(typeof controller.canRedo).toBe("function")
    expect(typeof controller.resetHistory).toBe("function")
  })

  it("present satisfies NoteContentUndoRedoSnapshot", () => {
    const { result } = renderHook(() =>
      useNoteContentUndoRedo({ title: "T", summary: "S", blocks: [] })
    )

    const snapshot: NoteContentUndoRedoSnapshot = result.current.present

    expect(snapshot.title).toBe("T")
    expect(snapshot.summary).toBe("S")
    expect(snapshot.blocks).toEqual([])
  })

  it("undo/redo via method and controller match", () => {
    const { result } = renderHook(() =>
      useNoteContentUndoRedo({ title: "A", blocks: [] })
    )

    // Mutate to create history
    act(() => {
      result.current.setTitle("B")
    })
    expect(result.current.canUndo).toBe(true)

    // Undo via method
    act(() => {
      const ok = result.current.undo()
      expect(ok).toBe(true)
    })
    expect(result.current.present.title).toBe("A")

    // Redo via controller
    act(() => {
      const ok = result.current.controller.redo()
      expect(ok).toBe(true)
    })
    expect(result.current.present.title).toBe("B")
  })

  it("the public handle types are importable (static type assertion)", () => {
    // This is a compile-time check: if imports fail above, TS won't compile.
    // At runtime, verify the types are actual objects/functions where expected.
    const handle: NoteContentUndoRedoHandle = {
      undo: () => true,
      redo: () => true,
      canUndo: () => true,
      canRedo: () => true,
      resetHistory: () => {}
    }
    expect(handle.undo()).toBe(true)

    const ctrl: NoteContentUndoRedoController = handle
    expect(ctrl.redo()).toBe(true)

    const contentHandle: NoteContentHandle = {
      ...handle,
      startExternalDrag: (): ExternalNoteDragStartResult => ({
        ok: false,
        reason: "not-editable"
      }),
      scrollToBlock: () => true
    }
    expect(contentHandle.scrollToBlock("block-1")).toBe(true)

    const externalItem: NoteExternalItem = {
      id: "host-item",
      content: "Linked content",
      clickable: true
    }
    expect(externalItem.clickable).toBe(true)

    const inferredHandle: ComponentRef<typeof NoteContent> = contentHandle
    expect(inferredHandle.scrollToBlock("block-1")).toBe(true)
  })
})
