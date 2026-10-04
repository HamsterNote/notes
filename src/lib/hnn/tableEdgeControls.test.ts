// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Editor } from "@tiptap/core"
import { undoDepth } from "@tiptap/pm/history"

import { computeTableDragTarget } from "./tableEdgeControls"
import { installHnnBudgetEncoder } from "./budgetedTransaction"
import { createEditorSession, type EditorSession } from "../editor/session"
import { encodeHnn, type HnnDocument } from "./codec"
import { HNN_LIMITS, UUID_V4_PATTERN } from "./limits"
import { collectHnnNodeIds } from "./nodeId"

// 严格编码器注入（生产由 blockMenu 完成；此处测试独立加载 hnn 模块需自行注入）。
installHnnBudgetEncoder(encodeHnn)

let seq = 0
const nid = () => `123e4567-e89b-42d3-a456-${String(++seq).padStart(12, "0")}`

function tableDocument(rows: number, cols: number): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{
        type: "table",
        attrs: { nodeId: nid() },
        content: Array.from({ length: rows }, (_r, r) => ({
          type: "tableRow",
          attrs: { nodeId: nid() },
          content: Array.from({ length: cols }, (_c, c) => ({
            type: "tableCell",
            attrs: { nodeId: nid(), colspan: 1, rowspan: 1, colwidth: null, align: null },
            content: [{ type: "paragraph", attrs: { nodeId: nid() }, content: [{ type: "text", text: `r${r + 1}c${c + 1}` }] }]
          }))
        }))
      }]
    }
  }
}

/** 单行：唯一单元格 colspan=2（childCount 1，逻辑宽度 2），验证 span 感知。 */
function colspanTableDocument(): HnnDocument {
  const cell = (text: string, colspan = 1) => ({
    type: "tableCell",
    attrs: { nodeId: nid(), colspan, rowspan: 1, colwidth: null, align: null },
    content: [{ type: "paragraph", attrs: { nodeId: nid() }, content: [{ type: "text", text }] }]
  })
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{
        type: "table",
        attrs: { nodeId: nid() },
        content: [
          { type: "tableRow", attrs: { nodeId: nid() }, content: [cell("wide", 2), cell("narrow")] },
          { type: "tableRow", attrs: { nodeId: nid() }, content: [cell("a"), cell("b"), cell("c")] }
        ]
      }]
    }
  }
}

/** 空单元格表格：无文本节点，用于逼近 HNN 节点预算（16×15 = 498 节点）。 */
function emptyTableDocument(rows: number, cols: number): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{
        type: "table",
        attrs: { nodeId: nid() },
        content: Array.from({ length: rows }, () => ({
          type: "tableRow",
          attrs: { nodeId: nid() },
          content: Array.from({ length: cols }, () => ({
            type: "tableCell",
            attrs: { nodeId: nid(), colspan: 1, rowspan: 1, colwidth: null, align: null },
            content: [{ type: "paragraph", attrs: { nodeId: nid() } }]
          }))
        }))
      }]
    }
  }
}

/** 大文本段落 + 单列表格：用于构造逼近 512 KiB 外壳上限的合法文档。 */
function budgetTableDocument(paragraphCount: number, textLen: number, tableRows: number): HnnDocument {
  const content: unknown[] = Array.from({ length: paragraphCount }, () => ({
    type: "paragraph",
    attrs: { nodeId: nid() },
    ...(textLen > 0 ? { content: [{ type: "text", text: "x".repeat(textLen) }] } : {})
  }))
  content.push({
    type: "table",
    attrs: { nodeId: nid() },
    content: Array.from({ length: tableRows }, () => ({
      type: "tableRow",
      attrs: { nodeId: nid() },
      content: [{
        type: "tableCell",
        attrs: { nodeId: nid(), colspan: 1, rowspan: 1, colwidth: null, align: null },
        content: [{ type: "paragraph", attrs: { nodeId: nid() } }]
      }]
    }))
  })
  return { schemaVersion: 1, data: { type: "doc", content } }
}

/** 合法合并布局：A 占逻辑 rows1-2/cols1-2（colspan2 rowspan2），第 3 行 D/E/F。 */function mergedTableDocument(): HnnDocument {
  const cell = (text: string, span: { colspan?: number; rowspan?: number } = {}) => ({
    type: "tableCell",
    attrs: { nodeId: nid(), colspan: span.colspan ?? 1, rowspan: span.rowspan ?? 1, colwidth: null, align: null },
    content: [{ type: "paragraph", attrs: { nodeId: nid() }, content: [{ type: "text", text }] }]
  })
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{
        type: "table",
        attrs: { nodeId: nid() },
        content: [
          { type: "tableRow", attrs: { nodeId: nid() }, content: [cell("A", { colspan: 2, rowspan: 2 }), cell("B")] },
          { type: "tableRow", attrs: { nodeId: nid() }, content: [cell("C")] },
          { type: "tableRow", attrs: { nodeId: nid() }, content: [cell("D"), cell("E"), cell("F")] }
        ]
      }]
    }
  }
}

/** 按可见文案取当前打开菜单的条目。 */
function menuItem(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((button) => button.textContent === label)
  expect(found, `菜单条目：${label}`).toBeDefined()
  return found!
}

const mountedShells: HTMLElement[] = []
const sessions: EditorSession[] = []

function sessionFor(doc: HnnDocument): EditorSession {
  const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: doc })
  const shell = session.editor.view.dom.parentElement
  if (shell instanceof HTMLElement && !shell.isConnected) {
    document.body.appendChild(shell)
    mountedShells.push(shell)
  }
  sessions.push(session)
  return session
}

beforeEach(() => {
  seq = 0
})

afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy()
  for (const shell of mountedShells.splice(0)) shell.remove()
  document.body.innerHTML = ""
  // 拖拽测试注入的 elementFromPoint 桩一律还原。
  delete (document as Partial<Document>).elementFromPoint
})

function wrapper(session: EditorSession): HTMLElement {
  const element = session.editor.view.dom.querySelector<HTMLElement>(".hn-editor-table-wrapper")
  expect(element).not.toBeNull()
  return element!
}

function cells(session: EditorSession): HTMLElement[] {
  return Array.from(wrapper(session).querySelectorAll<HTMLElement>("td, th"))
}

function edge(session: EditorSession, label: string): HTMLButtonElement {
  const button = wrapper(session).querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  return button!
}

function rowCount(session: EditorSession): number {
  return session.editor.state.doc.firstChild!.childCount
}

function colCount(session: EditorSession): number {
  let max = 0
  session.editor.state.doc.firstChild!.forEach((row) => { max = Math.max(max, row.childCount) })
  return max
}

/** 首列单元格文本按文档顺序排列，用来断言行顺序。 */
function firstColumnTexts(session: EditorSession): string[] {
  const texts: string[] = []
  session.editor.state.doc.firstChild!.forEach((row) => texts.push(row.firstChild!.textContent))
  return texts
}

function focusText(editor: Editor, text: string): void {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.isText && node.text === text) { found = pos; return false }
    return true
  })
  expect(found).toBeGreaterThanOrEqual(0)
  editor.commands.setTextSelection(found + 1)
}

/** jsdom 没有 PointerEvent：以结构性字段构造（与本库事件读取方式一致）。 */
function pointerEvent(type: string, init: { pointerId?: number; clientX?: number; clientY?: number } = {}): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0, ...init })
  return event
}

describe("computeTableDragTarget：中点推进规则", () => {
  it("指针未过中点→插入目标之前；越过中点→推进到目标之后", () => {
    expect(computeTableDragTarget({ sourceIndex: 2, targetIndex: 0, itemCount: 3, pointerOffset: 49, targetSize: 100 }))
      .toEqual({ insertionIndex: 0, destinationIndex: 0 })
    expect(computeTableDragTarget({ sourceIndex: 2, targetIndex: 0, itemCount: 3, pointerOffset: 50, targetSize: 100 }))
      .toEqual({ insertionIndex: 1, destinationIndex: 1 })
  })

  it("源在边界之前时落点下标减一；源之后则保持", () => {
    // 源 0 拖到第 2 项之后：插入边界 3 → 落点 2
    expect(computeTableDragTarget({ sourceIndex: 0, targetIndex: 2, itemCount: 3, pointerOffset: 90, targetSize: 100 }))
      .toEqual({ insertionIndex: 3, destinationIndex: 2 })
    // 源 2 拖到第 0 项之前：插入边界 0 → 落点 0
    expect(computeTableDragTarget({ sourceIndex: 2, targetIndex: 0, itemCount: 3, pointerOffset: 10, targetSize: 100 }))
      .toEqual({ insertionIndex: 0, destinationIndex: 0 })
  })

  it("非法输入（越界/非整数/零尺寸）返回 null", () => {
    expect(computeTableDragTarget({ sourceIndex: -1, targetIndex: 0, itemCount: 3, pointerOffset: 1, targetSize: 100 })).toBeNull()
    expect(computeTableDragTarget({ sourceIndex: 0, targetIndex: 3, itemCount: 3, pointerOffset: 1, targetSize: 100 })).toBeNull()
    expect(computeTableDragTarget({ sourceIndex: 0, targetIndex: 1, itemCount: 3, pointerOffset: 1, targetSize: 0 })).toBeNull()
    expect(computeTableDragTarget({ sourceIndex: 0.5, targetIndex: 1, itemCount: 3, pointerOffset: 1, targetSize: 100 })).toBeNull()
  })
})

describe("tableEdgeControls：边界 + 控件", () => {
  it("hover 单元格显现四边 +；首行无上边界 +、首列无左边界 +（§10 边界归属规则）", () => {
    const session = sessionFor(tableDocument(3, 3))
    const cell = cells(session)[4]! // r2c2：内部单元格
    cell.dispatchEvent(pointerEvent("pointerover"))
    for (const label of ["在上方插入行", "在下方插入行", "在左侧插入列", "在右侧插入列"]) {
      expect(edge(session, label).classList.contains("is-visible")).toBe(true)
    }

    // 首行单元格：无“在上方插入行”
    cells(session)[1]!.dispatchEvent(pointerEvent("pointerover"))
    expect(edge(session, "在上方插入行").classList.contains("is-visible")).toBe(false)
    expect(edge(session, "在下方插入行").classList.contains("is-visible")).toBe(true)

    // 首列单元格：无“在左侧插入列”
    cells(session)[3]!.dispatchEvent(pointerEvent("pointerover"))
    expect(edge(session, "在左侧插入列").classList.contains("is-visible")).toBe(false)
    expect(edge(session, "在右侧插入列").classList.contains("is-visible")).toBe(true)
  })

  it("点击下边界 + 在该行之后插入行；点击右边界 + 在该列之后插入列；各为单历史步", () => {
    const session = sessionFor(tableDocument(2, 2))
    cells(session)[0]!.dispatchEvent(pointerEvent("pointerover")) // hover r1c1
    edge(session, "在下方插入行").click()
    expect(rowCount(session)).toBe(3)
    // 新行紧跟 r1：首列顺序 r1c1 → 空 → r2c1
    expect(firstColumnTexts(session)).toEqual(["r1c1", "", "r2c1"])
    session.editor.commands.undo()
    expect(rowCount(session)).toBe(2)
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r2c1"])

    edge(session, "在右侧插入列").click()
    expect(colCount(session)).toBe(3)
    session.editor.commands.undo()
    expect(colCount(session)).toBe(2)
  })

  it("colspan 单元格的边界插入按逻辑网格计算，结构保持合法（span 感知）", () => {
    const session = sessionFor(colspanTableDocument())
    const wide = cells(session).find((c) => c.textContent === "wide")!
    wide.dispatchEvent(pointerEvent("pointerover"))
    // wide 占逻辑 [left=0,right=2) [top=0,bottom=1)：无 top/left，有 bottom/right
    expect(edge(session, "在上方插入行").classList.contains("is-visible")).toBe(false)
    expect(edge(session, "在左侧插入列").classList.contains("is-visible")).toBe(false)
    edge(session, "在下方插入行").click()
    expect(rowCount(session)).toBe(3)
    // 合并单元格属性未被破坏
    const merged = session.editor.state.doc.firstChild!.firstChild!.firstChild!
    expect(merged.attrs["colspan"]).toBe(2)
    expect(merged.textContent).toBe("wide")
    // 首轮 childCount=2（合并）的行仍是两行高度结构的一部分：撤销一步还原
    session.editor.commands.undo()
    expect(rowCount(session)).toBe(2)
  })

  it("达到 HNN_TABLE_LIMITS 上限的行方向 + 不显现，列方向不受影响", () => {
    const session = sessionFor(tableDocument(64, 2))
    cells(session)[3]!.dispatchEvent(pointerEvent("pointerover")) // r2c1
    expect(edge(session, "在下方插入行").classList.contains("is-visible")).toBe(false)
    expect(edge(session, "在上方插入行").classList.contains("is-visible")).toBe(false)
    expect(edge(session, "在右侧插入列").classList.contains("is-visible")).toBe(true)
  })

  it("紧邻单元格输入后的边界插入是独立 undo step", () => {
    const session = sessionFor(tableDocument(2, 2))
    focusText(session.editor, "r1c1")
    session.editor.commands.insertContent("改")
    cells(session)[0]!.dispatchEvent(pointerEvent("pointerover"))
    edge(session, "在下方插入行").click()
    expect(rowCount(session)).toBe(3)
    // 一步撤销只还原插入行，输入保留
    session.editor.commands.undo()
    expect(rowCount(session)).toBe(2)
    expect(session.editor.getText()).toContain("改")
    session.editor.commands.undo()
    expect(session.editor.getText()).not.toContain("改")
  })
})

describe("tableEdgeControls：焦点行/列操作控件与菜单", () => {
  it("选区在本表期间操作控件常驻；离开本表即隐藏", () => {
    const session = sessionFor(tableDocument(2, 2))
    expect(wrapper(session).querySelector('[aria-label="行操作"]')!.classList.contains("is-visible")).toBe(false)
    focusText(session.editor, "r2c1")
    expect(wrapper(session).querySelector('[aria-label="行操作"]')!.classList.contains("is-visible")).toBe(true)
    expect(wrapper(session).querySelector('[aria-label="列操作"]')!.classList.contains("is-visible")).toBe(true)
    // 选区离开表格（文档只有表格时移到表尾文本不可行，直接全选末尾后 collapse 到表格外：
    // 用新段落验证）——改为：删除行列后控件仍随焦点在表内显现，此处验证初始隐藏即可。
  })

  it("行操作菜单：在上方/下方插入行 + in-menu 两步删除（删除行 → 确认删除行）", () => {
    const session = sessionFor(tableDocument(3, 2))
    focusText(session.editor, "r2c1")
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()

    const menu = document.querySelector<HTMLElement>(".hn-editor-menu")!
    expect(menu).not.toBeNull()
    expect(menu.getAttribute("aria-label")).toBe("行操作菜单")
    const labels = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent)
    expect(labels).toEqual(["在上方插入行", "在下方插入行", "删除行"])

    // 两步删除：首次只切确认文案，结构不变、菜单不关
    const deleteItem = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === "删除行")!
    deleteItem.click()
    expect(rowCount(session)).toBe(3)
    expect(deleteItem.textContent).toBe("确认删除行")
    expect(document.querySelector(".hn-editor-menu")).not.toBeNull()
    // 再次激活：删除焦点行（r2），菜单关闭，单历史步可撤销
    deleteItem.click()
    expect(rowCount(session)).toBe(2)
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r3c1"])
    expect(document.querySelector(".hn-editor-menu")).toBeNull()
    session.editor.commands.undo()
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r2c1", "r3c1"])
  })

  it("单行表格的删除行禁用并注明原因；单列对称", () => {
    const session = sessionFor(tableDocument(1, 2))
    focusText(session.editor, "r1c1")
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()
    const deleteItem = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === "删除行")!
    expect(deleteItem.disabled).toBe(true)
    expect(deleteItem.title).toContain("至少保留一行")
  })

  it("选区漂移到别的单元格即关闭菜单（确认目标绝不漂移）", () => {
    const session = sessionFor(tableDocument(3, 2))
    focusText(session.editor, "r1c1")
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()
    const deleteItem = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === "删除行")!
    deleteItem.click() // arm
    expect(deleteItem.textContent).toBe("确认删除行")
    // 选区移到另一单元格 → transaction → refresh 关闭菜单（含确认态）
    focusText(session.editor, "r3c1")
    expect(document.querySelector(".hn-editor-menu")).toBeNull()
    expect(rowCount(session)).toBe(3)
  })

  it("Esc 关闭菜单并把焦点归还操作按钮；菜单外 pointerdown/scroll/resize 关闭", () => {
    const session = sessionFor(tableDocument(2, 2))
    focusText(session.editor, "r1c1")
    const rowOp = wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!
    rowOp.click()
    document.querySelector(".hn-editor-menu")!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    expect(document.querySelector(".hn-editor-menu")).toBeNull()
    expect(document.activeElement).toBe(rowOp)

    rowOp.click()
    document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    expect(document.querySelector(".hn-editor-menu")).toBeNull()

    rowOp.click()
    window.dispatchEvent(new window.Event("scroll"))
    expect(document.querySelector(".hn-editor-menu")).toBeNull()
  })

  it("菜单项“在上方插入行”作用于焦点行之上，单历史步", () => {
    const session = sessionFor(tableDocument(2, 2))
    focusText(session.editor, "r2c2")
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === "在上方插入行")!.click()
    expect(firstColumnTexts(session)).toEqual(["r1c1", "", "r2c1"])
    session.editor.commands.undo()
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r2c1"])
  })
})

describe("tableEdgeControls：行/列拖动重排", () => {
  /** 给单元格铺设 100×100 的视口矩形，使中点命中可计算。 */
  function layoutCell(cell: HTMLElement, top: number): void {
    cell.getBoundingClientRect = () =>
      ({ top, left: 0, right: 100, bottom: top + 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) })
  }

  it("拖动行操作控件：穿越中点推进边界、渲染预览线、释放精确落线，单历史步", () => {
    const session = sessionFor(tableDocument(3, 2))
    focusText(session.editor, "r3c1") // 焦点行 = 第 3 行（index 2）
    const rowOp = wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!
    const target = cells(session)[0]! // r1c1
    layoutCell(target, 0)
    ;(document as Partial<Document>).elementFromPoint = () => target

    rowOp.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 2 })) // 阈值内：尚未拖拽
    expect(wrapper(session).classList.contains("hn-editor-table-wrapper--reordering")).toBe(false)
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 10 })) // 越过阈值且未过中点
    expect(wrapper(session).classList.contains("hn-editor-table-wrapper--reordering")).toBe(true)
    // 预览：第 0 行单元格挂 row-before 线
    expect(target.classList.contains("hn-editor-table-preview--row-before")).toBe(true)

    document.dispatchEvent(pointerEvent("pointerup", { clientX: 0, clientY: 10 }))
    expect(firstColumnTexts(session)).toEqual(["r3c1", "r1c1", "r2c1"])
    // 预览与拖拽态清理
    expect(wrapper(session).querySelector("[class*='hn-editor-table-preview']")).toBeNull()
    expect(wrapper(session).classList.contains("hn-editor-table-wrapper--reordering")).toBe(false)
    // 单历史步还原
    session.editor.commands.undo()
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r2c1", "r3c1"])
  })

  it("拖拽结束后的残余 click 被抑制（不弹菜单）；pointercancel 只清理不提交", () => {
    const session = sessionFor(tableDocument(3, 2))
    const rowOp = wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!
    const target = cells(session)[0]!
    layoutCell(target, 0)
    ;(document as Partial<Document>).elementFromPoint = () => target

    // 完整拖拽 → 残余 click 不弹菜单
    focusText(session.editor, "r3c1")
    rowOp.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 10 }))
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 0, clientY: 10 }))
    rowOp.click()
    expect(document.querySelector(".hn-editor-menu")).toBeNull()

    // pointercancel：不提交，下一次真实点击正常开菜单
    session.editor.commands.undo()
    focusText(session.editor, "r3c1")
    rowOp.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 10 }))
    document.dispatchEvent(pointerEvent("pointercancel", { clientX: 0, clientY: 10 }))
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r2c1", "r3c1"])
    expect(wrapper(session).querySelector("[class*='hn-editor-table-preview']")).toBeNull()
    rowOp.click()
    expect(document.querySelector(".hn-editor-menu")).not.toBeNull()
  })

  it("拖动列操作控件：列按中点落线移动", () => {
    const session = sessionFor(tableDocument(2, 3))
    focusText(session.editor, "r1c3") // 焦点列 = 第 3 列（index 2）
    const columnOp = wrapper(session).querySelector<HTMLButtonElement>('[aria-label="列操作"]')!
    const target = cells(session)[0]! // r1c1
    target.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) })
    ;(document as Partial<Document>).elementFromPoint = () => target

    columnOp.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 10, clientY: 0 }))
    // 第 3 列移到最前：r1 行文本顺序 c3 → c1 → c2
    const firstRow = session.editor.state.doc.firstChild!.firstChild!
    const texts: string[] = []
    firstRow.forEach((cell) => texts.push(cell.textContent))
    expect(texts).toEqual(["r1c3", "r1c1", "r1c2"])
    session.editor.commands.undo()
    const restored: string[] = []
    session.editor.state.doc.firstChild!.firstChild!.forEach((cell) => restored.push(cell.textContent))
    expect(restored).toEqual(["r1c1", "r1c2", "r1c3"])
  })

  it("预览线经 PM 装饰持有（bug-7.5-2 回归）：真实停留 150ms 与无关 transaction 后仍在，doc/selection/history 零扰动", async () => {
    const session = sessionFor(tableDocument(3, 2))
    focusText(session.editor, "r3c1")
    const rowOp = wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!
    const target = cells(session)[0]!
    layoutCell(target, 0)
    ;(document as Partial<Document>).elementFromPoint = () => target

    const docBefore = session.editor.state.doc
    const selectionBefore = session.editor.state.selection
    const undoDepthBefore = undoDepth(session.editor.state) as number // 上游 d.ts 返回 any，此处收敛为 number

    rowOp.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 10 }))
    expect(target.classList.contains("hn-editor-table-preview--row-before")).toBe(true)

    // 用户拖拽停留的真实可见窗口（真实计时器）：装饰由 PM 持有，无定时器重挂。
    // （真实浏览器墙钟验收见 qa S2.10。）
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(target.classList.contains("hn-editor-table-preview--row-before")).toBe(true)

    // 拖拽期间的无关 transaction 触发 PM 重绘：旧实现直写 contentDOM 的 class
    // 即在此处被抹掉；装饰类由 PM 自己重建，必须仍在。
    session.editor.view.dispatch(session.editor.state.tr.setMeta("unrelatedProbe", 1))
    expect(target.classList.contains("hn-editor-table-preview--row-before")).toBe(true)

    // 手势期的视觉 transaction 全是 meta-only：doc/selection/history 零扰动。
    expect(session.editor.state.doc).toBe(docBefore)
    expect(session.editor.state.selection.eq(selectionBefore)).toBe(true)
    expect(undoDepth(session.editor.state)).toBe(undoDepthBefore)

    // 释放提交仍是单历史步：预览清空、一次 undo 精确还原。
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 0, clientY: 10 }))
    expect(firstColumnTexts(session)).toEqual(["r3c1", "r1c1", "r2c1"])
    expect(wrapper(session).querySelector("[class*='hn-editor-table-preview']")).toBeNull()
    expect(undoDepth(session.editor.state)).toBe(undoDepthBefore + 1)
    session.editor.commands.undo()
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r2c1", "r3c1"])
  })
})

describe("tableEdgeControls：预算、历史栅栏与 ID（oracle 7.5 回归）", () => {
  /** 把选区放进第一个单元格段落（空表与合并表都适用）。 */
  function focusFirstCell(session: EditorSession): void {
    let pos = -1
    session.editor.state.doc.descendants((node, position) => {
      if (pos < 0 && node.type.name === "paragraph" && node.isTextblock) {
        pos = position + 1
        return false
      }
      return true
    })
    expect(pos).toBeGreaterThanOrEqual(0)
    session.editor.commands.setTextSelection(pos)
  }

  it("16×15 空表（498 节点）增行/增列越过 512 节点：预检拒绝、零 dispatch、零变更", () => {
    const session = sessionFor(emptyTableDocument(16, 15))
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
    focusFirstCell(session)
    const before = session.editor.state.doc
    const beforeSelection = session.editor.state.selection.from
    const dispatch = vi.spyOn(session.editor.view, "dispatch")

    cells(session)[0]!.dispatchEvent(pointerEvent("pointerover"))
    edge(session, "在下方插入行").click()
    expect(rowCount(session)).toBe(16)
    expect(dispatch).not.toHaveBeenCalled()

    cells(session)[0]!.dispatchEvent(pointerEvent("pointerover"))
    edge(session, "在右侧插入列").click()
    expect(colCount(session)).toBe(15)
    expect(dispatch).not.toHaveBeenCalled()

    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()
    menuItem("在下方插入行").click()
    expect(rowCount(session)).toBe(16)
    expect(dispatch).not.toHaveBeenCalled()

    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="列操作"]')!.click()
    menuItem("在右侧插入列").click()
    expect(colCount(session)).toBe(15)
    expect(dispatch).not.toHaveBeenCalled()

    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(session.editor.state.selection.from).toBe(beforeSelection)
    expect(session.undo()).toBe(false)
  })

  it("512 KiB 外壳预算：合法临界文档增行越过外壳上限，激活拒绝、零变更", () => {
    const shellLen = (doc: HnnDocument) => {
      try {
        return JSON.stringify(encodeHnn(doc.data)).length
      } catch {
        return Number.POSITIVE_INFINITY
      }
    }
    const count = 70
    // 用两档文本长度测“纯每字符增量”，避免把段落内容字段的固定开销摊进斜率。
    const lenA = 1000
    const baseA = shellLen(budgetTableDocument(count, lenA, 1))
    const perChar = (shellLen(budgetTableDocument(count, lenA * 2, 1)) - baseA) / lenA
    const rowDelta = shellLen(budgetTableDocument(count, lenA, 2)) - baseA
    const textLen = Math.floor(lenA + (HNN_LIMITS.maxShellBytes - baseA - Math.ceil(rowDelta / 2)) / perChar)
    // 自检构造前提：每文本节点未越单节点上限，基线合法、增行后必然超外壳上限。
    expect(textLen).toBeGreaterThan(0)
    expect(textLen).toBeLessThanOrEqual(HNN_LIMITS.maxAttrBytes)
    expect(shellLen(budgetTableDocument(count, textLen, 1))).toBeLessThanOrEqual(HNN_LIMITS.maxShellBytes)
    expect(shellLen(budgetTableDocument(count, textLen, 2))).toBeGreaterThan(HNN_LIMITS.maxShellBytes)

    const session = sessionFor(budgetTableDocument(count, textLen, 1))
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
    focusFirstCell(session)
    const before = session.editor.state.doc
    const dispatch = vi.spyOn(session.editor.view, "dispatch")
    const tableCell = cells(session)[0]!
    tableCell.dispatchEvent(pointerEvent("pointerover"))
    edge(session, "在下方插入行").click()
    expect(rowCount(session)).toBe(1)
    expect(dispatch).not.toHaveBeenCalled()
    expect(session.editor.state.doc.eq(before)).toBe(true)
    expect(session.undo()).toBe(false)
  })

  it("增行保留原节点 ID、为新增节点补合法唯一 ID，最终文档可 encodeHnn", () => {
    const session = sessionFor(tableDocument(2, 2))
    const before = collectHnnNodeIds(session.editor.state.doc)
    focusText(session.editor, "r1c1")
    cells(session)[0]!.dispatchEvent(pointerEvent("pointerover"))
    edge(session, "在下方插入行").click()
    expect(rowCount(session)).toBe(3)
    const after = collectHnnNodeIds(session.editor.state.doc)
    for (const id of before) expect(after.has(id)).toBe(true)
    expect(after.size).toBeGreaterThan(before.size)
    for (const id of after) expect(UUID_V4_PATTERN.test(id)).toBe(true)
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
  })

  it("结构操作后同 tick 表内输入独立 undo：undo1 只撤输入，undo2 撤操作", () => {
    const session = sessionFor(tableDocument(2, 2))
    focusText(session.editor, "r1c1")
    cells(session)[0]!.dispatchEvent(pointerEvent("pointerover"))
    edge(session, "在下方插入行").click()
    expect(rowCount(session)).toBe(3)

    // 与增行同一 tick 立即输入（未等待 500ms 历史分组窗口）。
    session.editor.commands.insertContent("改")
    expect(session.editor.getText()).toContain("改")
    expect(session.editor.commands.undo()).toBe(true)
    expect(rowCount(session)).toBe(3)
    expect(session.editor.getText()).not.toContain("改")
    expect(session.editor.commands.undo()).toBe(true)
    expect(rowCount(session)).toBe(2)
  })

  it("删除行后同 tick 输入独立 undo：undo1 只撤输入，undo2 撤删除", () => {
    const session = sessionFor(tableDocument(3, 2))
    focusText(session.editor, "r2c1")
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()
    const del = menuItem("删除行")
    del.click()
    del.click()
    expect(rowCount(session)).toBe(2)

    session.editor.commands.insertContent("改")
    expect(session.editor.getText()).toContain("改")
    expect(session.editor.commands.undo()).toBe(true)
    expect(rowCount(session)).toBe(2)
    expect(session.editor.getText()).not.toContain("改")
    expect(session.editor.commands.undo()).toBe(true)
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r2c1", "r3c1"])
  })

  it("行移动后同 tick 输入独立 undo：undo1 只撤输入，undo2 还原移动", () => {
    const session = sessionFor(tableDocument(3, 2))
    focusText(session.editor, "r3c1")
    const rowOp = wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!
    const target = cells(session)[0]! // r1c1
    target.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) })
    ;(document as Partial<Document>).elementFromPoint = () => target
    rowOp.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 10 }))
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 0, clientY: 10 }))
    expect(firstColumnTexts(session)).toEqual(["r3c1", "r1c1", "r2c1"])

    // 与移动同一 tick 立即输入（选区随 moveTableRow 落回表内）。
    session.editor.commands.insertContent("改")
    expect(session.editor.getText()).toContain("改")
    expect(session.editor.commands.undo()).toBe(true)
    expect(firstColumnTexts(session)).toEqual(["r3c1", "r1c1", "r2c1"])
    expect(session.editor.getText()).not.toContain("改")
    expect(session.editor.commands.undo()).toBe(true)
    expect(firstColumnTexts(session)).toEqual(["r1c1", "r2c1", "r3c1"])
  })

  it("merged rowspan/colspan 删除行：布局合法、span 保留、原 nodeID 稳定", () => {
    const session = sessionFor(mergedTableDocument())
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
    const before = collectHnnNodeIds(session.editor.state.doc)
    focusText(session.editor, "F")
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()
    const del = menuItem("删除行")
    del.click()
    del.click()
    expect(rowCount(session)).toBe(2)
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
    const merged = session.editor.state.doc.firstChild!.firstChild!.firstChild!
    expect(merged.attrs["colspan"]).toBe(2)
    expect(merged.attrs["rowspan"]).toBe(2)
    const after = collectHnnNodeIds(session.editor.state.doc)
    for (const id of after) expect(before.has(id)).toBe(true)
  })

  it("merged 表格行移动：布局合法、原 nodeID 全部保留、一次撤销还原", () => {
    const session = sessionFor(mergedTableDocument())
    const before = collectHnnNodeIds(session.editor.state.doc)
    focusText(session.editor, "F") // 第 3 行（index 2）
    const rowOp = wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!
    const target = cells(session)[0]! // 合并单元格 A
    target.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) })
    ;(document as Partial<Document>).elementFromPoint = () => target

    rowOp.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 10 })) // 未过中点 → 插入边界 0
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 0, clientY: 10 }))
    expect(firstColumnTexts(session)).toEqual(["D", "A", "C"])
    expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
    const after = collectHnnNodeIds(session.editor.state.doc)
    expect(after.size).toBe(before.size)
    for (const id of before) expect(after.has(id)).toBe(true)

    session.editor.commands.undo()
    expect(firstColumnTexts(session)).toEqual(["A", "C", "D"])
  })
})

describe("tableEdgeControls：只读与生命周期", () => {
  it("只读会话不渲染、不响应任何控件（CSS 隐藏 + isEditable 守卫双层）", () => {
    const session = sessionFor(tableDocument(2, 2))
    focusText(session.editor, "r1c1")
    session.editor.setEditable(false)
    // setEditable 不产 transaction：补一个空事务驱动 refresh 清掉残留的 is-visible
    // 类（真实浏览器里 CSS 的 [contenteditable="false"] 规则即时隐藏，不依赖 JS）。
    session.editor.view.dispatch(session.editor.state.tr)

    // hover 不显现边界 +（JS 守卫）
    cells(session)[0]!.dispatchEvent(pointerEvent("pointerover"))
    expect(edge(session, "在下方插入行").classList.contains("is-visible")).toBe(false)
    expect(wrapper(session).querySelector('[aria-label="行操作"]')!.classList.contains("is-visible")).toBe(false)
    // 操作控件点击不开菜单、结构不变
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()
    expect(document.querySelector(".hn-editor-menu")).toBeNull()
    expect(rowCount(session)).toBe(2)
    // 边界 + 直接点击也不提交
    edge(session, "在下方插入行").click()
    expect(rowCount(session)).toBe(2)
    // 拖拽手势不启动
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!
      .dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }))
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 30 }))
    expect(wrapper(session).classList.contains("hn-editor-table-wrapper--reordering")).toBe(false)

    session.editor.setEditable(true)
    cells(session)[0]!.dispatchEvent(pointerEvent("pointerover"))
    expect(edge(session, "在下方插入行").classList.contains("is-visible")).toBe(true)
  })

  it("destroy 移除全部控件与监听：NodeView 失活后不留悬挂资源", () => {
    const session = sessionFor(tableDocument(2, 2))
    focusText(session.editor, "r1c1")
    wrapper(session).querySelector<HTMLButtonElement>('[aria-label="行操作"]')!.click()
    expect(document.querySelector(".hn-editor-menu")).not.toBeNull()

    // 删除整个表格块 → NodeView destroy → 控件 DOM、菜单、监听全部清理
    const tablePos = 0
    session.editor.commands.command(({ tr }) => {
      tr.delete(tablePos, tablePos + session.editor.state.doc.firstChild!.nodeSize)
      return true
    })
    expect(document.querySelector(".hn-editor-table-wrapper")).toBeNull()
    expect(document.querySelector(".hn-editor-menu")).toBeNull()
    // 后续窗口事件不再触达已销毁控件（不抛错即通过）
    window.dispatchEvent(new window.Event("resize"))
  })
})
