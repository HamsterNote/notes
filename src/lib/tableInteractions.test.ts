/// <reference types="node" />

import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const readSource = (fileName: string): string =>
  readFileSync(new URL(fileName, import.meta.url), "utf8")

describe("editable table edge controls", () => {
  it("renders dedicated controls on all four table edges", () => {
    // Given: editable tables expose insertion controls on cell boundaries.
    const source = readSource("./NoteTableBlock.tsx")

    // When: the edge controls are inspected.
    // Then: every outer direction has an explicit placement class.
    expect(source).toContain("hn-note-table-edge-btn--left")
    expect(source).toContain("hn-note-table-edge-btn--right")
    expect(source).toContain("hn-note-table-edge-btn--top")
    expect(source).toContain("hn-note-table-edge-btn--bottom")
  })

  it("reserves the header boundaries while keeping four controls on inner cells", () => {
    // Given: the top edge belongs to column operations and the left edge belongs to row operations.
    const source = readSource("./NoteTableBlock.tsx")

    // When: the conditional rendering rules for left and top insertion controls are inspected.
    // Then: only cells beyond those headers render the preceding-column and preceding-row controls.
    expect(source).toContain("colIndex > 0")
    expect(source).toContain("openColumnEdgeMenu(event, colIndex)")
    expect(source).toContain("rowIndex > 0")
    expect(source).toContain("openRowEdgeMenu(event, rowIndex)")
    expect(source).not.toContain(
      "colIndex === 0 && rowIndex !== focusedRow"
    )
    expect(source).not.toContain(
      "rowIndex === 0 && colIndex !== focusedCol"
    )
  })

  it("keeps column and row insertion menus direction-specific", () => {
    // Given: left/right edges insert columns while top/bottom edges insert rows.
    const source = readSource("./useTableOperationMenus.ts")

    // When: the two edge menu builders are inspected.
    // Then: each builder offers exactly its matching insertion action.
    expect(source).toMatch(
      /const openColumnEdgeMenu[\s\S]*?label: "添加列"[\s\S]*?\n\s*\]\)/
    )
    expect(source).toMatch(
      /const openRowEdgeMenu[\s\S]*?label: "添加行"[\s\S]*?\n\s*\]\)/
    )
  })

  it("positions header operations on table boundaries", () => {
    // Given: focused row and column operations replace conflicting edge controls.
    const styles = readSource("./styles.css")

    // When: operation button geometry is inspected.
    // Then: both controls are centered over the corresponding boundary.
    expect(styles).toMatch(
      /\.hn-note-table-row-op\s*\{[^}]*left:\s*0;[^}]*transform:\s*translate\(-50%, -50%\);/
    )
    expect(styles).toMatch(
      /\.hn-note-table-col-op\s*\{[^}]*top:\s*0;[^}]*transform:\s*translate\(-50%, -50%\);/
    )
  })

  it("clears transient drag UI when the active pointer is cancelled", () => {
    // Given: a row or column handle has crossed the drag threshold.
    const source = readSource("./TableDragHandle.tsx")

    // When: the browser cancels the active pointer.
    // Then: both the insertion preview and dragging handle state are removed immediately.
    expect(source).toMatch(
      /const handlePointerCancel[\s\S]*?classList\.remove\("hn-note-table-drag-handle--dragging"\)[\s\S]*?clearDropPreview\?\.\(\)/
    )
  })

  it("does not treat a focused operation button as a focused table cell", () => {
    // Given: the drag handle itself can own document focus when a drag begins.
    const source = readSource("./useTableMoveFocus.ts")

    // When: the real focused-cell snapshot guard is inspected.
    // Then: only the editable textbox is accepted, so handle focus uses the edge fallback.
    expect(source).toContain(
      'activeElement.matches(".hn-note-table-cell[data-editable-block-id]")'
    )
  })
})

describe("destructive and trailing-row table interactions", () => {
  it("requires a second explicit action before deleting a row", () => {
    // Given: deleting a row is destructive but deleting a column keeps its existing flow.
    const source = readSource("./useTableOperationMenus.ts")
    const menuSource = readSource("./TableOperationMenu.tsx")

    // When: the row action definition is inspected.
    // Then: it provides a confirmation label consumed by the operation menu.
    expect(source).toMatch(
      /label: "删除行",[\s\S]*?confirmationLabel: "确认删除行"/
    )
    expect(menuSource).toContain("pendingConfirmationLabel")
  })

  it("reuses a trailing empty text line instead of appending another", () => {
    // Given: the body tail is the surface for appending an empty paragraph.
    const source = readSource("./NoteContent.tsx")

    // When: its click handler sees an existing empty paragraph or heading.
    // Then: it focuses that line and returns before creating a new block id.
    expect(source).toMatch(
      /isVisibleHtmlEmpty\(lastBlock\.text\)[\s\S]*?requestFocus\?\.\(lastBlock\.id, "start"\)[\s\S]*?return/
    )
  })
})
