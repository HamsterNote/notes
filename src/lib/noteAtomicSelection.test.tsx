/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
})

describe("NoteContent atomic selection state", () => {
  it("marks an atomic row selected for a reverse continuous text selection", () => {
    // Given: 表格行位于标题之后，两者都在同一笔记文本流中。
    const view = render(
      <NoteContent
        editable
        title="Alpha"
        blocks={[
          {
            id: "table",
            kind: "table",
            rows: [["One", "Two"]]
          }
        ]}
      />
    )
    const title = view.container.querySelector<HTMLElement>(
      '[data-note-region-id="title"]'
    )
    const row = view.container.querySelector<HTMLElement>(
      '[data-note-atomic-id="table:table:row:0"]'
    )
    if (!(title?.firstChild instanceof Text) || !row?.parentNode) {
      throw new Error("Expected title and atomic table row")
    }
    const rowIndex = Array.from(row.parentNode.childNodes).indexOf(row)

    // When: 连续文本选区从表格行末端反向延伸到标题。
    window.getSelection()?.setBaseAndExtent(
      row.parentNode,
      rowIndex + 1,
      title.firstChild,
      1
    )
    fireEvent(document, new Event("selectionchange"))

    // Then: 完整纳入的原子选择单元仍显示选中状态。
    expect(row.getAttribute("data-note-atomic-selected")).toBe("true")
  })
})
