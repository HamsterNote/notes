import { describe, expect, it } from "vitest"

import { resolveTableMoveFocus } from "./tableMoveFocus"

describe("resolveTableMoveFocus", () => {
  it("keeps focus on the same cell content when its row moves", () => {
    // Given: the focused cell belongs to the row being moved.
    const focusedCell = { row: 1, col: 2 }

    // When: that row moves from index 1 to index 3.
    const target = resolveTableMoveFocus("row", focusedCell, {
      sourceIndex: 1,
      destinationIndex: 3
    })

    // Then: focus follows the row while preserving its column.
    expect(target).toEqual({ row: 3, col: 2 })
  })

  it("keeps focus on the same cell content when another row crosses it", () => {
    // Given: the focused cell is below the row being moved.
    const focusedCell = { row: 2, col: 1 }

    // When: a row above it moves below it.
    const target = resolveTableMoveFocus("row", focusedCell, {
      sourceIndex: 0,
      destinationIndex: 3
    })

    // Then: the focused content shifts up by one row.
    expect(target).toEqual({ row: 1, col: 1 })
  })

  it("keeps focus on the same cell content when its column moves", () => {
    // Given: the focused cell belongs to the column being moved.
    const focusedCell = { row: 2, col: 1 }

    // When: that column moves from index 1 to index 3.
    const target = resolveTableMoveFocus("column", focusedCell, {
      sourceIndex: 1,
      destinationIndex: 3
    })

    // Then: focus follows the column while preserving its row.
    expect(target).toEqual({ row: 2, col: 3 })
  })

  it("keeps focus on the same cell content when another column crosses it", () => {
    // Given: the focused cell is left of the column being moved.
    const focusedCell = { row: 1, col: 1 }

    // When: a column to its right moves before it.
    const target = resolveTableMoveFocus("column", focusedCell, {
      sourceIndex: 3,
      destinationIndex: 0
    })

    // Then: the focused content shifts right by one column.
    expect(target).toEqual({ row: 1, col: 2 })
  })

  it("focuses the moved row's leftmost cell when no cell was focused", () => {
    // Given: no table cell held focus before the row drag.
    // When: a row moves to index 2.
    const target = resolveTableMoveFocus("row", null, {
      sourceIndex: 0,
      destinationIndex: 2
    })

    // Then: focus lands on the moved row's left edge.
    expect(target).toEqual({ row: 2, col: 0 })
  })

  it("focuses the moved column's top cell when no cell was focused", () => {
    // Given: no table cell held focus before the column drag.
    // When: a column moves to index 2.
    const target = resolveTableMoveFocus("column", null, {
      sourceIndex: 0,
      destinationIndex: 2
    })

    // Then: focus lands on the moved column's top edge.
    expect(target).toEqual({ row: 0, col: 2 })
  })
})
