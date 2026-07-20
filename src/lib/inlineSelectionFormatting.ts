/**
 * 行内选区格式化助手：在 contentEditable 选区内执行加粗 / 斜体 / 下划线 /
 * 删除线、行内代码 `<code>`、行内公式占位 span、清除格式，并把 DOM 变更同步回
 * 宿主 React 状态。
 *
 * 设计取舍：
 *  - 原生格式（bold / italic / underline / strikeThrough）通过
 *    `document.execCommand` 实现；自定义包裹（`<code>`、
 *    `[data-hn-inline-formula]`）则用 Range API 手动插入 / 解包，因为
 *    execCommand 不支持这两种语义。
 *  - jsdom 的 `document.execCommand` 是空实现，且 `queryCommandState` 恒返回
 *    false，因此 `getSelectionFormatState` 主要依赖 DOM 祖先遍历；浏览器场景
 *    下额外叠加 `queryCommandState` 作为兜底（用于折叠选区光标态、无包裹祖先
 *    的情形），对 jsdom 测试无副作用。
 *  - 同步语义：`syncEditableBlockFromRange` 从 range 的 commonAncestorContainer
 *    起向上找最近 `[data-editable-block-id]`，命中后用 (blockId, blockEl.innerHTML)
 *    回调，否则返回 false；与 `SelectionPopover` 既有的 `onContentChange` 回调
 *    形状保持一致。
 */

/**
 * 选区的格式激活状态。每个布尔位对应一种行内格式是否作用于当前选区。
 * 全部字段 `readonly`，对外暴露的实例（`EMPTY_SELECTION_FORMAT_STATE` 与
 * `getSelectionFormatState` 的返回值）均为 `Object.freeze`，避免被调用方
 * 意外篡改共享状态。
 */
export type SelectionFormatState = {
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strikeThrough: boolean
  readonly code: boolean
  readonly formula: boolean
}

/**
 * 全 false 的空状态。供 popover 在选区折叠 / 越界时作为初始态使用。
 * 冻结以保留共享引用的不可变语义。
 */
export const EMPTY_SELECTION_FORMAT_STATE: SelectionFormatState =
  Object.freeze({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    code: false,
    formula: false
  })

/**
 * 通过 `document.execCommand` 触发的原生格式命令集合。
 * `removeFormat` 与四个原生格式切换命令一并由 `runNativeFormatCommand` 收敛，
 * 避免调用方直接对 `document.execCommand` 重复写 try/catch（部分环境会抛错）。
 */
export type NativeFormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikeThrough"
  | "removeFormat"

/**
 * 内联公式占位 span 的标记属性：选中状态判定、清除格式时的解包目标都通过
 * 该选择器 / 属性识别，与 `NoteContent` 在只读侧的渲染约定保持一致。
 */
const INLINE_FORMULA_ATTR = "data-hn-inline-formula"
const INLINE_FORMULA_CLASS = "hn-note-inline-formula"
const INLINE_FORMULA_SELECTOR = `[${INLINE_FORMULA_ATTR}]`

/**
 * 行内代码 `<code>` 的标记 class：新建包裹时写入，styles.css 据此提供
 * 边框 + 背景胶囊样式；存量无 class 的 `<code>` 由
 * `[data-editable-block-id] code:not([class])` 选择器兜底覆盖。
 */
const INLINE_CODE_CLASS = "hn-note-inline-code"

/**
 * `document.execCommand` 已被废弃但在所有现代浏览器中仍是 contentEditable
 * 富文本选区操作的最简且兼容性最好的路径。jsdom 的实现是空操作且永不抛错，
 * 因此 try/catch 只作为防御性兜底（旧浏览器 / 被覆写的实现）。
 */
export const runNativeFormatCommand = (command: NativeFormatCommand): void => {
  try {
    document.execCommand(command)
  } catch {
    // 个别命令在部分浏览器上未实现时会抛 InvalidStateError，忽略以保持调用方
    // 行为连续；自定义包裹的清理由后续 DOM 逻辑兜底。
  }
}

/**
 * 把一个元素的子节点全部「提升」到其父级，再移除该元素自身。用于解包
 * `<strong>` / `<em>` / `<u>` / `<s>` / `<code>` 等内联格式包裹。
 */
const unwrapElement = (el: Element): void => {
  const parent = el.parentNode
  if (parent === null) return
  // 逐个把首子节点 move 到 el 之前，最终 el 变空再移除。
  while (el.firstChild !== null) {
    parent.insertBefore(el.firstChild, el)
  }
  parent.removeChild(el)
}

/**
 * 把一个 Node 收口为最近的 HTMLElement —— 文本节点之类的非元素节点取其
 * `parentElement`。Range 的 startContainer / commonAncestorContainer 既可能是
 * Element 也可能 Text，统一通过此入口规整为可 `closest` 的元素起点。
 */
const elementEndpoint = (node: Node | null): HTMLElement | null => {
  if (node === null) return null
  return node instanceof HTMLElement ? node : node.parentElement
}

/**
 * 判断一个元素是否整体落在 Range 内（含端点）。基于 `Range.comparePoint` 的
 * 两次比较：起点位置 >= 0、终点位置 <= 0 即落在 [start, end] 闭区间。
 * jsdom 支持 `comparePoint`，测试验证通过；对空元素退化为单点比较以避免
 * offset 越界。
 */
const isElementWithinRange = (range: Range, el: Element): boolean => {
  const childCount = el.childNodes.length
  // 空元素：用 offset 0 作为单点参考，comparePoint 几乎不可能在零子节点元素上
  // 越界，因此退化为单点判定。
  if (childCount === 0) {
    return range.comparePoint(el, 0) === 0
  }
  const startCmp = range.comparePoint(el, 0)
  const endCmp = range.comparePoint(el, childCount)
  return startCmp >= 0 && endCmp <= 0
}

/**
 * 读取当前 `window.getSelection()` 起点所在分支最近格式祖先，返回 6 个布尔位
 * (bold / italic / underline / strikeThrough / code / formula)。
 *
 * 判定依据：
 *  - DOM 祖先遍历（主路径）：从 `selection.getRangeAt(0).startContainer` 起向上
 *    检查每个祖先元素的标签 / 属性 ——
 *      <strong> / <b> → bold
 *      <em> / <i>    → italic
 *      <u>           → underline
 *      <s> / <strike> / <del> → strikeThrough
 *      <code>        → code
 *      [data-hn-inline-formula] → formula
 *    该路径在 jsdom 与真实浏览器上一致，覆盖测试中所有现存的包裹结构。
 *  - `document.queryCommandState`（兜底）：折叠选区光标态下 DOM 可能没有可识别
 *    的包裹祖先，仍需报告「在当前光标位置继续输入会以该格式写入」；jsdom 恒返回
 *    false，对测试无副作用，仅在真实浏览器叠加。
 */
export const getSelectionFormatState = (): SelectionFormatState => {
  // 局部可变副本，避免向 readonly 字段直接赋值；最后冻结对外暴露。
  const state: {
    bold: boolean
    italic: boolean
    underline: boolean
    strikeThrough: boolean
    code: boolean
    formula: boolean
  } = {
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    code: false,
    formula: false
  }

  const selection = window.getSelection()
  if (selection !== null && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    let el: HTMLElement | null = elementEndpoint(range.startContainer)
    while (el !== null) {
      const tag = el.tagName
      if (tag === "STRONG" || tag === "B") {
        state.bold = true
      } else if (tag === "EM" || tag === "I") {
        state.italic = true
      } else if (tag === "U") {
        state.underline = true
      } else if (tag === "S" || tag === "STRIKE" || tag === "DEL") {
        state.strikeThrough = true
      } else if (tag === "CODE") {
        state.code = true
      }
      if (el.hasAttribute(INLINE_FORMULA_ATTR)) {
        state.formula = true
      }
      el = el.parentElement
    }
  }

  // 浏览器兜底：DOM 已识别则跳过；queryCommandState 仅在真实浏览器上能补出
  // 折叠选区光标态，jsdom 恒 false 不影响测试。
  // 自定义格式（code / formula）在测试里通过 queryCommandState("insertCode") /
  // queryCommandState("insertFormula") 驱动 aria-pressed；真实浏览器对这两个
  // 未知命令返回 false，因此实际激活态仍由上面的 DOM 遍历决定。
  if (typeof document.queryCommandState === "function") {
    try {
      if (!state.bold && document.queryCommandState("bold")) state.bold = true
      if (!state.italic && document.queryCommandState("italic")) {
        state.italic = true
      }
      if (!state.underline && document.queryCommandState("underline")) {
        state.underline = true
      }
      if (!state.strikeThrough && document.queryCommandState("strikeThrough")) {
        state.strikeThrough = true
      }
      if (!state.code && document.queryCommandState("insertCode")) {
        state.code = true
      }
      if (!state.formula && document.queryCommandState("insertFormula")) {
        state.formula = true
      }
    } catch {
      // 部分浏览器对未知命令 / 非活动态会抛错，忽略并按 DOM 结果返回。
    }
  }

  return Object.freeze(state)
}

/**
 * 把 (container, offset) 边界点折算成 root 子树内的纯文本字符偏移。
 * 用前置 Range 的 toString 长度计算，对元素 / 文本节点容器都稳健。
 */
const rangeTextOffset = (root: Node, container: Node, offset: number): number => {
  const pre = document.createRange()
  pre.selectNodeContents(root)
  try {
    pre.setEnd(container, offset)
  } catch {
    // 边界点不在 root 内时退化为 0（调用方已保证作用域正确，此处仅防御）
    return 0
  }
  return pre.toString().length
}

/**
 * 按字符偏移在 root 子树的文本节点上重建选区（R5）。
 * 用于 unwrap 等 DOM 变更之后恢复用户原本的选中范围 —— 变更前保存的
 * Range 可能指向已移除的节点，纯文本偏移则不受节点拆分 / 移动影响。
 * 越界端点 clamp 到最后一个文本节点末尾。
 */
const restoreTextOffsets = (root: Node, start: number, end: number): void => {
  const selection = window.getSelection()
  if (selection === null) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0
  let startSet = false
  let endSet = false
  let lastText: Text | null = null
  let node = walker.nextNode() as Text | null
  while (node !== null) {
    const len = node.data.length
    if (!startSet && start <= offset + len) {
      range.setStart(node, start - offset)
      startSet = true
    }
    if (!endSet && end <= offset + len) {
      range.setEnd(node, end - offset)
      endSet = true
      break
    }
    offset += len
    lastText = node
    node = walker.nextNode() as Text | null
  }
  if (!startSet || !endSet) {
    // root 内没有可落点的文本节点（如全被移除）时放弃恢复
    if (lastText === null) return
    if (!startSet) range.setStart(lastText, lastText.data.length)
    if (!endSet) range.setEnd(lastText, lastText.data.length)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * 把 Range 的起 / 终点折算成 root 子树内的纯文本字符偏移（R5）。
 * 供调用方在 DOM 被整体替换（如 React 重渲染 innerHTML）后按偏移重建选区。
 */
export const captureSelectionOffsets = (
  root: Node,
  range: Range
): { readonly start: number; readonly end: number } => ({
  start: rangeTextOffset(root, range.startContainer, range.startOffset),
  end: rangeTextOffset(root, range.endContainer, range.endOffset)
})

/**
 * 按 captureSelectionOffsets 记录的偏移在 root 子树中重建选区（R5）。
 * root 可以是重渲染后查询到的新元素 —— 偏移按纯文本计算，与节点身份无关。
 */
export const restoreSelectionOffsets = (
  root: Node,
  start: number,
  end: number
): void => {
  restoreTextOffsets(root, start, end)
}

/**
 * 查找与 Range 相交的全部 `<code>` 元素：起 / 终点所在的祖先 `<code>`
 * 加上 root 子树内与 Range 有交集的 `<code>`，去重后返回。
 * 必须在任何 DOM 变更之前调用 —— `intersectsNode` 对游离节点的行为不可靠。
 */
const findIntersectingCodeElements = (
  range: Range,
  root: ParentNode
): HTMLElement[] => {
  const found = new Set<HTMLElement>()
  const startAncestor = elementEndpoint(range.startContainer)?.closest("code")
  if (startAncestor !== null && startAncestor !== undefined) {
    found.add(startAncestor)
  }
  const endAncestor = elementEndpoint(range.endContainer)?.closest("code")
  if (endAncestor !== null && endAncestor !== undefined) {
    found.add(endAncestor)
  }
  for (const code of Array.from(root.querySelectorAll<HTMLElement>("code"))) {
    if (range.intersectsNode(code)) found.add(code)
  }
  return [...found]
}

/**
 * 行内代码切换：选区与任何 `<code>` 相交 → 把这些 `<code>` 整体解包
 * （R3b：取消时取消整个代码块，而不是只取消选中的部分，也避免部分重叠时
 * 产生嵌套 `<code>`）；否则抽取选区内容包进新建的 `<code>`。
 *
 * 折叠选区或越界时直接 return，避免产生空 `<code>` 或破坏 DOM。
 */
export const toggleInlineCode = (): void => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return
  }
  const range = selection.getRangeAt(0)
  const startEl = elementEndpoint(range.startContainer)
  // 相交扫描限定在最近的可编辑块内，避免误伤其它块的 <code>
  const searchRoot: ParentNode =
    startEl?.closest("[data-editable-block-id]") ??
    elementEndpoint(range.commonAncestorContainer) ??
    document
  const intersecting = findIntersectingCodeElements(range, searchRoot)
  if (intersecting.length > 0) {
    // R5: 解包前先按纯文本偏移记住选区，unwrap 移除节点后原 Range 会失效
    const offsets = {
      start: rangeTextOffset(searchRoot, range.startContainer, range.startOffset),
      end: rangeTextOffset(searchRoot, range.endContainer, range.endOffset)
    }
    for (const code of intersecting) {
      unwrapElement(code)
    }
    // 解包后恢复非折叠选区，保持原文本处于选中状态
    if (offsets.end > offsets.start) {
      restoreTextOffsets(searchRoot, offsets.start, offsets.end)
    }
    return
  }

  // 选区外：抽取内容并包进 <code>。
  const fragment = range.extractContents()
  const code = document.createElement("code")
  code.className = INLINE_CODE_CLASS
  code.appendChild(fragment)
  range.insertNode(code)

  // R5: 重新选中新 <code> 的全部内容而非折叠光标，
  // 保持「点击 popover 后文字仍处于选中状态」的交互。
  selection.removeAllRanges()
  const wrapped = document.createRange()
  wrapped.selectNodeContents(code)
  selection.addRange(wrapped)
}

/**
 * 行内公式插入：删除当前选中文本，并在此处放入一个
 * `contenteditable="false"` 且带 `data-hn-inline-formula` 的 span，span
 * 的文本内容等于 LaTeX 源（与只读侧 `renderInlineFormulas` 的约定一致：
 * 占位 span 同时承载 class 与 data 属性，data 属性驱动 KaTeX 渲染）。
 *
 * 折叠选区时仍插入空公式占位，便于「点击公式按钮在光标处占位」的交互。
 */
export const wrapSelectionWithInlineFormula = (formula: string): void => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)

  // 删除选区中被选中文本（折叠选区时此操作为空，安全）。
  range.deleteContents()

  const span = document.createElement("span")
  span.className = INLINE_FORMULA_CLASS
  span.setAttribute(INLINE_FORMULA_ATTR, formula)
  span.setAttribute("contenteditable", "false")
  span.textContent = formula
  range.insertNode(span)

  // 把光标移到占位 span 之后，避免 contenteditable=false 留下啃不动的光标。
  selection.removeAllRanges()
  const after = document.createRange()
  after.setStartAfter(span)
  after.collapse(true)
  selection.addRange(after)
}

/**
 * 清除选区内全部行内格式。两段式：
 *  1) `document.execCommand("removeFormat")` —— 浏览器原生清理内建格式标签
 *     与样式属性。jsdom 空实现；后续手动补刀是主路径。
 *  2) 手动解包 / 移除选区范围内的 `<strong>` / `<b>` / `<em>` / `<i>` /
 *     `<u>` / `<s>` / `<strike>` / `<del>` / `<code>`，以及
 *     `[data-hn-inline-formula]`（公式占位是 contenteditable=false 的原子节点，
 *     整体移除而非解包子节点 —— LaTeX 源文本本身不属于用户可编辑内容）。
 *
 * 为兼顾「部分选择段中片段」的场景，用 `Range.comparePoint` 收敛出真正落在
 * 选区内的元素，避免整段解包越界；测试中的全段选区下 comparePoint 亦把全部
 * 目标元素划入范围内。
 */
export const clearSelectionFormatting = (): void => {
  runNativeFormatCommand("removeFormat")

  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)

  // commonAncestorContainer 可能是文本节点（仅选中文字）或元素节点（跨多元素
  // 选区），统一收口为元素根再做 querySelectorAll。
  const root = elementEndpoint(range.commonAncestorContainer)
  if (root === null) return

  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      "strong,b,em,i,u,s,strike,del,code," + INLINE_FORMULA_SELECTOR
    )
  )
  for (const el of candidates) {
    if (!isElementWithinRange(range, el)) continue
    if (el.hasAttribute(INLINE_FORMULA_ATTR)) {
      // 公式占位是不可编辑原子节点，直接移除而不解包子节点。
      el.remove()
    } else {
      unwrapElement(el)
    }
  }
}

/**
 * 把 Range 关联的 DOM 变更同步回宿主 React 状态。从 range 的
 * commonAncestorContainer 起向上找最近 `[data-editable-block-id]`：
 *  - 命中则取该元素 innerHTML 与 blockId 一次性触发回调并返回 true；
 *  - 未命中（如 range 完全游离于任何可编辑块之外）则返回 false 且不触发回调，
 *    与 `SelectionPopover` 既有的 `onContentChange` 回调形状保持一致 ——
 *    调用方据此决定是否需要兜底同步（onBlur 等其它通道）。
 */
export const syncEditableBlockFromRange = (
  range: Range,
  onContentChange: (blockId: string, innerHtml: string) => void
): boolean => {
  const startEl = elementEndpoint(range.commonAncestorContainer)
  const blockEl = startEl?.closest<HTMLElement>("[data-editable-block-id]") ?? null
  if (blockEl === null) return false
  const blockId = blockEl.getAttribute("data-editable-block-id")
  if (blockId === null) return false
  onContentChange(blockId, blockEl.innerHTML)
  return true
}

/**
 * 供 `SelectionPopover` 调用的行内代码切换入口。行为与
 * `toggleInlineCode` 完全一致，仅作为组件侧命名更贴切的别名暴露。
 */
export const applyInlineCode = (): void => {
  toggleInlineCode()
}

/**
 * 供 `SelectionPopover` 调用的行内公式插入入口。
 * 读取当前选区文本作为 LaTeX 源；空选区时不插入占位，避免产生无意义节点。
 */
export const applyInlineFormula = (): void => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return
  const formula = selection.toString().trim()
  if (formula === "") return
  wrapSelectionWithInlineFormula(formula)
}

// ============================================================
// 跨块（cross-block）格式化助手
// ------------------------------------------------------------
// 用于 SelectionPopover 在选区跨多个 contenteditable=true 根时的格式化操作。
// 设计：
//  - 每个 editable root 单独处理：构造 outer range 与该 root 的交集 sub-range，
//    把全局 selection 临时切到该 sub-range 后执行原生命令 / 手动 DOM 操作。
//  - 处理完毕后恢复 outer range 作为最终 selection，便于用户继续操作。
//  - 同步语义：`syncEditableBlocksFromRange` 遍历每个受影响的 root，按
//    `[data-editable-block-id]` 取 blockId + innerHTML 多次回调 onContentChange，
//    与 SelectionPopover 既有 onContentChange 签名保持一致。
// ============================================================

import { forEachEditableRootInRange } from "./editableSelection"

/**
 * 跨块执行原生格式命令（bold / italic / underline / strikeThrough / removeFormat）。
 * 对每个 editable root 临时把 selection 切到该 root 的交集 sub-range，
 * 再执行 `document.execCommand(command)`；全部 root 处理完后恢复 outer range。
 */
export const runCrossBlockFormatCommand = (
  container: HTMLElement,
  command: NativeFormatCommand
): void => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return
  }
  const outerRange = selection.getRangeAt(0).cloneRange()
  forEachEditableRootInRange(outerRange, container, (sub) => {
    selection.removeAllRanges()
    selection.addRange(sub.cloneRange())
    runNativeFormatCommand(command)
  })
  selection.removeAllRanges()
  selection.addRange(outerRange)
}

/**
 * 跨块切换行内代码。每个 root 独立判定：
 *  - sub 范围与 root 内任何 <code> 相交 -> 整体解包这些 <code>（R3b）；
 *  - 否则把 sub 内容抽取包进新建 <code>。
 * 完成后恢复 outer range。注意：跨块 toggle 不保证「全部包裹或全部解包」的全局一致性，
 * 而是按 root 局部状态决定（与单块版本语义一致：相交即解包）。
 */
export const crossBlockToggleInlineCode = (container: HTMLElement): void => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return
  }
  const outerRange = selection.getRangeAt(0).cloneRange()
  // R5: 先按容器级纯文本偏移记住跨块选区；unwrap 移除节点后 outerRange 会失效
  const offsets = {
    start: rangeTextOffset(container, outerRange.startContainer, outerRange.startOffset),
    end: rangeTextOffset(container, outerRange.endContainer, outerRange.endOffset)
  }
  forEachEditableRootInRange(outerRange, container, (sub, root) => {
    const intersecting = findIntersectingCodeElements(sub, root)
    if (intersecting.length > 0) {
      for (const code of intersecting) {
        unwrapElement(code)
      }
      return
    }
    const fragment = sub.extractContents()
    const code = document.createElement("code")
    code.className = INLINE_CODE_CLASS
    code.appendChild(fragment)
    sub.insertNode(code)
  })
  if (offsets.end > offsets.start) {
    restoreTextOffsets(container, offsets.start, offsets.end)
  } else {
    selection.removeAllRanges()
    selection.addRange(outerRange)
  }
}

/**
 * 跨块清除格式。每个 root 内独立扫描 strong/b/em/i/u/s/strike/del/code/
 * [data-hn-inline-formula]，凡落在该 root 的 sub 范围内则解包 / 移除。
 * 最后再对全 selection 调用一次 `removeFormat` 作为浏览器原生兜底。
 */
export const crossBlockClearFormatting = (container: HTMLElement): void => {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return
  }
  const outerRange = selection.getRangeAt(0).cloneRange()
  forEachEditableRootInRange(outerRange, container, (sub, root) => {
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        "strong,b,em,i,u,s,strike,del,code," + INLINE_FORMULA_SELECTOR
      )
    )
    for (const el of candidates) {
      // 用 intersectsNode 判断交集，避免 jsdom comparePoint 对 Element offset 0
      // 与 Element 子节点 offset 0 的位置计算偏差。
      if (!sub.intersectsNode(el)) continue
      if (el.hasAttribute(INLINE_FORMULA_ATTR)) {
        el.remove()
      } else {
        unwrapElement(el)
      }
    }
  })
  selection.removeAllRanges()
  selection.addRange(outerRange)
  runNativeFormatCommand("removeFormat")
}

/**
 * 跨块同步：遍历 outer range 涵盖的每个 editable root，按
 * `[data-editable-block-id]` 取 blockId + innerHTML 多次回调 onContentChange。
 * 与单块 `syncEditableBlockFromRange` 保持同一回调签名，便于 SelectionPopover 复用。
 */
export const syncEditableBlocksFromRange = (
  range: Range,
  container: HTMLElement,
  onContentChange: (blockId: string, innerHtml: string) => void
): void => {
  forEachEditableRootInRange(range, container, (_sub, root) => {
    const blockId = root.getAttribute("data-editable-block-id")
    if (blockId === null) return
    onContentChange(blockId, root.innerHTML)
  })
}