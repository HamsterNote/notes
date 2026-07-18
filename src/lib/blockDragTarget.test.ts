import { describe, expect, it } from "vitest"

import { getBlockDragTarget, moveBlock } from "./blockDragTarget"
import type { NoteBlock } from "./types"

const blocks: readonly NoteBlock[] = [
  { id: "alpha", kind: "paragraph", text: "Alpha" },
  { id: "beta", kind: "paragraph", text: "Beta" },
  { id: "gamma", kind: "paragraph", text: "Gamma" }
]

describe("getBlockDragTarget", () => {
  it("targets the boundary after a block when the pointer crosses its midpoint", () => {
    // Given: the first block is dragged over the lower half of the last block.
    // When: the insertion target is calculated.
    const target = getBlockDragTarget({
      itemCount: 3,
      pointerOffset: 35,
      sourceIndex: 0,
      targetIndex: 2,
      targetSize: 40
    })

    // Then: the preview is after the last block and the source becomes last.
    expect(target).toEqual({ destinationIndex: 2, insertionIndex: 3 })
  })

  it("keeps the boundary immediately after the source as a no-op destination", () => {
    // Given: the middle block is dragged to its own trailing boundary.
    // When: the target is calculated from the lower half of that block.
    const target = getBlockDragTarget({
      itemCount: 3,
      pointerOffset: 30,
      sourceIndex: 1,
      targetIndex: 1,
      targetSize: 40
    })

    // Then: removing and reinserting the source would preserve its index.
    expect(target).toEqual({ destinationIndex: 1, insertionIndex: 2 })
  })
})

describe("moveBlock", () => {
  it("moves a block without mutating the controlled source array", () => {
    // Given: three controlled blocks in their original order.
    // When: the first block is moved to the final destination.
    const moved = moveBlock(blocks, 0, 2)

    // Then: a new array contains the requested order and the input is unchanged.
    expect(moved.map((block) => block.id)).toEqual(["beta", "gamma", "alpha"])
    expect(blocks.map((block) => block.id)).toEqual(["alpha", "beta", "gamma"])
  })

  it("returns the original array for an invalid destination", () => {
    // Given: a destination outside the controlled block list.
    // When: a move is requested.
    const moved = moveBlock(blocks, 0, 4)

    // Then: no replacement array is produced.
    expect(moved).toBe(blocks)
  })
})
