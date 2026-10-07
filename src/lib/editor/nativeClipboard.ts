import type { Editor } from "@tiptap/core"
import { closeHistory } from "@tiptap/pm/history"
import { encodeHnn } from "../hnn/codec"
import { parseHnnClipboardNode } from "../hnn/extensions"
import { HNN_LIMITS, HNN_TABLE_LIMITS } from "../hnn/limits"

/** 所有 custom marker 必须命中 extensions 的唯一闭合声明；普通外部 HTML 交给 PM parser。 */
function hasUnsafeCustomClipboardHtml(html: string): boolean {
  const document = new DOMParser().parseFromString(html, "text/html")
  for (const element of document.querySelectorAll<HTMLElement>("[data-hnn-node]")) {
    if (parseHnnClipboardNode(element) === null) return true
  }
  return false
}

function boundedPositiveSpan(value: string | null): number | null {
  if (value === null) return 1
  if (!/^[1-9]\d*$/u.test(value)) return null
  const span = Number(value)
  return Number.isSafeInteger(span) && span <= HNN_TABLE_LIMITS.maxSpan ? span : null
}

/**
 * 在浏览器/PM 解析标准 HTML table 前按固定 64 列 occupancy 检查不可信几何。输入中的
 * colspan/rowspan 绝不决定数组长度，宽度、行数、单元格数和 grid 面积均有固定上限。
 * ragged 行是可修复输入，保留给后续 TableKit fixTables；只拒绝资源/几何上不安全的表。
 */
function hasUnsafeStandardTableHtml(html: string): boolean {
  const document = new DOMParser().parseFromString(html, "text/html")
  const tables = document.querySelectorAll<HTMLTableElement>("table")
  if (tables.length > HNN_LIMITS.maxNodes) return true
  let elementBudget = 0
  for (const table of tables) {
    const rows = [...table.querySelectorAll<HTMLTableRowElement>("tr")]
      .filter((row) => row.closest("table") === table)
    if (rows.length > HNN_TABLE_LIMITS.maxRows) return true
    const occupancy = new Array<number>(HNN_TABLE_LIMITS.maxColumns).fill(0)
    let width = 0
    for (const row of rows) {
      const cells = [...row.children].filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement)
      elementBudget += cells.length + 1
      if (elementBudget > HNN_LIMITS.maxNodes) return true
      let column = 0
      for (const cell of cells) {
        const colspan = boundedPositiveSpan(cell.getAttribute("colspan"))
        const rowspan = boundedPositiveSpan(cell.getAttribute("rowspan"))
        if (colspan === null || rowspan === null) return true
        while (column < HNN_TABLE_LIMITS.maxColumns && occupancy[column] !== 0) column += 1
        if (column + colspan > HNN_TABLE_LIMITS.maxColumns) return true
        for (let offset = 0; offset < colspan; offset += 1) {
          if (occupancy[column + offset] !== 0) return true
          occupancy[column + offset] = rowspan
        }
        column += colspan
      }
      width = Math.max(width, column)
      if (width * rows.length > HNN_TABLE_LIMITS.maxGridCells) return true
      for (let columnIndex = 0; columnIndex < HNN_TABLE_LIMITS.maxColumns; columnIndex += 1) {
        occupancy[columnIndex] = Math.max(0, occupancy[columnIndex]! - 1)
      }
    }
  }
  return false
}

/**
 * 保持 PM 原生 copy/cut/paste handler 和默认单 transaction dispatch。capture 阶段先拒绝
 * 原始非法 custom marker/composition paste，dispatch 阶段再验证实际 document-changing
 * transaction（覆盖 TableKit、ordered-list 等任何前序 handler 生成的 transaction）。
 */
export function installHnnClipboardHistoryBoundary(editor: Editor): () => void {
  const view = editor.view
  const previousDispatch = view.dispatch
  let activeClipboard: "paste" | "cut" | null = null
  let closeFollowingInput = false
  let composing = false
  const stopPaste = (event: ClipboardEvent): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const armPaste = (event: Event): void => {
    const clipboardEvent = event as ClipboardEvent
    // jsdom 并不提供 ClipboardEvent 构造器；真实浏览器与测试夹具都以结构性字段识别。
    if (event.type !== "paste") return
    const clipboardData = "clipboardData" in clipboardEvent ? clipboardEvent.clipboardData : null
    // PM 的 capturePaste 无 clipboardData 时会走异步 DOM setTimeout 路径，无法保证本
    // 次 raw validator/history boundary 覆盖，因此直接拒绝并保持 editor state 不变。
    if (clipboardData === null) {
      stopPaste(clipboardEvent)
      return
    }
    const html = clipboardData.getData("text/html")
    // composition 中浏览器可能直接改写 DOM；本库拒绝这次粘贴，避免未验证 mutation 入库。
    if (composing || view.composing || (html !== "" && (hasUnsafeCustomClipboardHtml(html) || hasUnsafeStandardTableHtml(html)))) {
      stopPaste(clipboardEvent)
      return
    }
    activeClipboard = "paste"
    queueMicrotask(() => { activeClipboard = null })
  }
  const armCut = (): void => {
    activeClipboard = "cut"
    queueMicrotask(() => { activeClipboard = null })
  }
  const onCompositionStart = (): void => { composing = true }
  const onCompositionEnd = (): void => { composing = false }
  view.dom.addEventListener("paste", armPaste, true)
  view.dom.addEventListener("cut", armCut, true)
  view.dom.addEventListener("compositionstart", onCompositionStart, true)
  view.dom.addEventListener("compositionend", onCompositionEnd, true)
  const guardedDispatch: typeof view.dispatch = (transaction) => {
    if (activeClipboard !== null && transaction.docChanged) {
      try {
        // applyTransaction 会运行真实的 appendTransaction 链（TableKit fixTables、nodeId
        // repair 等）。它只创建不可变 preview state，绝不把候选 materialize 到 view。
        const preview = view.state.applyTransaction(transaction)
        encodeHnn(preview.state.doc)
      } catch {
        // 不 forward 即不产生 mutation/history/dirty；原生 clipboard handler 已在处理中。
        return
      }
      closeHistory(transaction)
      closeFollowingInput = true
    } else if (closeFollowingInput && transaction.docChanged) {
      // selection transaction 不消费边界；paste/cut 后第一条实际输入独立成为一段历史。
      closeHistory(transaction)
      closeFollowingInput = false
    }
    previousDispatch.call(view, transaction)
  }
  view.dispatch = guardedDispatch
  return () => {
    view.dom.removeEventListener("paste", armPaste, true)
    view.dom.removeEventListener("cut", armCut, true)
    view.dom.removeEventListener("compositionstart", onCompositionStart, true)
    view.dom.removeEventListener("compositionend", onCompositionEnd, true)
    // 多个内部包装器的 cleanup 不得覆盖后安装的 dispatch wrapper。
    if (view.dispatch === guardedDispatch) view.dispatch = previousDispatch
  }
}
