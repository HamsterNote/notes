/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

// 受控 harness：onBlocksChange 写回 state，模拟真实宿主（demo）的数据流
const Harness = ({ initialBlock }: { initialBlock: NoteBlock }) => {
  const [blocks, setBlocks] = useState<readonly NoteBlock[]>([initialBlock])
  return (
    <NoteContent
      blocks={blocks}
      title="inline markdown"
      editable
      onBlocksChange={setBlocks}
    />
  )
}

const renderParagraph = (text: string) => {
  const view = render(
    <Harness initialBlock={{ id: "p", kind: "paragraph", text: "" }} />
  )
  const editable = view.container.querySelector<HTMLElement>(
    '[data-editable-block-id="p"]'
  )
  if (!editable) throw new Error("Expected editable paragraph.")
  // 模拟用户已键入的字符：直接写入 textContent（不经 onInput 同步），
  // 与真实浏览器中「字符已插入 DOM 但 React state 尚未更新」的瞬间一致
  editable.textContent = text
  const textNode = editable.firstChild
  if (!(textNode instanceof Text)) throw new Error("Expected text node.")
  const range = document.createRange()
  range.setStart(textNode, text.length)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return { view, editable }
}

describe("NoteContent Markdown 行内自动转换（R7）", () => {
  afterEach(() => {
    cleanup()
  })

  it("输入闭合反引号后 `` `foo`` 自动转换为行内 <code>，且按键被拦截", () => {
    const { editable } = renderParagraph("`foo")

    const notPrevented = fireEvent.keyDown(editable, { key: "`" })

    expect(notPrevented).toBe(false)
    expect(editable.innerHTML).toBe(
      '<code class="hn-note-inline-code">foo</code>'
    )
  })

  it("输入 **foo** 的最后一个 * 后转换为 <strong>", () => {
    const { editable } = renderParagraph("**foo*")

    fireEvent.keyDown(editable, { key: "*" })

    expect(editable.innerHTML).toBe("<strong>foo</strong>")
  })

  it("输入 *foo* 的闭合 * 后转换为 <em>", () => {
    const { editable } = renderParagraph("*foo")

    fireEvent.keyDown(editable, { key: "*" })

    expect(editable.innerHTML).toBe("<em>foo</em>")
  })

  it("输入 ~~foo~~ 的最后一个 ~ 后转换为 <s>", () => {
    const { editable } = renderParagraph("~~foo~")

    fireEvent.keyDown(editable, { key: "~" })

    expect(editable.innerHTML).toBe("<s>foo</s>")
  })

  it("转换后的第一个字符落在格式元素之外（Chrome 粘滞规避）", () => {
    const { editable } = renderParagraph("`foo")

    fireEvent.keyDown(editable, { key: "`" })
    // 模拟转换后继续输入：守卫应把 X 手动插到 <code> 之外
    fireEvent.keyDown(editable, { key: "X" })

    expect(editable.innerHTML).toBe(
      '<code class="hn-note-inline-code">foo</code>X'
    )
  })

  it("未配对的触发键不转换也不拦截", () => {
    const { editable } = renderParagraph("foo")

    const notPrevented = fireEvent.keyDown(editable, { key: "`" })

    expect(notPrevented).toBe(true)
    expect(editable.innerHTML).toBe("foo")
  })

  it("转换并同步重渲染后，光标折叠在格式元素之后", () => {
    const { editable } = renderParagraph("`foo")

    fireEvent.keyDown(editable, { key: "`" })

    const selection = window.getSelection()
    expect(selection?.isCollapsed).toBe(true)
    // React 提交会按同步后的 innerHTML 重建 DOM；useLayoutEffect 恢复的光标
    // 应折叠在 <code> 元素之后（末尾补空文本节点承载，规避 Chrome 把输入
    // 吸进内联元素的粘滞行为），继续输入不再携带格式
    const anchor = selection?.anchorNode
    expect(anchor).toBeInstanceOf(Text)
    expect(selection?.anchorOffset).toBe(0)
    expect((anchor as Text).previousSibling).toBe(
      editable.querySelector("code")
    )
  })
})
