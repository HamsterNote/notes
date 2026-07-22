/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"

import {
  matchInlineMarkdownShortcut,
  tryApplyInlineMarkdownShortcut,
  tryEscapeTrailingFormat
} from "./inlineMarkdownShortcut"

describe("matchInlineMarkdownShortcut（纯函数匹配）", () => {
  describe("行内代码 `` ` ``", () => {
    it("光标前有未闭合反引号且内容非空时命中 code", () => {
      expect(matchInlineMarkdownShortcut("`foo", "`")).toEqual({
        kind: "code",
        openIndex: 0,
        contentStart: 1,
        contentEnd: 4
      })
    })

    it("起始反引号可以不在行首，取其下标", () => {
      expect(matchInlineMarkdownShortcut("say `hi", "`")).toEqual({
        kind: "code",
        openIndex: 4,
        contentStart: 5,
        contentEnd: 7
      })
    })

    it("取最后一个反引号作为起始标记", () => {
      // "`a`b"：下标 0/2 各有一个反引号，lastIndexOf 命中下标 2
      expect(matchInlineMarkdownShortcut("`a`b", "`")).toEqual({
        kind: "code",
        openIndex: 2,
        contentStart: 3,
        contentEnd: 4
      })
    })

    it("无起始反引号 / 内容为空 / 内容纯空格时不命中", () => {
      expect(matchInlineMarkdownShortcut("foo", "`")).toBeNull()
      // "``" 是代码块 ``` 快捷键的前缀，内容为空不应触发行内转换
      expect(matchInlineMarkdownShortcut("``", "`")).toBeNull()
      expect(matchInlineMarkdownShortcut("` ", "`")).toBeNull()
    })

    it("内容首尾带空格时不命中", () => {
      expect(matchInlineMarkdownShortcut("` foo", "`")).toBeNull()
      expect(matchInlineMarkdownShortcut("`foo ", "`")).toBeNull()
    })
  })

  describe("粗体 **", () => {
    it("光标前文本形如 **foo*（已输入一个闭合星号）时按下 * 命中 bold", () => {
      expect(matchInlineMarkdownShortcut("**foo*", "*")).toEqual({
        kind: "bold",
        openIndex: 0,
        contentStart: 2,
        contentEnd: 5
      })
    })

    it("起始 ** 不在行首时取其下标", () => {
      expect(matchInlineMarkdownShortcut("a **foo*", "*")).toEqual({
        kind: "bold",
        openIndex: 2,
        contentStart: 4,
        contentEnd: 7
      })
    })

    it("已完成闭合的 **foo** 后再次按 * 不重复命中", () => {
      expect(matchInlineMarkdownShortcut("**foo**", "*")).toBeNull()
    })

    it("内容含星号 / 为空 / 首尾空格时不命中", () => {
      expect(matchInlineMarkdownShortcut("***", "*")).toBeNull()
      expect(matchInlineMarkdownShortcut("** foo*", "*")).toBeNull()
    })
  })

  describe("斜体 *", () => {
    it("光标前有单个未闭合 * 且内容非空时命中 italic", () => {
      expect(matchInlineMarkdownShortcut("*foo", "*")).toEqual({
        kind: "italic",
        openIndex: 0,
        contentStart: 1,
        contentEnd: 4
      })
    })

    it("粗体优先：**foo* 按下 * 命中 bold 而非 italic", () => {
      expect(matchInlineMarkdownShortcut("**foo*", "*")?.kind).toBe("bold")
    })

    it("输入粗体闭合对的第一个 * 时不提前触发斜体", () => {
      // "**foo" 中最后一个 * 的前一个字符仍是 *，不是合法斜体起始标记
      expect(matchInlineMarkdownShortcut("**foo", "*")).toBeNull()
    })

    it("已闭合的 *foo* 后再次按 * 不命中", () => {
      expect(matchInlineMarkdownShortcut("*foo*", "*")).toBeNull()
    })
  })

  describe("删除线 ~~", () => {
    it("光标前文本形如 ~~foo~ 时按下 ~ 命中 strike", () => {
      expect(matchInlineMarkdownShortcut("~~foo~", "~")).toEqual({
        kind: "strike",
        openIndex: 0,
        contentStart: 2,
        contentEnd: 5
      })
    })

    it("单个 ~ 不构成标记", () => {
      expect(matchInlineMarkdownShortcut("~foo~", "~")).toBeNull()
      expect(matchInlineMarkdownShortcut("~~foo", "~")).toBeNull()
    })
  })

  it("非触发键一律不命中", () => {
    expect(matchInlineMarkdownShortcut("`foo", "a")).toBeNull()
    expect(matchInlineMarkdownShortcut("**foo*", "b")).toBeNull()
  })
})

// 在给定文本节点上放置折叠光标
const placeCaret = (node: Text, offset: number): void => {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const mountBlock = (html: string): HTMLElement => {
  document.body.innerHTML = ""
  const block = document.createElement("div")
  block.setAttribute("data-editable-block-id", "b1")
  block.innerHTML = html
  document.body.appendChild(block)
  return block
}

describe("tryApplyInlineMarkdownShortcut（DOM 应用）", () => {
  it("反引号闭合后内容被包进带 class 的 <code>，光标落在元素之后", () => {
    const block = mountBlock("`foo")
    const text = block.firstChild as Text
    placeCaret(text, 4)

    const result = tryApplyInlineMarkdownShortcut("`")

    expect(result).toBe(block)
    expect(block.innerHTML).toBe(
      '<code class="hn-note-inline-code">foo</code>'
    )
    const selection = window.getSelection()
    expect(selection?.isCollapsed).toBe(true)
    // 光标折叠在 <code> 元素之后（继续输入不再带格式）：元素是块内最后一个
    // 子节点时会补空文本节点承载光标（规避 Chrome 粘滞内联元素行为）
    const anchor = selection?.anchorNode
    expect(anchor).toBeInstanceOf(Text)
    expect(selection?.anchorOffset).toBe(0)
    expect((anchor as Text).previousSibling).toBe(block.querySelector("code"))
  })

  it("保留标记前后的普通文本", () => {
    const block = mountBlock("x `foo y")
    const text = block.firstChild as Text
    placeCaret(text, 6)

    const result = tryApplyInlineMarkdownShortcut("`")

    expect(result).toBe(block)
    expect(block.innerHTML).toBe(
      'x <code class="hn-note-inline-code">foo</code> y'
    )
  })

  it("** 闭合命中时包进 <strong>", () => {
    const block = mountBlock("**foo*")
    placeCaret(block.firstChild as Text, 6)

    expect(tryApplyInlineMarkdownShortcut("*")).toBe(block)
    expect(block.innerHTML).toBe("<strong>foo</strong>")
  })

  it("单个 * 闭合命中时包进 <em>", () => {
    const block = mountBlock("*foo")
    placeCaret(block.firstChild as Text, 4)

    expect(tryApplyInlineMarkdownShortcut("*")).toBe(block)
    expect(block.innerHTML).toBe("<em>foo</em>")
  })

  it("~~ 闭合命中时包进 <s>", () => {
    const block = mountBlock("~~foo~")
    placeCaret(block.firstChild as Text, 6)

    expect(tryApplyInlineMarkdownShortcut("~")).toBe(block)
    expect(block.innerHTML).toBe("<s>foo</s>")
  })

  it("未命中时返回 null 且 DOM 不变", () => {
    const block = mountBlock("foo")
    placeCaret(block.firstChild as Text, 3)

    expect(tryApplyInlineMarkdownShortcut("`")).toBeNull()
    expect(block.innerHTML).toBe("foo")
  })

  it("非折叠选区不转换", () => {
    const block = mountBlock("`foo")
    const range = document.createRange()
    range.selectNodeContents(block)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(tryApplyInlineMarkdownShortcut("`")).toBeNull()
  })

  it("光标位于既有 <code> 内不转换", () => {
    const block = mountBlock(
      '<code class="hn-note-inline-code">`foo</code>'
    )
    placeCaret(block.querySelector("code")?.firstChild as Text, 4)

    expect(tryApplyInlineMarkdownShortcut("`")).toBeNull()
  })

  it("不在 [data-editable-block-id] 块内不转换", () => {
    document.body.innerHTML = ""
    const orphan = document.createElement("div")
    orphan.textContent = "`foo"
    document.body.appendChild(orphan)
    placeCaret(orphan.firstChild as Text, 4)

    expect(tryApplyInlineMarkdownShortcut("`")).toBeNull()
  })
})

describe("tryEscapeTrailingFormat（块尾格式逃逸）", () => {
  it("光标在格式元素文本末尾时，字符手动插到元素之后", () => {
    const block = mountBlock('<code class="hn-note-inline-code">foo</code>')
    placeCaret(block.querySelector("code")?.firstChild as Text, 3)

    const result = tryEscapeTrailingFormat("X")

    expect(result).toBe(block)
    expect(block.innerHTML).toBe(
      '<code class="hn-note-inline-code">foo</code>X'
    )
    const selection = window.getSelection()
    expect((selection?.anchorNode as Text).data).toBe("X")
    expect(selection?.anchorOffset).toBe(1)
  })

  it("光标在格式元素后的空文本节点时，复用该节点写入字符", () => {
    const block = mountBlock('<code class="hn-note-inline-code">foo</code>')
    block.appendChild(document.createTextNode(""))
    placeCaret(block.lastChild as Text, 0)

    expect(tryEscapeTrailingFormat("X")).toBe(block)
    expect(block.innerHTML).toBe(
      '<code class="hn-note-inline-code">foo</code>X'
    )
  })

  it("格式元素后仍有可见文本时不接管（交还浏览器默认插入）", () => {
    const block = mountBlock("<strong>foo</strong> bar")
    placeCaret(block.querySelector("strong")?.firstChild as Text, 3)

    expect(tryEscapeTrailingFormat("X")).toBeNull()
  })

  it("光标在格式元素文本中部时不接管", () => {
    const block = mountBlock("<strong>foo</strong>")
    placeCaret(block.querySelector("strong")?.firstChild as Text, 1)

    expect(tryEscapeTrailingFormat("X")).toBeNull()
  })

  it("光标不在格式元素边界时不接管", () => {
    const block = mountBlock("plain")
    placeCaret(block.firstChild as Text, 5)

    expect(tryEscapeTrailingFormat("X")).toBeNull()
  })
})
