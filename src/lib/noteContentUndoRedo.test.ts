/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  DISABLED_CONTROLLER,
  isDisabledController,
  useNoteContentUndoRedo,
} from "./noteContentUndoRedo"
import type { NoteBlock, NoteContentUndoRedoSnapshot } from "./types"

// ── Helpers ──────────────────────────────────────────────────────────────────

function createSnapshot(
  overrides?: Partial<NoteContentUndoRedoSnapshot>,
): NoteContentUndoRedoSnapshot {
  const { summary, ...rest } = overrides ?? {}
  const base: NoteContentUndoRedoSnapshot = {
    title: rest.title ?? "Test Note",
    blocks: rest.blocks ?? [],
  }
  if (summary !== undefined) {
    return { ...base, summary }
  }
  return base
}

const makeBlock = (id: string, text?: string): NoteBlock => ({
  id,
  kind: "paragraph",
  text: text ?? `Block ${id}`,
})

// ── DISABLED_CONTROLLER (unchanged from Wave 1) ──────────────────────────────

describe("DISABLED_CONTROLLER", () => {
  it("undo() returns false and is a no-op", () => {
    const controller = DISABLED_CONTROLLER
    const result = controller.undo()
    expect(result).toBe(false)
  })

  it("redo() returns false and is a no-op", () => {
    const controller = DISABLED_CONTROLLER
    const result = controller.redo()
    expect(result).toBe(false)
  })

  it("canUndo() returns false", () => {
    const controller = DISABLED_CONTROLLER
    const result = controller.canUndo()
    expect(result).toBe(false)
  })

  it("canRedo() returns false", () => {
    const controller = DISABLED_CONTROLLER
    const result = controller.canRedo()
    expect(result).toBe(false)
  })

  it("resetHistory() does not throw when called with no arguments", () => {
    const controller = DISABLED_CONTROLLER
    expect(() => controller.resetHistory()).not.toThrow()
  })

  it("resetHistory() is idempotent", () => {
    const controller = DISABLED_CONTROLLER
    controller.resetHistory()
    controller.resetHistory()
    controller.resetHistory()
    expect(controller.undo()).toBe(false)
    expect(controller.redo()).toBe(false)
    expect(controller.canUndo()).toBe(false)
    expect(controller.canRedo()).toBe(false)
  })
})

describe("isDisabledController", () => {
  it("returns true for DISABLED_CONTROLLER itself", () => {
    expect(isDisabledController(DISABLED_CONTROLLER)).toBe(true)
  })

  it("returns false for a structurally identical controller object", () => {
    const lookalike: typeof DISABLED_CONTROLLER = {
      undo: () => false,
      redo: () => false,
      canUndo: () => false,
      canRedo: () => false,
      resetHistory: () => {
        /* no-op */
      },
    }
    expect(isDisabledController(lookalike)).toBe(false)
  })

  it("returns false for a real controller that returns true from canUndo", () => {
    const activeController = {
      undo: () => true,
      redo: () => false,
      canUndo: () => true,
      canRedo: () => false,
      resetHistory: () => {
        /* no-op */
      },
    }
    expect(isDisabledController(activeController)).toBe(false)
  })
})

// ── useNoteContentUndoRedo ────────────────────────────────────────────────────

describe("useNoteContentUndoRedo", () => {
  describe("initial state", () => {
    it("preserves title from initial snapshot", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ title: "My Title" })),
      )
      expect(result.current.present.title).toBe("My Title")
    })

    it("preserves optional summary from initial snapshot", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ summary: "My summary" })),
      )
      expect(result.current.present.summary).toBe("My summary")
    })

    it("handles initial snapshot without summary", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      expect(result.current.present.summary).toBeUndefined()
    })

    it("preserves readonly blocks from initial snapshot", () => {
      const blocks = [makeBlock("1"), makeBlock("2")] as const
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ blocks })),
      )
      expect(result.current.present.blocks).toHaveLength(2)
      expect(result.current.present.blocks).toEqual([
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ id: "2" }),
      ])
    })

    it("canUndo and canRedo are false with no history", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(false)
    })
  })

  describe("setTitle", () => {
    it("updates present.title", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        result.current.setTitle("Updated Title")
      })
      expect(result.current.present.title).toBe("Updated Title")
    })

    it("does not mutate prior state", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ title: "Original" })),
      )
      const prior = result.current.present
      act(() => {
        result.current.setTitle("New Title")
      })
      expect(prior.title).toBe("Original")
      expect(result.current.present.title).toBe("New Title")
    })
  })

  describe("setSummary", () => {
    it("updates present.summary with a string value", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        result.current.setSummary("New summary")
      })
      expect(result.current.present.summary).toBe("New summary")
    })

    it("removes summary when set to undefined", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ summary: "Existing" })),
      )
      act(() => {
        result.current.setSummary(undefined)
      })
      expect(result.current.present.summary).toBeUndefined()
      expect("summary" in result.current.present).toBe(false)
    })

    it("stores explicit empty string when set to empty string", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ summary: "Existing" })),
      )
      act(() => {
        result.current.setSummary("")
      })
      expect(result.current.present.summary).toBe("")
    })
  })

  describe("setBlocks", () => {
    it("updates present.blocks with new blocks", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      const newBlocks = [makeBlock("x"), makeBlock("y")]
      act(() => {
        result.current.setBlocks(newBlocks)
      })
      expect(result.current.present.blocks).toHaveLength(2)
      expect(result.current.present.blocks).toEqual([
        expect.objectContaining({ id: "x" }),
        expect.objectContaining({ id: "y" }),
      ])
    })

    it("does not mutate prior blocks array", () => {
      const initialBlocks = [makeBlock("a")]
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ blocks: initialBlocks })),
      )
      const priorBlocks = result.current.present.blocks
      act(() => {
        result.current.setBlocks([makeBlock("b")])
      })
      expect(priorBlocks).toHaveLength(1)
      expect(priorBlocks).toEqual([expect.objectContaining({ id: "a" })])
      expect(result.current.present.blocks).toEqual([
        expect.objectContaining({ id: "b" }),
      ])
    })

    it("preserves another field changed in the same React batch", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ title: "Original" })),
      )

      act(() => {
        result.current.setTitle("Updated")
        result.current.setBlocks([makeBlock("new")])
      })

      expect(result.current.present.title).toBe("Updated")
      expect(result.current.present.blocks).toEqual([
        expect.objectContaining({ id: "new" }),
      ])
    })
  })

  describe("commitTransaction", () => {
    it("restores the complete previous note in one undo step", () => {
      // Given: a note whose title, summary, and body all change together.
      const initial = createSnapshot({
        title: "Before",
        summary: "Summary",
        blocks: [makeBlock("before")],
      })
      const { result } = renderHook(() => useNoteContentUndoRedo(initial))

      // When: the complete next snapshot is committed as one transaction.
      act(() => {
        result.current.commitTransaction({
          title: "After",
          blocks: [makeBlock("after")],
        })
      })
      act(() => {
        result.current.undo()
      })

      // Then: one undo restores every field from the prior snapshot.
      expect(result.current.present).toEqual(initial)
      expect(result.current.canUndo).toBe(false)
    })
  })

  describe("undo / redo", () => {
    it("undo() returns true and restores previous present", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        result.current.setTitle("V2")
      })
      expect(result.current.present.title).toBe("V2")
      expect(result.current.canUndo).toBe(true)

      act(() => {
        const ok = result.current.undo()
        expect(ok).toBe(true)
      })
      expect(result.current.present.title).toBe("Test Note")
    })

    it("undo() returns false when nothing to undo", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        const ok = result.current.undo()
        expect(ok).toBe(false)
      })
    })

    it("redo() returns true and restores next present", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        result.current.setTitle("V2")
      })
      act(() => {
        result.current.undo()
      })
      expect(result.current.present.title).toBe("Test Note")
      expect(result.current.canRedo).toBe(true)

      act(() => {
        const ok = result.current.redo()
        expect(ok).toBe(true)
      })
      expect(result.current.present.title).toBe("V2")
    })

    it("redo() returns false when nothing to redo", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        const ok = result.current.redo()
        expect(ok).toBe(false)
      })
    })

    it("canUndo / canRedo reflect availability across history", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(false)

      act(() => {
        result.current.setTitle("V2")
      })
      expect(result.current.canUndo).toBe(true)
      expect(result.current.canRedo).toBe(false)

      act(() => {
        result.current.undo()
      })
      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(true)

      act(() => {
        result.current.redo()
      })
      expect(result.current.canUndo).toBe(true)
      expect(result.current.canRedo).toBe(false)
    })
  })

  describe("controller", () => {
    it("controller.undo() returns true and restores previous present", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        result.current.setTitle("V2")
      })
      act(() => {
        const ok = result.current.controller.undo()
        expect(ok).toBe(true)
      })
      expect(result.current.present.title).toBe("Test Note")
    })

    it("controller.undo() returns false when nothing to undo", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        const ok = result.current.controller.undo()
        expect(ok).toBe(false)
      })
    })

    it("controller.redo() returns true and restores next present", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        result.current.setTitle("V2")
      })
      act(() => {
        result.current.controller.undo()
      })
      act(() => {
        const ok = result.current.controller.redo()
        expect(ok).toBe(true)
      })
      expect(result.current.present.title).toBe("V2")
    })

    it("controller.redo() returns false when nothing to redo", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      act(() => {
        const ok = result.current.controller.redo()
        expect(ok).toBe(false)
      })
    })

    it("controller.canUndo() / canRedo() reflect availability", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot()),
      )
      expect(result.current.controller.canUndo()).toBe(false)
      expect(result.current.controller.canRedo()).toBe(false)

      act(() => {
        result.current.setTitle("V2")
      })
      expect(result.current.controller.canUndo()).toBe(true)
      expect(result.current.controller.canRedo()).toBe(false)

      act(() => {
        result.current.controller.undo()
      })
      expect(result.current.controller.canUndo()).toBe(false)
      expect(result.current.controller.canRedo()).toBe(true)
    })

    it("controller.resetHistory() clears history around current present", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ title: "Original" })),
      )
      act(() => {
        result.current.setTitle("V2")
      })
      expect(result.current.canUndo).toBe(true)

      act(() => {
        result.current.controller.resetHistory()
      })
      expect(result.current.present.title).toBe("V2")
      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(false)
    })
  })

  describe("resetHistory", () => {
    it("resetHistory() clears history around current present", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ title: "Original" })),
      )
      act(() => {
        result.current.setTitle("V2")
      })
      expect(result.current.canUndo).toBe(true)

      act(() => {
        result.current.resetHistory()
      })
      expect(result.current.present.title).toBe("V2")
      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(false)
    })

    it("resetHistory(nextSnapshot) resets to supplied snapshot and clears history", () => {
      const { result } = renderHook(() =>
        useNoteContentUndoRedo(createSnapshot({ title: "Original" })),
      )
      act(() => {
        result.current.setTitle("V2")
      })

      const fresh: NoteContentUndoRedoSnapshot = {
        title: "Fresh Start",
        blocks: [makeBlock("1")],
      }
      act(() => {
        result.current.resetHistory(fresh)
      })
      expect(result.current.present.title).toBe("Fresh Start")
      expect(result.current.present.blocks).toHaveLength(1)
      expect(result.current.present.blocks).toEqual([
        expect.objectContaining({ id: "1" }),
      ])
      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(false)
    })
  })
})
