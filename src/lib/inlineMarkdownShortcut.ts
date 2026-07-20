/**
 * Markdown 行内自动转换（R7）：在 contentEditable 中输入闭合字符
 * （`` ` `` / `*` / `~`）的 keydown 瞬间，若光标前文本与起始标记构成
 * 封闭配对，则把配对内容直接转换为行内格式元素，并拦截该字符的默认插入。
 *
 * 支持的配对（与 SelectionPopover 的格式能力对齐）：
 *  - `` `code` ``   → <code class="hn-note-inline-code">
 *  - `**bold**`    → <strong>
 *  - `*italic*`    → <em>
 *  - `~~strike~~`  → <s>
 *
 * 触发模型（为什么 bold / strike 需要「光标前已有一个闭合字符」）：
 * 用户在 keydown 时闭合字符尚未插入 DOM。以 `**foo**` 为例，按下最后一个
 * `*` 时光标前文本是 `**foo*` —— 即「起始 ** + 内容 + 已输入的第一个
 * 闭合 *」。匹配器据此识别配对，随后转换逻辑把 opener + 内容 + 已输入的
 * 闭合字符整体从文本节点移除，替换为格式元素。
 *
 * 防误触规则：
 *  - 斜体起始 * 的前一个字符不能还是 *（否则输入粗体闭合对的第一个 *
 *    时会把 `**foo` 提前斜体化）；
 *  - 粗体优先于斜体判定；
 *  - 内容不能为空 / 纯空格，首尾不能带空格；
 *  - 已完成闭合的配对（`*foo*`、`**foo**`）不会重复命中；
 *  - 既有 <code> / <pre> / textarea / contenteditable=false 原子节点内
 *    不转换（代码编辑器与行内代码的原始文本必须保持字面语义）。
 *
 * 同步语义：tryApply 返回所在的 [data-editable-block-id] 块元素，由调用方
 * （NoteContent 的 keydown 捕获）负责 preventDefault 与
 * onBlocksChange(updateText(...)) 同步，与 SelectionPopover 的同步路径一致。
 */

import { INLINE_CODE_CLASS } from "./inlineSelectionFormatting"

export type InlineMarkdownKind = "code" | "bold" | "italic" | "strike"

export type InlineMarkdownMatch = {
  readonly kind: InlineMarkdownKind
  /** 起始标记在「光标前文本」中的下标 */
  readonly openIndex: number
  /** 内容（不含标记）在「光标前文本」中的起止下标 */
  readonly contentStart: number
  readonly contentEnd: number
}

const TRIGGER_KEYS = new Set(["`", "*", "~"])

// 内容必须非空且首尾不带空格，避免 "* foo *" 这类带边距的误转换
const isValidContent = (content: string): boolean =>
  content.length > 0 && content.trim() === content && content.trim() !== ""

const matchPairedMarker = (
  text: string,
  marker: "**" | "~~",
  kind: InlineMarkdownKind
): InlineMarkdownMatch | null => {
  // 形如 <marker>内容<marker 首字符>$ —— 闭合对的最后一个字符由本次按键提供
  const closer = marker[0] ?? ""
  const pattern = new RegExp(
    `${marker.replace(/[.*~]/g, (ch) => `\\${ch}`)}([^${closer}]+)\\${closer}$`
  )
  const hit = pattern.exec(text)
  if (hit === null) return null
  const content = hit[1] ?? ""
  if (!isValidContent(content)) return null
  const openIndex = hit.index
  return {
    kind,
    openIndex,
    contentStart: openIndex + marker.length,
    contentEnd: openIndex + marker.length + content.length
  }
}

const matchCode = (text: string): InlineMarkdownMatch | null => {
  const openIndex = text.lastIndexOf("`")
  if (openIndex < 0) return null
  const content = text.slice(openIndex + 1)
  // 内容里不会再出现反引号（lastIndexOf 保证），只需校验非空与边距
  if (!isValidContent(content)) return null
  return {
    kind: "code",
    openIndex,
    contentStart: openIndex + 1,
    contentEnd: text.length
  }
}

const matchAsterisk = (text: string): InlineMarkdownMatch | null => {
  const bold = matchPairedMarker(text, "**", "bold")
  if (bold !== null) return bold
  const openIndex = text.lastIndexOf("*")
  if (openIndex < 0) return null
  // 斜体起始 * 前一个字符不能还是 *（防粗体闭合对第一个 * 被提前斜体化）
  if (openIndex > 0 && text[openIndex - 1] === "*") return null
  const content = text.slice(openIndex + 1)
  // 内容含 * 说明存在更近的起始标记，按 lastIndexOf 语义已处理过，直接放弃
  if (content.includes("*") || !isValidContent(content)) return null
  return {
    kind: "italic",
    openIndex,
    contentStart: openIndex + 1,
    contentEnd: text.length
  }
}

/**
 * 纯函数匹配：给定光标前文本与按下的触发键，返回配对信息；未命中返回 null。
 */
export const matchInlineMarkdownShortcut = (
  textBeforeCaret: string,
  key: string
): InlineMarkdownMatch | null => {
  if (!TRIGGER_KEYS.has(key)) return null
  if (key === "`") return matchCode(textBeforeCaret)
  if (key === "*") return matchAsterisk(textBeforeCaret)
  return matchPairedMarker(textBeforeCaret, "~~", "strike")
}

const ELEMENT_TAG_BY_KIND: Record<InlineMarkdownKind, string> = {
  code: "code",
  bold: "strong",
  italic: "em",
  strike: "s"
}

/**
 * 把折叠光标放到行内格式元素之后。
 * Chrome 的「粘滞内联元素」行为：光标以（父节点 + indexAfter）形式落在
 * 内联元素右边界时，继续输入会被吸进元素内部。因此始终把光标放进元素
 * 后面的文本节点里 —— 优先复用已有的后继文本节点（surroundContents
 * 拆分产生的空文本节点或原文本），没有则补一个空文本节点；空文本节点
 * 序列化为空串，不影响 innerHTML 同步与后续 React 渲染。
 */
const placeCaretAfterFormat = (
  element: HTMLElement,
  selection: Selection
): void => {
  let target = element.nextSibling
  if (!(target instanceof Text)) {
    target = document.createTextNode("")
    element.parentNode?.insertBefore(target, element.nextSibling)
  }
  const caret = document.createRange()
  caret.setStart(target, 0)
  caret.collapse(true)
  selection.removeAllRanges()
  selection.addRange(caret)
}

/**
 * 读取当前 window selection，若光标前文本与 key 构成封闭配对则执行转换：
 *  1. 从文本节点中移除 opener + 内容 + 已输入的闭合字符（光标后文本保留）；
 *  2. 把内容圈进对应的格式元素（code 额外写入 hn-note-inline-code class）；
 *  3. 光标折叠到格式元素之后，继续输入不再携带格式。
 *
 * 返回所在 [data-editable-block-id] 块元素供调用方同步；以下情形返回 null
 * 且不改 DOM：非折叠选区、锚点不是文本节点、光标在 code/pre/textarea/
 * contenteditable=false 内、不在任何可编辑块内、配对未命中。
 */
export const tryApplyInlineMarkdownShortcut = (
  key: string
): HTMLElement | null => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null
  }
  const anchorNode = selection.anchorNode
  if (!(anchorNode instanceof Text)) return null
  const anchorOffset = selection.anchorOffset
  const anchorEl = anchorNode.parentElement
  if (anchorEl === null) return null
  if (
    anchorEl.closest(
      "code, pre, textarea, input, [contenteditable='false']"
    ) !== null
  ) {
    return null
  }
  const blockEl = anchorEl.closest<HTMLElement>("[data-editable-block-id]")
  if (blockEl === null) return null

  const textBeforeCaret = anchorNode.data.slice(0, anchorOffset)
  const match = matchInlineMarkdownShortcut(textBeforeCaret, key)
  if (match === null) return null

  const content = textBeforeCaret.slice(match.contentStart, match.contentEnd)
  const afterCaret = anchorNode.data.slice(anchorOffset)
  anchorNode.data =
    textBeforeCaret.slice(0, match.openIndex) + content + afterCaret

  // 内容必然落在同一文本节点内（配对在同一节点中检出），surroundContents 安全
  const contentRange = document.createRange()
  contentRange.setStart(anchorNode, match.openIndex)
  contentRange.setEnd(anchorNode, match.openIndex + content.length)
  const element = document.createElement(ELEMENT_TAG_BY_KIND[match.kind])
  if (match.kind === "code") element.className = INLINE_CODE_CLASS
  contentRange.surroundContents(element)

  placeCaretAfterFormat(element, selection)

  return blockEl
}

/**
 * R7 光标恢复修正：React 提交重建块 DOM 后，按纯文本偏移恢复的折叠光标
 * 会落在格式元素文本的「内部末尾」（继续输入会把字打进 code/strong 里）。
 * 若当前折叠光标恰好位于某个行内格式元素的文本末尾，则把它外移到该元素
 * 之后，恢复「转换完成后在格式元素外继续输入」的语义。
 * 光标在格式元素中部或非格式元素内时不做任何调整。
 */
export const moveCaretOutsideTrailingFormat = (root: Element): void => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
    return
  }
  const anchorNode = selection.anchorNode
  if (anchorNode === null) return
  const anchorEl =
    anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement
  const formatEl = anchorEl?.closest("code, strong, em, s") ?? null
  if (formatEl === null || !root.contains(formatEl)) return
  // 仅当光标位于格式元素文本末尾（相对元素末尾的纯文本偏移为 0）时才外移
  const tail = document.createRange()
  tail.selectNodeContents(formatEl)
  try {
    tail.setStart(anchorNode, selection.anchorOffset)
  } catch {
    return
  }
  if (tail.toString().length > 0) return
  placeCaretAfterFormat(formatEl as HTMLElement, selection)
}

const TRAILING_FORMAT_SELECTOR = "code, strong, em, s"

/**
 * 「逃逸」块尾行内格式：自动转换刚完成时，光标停在格式元素右边界
 * （元素内文本末尾，或紧邻其后的空文本节点）。Chrome 会把此时键入的
 * 第一个字符吸进格式元素内部，因此对该字符做手动插入：
 * 在格式元素后的文本节点（没有则新建）写入该字符并把光标移到其后。
 *
 * 返回所在块元素供调用方 preventDefault + 同步；以下情形返回 null：
 * 光标不在「格式元素右边界」、格式元素后还有可见文本（无粘滞问题，
 * 走浏览器默认插入即可）、不在可编辑块内。调用方负责过滤可打印单字符
 * （key.length === 1、无修饰键、非输入法组合态）。
 */
export const tryEscapeTrailingFormat = (key: string): HTMLElement | null => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null
  }
  const anchorNode = selection.anchorNode
  if (!(anchorNode instanceof Text)) return null
  const anchorEl = anchorNode.parentElement
  if (anchorEl === null) return null

  // 两种边界形态：(a) 光标在格式元素文本末尾；(b) 光标在格式元素后的空文本节点
  let formatEl: HTMLElement | null = anchorEl.closest(TRAILING_FORMAT_SELECTOR)
  if (formatEl !== null) {
    const tail = document.createRange()
    tail.selectNodeContents(formatEl)
    try {
      tail.setStart(anchorNode, selection.anchorOffset)
    } catch {
      return null
    }
    if (tail.toString().length > 0) return null
  } else {
    if (anchorNode.data.length > 0 || selection.anchorOffset !== 0) return null
    const prev = anchorNode.previousSibling
    formatEl =
      prev instanceof HTMLElement && prev.matches(TRAILING_FORMAT_SELECTOR)
        ? prev
        : null
  }
  if (formatEl === null) return null

  const blockEl = formatEl.closest<HTMLElement>("[data-editable-block-id]")
  if (blockEl === null) return null
  // 格式元素之后仍有可见文本时不存在粘滞问题，交给浏览器默认行为
  const after = document.createRange()
  after.selectNodeContents(blockEl)
  try {
    after.setStartAfter(formatEl)
  } catch {
    return null
  }
  if (after.toString().trim().length > 0) return null

  // 手动把字符插到格式元素之后：复用紧随的空文本节点，否则新建
  const next = formatEl.nextSibling
  const target = next instanceof Text ? next : document.createTextNode("")
  if (target !== next) {
    formatEl.parentNode?.insertBefore(target, next)
  }
  target.data = key + target.data
  const caret = document.createRange()
  caret.setStart(target, 1)
  caret.collapse(true)
  selection.removeAllRanges()
  selection.addRange(caret)
  return blockEl
}
