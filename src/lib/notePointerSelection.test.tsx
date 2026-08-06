/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"

const originalCaretPositionFromPoint = Object.getOwnPropertyDescriptor(
  document,
  "caretPositionFromPoint"
)

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  if (originalCaretPositionFromPoint) {
    Object.defineProperty(
      document,
      "caretPositionFromPoint",
      originalCaretPositionFromPoint
    )
  } else {
    Reflect.deleteProperty(document, "caretPositionFromPoint")
  }
})

describe("NoteContent pointer selection", () => {
  it("extends a mouse selection across sibling editable note regions", () => {
    // Given: 标题与摘要是两个独立的 contenteditable 编辑宿主。
    const view = render(
      <NoteContent
        editable
        title="Alpha"
        summary="Summary"
        blocks={[]}
      />
    )
    const title = view.container.querySelector<HTMLElement>(
      '[data-note-region-id="title"]'
    )
    const summary = view.container.querySelector<HTMLElement>(
      '[data-note-region-id="summary"]'
    )
    if (
      !(title?.firstChild instanceof Text) ||
      !(summary?.firstChild instanceof Text)
    ) {
      throw new Error("Expected title and summary text regions")
    }
    const titleText = title.firstChild
    const summaryText = summary.firstChild
    const caretPositionFromPoint: Document["caretPositionFromPoint"] = (
      _x,
      y
    ) => ({
      offsetNode: y < 50 ? titleText : summaryText,
      offset: y < 50 ? 1 : 2,
      getClientRect: () => null
    })
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: caretPositionFromPoint
    })

    // When: 用户按住鼠标，从标题拖到摘要。
    fireEvent.pointerDown(title, {
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 10,
      pointerId: 7,
      pointerType: "mouse"
    })
    fireEvent.pointerMove(summary, {
      button: 0,
      buttons: 1,
      clientX: 20,
      clientY: 80,
      pointerId: 7,
      pointerType: "mouse"
    })
    fireEvent.pointerUp(summary, {
      button: 0,
      buttons: 0,
      clientX: 20,
      clientY: 80,
      pointerId: 7,
      pointerType: "mouse"
    })

    // Then: Selection 的锚点与焦点真实落在两个不同的笔记区域。
    const selection = window.getSelection()
    expect(selection?.anchorNode).toBe(titleText)
    expect(selection?.anchorOffset).toBe(1)
    expect(selection?.focusNode).toBe(summaryText)
    expect(selection?.focusOffset).toBe(2)
    expect(selection?.getRangeAt(0).toString()).toBe("lphaSu")
  })

  it("includes a complete atomic row when dragging into a table", () => {
    // Given: 普通文本区域后方是一个只能整体纳入笔记级选区的表格行。
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
    const cell = row?.querySelector<HTMLElement>('[contenteditable="true"]')
    if (
      !(title?.firstChild instanceof Text) ||
      !(cell?.firstChild instanceof Text) ||
      !row
    ) {
      throw new Error("Expected title and atomic table row")
    }
    const titleText = title.firstChild
    const cellText = cell.firstChild
    const caretPositionFromPoint: Document["caretPositionFromPoint"] = (
      _x,
      y
    ) => ({
      offsetNode: y < 50 ? titleText : cellText,
      offset: 1,
      getClientRect: () => null
    })
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: caretPositionFromPoint
    })

    // When: 用户从标题拖入表格第一行。
    fireEvent.pointerDown(title, {
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 10,
      pointerId: 9,
      pointerType: "mouse"
    })
    fireEvent.pointerMove(cell, {
      button: 0,
      buttons: 1,
      clientX: 20,
      clientY: 80,
      pointerId: 9,
      pointerType: "mouse"
    })

    // Then: Range 覆盖整行边界，而不是停留在标题编辑宿主中。
    const selection = window.getSelection()
    const range = selection?.getRangeAt(0)
    const rowRange = document.createRange()
    rowRange.selectNode(row)
    expect(range?.intersectsNode(row)).toBe(true)
    expect(
      range?.compareBoundaryPoints(Range.END_TO_END, rowRange)
    ).toBeGreaterThanOrEqual(0)
    expect(row.getAttribute("data-note-atomic-selected")).toBe("true")
  })

  it("clears the atomic selection state when the selection collapses", () => {
    // Given: 表格行已被一个完整覆盖其 DOM 边界的连续文本选区纳入。
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
    window.getSelection()?.setBaseAndExtent(
      title.firstChild,
      1,
      row.parentNode,
      rowIndex + 1
    )
    fireEvent(document, new Event("selectionchange"))
    expect(row.getAttribute("data-note-atomic-selected")).toBe("true")

    // When: 用户单击文字，把连续文本选区收回为折叠光标。
    window.getSelection()?.collapse(title.firstChild, 2)
    fireEvent(document, new Event("selectionchange"))

    // Then: 原子选择单元的临时视觉状态同步清除。
    expect(row.hasAttribute("data-note-atomic-selected")).toBe(false)
  })

  it("makes block add and convert handles non-selectable", () => {
    // Given: 可编辑文字内容块渲染了左侧加号和转换 handle。
    const view = render(
      <NoteContent
        editable
        title="Alpha"
        blocks={[{ id: "paragraph", kind: "paragraph", text: "Body" }]}
        onBlocksChange={() => undefined}
      />
    )
    const handles = view.container.querySelectorAll<HTMLElement>(
      ".hn-note-block-handle"
    )

    // When: 选区桥接识别控制柄的原生按钮语义。
    // Then: 两个控制柄都沿用桥接已排除的按钮边界。
    expect(handles).toHaveLength(2)
    for (const handle of handles) {
      expect(handle).toBeInstanceOf(HTMLButtonElement)
    }
  })

  it("does not append a block for the body click synthesized after a cross-block drag", () => {
    // Given: 鼠标拖选已经在两个正文内容块之间建立了非折叠 Selection。
    const onBlocksChange = vi.fn()
    const view = render(
      <NoteContent
        editable
        title="Alpha"
        blocks={[
          { id: "first", kind: "paragraph", text: "First" },
          { id: "second", kind: "paragraph", text: "Second" }
        ]}
        onBlocksChange={onBlocksChange}
      />
    )
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")
    const first = view.container.querySelector<HTMLElement>(
      '[data-note-region-id="block:first"]'
    )
    const second = view.container.querySelector<HTMLElement>(
      '[data-note-region-id="block:second"]'
    )
    if (
      !body ||
      !(first?.firstChild instanceof Text) ||
      !(second?.firstChild instanceof Text)
    ) {
      throw new Error("Expected two editable body regions")
    }
    window.getSelection()?.setBaseAndExtent(
      first.firstChild,
      1,
      second.firstChild,
      2
    )

    // When: Chromium 在拖动结束后把 click 合成到两端的共同祖先正文容器。
    fireEvent.click(body)

    // Then: 该 click 不能被当作用户点击正文空白区来新增内容块。
    expect(onBlocksChange).not.toHaveBeenCalled()
  })
})
