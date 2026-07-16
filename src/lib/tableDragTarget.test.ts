import { describe, expect, it } from "vitest"

import { getTableDragTarget } from "./tableDragTarget"

describe("getTableDragTarget", () => {
  it("targets the boundary after a cell when the pointer crosses its midpoint", () => {
    // Given: the second row is dragged over the lower half of the third row.
    // When: the insertion target is calculated.
    const target = getTableDragTarget({
      sourceIndex: 1,
      targetIndex: 2,
      itemCount: 4,
      pointerOffset: 30,
      targetSize: 40
    })

    // Then: the preview sits after row 3 and the moved row becomes row 3.
    expect(target).toEqual({ insertionIndex: 3, destinationIndex: 2 })
  })

  it("targets the boundary before a cell when the pointer remains before its midpoint", () => {
    // Given: the final column is dragged over the left half of the first column.
    // When: the insertion target is calculated.
    const target = getTableDragTarget({
      sourceIndex: 3,
      targetIndex: 0,
      itemCount: 4,
      pointerOffset: 12,
      targetSize: 40
    })

    // Then: the preview and final destination both point to the table start.
    expect(target).toEqual({ insertionIndex: 0, destinationIndex: 0 })
  })

  it("keeps adjacent insertion boundaries as no-op destinations", () => {
    // Given: a row is dragged to the boundary immediately after itself.
    // When: the insertion target is calculated from the next row's upper half.
    const target = getTableDragTarget({
      sourceIndex: 1,
      targetIndex: 2,
      itemCount: 4,
      pointerOffset: 8,
      targetSize: 40
    })

    // Then: removing and reinserting the row would leave it at the same index.
    expect(target).toEqual({ insertionIndex: 2, destinationIndex: 1 })
  })

  it("rejects targets outside the table bounds", () => {
    // Given: an element reports a target index that the current table does not own.
    // When: the insertion target is calculated.
    const target = getTableDragTarget({
      sourceIndex: 1,
      targetIndex: 5,
      itemCount: 4,
      pointerOffset: 8,
      targetSize: 40
    })

    // Then: no preview or move destination is produced.
    expect(target).toBeNull()
  })
})
