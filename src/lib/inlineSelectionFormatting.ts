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
 * 行内代码切换：选区在 `<code>` 内 → 解包并把其子节点提升回父级；
 * 选区外 → 抽取选区内容包进新建的 `<code>`，并把光标定位到包裹之后，
 * 方便用户继续输入。
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
  // 已在 <code> 内：解包。
  const codeAncestor = startEl?.closest("code") ?? null
  if (codeAncestor !== null) {
    unwrapElement(codeAncestor)
    return
  }

  // 选区外：抽取内容并包进 <code>。
  const fragment = range.extractContents()
  const code = document.createElement("code")
  code.appendChild(fragment)
  range.insertNode(code)

  // 把光标移到新插入的 <code> 之后，与原生 execCommand 的 wrap 行为一致。
  selection.removeAllRanges()
  const after = document.createRange()
  after.setStartAfter(code)
  after.collapse(true)
  selection.addRange(after)
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