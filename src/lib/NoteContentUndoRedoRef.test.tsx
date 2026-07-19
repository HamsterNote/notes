/** @vitest-environment jsdom */

import { render } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import { DISABLED_CONTROLLER } from "./noteContentUndoRedo"
import type {
  NoteBlock,
  NoteContentHandle,
  NoteContentUndoRedoController,
  NoteContentUndoRedoHandle
} from "./types"

// ── NoteContent undo/redo ref bridge ──────────────────────────────────────────

describe("NoteContent undo/redo ref bridge", () => {
  it("delegates ref methods to the provided undoRedoController", () => {
    const fakeUndo = vi.fn(() => true)
    const fakeRedo = vi.fn(() => false)
    const fakeCanUndo = vi.fn(() => true)
    const fakeCanRedo = vi.fn(() => false)
    const fakeResetHistory = vi.fn()

    const fakeController: NoteContentUndoRedoController = {
      undo: fakeUndo,
      redo: fakeRedo,
      canUndo: fakeCanUndo,
      canRedo: fakeCanRedo,
      resetHistory: fakeResetHistory
    }

    const noteRef = createRef<NoteContentHandle>()
    render(
      <NoteContent
        ref={noteRef}
        undoRedoController={fakeController}
        blocks={[]}
        title=""
      />
    )

    const handle = noteRef.current
    if (!handle) throw new Error("Expected NoteContent ref handle")
    expect(handle.undo()).toBe(true)
    expect(fakeUndo).toHaveBeenCalledOnce()
    expect(handle.redo()).toBe(false)
    expect(fakeRedo).toHaveBeenCalledOnce()
    expect(handle.canUndo()).toBe(true)
    expect(fakeCanUndo).toHaveBeenCalledOnce()
    expect(handle.canRedo()).toBe(false)
    expect(fakeCanRedo).toHaveBeenCalledOnce()
    handle.resetHistory()
    expect(fakeResetHistory).toHaveBeenCalledOnce()
  })

  it("provides safe no-op ref methods when no undoRedoController is given", () => {
    const noteRef = createRef<NoteContentHandle>()
    render(<NoteContent ref={noteRef} blocks={[]} title="" />)

    const handle = noteRef.current
    if (!handle) throw new Error("Expected NoteContent ref handle")
    expect(handle.undo()).toBe(false)
    expect(handle.redo()).toBe(false)
    expect(handle.canUndo()).toBe(false)
    expect(handle.canRedo()).toBe(false)
    expect(() => handle.resetHistory()).not.toThrow()
  })

  it("accepts the legacy undo-redo-only ref type", () => {
    // Given: a consumer created against the original public ref handle.
    const noteRef = createRef<NoteContentUndoRedoHandle>()

    // When: the legacy ref is passed to the current component.
    render(<NoteContent ref={noteRef} blocks={[]} title="" />)

    // Then: its original undo/redo surface remains available.
    expect(noteRef.current?.canUndo()).toBe(false)
  })

  it("returns DISABLED_CONTROLLER when undoRedoController is undefined", () => {
    // Verify the default controller is identity-equal to DISABLED_CONTROLLER
    // by checking that all methods match DISABLED_CONTROLLER's behavior.
    const noteRef = createRef<NoteContentHandle>()
    render(<NoteContent ref={noteRef} blocks={[]} title="" />)

    const handle = noteRef.current
    if (!handle) throw new Error("Expected NoteContent ref handle")
    expect(handle.undo()).toBe(DISABLED_CONTROLLER.undo())
    expect(handle.redo()).toBe(DISABLED_CONTROLLER.redo())
    expect(handle.canUndo()).toBe(DISABLED_CONTROLLER.canUndo())
    expect(handle.canRedo()).toBe(DISABLED_CONTROLLER.canRedo())
  })
})

describe("NoteContent block navigation ref bridge", () => {
  const ids = {
    title: "0bc93ba2-6969-474a-9a43-70dd63c3e2c6",
    intro: "3fdcf66d-13ae-445f-b033-4db9302e8cf4",
    tasks: "b43733ee-d0e9-4fd1-9d92-61f6eb3b8b71",
    taskFirst: "b286c682-cf82-45f0-b25a-99e8d71e0110",
    taskSecond: "1ddc9c91-e829-4db6-babf-716f81f6dcbd",
    closing: "6ff8f9c4-f17f-4b03-aa44-ef68e88105e1",
    sample: "d896695f-1eff-4ca5-8a2d-b57e9516e1ba",
    notice: "71a8be29-2fba-4ad9-940a-8ef943a591a3",
    grid: "cdf4c6f9-49d2-46df-b272-06a34cb2468d",
    equation: "586ad628-3625-4abc-b88d-ebca5ac47d3b",
    illustration: "a7345ff0-5683-4441-9671-815bb4034af7"
  } as const
  const blocks: readonly NoteBlock[] = [
    { id: ids.title, kind: "heading", level: 2, text: "Title" },
    { id: ids.intro, kind: "paragraph", text: "Intro" },
    {
      id: ids.tasks,
      kind: "todo",
      title: "Tasks",
      items: [
        { id: ids.taskFirst, checked: false, text: "First" },
        { id: ids.taskSecond, checked: true, text: "Second" }
      ]
    },
    { id: ids.closing, kind: "quote", text: "Closing" },
    { id: ids.sample, kind: "code", language: "text", code: "sample" },
    {
      id: ids.notice,
      kind: "callout",
      tone: "info",
      title: "Notice",
      text: "Details"
    },
    { id: ids.grid, kind: "table", rows: [["Header"], ["Value"]] },
    { id: ids.equation, kind: "formula", formula: "x^2" },
    {
      id: ids.illustration,
      kind: "picture",
      url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      filename: "Illustration"
    }
  ]

  it("maps each body-level render unit to its data id", () => {
    const { container } = render(
      <NoteContent blocks={blocks} title="Block ids" />
    )

    const blockIds = Array.from(
      container.querySelectorAll<HTMLElement>(".hn-note-body > [id]"),
      (block) => block.id
    )

    expect(blockIds).toEqual([
      ids.title,
      ids.intro,
      ids.taskFirst,
      ids.taskSecond,
      ids.closing,
      ids.sample,
      ids.notice,
      ids.grid,
      ids.equation,
      ids.illustration
    ])
    expect(container.querySelector(".hn-note-todo")).toBeNull()
  })

  it("scrolls the matching block id into view", () => {
    const noteRef = createRef<NoteContentHandle>()
    const { container } = render(
      <NoteContent ref={noteRef} blocks={blocks} title="Block ids" />
    )
    const target = container.querySelector<HTMLElement>(
      `[id="${ids.taskSecond}"]`
    )
    if (!target) throw new Error("Expected todo item target")
    const scrollIntoView = vi.fn()
    const focus = vi.fn()
    target.scrollIntoView = scrollIntoView
    target.focus = focus

    const didScroll = noteRef.current?.scrollToBlock(ids.taskSecond)

    expect(didScroll).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center"
    })
    expect(target.tabIndex).toBe(-1)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it("scrolls a persisted todo block id to its first rendered item", () => {
    // Given: a todo whose persisted id differs from its direct item ids.
    const noteRef = createRef<NoteContentHandle>()
    const { container } = render(
      <NoteContent ref={noteRef} blocks={blocks} title="Block ids" />
    )
    const target = container.querySelector<HTMLElement>(
      `[id="${ids.taskFirst}"]`
    )
    if (!target) throw new Error("Expected first todo item target")
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    target.focus = vi.fn()

    // When: the public navigation API receives the persisted todo id.
    const didScroll = noteRef.current?.scrollToBlock(ids.tasks)

    // Then: navigation resolves the flattened todo to its first item.
    expect(didScroll).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("keeps an empty todo visible without an aggregate wrapper", () => {
    // Given: a persisted todo with a title and no items.
    const emptyTodo: readonly NoteBlock[] = [
      { id: ids.tasks, kind: "todo", title: "Empty tasks", items: [] }
    ]

    // When: the note renders in read-only mode.
    const { container } = render(
      <NoteContent blocks={emptyTodo} title="Block ids" />
    )

    // Then: one direct empty-state block preserves the todo title and id.
    const emptyBlock = container.querySelector<HTMLElement>(
      `.hn-note-body > [id="${ids.tasks}"]`
    )
    expect(emptyBlock?.classList.contains("hn-note-todo-empty")).toBe(true)
    expect(emptyBlock?.textContent).toContain("Empty tasks")
    expect(container.querySelector(".hn-note-todo")).toBeNull()
  })

  it("returns false when the block id is not rendered", () => {
    const noteRef = createRef<NoteContentHandle>()
    render(<NoteContent ref={noteRef} blocks={blocks} title="Block ids" />)

    const didScroll = noteRef.current?.scrollToBlock(
      "a6739856-a9e9-43fc-9ba4-42074ffb2527"
    )

    expect(didScroll).toBe(false)
  })
})
