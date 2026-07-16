import { describe, expect, it } from "vitest"

import { moveTableColumn, moveTableRow } from "./tableEditing"
import type { NoteBlock, NoteTableBlock } from "./types"

const table: NoteTableBlock = {
  id: "features",
  kind: "table",
  rows: [
    ["Feature", "Status", "Notes"],
    ["Theme", "Done", "Colors"],
    ["Editing", "Active", "Inline"]
  ]
}

const blocks: readonly NoteBlock[] = [table]

describe("moveTableRow", () => {
  it("moves a row to the hovered row without mutating the source table", () => {
    // Given: a three-row table whose second row is dragged.
    const originalRows = table.rows

    // When: the second row is moved after the final row.
    const moved = moveTableRow(blocks, table.id, 1, 2)

    // Then: the row order changes and the original data remains untouched.
    expect(moved[0]).toMatchObject({
      rows: [table.rows[0], table.rows[2], table.rows[1]]
    })
    expect(table.rows).toBe(originalRows)
  })

  it("returns the table unchanged when a row index is outside its bounds", () => {
    // Given: a valid table and an invalid source row.
    // When: the invalid row is moved.
    const moved = moveTableRow(blocks, table.id, 8, 0)

    // Then: no replacement table is created.
    expect(moved[0]).toBe(table)
  })
})

describe("moveTableColumn", () => {
  it("moves the same column in every row without mutating the source table", () => {
    // Given: a rectangular three-column table.
    const originalRows = table.rows

    // When: the first column is moved to the final position.
    const moved = moveTableColumn(blocks, table.id, 0, 2)

    // Then: every row receives the identical column permutation.
    expect(moved[0]).toMatchObject({
      rows: [
        ["Status", "Notes", "Feature"],
        ["Done", "Colors", "Theme"],
        ["Active", "Inline", "Editing"]
      ]
    })
    expect(table.rows).toBe(originalRows)
  })

  it("returns the table unchanged when a column index is outside its bounds", () => {
    // Given: a valid table and an invalid destination column.
    // When: the column is moved outside the table.
    const moved = moveTableColumn(blocks, table.id, 0, 8)

    // Then: no replacement table is created.
    expect(moved[0]).toBe(table)
  })
})
