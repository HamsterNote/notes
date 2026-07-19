/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

type Rect = Readonly<{ height: number; top: number }>

const setRect = (element: HTMLElement, { height, top }: Rect): void => {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom: top + height,
    height,
    left: 0,
    right: 400,
    top,
    width: 400,
    x: 0,
    y: top,
    toJSON: () => ({})
  })
}

const dragMouse = (
  handle: Element,
  startY: number,
  destinationY: number
): void => {
  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 20,
    clientY: startY,
    pointerId: 1,
    pointerType: "mouse"
  })
  fireEvent.pointerMove(document, {
    clientX: 20,
    clientY: destinationY,
    pointerId: 1,
    pointerType: "mouse"
  })
  fireEvent.pointerUp(document, {
    clientX: 20,
    clientY: destinationY,
    pointerId: 1,
    pointerType: "mouse"
  })
}

const directSortableIds = (container: HTMLElement): (string | null)[] =>
  Array.from(container.children)
    .filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.hasAttribute("data-note-sortable-id")
    )
    .map((element) => element.getAttribute("data-note-sortable-id"))

const ControlledNote = ({ initialBlocks }: { initialBlocks: readonly NoteBlock[] }) => {
  const [blocks, setBlocks] = useState(initialBlocks)
  return (
    <NoteContent
      blocks={blocks}
      title="Collapsible block drag"
      editable
      onBlocksChange={setBlocks}
    />
  )
}

describe("NoteContent collapsible block dragging", () => {
  it("moves a block from an expanded collapsible to the note body", () => {
    // Given: an expanded collapsible contains a paragraph before a body-level tail.
    const view = render(
      <ControlledNote
        initialBlocks={[
          {
            id: "fold",
            kind: "collapsible",
            title: "Details",
            collapsed: false,
            blocks: [{ id: "inside", kind: "paragraph", text: "Inside" }]
          },
          { id: "tail", kind: "paragraph", text: "Tail" }
        ]}
      />
    )
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")
    const fold = view.container.querySelector<HTMLElement>('[data-note-sortable-id="fold"]')
    const inside = view.container.querySelector<HTMLElement>('[data-note-sortable-id="inside"]')
    const tail = view.container.querySelector<HTMLElement>('[data-note-sortable-id="tail"]')
    const handle = view.container.querySelector(
      '[data-block-id="inside"][data-block-menu-mode="convert"]'
    )
    if (!body || !fold || !inside || !tail || !handle) {
      throw new Error("Expected the collapsible child and its drag handle.")
    }
    setRect(fold, { top: 0, height: 100 })
    setRect(inside, { top: 40, height: 40 })
    setRect(tail, { top: 120, height: 40 })

    // When: the child handle is dragged below the body-level tail.
    dragMouse(handle, 60, 180)

    // Then: the child leaves the collapsible and becomes the final body block.
    expect(directSortableIds(body)).toEqual(["fold", "tail", "inside"])
    const collapsibleBody = view.container.querySelector<HTMLElement>(
      ".hn-note-collapsible-body"
    )
    expect(collapsibleBody && directSortableIds(collapsibleBody)).toEqual([])
  })

  it("moves a body block into an expanded collapsible", () => {
    // Given: a body paragraph precedes an expanded collapsible with one child.
    const view = render(
      <ControlledNote
        initialBlocks={[
          { id: "intro", kind: "paragraph", text: "Intro" },
          {
            id: "fold",
            kind: "collapsible",
            title: "Details",
            collapsed: false,
            blocks: [{ id: "inside", kind: "paragraph", text: "Inside" }]
          }
        ]}
      />
    )
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")
    const intro = view.container.querySelector<HTMLElement>('[data-note-sortable-id="intro"]')
    const fold = view.container.querySelector<HTMLElement>('[data-note-sortable-id="fold"]')
    const inside = view.container.querySelector<HTMLElement>('[data-note-sortable-id="inside"]')
    const collapsibleBody = view.container.querySelector<HTMLElement>(
      ".hn-note-collapsible-body"
    )
    const handle = view.container.querySelector(
      '[data-block-id="intro"][data-block-menu-mode="convert"]'
    )
    if (!body || !intro || !fold || !inside || !collapsibleBody || !handle) {
      throw new Error("Expected the body block and expanded collapsible target.")
    }
    setRect(intro, { top: 0, height: 40 })
    setRect(fold, { top: 60, height: 120 })
    setRect(collapsibleBody, { top: 90, height: 70 })
    setRect(inside, { top: 100, height: 40 })

    // When: the body block is dragged below the child inside the collapsible.
    dragMouse(handle, 20, 130)

    // Then: it is removed from the note body and appended inside the collapsible.
    expect(directSortableIds(body)).toEqual(["fold"])
    expect(directSortableIds(collapsibleBody)).toEqual(["inside", "intro"])
  })

  it("moves a body block into an empty expanded collapsible", () => {
    // Given: an expanded collapsible has an empty but visible body.
    const view = render(
      <ControlledNote
        initialBlocks={[
          { id: "intro", kind: "paragraph", text: "Intro" },
          {
            id: "fold",
            kind: "collapsible",
            title: "Empty details",
            collapsed: false,
            blocks: []
          }
        ]}
      />
    )
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")
    const intro = view.container.querySelector<HTMLElement>('[data-note-sortable-id="intro"]')
    const fold = view.container.querySelector<HTMLElement>('[data-note-sortable-id="fold"]')
    const collapsibleBody = view.container.querySelector<HTMLElement>(
      ".hn-note-collapsible-body"
    )
    const handle = view.container.querySelector(
      '[data-block-id="intro"][data-block-menu-mode="convert"]'
    )
    if (!body || !intro || !fold || !collapsibleBody || !handle) {
      throw new Error("Expected the body block and empty collapsible target.")
    }
    setRect(intro, { top: 0, height: 40 })
    setRect(fold, { top: 60, height: 100 })
    setRect(collapsibleBody, { top: 100, height: 40 })

    // When: the body block is dragged over the empty collapsible body.
    dragMouse(handle, 20, 120)

    // Then: the block becomes the empty collapsible's first child.
    expect(directSortableIds(body)).toEqual(["fold"])
    const nextCollapsibleBody = view.container.querySelector<HTMLElement>(
      ".hn-note-collapsible-body"
    )
    expect(nextCollapsibleBody && directSortableIds(nextCollapsibleBody)).toEqual([
      "intro"
    ])
  })
})
