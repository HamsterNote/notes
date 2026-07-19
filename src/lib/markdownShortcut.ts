import { createNoteId } from "./noteId"
import type { NoteBlock } from "./types"

/**
 * Markdown 快捷键命中结果。
 *
 * 当用户在段落 / heading 块上输入触发字符串并（多数情况）按下空格时，
 * onInput 会被触发——此时若 textContent 恰好匹配某个 marker，就把当前
 * text 块整体替换为以下目标块之一。
 *
 * 与 `blockConversion.convertBlockFormat` 的区别在于：
 *  - 该函数不抽取 source 块的现有文本——因为 onInput 触发时 source.text
 *    仍是 marker 本身（如 "# "），保留它会污染新块的初始文本。
 *  - 该函数仅服务于「Markdown 快捷键即时转换」这一 narrow use case，
 *    不处理可视化「转换菜单」所追求的文本保留语义。
 */
export type MarkdownShortcutMatch =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 }
  | { readonly kind: "checklist"; readonly checked: boolean }
  | { readonly kind: "quote" }
  | { readonly kind: "code" }

/**
 * 把 contentEditable 的 textContent 归一化为「人类可读纯文本」以便与 marker 比对：
 *  - `&nbsp;` (\u00a0) → 普通空格（一些 IME / 粘贴 / 退格场景会注入 nbsp）
 *  - 零宽空格 (\u200B) → 剔除（浏览器在 contentEditable 中偶发插入）
 *
 * 不替换其它不可见控制字符到任何形式——保持与既有 quote 入口一致的归一化尺度。
 */
const normalizeShortcutText = (text: string): string =>
  text.replaceAll("\u00a0", " ").replaceAll("\u200B", "")

/**
 * 识别 onInput 触发瞬间 textContent 是否恰好等于某个 Markdown 快捷键 marker。
 * 命中即返回转换目标；否则返回 null 让调用方继续走常规文本输入流程。
 *
 * 设计原则：
 *  - 严格匹配完整 marker，避免误伤「> 你好」这类以触发字符起始的普通文本。
 *  - heading：1~5 个 `#` 加一个空格；多 / 少 / 含其它字符均不命中。
 *  - checklist：仅 `[] ` 与 `[x] `（**小写** x）两种 marker，与既有
 *    `blockSourceConversion` 中 `preserveMarkdownMarker` 的输出一致，
 *    便于「转换菜单」与「Markdown 快捷键」之间的对称反演。
 *  - quote：`> `，与既有 `NoteTextBlock.handleInput` 行为一致（向后兼容）。
 *  - code：恰好三个反引号，**不需要空格**——这是与其它 marker 唯一的差异，
 *    因为代码块本身就要容纳多行 / 缩进 / 起始空格等内容。
 *
 * 当 textContent 含 `\n` 时直接返回 null：onInput 期间不应该出现换行（Enter
 * 已被 keydown preventDefault 拆块），保留 null 分支作为防御性短路。
 */
export const matchMarkdownShortcut = (
  raw: string
): MarkdownShortcutMatch | null => {
  const text = normalizeShortcutText(raw)
  if (text.includes("\n")) return null

  // heading：1~5 个 `#` 后跟一个空格，整段恰好如此。
  // 捕获组长度决定 heading level。
  const headingMatch = /^(#{1,5}) $/.exec(text)
  if (headingMatch) {
    const hashes = headingMatch[1] ?? ""
    const level = hashes.length
    if (level < 1 || level > 5) return null
    return { kind: "heading", level: level as 1 | 2 | 3 | 4 | 5 }
  }

  // checklist：`[] ` 表示未勾选；`[x] ` 表示已勾选（小写 x）。
  if (text === "[] ") return { kind: "checklist", checked: false }
  if (text === "[x] ") return { kind: "checklist", checked: true }

  // quote：沿用既有 NoteTextBlock.handleInput 的精确字符串匹配。
  if (text === "> ") return { kind: "quote" }

  // code：恰好三个反引号，无空格。
  if (text === "```") return { kind: "code" }

  return null
}

/**
 * 给定命中结果，构造一个以 `blockId` 为 id 的全新空块。
 * 初始 text/code 一律为空：因为 onInput 触发瞬间 source 块的 text 仍是
 * marker 本身，重用它会让新块带前缀污染，故此函数不复用 source.text。
 *
 * checklist 单独为 item 生成新的稳定 id（与可视化「转换菜单」语义一致：
 * checklist 的真正可编辑元素是 item 而非块本身，新建一个 item id 才能让
 * `useBlockEditing.requestFocus` 找到正确的 contentEditable 节点）。
 */
export const buildReplacementFromShortcut = (
  match: MarkdownShortcutMatch,
  blockId: string
): NoteBlock => {
  switch (match.kind) {
    case "heading":
      return {
        id: blockId,
        kind: "heading",
        level: match.level,
        text: ""
      }
    case "quote":
      return { id: blockId, kind: "quote", text: "" }
    case "code":
      return {
        id: blockId,
        kind: "code",
        // 默认语言 "text"，与可视化「转换菜单」中 convertBlockFormat 对 code 块的默认一致
        language: "text",
        code: ""
      }
    case "checklist": {
      const itemId = createNoteId()
      return {
        id: blockId,
        kind: "checklist",
        title: "",
        items: [{ id: itemId, checked: match.checked, text: "" }]
      }
    }
  }
}

/**
 * 决定转换后应 focus 的可编辑元素 id。
 *
 * - quote / code / heading：直接建立在 `blockId` 上的 contentEditable
 *   （与 `NoteBlockFocus.editableIds` 的归类对齐：heading/quote/code 都映射
 *   到 block.id 这一可编辑根）。
 * - checklist：底层 contentEditable 是 item.id（块容器本身不可编辑），
 *   因此拆出第一个 item 的 id 作为 focus target。
 *
 * `replacement.kind === "checklist"` 时保证取到 items[0].id；防御性兜底
 * 返回 replacement.id 以满足调用方静态类型。
 */
export const focusTargetIdFromShortcut = (
  match: MarkdownShortcutMatch,
  replacement: NoteBlock
): string => {
  if (match.kind === "checklist" && replacement.kind === "checklist") {
    const item = replacement.items[0]
    return item ? item.id : replacement.id
  }
  return replacement.id
}