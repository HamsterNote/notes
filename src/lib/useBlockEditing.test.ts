/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest"

import { focusEditableBlock } from "./useBlockEditing"

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

describe("focusEditableBlock", () => {
  it("focuses a block whose id contains selector syntax", () => {
    // Given: 公开 block id 包含 CSS attribute selector 中有语义的字符。
    const blockId = 'section"]draft'
    const root = document.createElement("div")
    const editable = document.createElement("div")
    editable.setAttribute("contenteditable", "true")
    editable.setAttribute("data-editable-block-id", blockId)
    editable.textContent = "Focus me"
    root.append(editable)
    document.body.append(root)

    // When: 编辑流程请求聚焦该 block 的起点。
    focusEditableBlock(blockId, "start", root)

    // Then: id 不会被解释为 selector，目标获得焦点且光标位于起点。
    expect(document.activeElement).toBe(editable)
    const selection = window.getSelection()
    expect(selection?.isCollapsed).toBe(true)
    expect(selection?.anchorNode).toBe(editable)
    expect(selection?.anchorOffset).toBe(0)
  })
})
