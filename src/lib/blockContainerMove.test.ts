import { describe, expect, it } from "vitest"

import { moveBlockToContainer } from "./blockContainerMove"
import type { NoteBlock } from "./types"

describe("moveBlockToContainer", () => {
  it("moves a top-level block into a nested container", () => {
    // Given: a paragraph before an expanded collapsible.
    const blocks: readonly NoteBlock[] = [
      { id: "intro", kind: "paragraph", text: "Intro" },
      {
        id: "fold",
        kind: "collapsible",
        title: "Details",
        collapsed: false,
        blocks: [{ id: "inside", kind: "paragraph", text: "Inside" }]
      }
    ]

    // When: the paragraph is appended to the collapsible's child container.
    const next = moveBlockToContainer({
      blocks,
      sourceBlockId: "intro",
      sourceContainerId: null,
      destination: {
        containerId: "fold",
        placement: "after",
        targetBlockId: "inside"
      }
    })

    // Then: only the collapsible remains at the top level with both children.
    expect(next.map((block) => block.id)).toEqual(["fold"])
    expect(next[0]?.kind === "collapsible" ? next[0].blocks.map((block) => block.id) : []).toEqual([
      "inside",
      "intro"
    ])
  })

  it("moves a nested block to the top level", () => {
    // Given: a collapsible child and a trailing body paragraph.
    const blocks: readonly NoteBlock[] = [
      {
        id: "fold",
        kind: "collapsible",
        title: "Details",
        collapsed: false,
        blocks: [{ id: "inside", kind: "paragraph", text: "Inside" }]
      },
      { id: "tail", kind: "paragraph", text: "Tail" }
    ]

    // When: the child is placed after the body paragraph.
    const next = moveBlockToContainer({
      blocks,
      sourceBlockId: "inside",
      sourceContainerId: "fold",
      destination: {
        containerId: null,
        placement: "after",
        targetBlockId: "tail"
      }
    })

    // Then: the child becomes the final top-level block.
    expect(next.map((block) => block.id)).toEqual(["fold", "tail", "inside"])
    expect(next[0]?.kind === "collapsible" ? next[0].blocks : []).toEqual([])
  })

  it("rejects moving a collapsible into its own descendant", () => {
    // Given: a collapsible owns a nested collapsible container.
    const blocks: readonly NoteBlock[] = [
      {
        id: "parent",
        kind: "collapsible",
        title: "Parent",
        collapsed: false,
        blocks: [
          {
            id: "child",
            kind: "collapsible",
            title: "Child",
            collapsed: false,
            blocks: []
          }
        ]
      }
    ]

    // When: the parent is targeted at its descendant's container.
    const next = moveBlockToContainer({
      blocks,
      sourceBlockId: "parent",
      sourceContainerId: null,
      destination: {
        containerId: "child",
        placement: "after",
        targetBlockId: null
      }
    })

    // Then: the original immutable tree is retained.
    expect(next).toBe(blocks)
  })

  it("preserves the original reference for an adjacent same-container no-op", () => {
    // Given: B already sits directly after A in the top-level container.
    const blocks: readonly NoteBlock[] = [
      { id: "a", kind: "paragraph", text: "A" },
      { id: "b", kind: "paragraph", text: "B" },
      { id: "c", kind: "paragraph", text: "C" }
    ]

    // When: B is dropped after A again.
    const next = moveBlockToContainer({
      blocks,
      sourceBlockId: "b",
      sourceContainerId: null,
      destination: {
        containerId: null,
        placement: "after",
        targetBlockId: "a"
      }
    })

    // Then: undo history is not polluted by an equivalent new tree.
    expect(next).toBe(blocks)
  })
})
