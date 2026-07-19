/**
 * @vitest-environment jsdom
 *
 * Red-phase tests for inline-selection formatting helpers.
 *
 * 这些测试描述的是「在 contentEditable 选区内执行加粗 / 斜体 / 下划线 /
 * 删除线 / 行内代码 / 行内公式 / 清除格式 + 把变更同步回 React」的契约。
 * 目标模块 `./inlineSelectionFormatting` 尚未实现，因此用例应当因为
 * import 失败而失败，而不是因为 vitest 配置 / setup 失败失败。
 *
 * 契约要点：
 *  1. `getSelectionFormatState()` 基于当前 `window.getSelection()` 的起点
 *     容器向上查找最近格式祖先，返回 6 个布尔位
 *     (bold / italic / underline / strikeThrough / code / formula)。
 *  2. `toggleInlineCode()` 在选区外把选中文本包成 `<code>`，在选区已在
 *     `<code>` 内时解包并把子节点提升回父级。
 *  3. `wrapSelectionWithInlineFormula(formula)` 用一个 `contenteditable="false"`
 *     且带 `data-hn-inline-formula` 属性的 span 取代选中文本，属性值是 LaTeX 源。
 *  4. `clearSelectionFormatting()` 调用 `document.execCommand("removeFormat")`
 *     之后再手动解包 `<code>` 与 `[data-hn-inline-formula]` 这两个自定义包裹。
 *  5. `syncEditableBlockFromRange(range, onContentChange)` 从 range 的 commonAncestor
 *     起向上找最近 `[data-editable-block-id]`，命中后用 (id, innerHTML) 调用回调并返回 true，
 *     否则返回 false 而不调用回调。
 *
 * jsdom 的 `document.execCommand` 基本上是空实现，因此用例只断言可观察的 DOM 结果，
 * 不依赖 jsdom 对 execCommand 的内部支持；这与实现端「主动解包自定义标签 + 仅在原生浏览器
 * 上把 removeFormat 作为兜底」的策略相容。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  clearSelectionFormatting,
  crossBlockClearFormatting,
  crossBlockToggleInlineCode,
  getSelectionFormatState,
  runCrossBlockFormatCommand,
  syncEditableBlockFromRange,
  syncEditableBlocksFromRange,
  toggleInlineCode,
  wrapSelectionWithInlineFormula
} from "./inlineSelectionFormatting"

// 构造一个带 `data-editable-block-id` 的 contentEditable 容器并注入 HTML。
// 返回该容器以便测试对其进行查询与断言。
const mountEditable = (html: string, blockId = "block-1"): HTMLElement => {
  document.body.innerHTML = ""
  const editable = document.createElement("div")
  editable.setAttribute("contenteditable", "true")
  editable.setAttribute("data-editable-block-id", blockId)
  editable.innerHTML = html
  document.body.appendChild(editable)
  return editable
}

// 选中给定容器全部文本内容的工具函数：用 Range.selectNodeContents 确定性地覆盖。
const selectContents = (container: Node): Range => {
  const selection = window.getSelection()
  if (!selection) throw new Error("Selection API unavailable in jsdom.")
  selection.removeAllRanges()
  const range = document.createRange()
  range.selectNodeContents(container)
  selection.addRange(range)
  return range
}

// 在两个文本偏移之间创建选区，便于“选中段中一部分单词”这样的场景。
const selectBetween = (
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number
): Range => {
  const selection = window.getSelection()
  if (!selection) throw new Error("Selection API unavailable in jsdom.")
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  selection.addRange(range)
  return range
}

// 用 TreeWalker 找到容器里第一段包含 target 文本的文本节点，供 selectBetween 使用。
const findTextNode = (container: HTMLElement, target: string): Text => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    if (node.data.includes(target)) return node
    node = walker.nextNode() as Text | null
  }
  throw new Error(`Text node containing "${target}" not found.`)
}

beforeEach(() => {
  // 每个用例独立的 DOM 状态：清空 body + 重置选区。
  document.body.innerHTML = ""
  window.getSelection()?.removeAllRanges()
})

describe("getSelectionFormatState", () => {
  it("reports bold as active when the selection sits inside a <strong> ancestor", () => {
    // Given: a contentEditable paragraph whose word is wrapped in <strong>.
    const editable = mountEditable("<p><strong>bold text</strong></p>")
    const strong = editable.querySelector("strong")
    if (!strong) throw new Error("Expected <strong> wrapper.")
    selectContents(strong)

    // When: the format state is read from the current selection.
    const state = getSelectionFormatState()

    // Then: bold is on and no other format is reported active.
    expect(state).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strikeThrough: false,
      code: false,
      formula: false
    })
  })

  it("reports italic as active when the selection sits inside an <em> ancestor", () => {
    // Given: a contentEditable paragraph whose word is wrapped in <em>.
    const editable = mountEditable("<p><em>italic</em></p>")
    const em = editable.querySelector("em")
    if (!em) throw new Error("Expected <em> wrapper.")
    selectContents(em)

    // When: the format state is read.
    const state = getSelectionFormatState()

    // Then: only italic is active.
    expect(state.italic).toBe(true)
    expect(state.bold).toBe(false)
  })

  it("reports underline as active when the selection sits inside a <u> ancestor", () => {
    // Given: a contentEditable paragraph whose word is wrapped in <u>.
    const editable = mountEditable("<p><u>underlined</u></p>")
    const u = editable.querySelector("u")
    if (!u) throw new Error("Expected <u> wrapper.")
    selectContents(u)

    // When / Then: underline flag is the only active format.
    const state = getSelectionFormatState()
    expect(state.underline).toBe(true)
    expect(state.bold).toBe(false)
  })

  it("reports strikeThrough as active when the selection sits inside an <s> ancestor", () => {
    // Given: a contentEditable paragraph whose word is wrapped in an <s> strikethrough.
    const editable = mountEditable("<p><s>struck</s></p>")
    const s = editable.querySelector("s")
    if (!s) throw new Error("Expected <s> wrapper.")
    selectContents(s)

    // When / Then: strikeThrough flag is the only active format.
    const state = getSelectionFormatState()
    expect(state.strikeThrough).toBe(true)
    expect(state.bold).toBe(false)
  })

  it("reports code as active when the selection sits inside a <code> ancestor", () => {
    // Given: a contentEditable paragraph whose word is wrapped in <code>.
    const editable = mountEditable("<p><code>foo()</code></p>")
    const code = editable.querySelector("code")
    if (!code) throw new Error("Expected <code> wrapper.")
    selectContents(code)

    // When / Then: code flag is the only active format.
    const state = getSelectionFormatState()
    expect(state.code).toBe(true)
    expect(state.bold).toBe(false)
  })

  it("reports formula as active when the selection sits inside a [data-hn-inline-formula] span", () => {
    // Given: a paragraph containing a non-editable inline-formula placeholder span.
    const editable = mountEditable(
      '<p>pre <span class="hn-note-inline-formula" data-hn-inline-formula="x^2" contenteditable="false">x^2</span> post</p>'
    )
    const formulaSpan = editable.querySelector("[data-hn-inline-formula]")
    if (!formulaSpan) throw new Error("Expected inline-formula span.")

    // When: selecting the contents of the formula span.
    selectContents(formulaSpan)
    const state = getSelectionFormatState()

    // Then: formula flag is the only active format.
    expect(state.formula).toBe(true)
    expect(state.bold).toBe(false)
    expect(state.code).toBe(false)
  })

  it("returns every flag false for plain text without any formatting ancestor", () => {
    // Given: a plain paragraph containing nothing but text.
    const editable = mountEditable("<p>plain text</p>")
    const paragraph = editable.querySelector("p")
    if (!paragraph) throw new Error("Expected <p>.")
    selectContents(paragraph)

    // When: the format state is read.
    const state = getSelectionFormatState()

    // Then: no flag is active.
    expect(state).toEqual({
      bold: false,
      italic: false,
      underline: false,
      strikeThrough: false,
      code: false,
      formula: false
    })
  })
})

describe("toggleInlineCode", () => {
  it("wraps the selected text in <code> when the selection is outside any <code>", () => {
    // Given: a paragraph whose middle word we will select.
    const editable = mountEditable("<p>foo bar baz</p>")
    const text = findTextNode(editable, "foo bar baz")

    // When: the selection covers "bar" (offsets 4..7) and toggleInlineCode is applied.
    selectBetween(text, 4, text, 7)
    toggleInlineCode()

    // Then: exactly one <code> is produced and it contains the selected word.
    const codeElements = editable.querySelectorAll("code")
    expect(codeElements).toHaveLength(1)
    const code = editable.querySelector("code")
    expect(code).not.toBeNull()
    expect(code?.textContent).toBe("bar")
  })

  it("unwraps <code> when the selection is inside an existing <code> element", () => {
    // Given: a paragraph that already wraps "bar" in <code>.
    const editable = mountEditable("<p>foo <code>bar</code> baz</p>")
    const innerText = findTextNode(editable, "bar")

    // When: every character inside the <code> is selected and toggleInlineCode runs.
    selectBetween(innerText, 0, innerText, 3)
    toggleInlineCode()

    // Then: <code> is removed but its text stays in place, keeping the surrounding text intact.
    expect(editable.querySelector("code")).toBeNull()
    expect(editable.textContent).toContain("bar")
    expect(editable.textContent).toContain("foo")
    expect(editable.textContent).toContain("baz")
  })
})

describe("wrapSelectionWithInlineFormula", () => {
  it("replaces the selection with a non-editable span tagged with the formula source", () => {
    // Given: a paragraph whose middle word we will replace with a formula span.
    const editable = mountEditable("<p>foo bar baz</p>")
    const text = findTextNode(editable, "foo bar baz")

    // When: the selection covers "bar" and wrapSelectionWithInlineFormula is applied.
    selectBetween(text, 4, text, 7)
    wrapSelectionWithInlineFormula("a^2 + b^2")

    // Then: one inline-formula span is inserted, marked non-editable and carrying
    // the LaTeX source on its data attribute.
    const formulaSpans = editable.querySelectorAll<HTMLElement>(
      "[data-hn-inline-formula]"
    )
    expect(formulaSpans).toHaveLength(1)
    const span = editable.querySelector("[data-hn-inline-formula]")
    expect(span).not.toBeNull()
    expect(span?.getAttribute("contenteditable")).toBe("false")
    expect(span?.getAttribute("data-hn-inline-formula")).toBe("a^2 + b^2")
  })

  it("drops the previously selected word from the surrounding text once a formula is inserted", () => {
    // Given: a paragraph with a selectable middle word.
    const editable = mountEditable("<p>foo bar baz</p>")
    const text = findTextNode(editable, "foo bar baz")

    // When: "bar" is replaced with an inline-formula span.
    selectBetween(text, 4, text, 7)
    wrapSelectionWithInlineFormula("y = 2x")

    // Then: the literal "bar" no longer appears in the editable text — it has been
    // removed from the DOM alongside the selection it consumed.
    expect(editable.textContent).not.toContain("bar")
    expect(
      editable.querySelector("[data-hn-inline-formula]")
    ).not.toBeNull()
  })
})

describe("clearSelectionFormatting", () => {
  it("unwraps every built-in phrasing element (<strong>/<em>/<u>/<s>) inside the selection", () => {
    // Given: a paragraph carrying multiple inline formats on different words.
    const editable = mountEditable(
      "<p><strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s></p>"
    )
    const paragraph = editable.querySelector("p")
    if (!paragraph) throw new Error("Expected <p>.")

    // When: the whole paragraph is selected and formatting is cleared.
    selectContents(paragraph)
    clearSelectionFormatting()

    // Then: every built-in inline format element is gone, but its text content survives.
    expect(editable.querySelector("strong")).toBeNull()
    expect(editable.querySelector("em")).toBeNull()
    expect(editable.querySelector("u")).toBeNull()
    expect(editable.querySelector("s")).toBeNull()
    expect(editable.textContent).toContain("bold")
    expect(editable.textContent).toContain("italic")
    expect(editable.textContent).toContain("under")
    expect(editable.textContent).toContain("strike")
  })

  it("also unwraps inline <code> elements inside the selection", () => {
    // Given: a paragraph wrapping a word in <code>.
    const editable = mountEditable("<p>foo <code>bar()</code> baz</p>")
    const paragraph = editable.querySelector("p")
    if (!paragraph) throw new Error("Expected <p>.")

    // When: the whole paragraph is selected and formatting is cleared.
    selectContents(paragraph)
    clearSelectionFormatting()

    // Then: <code> is removed but its text remains inline.
    expect(editable.querySelector("code")).toBeNull()
    expect(editable.textContent).toContain("bar()")
  })

  it("also unwraps inline formula placeholders inside the selection", () => {
    // Given: a paragraph containing an inline formula span.
    const editable = mountEditable(
      '<p>before <span class="hn-note-inline-formula" data-hn-inline-formula="x^2" contenteditable="false">x^2</span> after</p>'
    )
    const paragraph = editable.querySelector("p")
    if (!paragraph) throw new Error("Expected <p>.")

    // When: the whole paragraph is selected and formatting is cleared.
    selectContents(paragraph)
    clearSelectionFormatting()

    // Then: the formula span is removed (the LaTeX content is no longer a non-editable node).
    expect(editable.querySelector("[data-hn-inline-formula]")).toBeNull()
  })
})

describe("syncEditableBlockFromRange", () => {
  it("calls onContentChange with the closest [data-editable-block-id] and its innerHTML", () => {
    // Given: a contentEditable block carrying a block id and rich paragraph content.
    const editable = mountEditable(
      "<p>hello <strong>world</strong></p>",
      "intro"
    )
    const helloText = findTextNode(editable, "hello")

    // When: a range is built over "hello" and synchronised back to the host.
    const range = selectBetween(helloText, 0, helloText, 5)
    const onContentChange = vi.fn()
    const called = syncEditableBlockFromRange(range, onContentChange)

    // Then: the host is notified once with the block id and the block's full innerHTML.
    expect(called).toBe(true)
    expect(onContentChange).toHaveBeenCalledTimes(1)
    expect(onContentChange).toHaveBeenCalledWith("intro", editable.innerHTML)
  })

  it("returns false and does not invoke the callback when no editable block ancestor exists", () => {
    // Given: a DOM branch without any [data-editable-block-id] wrapper.
    document.body.innerHTML = "<div><p>orphan text</p></div>"
    const paragraph = document.body.querySelector("p")
    if (!paragraph) throw new Error("Expected <p>.")
    const textNode = paragraph.firstChild
    if (!textNode) throw new Error("Expected text node.")

    // When: a range is built outside any editable block and synced.
    const range = selectBetween(textNode, 0, textNode, 3)
    const onContentChange = vi.fn()
    const called = syncEditableBlockFromRange(range, onContentChange)

    // Then: the helper reports no synchronization and the host is left untouched.
    expect(called).toBe(false)
    expect(onContentChange).not.toHaveBeenCalled()
  })
})

// ============================================================
// 跨块（cross-block）格式化助手测试
// ------------------------------------------------------------
// 验证 Phase 3 新增的 crossBlock* helpers：
//  - mount 两个 contenteditable=true 子块，构造跨块 Range
//  - 调 crossBlockToggleInlineCode / crossBlockClearFormatting / runCrossBlockFormatCommand
//  - 断言每个 root 都被独立处理；syncEditableBlocksFromRange 多次回调 onContentChange
// ============================================================

const mountTwoEditables = (): {
  container: HTMLElement
  block1: HTMLElement
  block2: HTMLElement
} => {
  document.body.innerHTML = ""
  const container = document.createElement("div")
  const block1 = document.createElement("div")
  block1.setAttribute("contenteditable", "true")
  block1.setAttribute("data-editable-block-id", "b1")
  block1.innerHTML = "alpha beta"
  const block2 = document.createElement("div")
  block2.setAttribute("contenteditable", "true")
  block2.setAttribute("data-editable-block-id", "b2")
  block2.innerHTML = "gamma delta"
  container.appendChild(block1)
  container.appendChild(block2)
  document.body.appendChild(container)
  return { container, block1, block2 }
}

const findTextIn = (root: HTMLElement, target: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node !== null) {
    if (node.nodeValue?.includes(target) === true) return node as Text
    node = walker.nextNode()
  }
  throw new Error(`findTextIn: "${target}" 未找到`)
}

const selectCrossBlockRange = (
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number
): Range => {
  const selection = window.getSelection()
  if (!selection) throw new Error("Selection API 不可用")
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  selection.addRange(range)
  return range
}

describe("inlineSelectionFormatting - 跨块 helpers", () => {
  it("crossBlockToggleInlineCode 把两个 root 的选区文本各自包进 <code>", () => {
    // Given: 跨块选区覆盖 block1 'alpha' + block2 'gamma'
    const { container, block1, block2 } = mountTwoEditables()
    const t1 = findTextIn(block1, "alpha beta")
    const t2 = findTextIn(block2, "gamma delta")
    selectCrossBlockRange(t1, 0, t2, 5)

    // When: 跨块切换行内代码
    crossBlockToggleInlineCode(container)

    // Then: block1 整段被包进 <code>，block2 的 'gamma' 被包进 <code>
    expect(block1.querySelector("code")?.textContent).toBe("alpha beta")
    expect(block2.querySelector("code")?.textContent).toBe("gamma")
  })

  it("crossBlockToggleInlineCode 起点已在 <code> 内 -> 仅解包该 root 的 <code>", () => {
    // Given: block1 已经在 <code> 内；block2 不在
    const { container, block1, block2 } = mountTwoEditables()
    block1.innerHTML = "<code>alpha beta</code>"
    block2.innerHTML = "gamma delta"
    const t1 = findTextIn(block1, "alpha beta")
    const t2 = findTextIn(block2, "gamma delta")
    selectCrossBlockRange(t1, 0, t2, 5)

    // When: 跨块切换行内代码
    crossBlockToggleInlineCode(container)

    // Then: block1 的 <code> 被解包（无 code），block2 的 'gamma' 被新包进 <code>
    expect(block1.querySelector("code")).toBeNull()
    expect(block2.querySelector("code")?.textContent).toBe("gamma")
  })

  it("crossBlockClearFormatting 清除两个 root 内的自定义包裹", () => {
    // Given: 两个块都有 <strong> 和 <code>
    const { container, block1, block2 } = mountTwoEditables()
    block1.innerHTML = "<strong>alpha</strong> <code>beta</code>"
    block2.innerHTML = "<em>gamma</em> <code>delta</code>"
    const t1 = findTextIn(block1, "alpha")
    const t2 = findTextIn(block2, "delta")
    selectCrossBlockRange(t1, 0, t2, 5)

    // When: 跨块清除格式
    crossBlockClearFormatting(container)

    // Then: 两个块内的 strong/em/code 全部被解包或移除
    expect(block1.querySelector("strong")).toBeNull()
    expect(block1.querySelector("code")).toBeNull()
    expect(block2.querySelector("em")).toBeNull()
    expect(block2.querySelector("code")).toBeNull()
  })

  it("syncEditableBlocksFromRange 对每个受影响 root 各回调一次", () => {
    // Given: 跨块选区覆盖两个 block
    const { container, block1, block2 } = mountTwoEditables()
    const t1 = findTextIn(block1, "alpha beta")
    const t2 = findTextIn(block2, "gamma delta")
    const range = selectCrossBlockRange(t1, 0, t2, 5)

    // When: 同步
    const onContentChange = vi.fn()
    syncEditableBlocksFromRange(range, container, onContentChange)

    // Then: 两个块各回调一次，参数 (blockId, innerHtml) 正确
    expect(onContentChange).toHaveBeenCalledTimes(2)
    expect(onContentChange).toHaveBeenCalledWith("b1", block1.innerHTML)
    expect(onContentChange).toHaveBeenCalledWith("b2", block2.innerHTML)
  })

  it("runCrossBlockFormatCommand 对每个 root 切换 selection 后执行命令", () => {
    // Given: 跨块选区
    const { container, block1, block2 } = mountTwoEditables()
    const t1 = findTextIn(block1, "alpha beta")
    const t2 = findTextIn(block2, "gamma delta")
    selectCrossBlockRange(t1, 0, t2, 5)
    // jsdom 默认未定义 document.execCommand，需先定义后再 spyOn
    if (typeof document.execCommand !== "function") {
      Object.defineProperty(document, "execCommand", {
        value: () => true,
        configurable: true,
        writable: true
      })
    }
    const execSpy = vi
      .spyOn(document, "execCommand")
      .mockImplementation(() => true)

    // When: 跨块执行 bold
    runCrossBlockFormatCommand(container, "bold")

    // Then: execCommand 被调用 2 次（每个 root 一次）
    expect(execSpy).toHaveBeenCalledTimes(2)
    expect(execSpy).toHaveBeenNthCalledWith(1, "bold")
    expect(execSpy).toHaveBeenNthCalledWith(2, "bold")

    // 最终 selection 恢复为 outer range（覆盖两个块）
    const sel = window.getSelection()
    expect(sel).not.toBeNull()
    expect(sel?.rangeCount).toBe(1)
    execSpy.mockRestore()
  })
})