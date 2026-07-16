/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock, NoteTableBlock } from "./types"

const initialTable: NoteTableBlock = {
  id: "table",
  kind: "table",
  rows: [
    ["A1", "A2", "A3"],
    ["B1", "B2", "B3"],
    ["C1", "C2", "C3"]
  ]
}

const renderEditableTable = () => {
  const Harness = () => {
    const [blocks, setBlocks] = useState<readonly NoteBlock[]>([initialTable])
    return (
      <NoteContent
        blocks={blocks}
        title="Table operations"
        editable
        onBlocksChange={setBlocks}
      />
    )
  }

  return render(<Harness />)
}

const getCell = (container: HTMLElement, row: number, col: number) => {
  const cell = container.querySelector<HTMLElement>(
    `[data-editable-block-id="table-r${row}-c${col}"]`
  )
  if (!cell) throw new Error(`Expected table cell at row ${row}, column ${col}.`)
  return cell
}

const getOperationHandle = (container: HTMLElement, label: string) => {
  const handle = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.getAttribute("aria-label") === label)
  if (!handle) throw new Error(`Expected operation handle labeled ${label}.`)
  return handle
}

const getTableValues = (container: HTMLElement): string[][] =>
  Array.from(container.querySelectorAll<HTMLTableRowElement>(".hn-note-table tr"))
    .map((row) =>
      Array.from(row.querySelectorAll<HTMLElement>("[data-editable-block-id]"))
        .map((cell) => cell.textContent ?? "")
    )

afterEach(cleanup)

describe("NoteContent table operation menus", () => {
  it("inserts a row after the row whose operation menu is open", async () => {
    // Given: the second row has focus and exposes its row operation handle.
    const view = renderEditableTable()
    fireEvent.focus(getCell(view.container, 1, 1))

    // When: the user chooses to add a row from that row's operation menu.
    fireEvent.click(getOperationHandle(view.container, "行操作"))
    fireEvent.click(await screen.findByRole("menuitem", { name: "添加行" }))

    // Then: the empty row appears immediately after the focused row.
    await waitFor(() => {
      expect(getTableValues(view.container)).toEqual([
        ["A1", "A2", "A3"],
        ["B1", "B2", "B3"],
        ["", "", ""],
        ["C1", "C2", "C3"]
      ])
    })
  })

  it("inserts a column after the column whose operation menu is open", async () => {
    // Given: the second column has focus and exposes its column operation handle.
    const view = renderEditableTable()
    fireEvent.focus(getCell(view.container, 1, 1))

    // When: the user chooses to add a column from that column's operation menu.
    fireEvent.click(getOperationHandle(view.container, "列操作"))
    fireEvent.click(await screen.findByRole("menuitem", { name: "添加列" }))

    // Then: the empty column appears immediately after the focused column.
    await waitFor(() => {
      expect(getTableValues(view.container)).toEqual([
        ["A1", "A2", "", "A3"],
        ["B1", "B2", "", "B3"],
        ["C1", "C2", "", "C3"]
      ])
    })
  })
})
