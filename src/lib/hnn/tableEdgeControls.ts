/**
 * 表格边缘控件（DESIGN.md §10，OpenSpec migrate-to-tiptap-prosemirror 任务 7.5）。
 *
 * 由表格 NodeView（extensions.ts）每个实例挂载一份，负责：
 * - 单元格边界圆形 + 控件：hover（键盘用户退化为选区聚焦单元格）显现；
 *   上/下 + 在该逻辑边界插入行，左/右 + 插入列。首行上边界只属于列操作、
 *   首列左边界只属于行操作（不渲染 +）；内部边界两侧相邻单元格都可触发。
 * - 焦点行操作控件（⋮，居中于该行首单元格左边界）与焦点列操作控件（⋯，居中于
 *   表头单元格上边界）：选区落在本表期间常驻；点击打开菜单（含 in-menu 两步
 *   删除：删除行 → 确认删除行，菜单关闭即取消确认），拖动则进入行列重排。
 * - 行列拖动：穿越目标单元格中点推进插入边界，沿边界渲染 --hn-theme 实线预览
 *   （PM 持有的单元格 node decorations，整个手势持续可见，不被 PM 重绘抹掉），
 *   释放精确落线；pointercancel/卸载只清理不提交。
 * - 所有结构判断以 TableMap 逻辑网格为准（colspan/rowspan 感知，绝不用 childCount）；
 *   所有变更只透传 TableKit/prosemirror-tables 命令，每个完整手势恰好一个 PM
 *   transaction（closeHistory 与相邻输入切分 undo step）；只读模式不渲染、不响应。
 */

import type { ChainedCommands, Editor } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state"
import { TableMap, moveTableColumn, moveTableRow, selectionCell } from "@tiptap/pm/tables"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

import { captureChainTransaction, commitBudgetedTransaction } from "./budgetedTransaction"
import { HNN_TABLE_LIMITS } from "./limits"
import { openAnchoredMenu, type AnchoredMenuEntry, type AnchoredMenuHandle, type AnchoredMenuItem } from "./menuPopover"

export type TableAxis = "row" | "column"
type Edge = "top" | "bottom" | "left" | "right"

/** 单元格在逻辑网格中的矩形（与 prosemirror-tables Rect 同构，本地定义避免深依赖）。 */
interface LogicalRect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

interface CellEntry {
  /** 单元格起点在 TableMap 槽位中的相对位置（相对 tablePos + 1）。 */
  readonly start: number
  readonly dom: HTMLElement
  readonly rect: LogicalRect
}

export interface TableDragTarget {
  /** 插入边界（第 insertionIndex 行/列之前）。 */
  readonly insertionIndex: number
  /** 移除源后的落点下标（moveTableRow/Column 的 to 参数）。 */
  readonly destinationIndex: number
}

/**
 * 中点规则（DESIGN.md §10）：指针越过目标单元格沿拖拽轴的中点，插入边界推进到
 * 目标之后，否则在目标之前；源位于边界之前时落点下标减一。与旧块实现的
 * getTableDragTarget 同算法，纯函数便于单测。
 */
export function computeTableDragTarget(args: {
  readonly sourceIndex: number
  readonly targetIndex: number
  readonly itemCount: number
  readonly pointerOffset: number
  readonly targetSize: number
}): TableDragTarget | null {
  const { sourceIndex, targetIndex, itemCount, pointerOffset, targetSize } = args
  const hasValidIndexes =
    Number.isInteger(sourceIndex) &&
    sourceIndex >= 0 &&
    sourceIndex < itemCount &&
    Number.isInteger(targetIndex) &&
    targetIndex >= 0 &&
    targetIndex < itemCount
  if (!hasValidIndexes || !Number.isFinite(pointerOffset) || !Number.isFinite(targetSize) || targetSize <= 0) {
    return null
  }
  const insertionIndex = pointerOffset >= targetSize / 2 ? targetIndex + 1 : targetIndex
  const destinationIndex = insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex
  return { insertionIndex, destinationIndex }
}

export interface TableEdgeControlsOptions {
  readonly editor: Editor
  /** 表格 NodeView 根（position: relative，控件绝对定位的参照系）。 */
  readonly wrapper: HTMLElement
  readonly table: HTMLTableElement
  readonly tbody: HTMLTableSectionElement
  readonly getPos: () => number | undefined
  /** 表格节点类型：位置漂移/节点替换时据此判定失活。 */
  readonly tableNodeType: { readonly name: string }
}

export interface TableEdgeControlsHandle {
  /** NodeView update 与 editor transaction 时重算焦点/位置/可用态。 */
  refresh(): void
  destroy(): void
}

const EDGE_CLASS = "hn-editor-table-edge"
const OP_CLASS = "hn-editor-table-op"
const VISIBLE_CLASS = "is-visible"
const DRAGGING_CLASS = "is-dragging"
const MENU_OPEN_CLASS = "is-menu-open"
const REORDERING_CLASS = "hn-editor-table-wrapper--reordering"
const PREVIEW_CLASSES = [
  "hn-editor-table-preview--row-before",
  "hn-editor-table-preview--row-after",
  "hn-editor-table-preview--col-before",
  "hn-editor-table-preview--col-after"
] as const

const EDGE_LABELS: Record<Edge, string> = {
  top: "在上方插入行",
  bottom: "在下方插入行",
  left: "在左侧插入列",
  right: "在右侧插入列"
}
/** 拖拽判定阈值：位移不超过 4px 的按下-抬起视为点击（打开菜单）。 */
const DRAG_THRESHOLD_PX = 4

/**
 * 拖拽预览的 PM 装饰描述：一组单元格 node decorations（绝对位置 + 尺寸 + 类名）。
 * null 表示清空。
 */
type TablePreviewSpec = readonly { pos: number; nodeSize: number; className: string }[]

/** 每编辑器一份的预览装饰插件 key（WeakMap：编辑器销毁即随 GC 回收）。 */
const previewPluginKeys = new WeakMap<Editor, PluginKey<TablePreviewSpec | null>>()

/**
 * 取（或惰性注册）本编辑器的行列拖拽预览装饰插件——bug-7.5-2 修复：
 * 预览类直写 contentDOM 会被 PM DOMObserver 的重绘抹掉（真实浏览器里渲染后
 * 同毫秒即被重建），必须由 PM 持有的 node decorations 渲染——类由 PM 自己写进
 * 单元格 DOM，任何重绘都从装饰重建，整个手势期间持续可见。
 * 惰性注册只发生在用户手势（pointer 事件）内：NodeView 构造处于 PM update
 * 周期，彼时 registerPlugin/updateState 非法。装饰更新走 meta-only
 * transaction（无 step），doc/selection/history 零扰动；docChanged 即清空
 * （保守取消，杜绝错位残留）——这也兜住了 destroy 的清理（PM update 周期内
 * 不能 dispatch，触发销毁的文档变更已在 apply 层把装饰清空）。
 */
const ensurePreviewPlugin = (editor: Editor): PluginKey<TablePreviewSpec | null> => {
  const existing = previewPluginKeys.get(editor)
  if (existing) return existing
  const key = new PluginKey<TablePreviewSpec | null>("hnnTableDragPreview")
  editor.registerPlugin(
    new Plugin({
      key,
      state: {
        init: (): TablePreviewSpec | null => null,
        apply: (tr, old): TablePreviewSpec | null => {
          const meta: unknown = tr.getMeta(key)
          if (meta !== undefined) return meta as TablePreviewSpec | null
          // 文档一旦变更（含拖拽提交、外部改动），预览位置语义即失效：保守清空。
          if (tr.docChanged) return null
          return old
        }
      },
      props: {
        decorations: (state) => {
          const spec = key.getState(state)
          if (!spec || spec.length === 0) return null
          const decorations: Decoration[] = []
          for (const cell of spec) {
            // meta-only transaction 不改文档，位置必然有效；越界直接跳过（防御）。
            if (cell.pos < 0 || cell.pos + cell.nodeSize > state.doc.content.size) continue
            decorations.push(Decoration.node(cell.pos, cell.pos + cell.nodeSize, { class: cell.className }))
          }
          return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null
        }
      }
    })
  )
  previewPluginKeys.set(editor, key)
  return key
}

export function installTableEdgeControls(options: TableEdgeControlsOptions): TableEdgeControlsHandle {
  const { editor, wrapper, table, tbody, getPos, tableNodeType } = options

  /** 当前表格节点 + TableMap；NodeView 失活或位置漂移时返回 null。 */
  const currentTable = (): { tablePos: number; map: TableMap; nodeSize: number } | null => {
    if (typeof getPos !== "function") return null
    const tablePos = getPos()
    if (typeof tablePos !== "number") return null
    const tableNode = editor.state.doc.nodeAt(tablePos)
    if (!tableNode || tableNode.type.name !== tableNodeType.name) return null
    return { tablePos, map: TableMap.get(tableNode), nodeSize: tableNode.nodeSize }
  }

  /**
   * 单元格清单：map 槽位去重升序 === 文档顺序 === tbody 内 td/th 的 DOM 顺序，
   * 一一对应 zip；渲染瞬态（事务未同步 DOM）数量不符时返回空，下轮 transaction 重算。
   */
  const collectCells = (): CellEntry[] => {
    const current = currentTable()
    if (!current) return []
    const { map } = current
    const starts = [...new Set(map.map)].sort((a, b) => a - b)
    const doms = tbody.querySelectorAll("td, th")
    if (doms.length !== starts.length) return []
    return starts.map((start, i) => ({ start, dom: doms[i] as HTMLElement, rect: map.findCell(start) }))
  }

  /** 选区落在本表单元格内时返回该单元格；不在本表返回 null（绝不暗中改选）。 */
  const focusedCell = (): { start: number; rect: LogicalRect } | null => {
    const current = currentTable()
    if (!current) return null
    const { tablePos, nodeSize, map } = current
    const { $anchor } = editor.state.selection
    if ($anchor.pos <= tablePos || $anchor.pos >= tablePos + nodeSize) return null
    try {
      const cell = selectionCell(editor.state)
      if (cell.pos <= tablePos || cell.pos >= tablePos + nodeSize) return null
      const start = cell.pos - tablePos - 1
      return { start, rect: map.findCell(start) }
    } catch {
      return null
    }
  }

  // ===== 控件 DOM：4 个边界 + 按钮 + 行/列操作按钮，一次性创建、按布局复用 =====

  const createButton = (className: string, label: string, glyph: string): HTMLButtonElement => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = className
    button.setAttribute("aria-label", label)
    button.textContent = glyph
    // mousedown 不夺走编辑器焦点/选区；键盘 Tab 聚焦与 click 激活不受影响。
    button.addEventListener("mousedown", (event) => event.preventDefault())
    return button
  }

  const edges: Record<Edge, HTMLButtonElement> = {
    top: createButton(`${EDGE_CLASS} ${EDGE_CLASS}--top`, EDGE_LABELS.top, "+"),
    bottom: createButton(`${EDGE_CLASS} ${EDGE_CLASS}--bottom`, EDGE_LABELS.bottom, "+"),
    left: createButton(`${EDGE_CLASS} ${EDGE_CLASS}--left`, EDGE_LABELS.left, "+"),
    right: createButton(`${EDGE_CLASS} ${EDGE_CLASS}--right`, EDGE_LABELS.right, "+")
  }
  const rowOp = createButton(`${OP_CLASS} ${OP_CLASS}--row`, "行操作", "⋮")
  const columnOp = createButton(`${OP_CLASS} ${OP_CLASS}--column`, "列操作", "⋯")
  wrapper.append(edges.top, edges.bottom, edges.left, edges.right, rowOp, columnOp)

  // ===== 结构变更：每个手势恰好一个事务（预算预检 + closeHistory 切分 undo） =====

  /** 把选区移入指定槽位单元格（span 感知），供 TableKit 选区语义命令使用。 */
  const withCellSelection = (chain: ChainedCommands, start: number): ChainedCommands =>
    chain.command(({ state, tr }) => {
      const current = currentTable()
      if (!current) return false
      tr.setSelection(TextSelection.near(state.doc.resolve(current.tablePos + 1 + start + 1), 1))
      return true
    })

  /**
   * 结构命令统一入口：先用 captureChainTransaction 捕获候选事务（绝不 run() 写入
   * live editor），再交给 commitBudgetedTransaction 补齐新节点 nodeId、对最终候选
   * 整文档 encodeHnn 预检（节点总数/表格几何/512KiB 外壳）——只有通过才 closeHistory
   * 后 dispatch 并补历史栅栏。失败返回 false 且 doc/selection/history/dirty 零变化。
   */
  const commitStructure = (build: (chain: ChainedCommands) => ChainedCommands): boolean => {
    const candidate = captureChainTransaction(editor, build)
    return candidate ? commitBudgetedTransaction(editor, candidate) : false
  }

  /** 在逻辑行边界 boundary 插入行：优先命中顶边恰在边界的单元格（addRowBefore），
   *  整行被上方 rowspan 占满时退化为底边恰在边界的单元格（addRowAfter）。 */
  const insertRowAt = (boundary: number): boolean => {
    const current = currentTable()
    if (!current || !editor.isEditable) return false
    const { map } = current
    if (map.height >= HNN_TABLE_LIMITS.maxRows || (map.height + 1) * map.width > HNN_TABLE_LIMITS.maxGridCells) return false
    const cells = collectCells()
    const before = cells.find((cell) => cell.rect.top === boundary)
    const after = cells.find((cell) => cell.rect.bottom === boundary)
    const target = before ?? after
    if (!target) return false
    return commitStructure((chain) => {
      const selected = withCellSelection(chain, target.start)
      return before ? selected.addRowBefore() : selected.addRowAfter()
    })
  }

  /** 在逻辑列边界 boundary 插入列（与 insertRowAt 对称）。 */
  const insertColumnAt = (boundary: number): boolean => {
    const current = currentTable()
    if (!current || !editor.isEditable) return false
    const { map } = current
    if (map.width >= HNN_TABLE_LIMITS.maxColumns || map.height * (map.width + 1) > HNN_TABLE_LIMITS.maxGridCells) return false
    const cells = collectCells()
    const before = cells.find((cell) => cell.rect.left === boundary)
    const after = cells.find((cell) => cell.rect.right === boundary)
    const target = before ?? after
    if (!target) return false
    return commitStructure((chain) => {
      const selected = withCellSelection(chain, target.start)
      return before ? selected.addColumnBefore() : selected.addColumnAfter()
    })
  }

  /** 删除焦点行/列：选区先落回焦点单元格，同一预算化事务完成结构变更。 */
  const deleteFocused = (axis: TableAxis): boolean => {
    const current = currentTable()
    if (!current || !editor.isEditable) return false
    const { map } = current
    if (axis === "row" && map.height <= 1) return false
    if (axis === "column" && map.width <= 1) return false
    const focused = focusedCell()
    if (!focused) return false
    return commitStructure((chain) => {
      const selected = withCellSelection(chain, focused.start)
      return axis === "row" ? selected.deleteRow() : selected.deleteColumn()
    })
  }

  /** 行/列移动提交：捕获 moveTableRow/Column 自建事务（它们不能并进 TipTap chain 的
   *  共享 tr），先补齐新节点 ID 并预算预检，成功才 closeHistory + dispatch + 栅栏；
   *  失败零变更并回 false。 */
  const commitMove = (axis: TableAxis, from: number, to: number): boolean => {
    const current = currentTable()
    if (!current || !editor.isEditable) return false
    const itemCount = axis === "row" ? current.map.height : current.map.width
    if (from === to || from < 0 || from >= itemCount || to < 0 || to >= itemCount) return false
    // pos 必须指向表内（findTable 沿祖先链查找）：tablePos 本身是表节点起点，
    // 其祖先只有 doc，会导致解析失败、命令静默返回 false。
    const command = axis === "row"
      ? moveTableRow({ from, to, pos: current.tablePos + 1 })
      : moveTableColumn({ from, to, pos: current.tablePos + 1 })
    let captured: Transaction | null = null
    const applied = command(editor.state, (tr) => { captured = tr }, editor.view)
    if (!applied || !captured) return false
    return commitBudgetedTransaction(editor, captured)
  }

  // ===== 边界 + 控件：hover 单元格（键盘退化为焦点单元格）的四边布局 =====

  let hoveredStart: number | null = null
  /** 各边当前指向的插入边界；不可用的边为 undefined（按钮隐藏）。 */
  const edgeBoundaries: Partial<Record<Edge, number>> = {}

  const wrapperRect = (): DOMRect => wrapper.getBoundingClientRect()

  const placeButton = (button: HTMLButtonElement, x: number, y: number): void => {
    button.style.left = `${x}px`
    button.style.top = `${y}px`
    button.classList.add(VISIBLE_CLASS)
  }

  const layoutEdgeButtons = (): void => {
    for (const edge of Object.keys(edges) as Edge[]) {
      edges[edge].classList.remove(VISIBLE_CLASS)
      delete edgeBoundaries[edge]
    }
    if (!editor.isEditable) return
    const activeStart = hoveredStart ?? focusedCell()?.start ?? null
    if (activeStart === null) return
    const current = currentTable()
    if (!current) return
    const entry = collectCells().find((cell) => cell.start === activeStart)
    if (!entry) return
    const { map } = current
    const rect = wrapperRect()
    const cellRect = entry.dom.getBoundingClientRect()
    const cx = cellRect.left - rect.left + cellRect.width / 2
    const cy = cellRect.top - rect.top + cellRect.height / 2
    const canAddRow = map.height < HNN_TABLE_LIMITS.maxRows && (map.height + 1) * map.width <= HNN_TABLE_LIMITS.maxGridCells
    const canAddColumn = map.width < HNN_TABLE_LIMITS.maxColumns && map.height * (map.width + 1) <= HNN_TABLE_LIMITS.maxGridCells

    // 首行上边界只属于列操作、首列左边界只属于行操作：不渲染该侧 +。
    if (canAddRow && entry.rect.top > 0) {
      edgeBoundaries.top = entry.rect.top
      placeButton(edges.top, cx, cellRect.top - rect.top)
    }
    if (canAddRow) {
      edgeBoundaries.bottom = entry.rect.bottom
      placeButton(edges.bottom, cx, cellRect.bottom - rect.top)
    }
    if (canAddColumn && entry.rect.left > 0) {
      edgeBoundaries.left = entry.rect.left
      placeButton(edges.left, cellRect.left - rect.left, cy)
    }
    if (canAddColumn) {
      edgeBoundaries.right = entry.rect.right
      placeButton(edges.right, cellRect.right - rect.left, cy)
    }
  }

  for (const edge of Object.keys(edges) as Edge[]) {
    edges[edge].addEventListener("click", () => {
      const boundary = edgeBoundaries[edge]
      if (boundary === undefined || !editor.isEditable) return
      if (edge === "top" || edge === "bottom") insertRowAt(boundary)
      else insertColumnAt(boundary)
    })
  }

  const onTbodyPointerOver = (event: Event): void => {
    // 只读不跟踪 hover：避免 hoveredStart 在只读期间落位，恢复可编辑后同格 hover
    // 被去重拦截导致控件不显现。
    if (!editor.isEditable) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const cell = target.closest("td, th")
    if (!cell || cell.closest("table") !== table) return
    const entry = collectCells().find((item) => item.dom === cell)
    if (!entry || entry.start === hoveredStart) return
    hoveredStart = entry.start
    layoutEdgeButtons()
  }
  // 指针离开整个 wrapper（含控件）才清除 hover：移到边界按钮上不移除。
  const onWrapperPointerLeave = (): void => {
    hoveredStart = null
    layoutEdgeButtons()
  }
  tbody.addEventListener("pointerover", onTbodyPointerOver)
  wrapper.addEventListener("pointerleave", onWrapperPointerLeave)

  // ===== 行列操作菜单（in-menu 两步删除；菜单关闭即取消确认） =====

  let opMenu: AnchoredMenuHandle | null = null
  let opMenuAnchor: HTMLButtonElement | null = null
  /** 菜单打开时的焦点单元格槽位：选区漂移到别的单元格即关闭菜单（确认目标绝不漂移）。 */
  let opMenuFocusedStart: number | null = null

  const closeOpMenu = (): void => {
    opMenu?.close(false)
  }

  const openOpMenu = (axis: TableAxis, anchor: HTMLButtonElement): void => {
    if (opMenu && opMenuAnchor === anchor) {
      closeOpMenu()
      return
    }
    closeOpMenu()
    const focused = focusedCell()
    if (!editor.isEditable || !focused) return
    const current = currentTable()
    if (!current) return
    const { map } = current
    const isRow = axis === "row"
    const unit = isRow ? "行" : "列"
    // 达到行/列数或单元格总量上限时插入项禁用并注明原因（与边界 + 的隐藏同一判定，
    // 菜单路径给出解释而不是静默消失）；激活瞬间 insertRowAt/insertColumnAt 仍实时复查。
    const canInsert = isRow
      ? map.height < HNN_TABLE_LIMITS.maxRows && (map.height + 1) * map.width <= HNN_TABLE_LIMITS.maxGridCells
      : map.width < HNN_TABLE_LIMITS.maxColumns && map.height * (map.width + 1) <= HNN_TABLE_LIMITS.maxGridCells
    const insertGuard = canInsert ? {} : { disabled: true, disabledReason: `已达表格${unit}数或单元格总量上限` }
    // 菜单条目在激活瞬间重新解析焦点单元格：菜单打开期间的文档变化不会落到错位目标。
    const insertItems: AnchoredMenuEntry[] = isRow
      ? [
          { label: "在上方插入行", ...insertGuard, onActivate: () => { const f = focusedCell(); if (f) insertRowAt(f.rect.top) } },
          { label: "在下方插入行", ...insertGuard, onActivate: () => { const f = focusedCell(); if (f) insertRowAt(f.rect.bottom) } }
        ]
      : [
          { label: "在左侧插入列", ...insertGuard, onActivate: () => { const f = focusedCell(); if (f) insertColumnAt(f.rect.left) } },
          { label: "在右侧插入列", ...insertGuard, onActivate: () => { const f = focusedCell(); if (f) insertColumnAt(f.rect.right) } }
        ]
    const deleteItem: AnchoredMenuItem = {
      label: `删除${unit}`,
      confirmLabel: `确认删除${unit}`,
      danger: true,
      disabled: isRow ? map.height <= 1 : map.width <= 1,
      disabledReason: `表格至少保留一${unit}`,
      onActivate: () => deleteFocused(axis)
    }
    anchor.classList.add(MENU_OPEN_CLASS)
    opMenuAnchor = anchor
    opMenuFocusedStart = focused.start
    opMenu = openAnchoredMenu({
      anchor,
      items: [...insertItems, "divider", deleteItem],
      ariaLabel: `${unit}操作菜单`,
      onClose: () => {
        opMenu = null
        opMenuAnchor = null
        opMenuFocusedStart = null
        anchor.classList.remove(MENU_OPEN_CLASS)
      }
    })
  }

  // ===== 行列拖动：穿越目标中点推进边界，沿边界渲染实线预览，释放精确落线 =====

  interface DragState {
    readonly axis: TableAxis
    readonly pointerId: number
    readonly startX: number
    readonly startY: number
    readonly sourceIndex: number
    readonly button: HTMLButtonElement
    dragging: boolean
    target: TableDragTarget | null
  }
  let drag: DragState | null = null
  /** 拖拽激活后抑制紧随的 click：拖动结束不弹出菜单。 */
  let suppressOpClick = false

  /**
   * 预览装饰的派发签名（去重）：相同预览不重复发 transaction——pointermove
   * 高频触发下，只有真实边界变化才产生一次 meta-only transaction。
   */
  let lastPreviewSignature: string | null = null
  /** NodeView destroy 处于 PM update 周期，不能 dispatch；装饰清理由插件
   *  apply 的 docChanged 清空兜底（触发销毁的正是文档变更）。 */
  let destroyed = false

  /** 更新/清空拖拽预览：meta-only transaction 只换装饰，不碰 doc/selection/history。 */
  const dispatchPreview = (spec: TablePreviewSpec | null): void => {
    const signature =
      spec && spec.length > 0 ? spec.map((cell) => `${cell.pos}:${cell.nodeSize}:${cell.className}`).join("|") : null
    if (signature === lastPreviewSignature) return
    lastPreviewSignature = signature
    if (destroyed || editor.isDestroyed) return
    const key = ensurePreviewPlugin(editor)
    editor.view.dispatch(editor.state.tr.setMeta(key, spec && spec.length > 0 ? spec : null))
  }

  const clearPreview = (): void => dispatchPreview(null)

  const applyPreview = (axis: TableAxis, insertionIndex: number): void => {
    const current = currentTable()
    if (!current) return
    const spec: { pos: number; nodeSize: number; className: string }[] = []
    for (const cell of collectCells()) {
      const className =
        axis === "row"
          ? cell.rect.top === insertionIndex
            ? PREVIEW_CLASSES[0]
            : cell.rect.bottom === insertionIndex
              ? PREVIEW_CLASSES[1]
              : null
          : cell.rect.left === insertionIndex
            ? PREVIEW_CLASSES[2]
            : cell.rect.right === insertionIndex
              ? PREVIEW_CLASSES[3]
              : null
      if (!className) continue
      // 单元格节点绝对位置 = 表位置 + 1 + 表内偏移（focusedCell 的逆运算）。
      const pos = current.tablePos + 1 + cell.start
      const node = editor.state.doc.nodeAt(pos)
      if (node) spec.push({ pos, nodeSize: node.nodeSize, className })
    }
    dispatchPreview(spec)
  }

  const cellFromPoint = (x: number, y: number): HTMLElement | null => {
    // jsdom 无 elementFromPoint：拖拽命中只在真实浏览器生效，测试可注入该函数。
    if (typeof document.elementFromPoint !== "function") return null
    const cell = document.elementFromPoint(x, y)?.closest("td, th")
    return cell instanceof HTMLElement && cell.closest("table") === table ? cell : null
  }

  const updateDragTarget = (event: PointerEvent): void => {
    const active = drag
    if (!active || !active.dragging) return
    const current = currentTable()
    if (!current) return
    const hit = cellFromPoint(event.clientX, event.clientY)
    if (!hit) {
      active.target = null
      clearPreview()
      return
    }
    const entry = collectCells().find((cell) => cell.dom === hit)
    if (!entry) {
      active.target = null
      clearPreview()
      return
    }
    const domRect = hit.getBoundingClientRect()
    const isRow = active.axis === "row"
    active.target = computeTableDragTarget({
      sourceIndex: active.sourceIndex,
      targetIndex: isRow ? entry.rect.top : entry.rect.left,
      itemCount: isRow ? current.map.height : current.map.width,
      pointerOffset: isRow ? event.clientY - domRect.top : event.clientX - domRect.left,
      targetSize: isRow ? domRect.height : domRect.width
    })
    if (active.target) applyPreview(active.axis, active.target.insertionIndex)
    else clearPreview()
  }

  const finishDrag = (commit: boolean): void => {
    const active = drag
    if (!active) return
    drag = null
    document.removeEventListener("pointermove", onDragPointerMove)
    document.removeEventListener("pointerup", onDragPointerUp)
    document.removeEventListener("pointercancel", onDragPointerCancel)
    active.button.classList.remove(DRAGGING_CLASS)
    wrapper.classList.remove(REORDERING_CLASS)
    clearPreview()
    // pointerup（commit 路径）后浏览器会补发 click：吃掉它避免误开菜单；
    // pointercancel 不产生 click，标志不置位，下一次真实点击不受影响。
    if (active.dragging && commit) suppressOpClick = true
    try {
      active.button.releasePointerCapture?.(active.pointerId)
    } catch {
      // jsdom 与已结束 pointer 的释放失败无害。
    }
    if (commit && active.dragging && active.target) {
      commitMove(active.axis, active.sourceIndex, active.target.destinationIndex)
    }
  }

  function onDragPointerMove(event: Event): void {
    const active = drag
    if (!active) return
    const pointerEvent = event as PointerEvent
    if (pointerEvent.pointerId !== active.pointerId) return
    // 手势中途会话转只读（setEditable 不产 transaction，onTransaction 兜底不到）：
    // 立即取消手势，绝不继续预览/提交（PR#11-#16 readonly 安全）。
    if (!editor.isEditable) {
      finishDrag(false)
      return
    }
    if (!active.dragging) {
      const distance = Math.hypot(pointerEvent.clientX - active.startX, pointerEvent.clientY - active.startY)
      if (distance <= DRAG_THRESHOLD_PX) return
      // 越过阈值才进入拖拽：此前都可回退为点击菜单。
      active.dragging = true
      active.button.classList.add(DRAGGING_CLASS)
      // 拖拽期间控件不吃指针命中：elementFromPoint 始终落在单元格上。
      wrapper.classList.add(REORDERING_CLASS)
      closeOpMenu()
    }
    updateDragTarget(pointerEvent)
  }

  function onDragPointerUp(event: Event): void {
    const active = drag
    if (!active || (event as PointerEvent).pointerId !== active.pointerId) return
    // 释放点坐标才是最终落点意图（PR#11-#17）：pointermove 可能被浏览器合并/
    // 节流，最后一次 move 的位置不代表释放位置；先按 pointerup 坐标重算目标。
    // 释放在表外时命中为 null → target 清空 → finishDrag 无目标不提交，等效取消。
    if (active.dragging) updateDragTarget(event as PointerEvent)
    finishDrag(true)
  }

  function onDragPointerCancel(event: Event): void {
    const active = drag
    if (!active || (event as PointerEvent).pointerId !== active.pointerId) return
    // 指针取消只清理瞬态，绝不提交（与块重排同策）。
    finishDrag(false)
  }

  const onOpPointerDown = (axis: TableAxis, button: HTMLButtonElement) => (event: Event): void => {
    const pointerEvent = event as PointerEvent
    if (!editor.isEditable || drag) return
    if (pointerEvent.pointerType === "mouse" && pointerEvent.button !== 0) return
    const focused = focusedCell()
    if (!focused) return
    const current = currentTable()
    if (!current) return
    drag = {
      axis,
      pointerId: pointerEvent.pointerId,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      sourceIndex: axis === "row" ? focused.rect.top : focused.rect.left,
      button,
      dragging: false,
      target: null
    }
    try {
      button.setPointerCapture?.(pointerEvent.pointerId)
    } catch {
      // jsdom 无 pointer capture；不致命。
    }
    document.addEventListener("pointermove", onDragPointerMove)
    document.addEventListener("pointerup", onDragPointerUp)
    document.addEventListener("pointercancel", onDragPointerCancel)
  }

  rowOp.addEventListener("pointerdown", onOpPointerDown("row", rowOp))
  columnOp.addEventListener("pointerdown", onOpPointerDown("column", columnOp))
  rowOp.addEventListener("click", () => {
    if (suppressOpClick) { suppressOpClick = false; return }
    openOpMenu("row", rowOp)
  })
  columnOp.addEventListener("click", () => {
    if (suppressOpClick) { suppressOpClick = false; return }
    openOpMenu("column", columnOp)
  })

  /** 焦点行/列操作控件布局：选区在本表期间常驻，只读不渲染。 */
  const layoutOpButtons = (): void => {
    rowOp.classList.remove(VISIBLE_CLASS)
    columnOp.classList.remove(VISIBLE_CLASS)
    if (!editor.isEditable) return
    const focused = focusedCell()
    if (!focused) return
    const cells = collectCells()
    // NodeView 创建瞬间子 DOM 尚未渲染（collectCells 为空）：放弃本轮，下轮 transaction 重算。
    if (cells.length === 0) return
    const rect = wrapperRect()
    // 行操作：居中于该行首个单元格（top 命中行、left 最小）的左边界。
    const rowCells = cells.filter((cell) => cell.rect.top === focused.rect.top)
    const firstInRow = rowCells.reduce<CellEntry | undefined>(
      (best, cell) => (best === undefined || cell.rect.left < best.rect.left ? cell : best),
      undefined
    )
    if (!firstInRow) return
    const rowRect = firstInRow.dom.getBoundingClientRect()
    placeButton(rowOp, rowRect.left - rect.left, rowRect.top - rect.top + rowRect.height / 2)
    // 列操作：居中于表头行（top===0）覆盖该列单元格的上边界。
    const headerCell = cells.find((cell) => cell.rect.top === 0 && cell.rect.left <= focused.rect.left && focused.rect.left < cell.rect.right)
    if (headerCell) {
      const headerRect = headerCell.dom.getBoundingClientRect()
      placeButton(columnOp, headerRect.left - rect.left + headerRect.width / 2, headerRect.top - rect.top)
    }
  }

  /** 全量刷新：NodeView update / editor transaction / resize 的统一入口。
   *  只读隐藏走 CSS（.hn-editor-content[contenteditable="false"] 属性选择器，
   *  setEditable 不产 transaction，JS 无法即时感知）；所有变更处理器另有
   *  editor.isEditable live 守卫兜底，只读下绝不提交。 */
  const refresh = (): void => {
    // 选区漂移到别的单元格（或离开本表）：菜单连同两步确认态一起关闭，
    // 确认目标绝不随选区漂移（对齐旧实现“transaction 取消确认”的保守语义）。
    if (opMenu && focusedCell()?.start !== opMenuFocusedStart) closeOpMenu()
    layoutOpButtons()
    layoutEdgeButtons()
  }
  refresh()

  /**
   * editor transaction 统一入口（PR#11-#16）：文档一旦变更（如手势中 undo 插入、
   * 外部协作改动），拖拽期捕获的 sourceIndex/目标下标语义即失效——保守取消手势
   * （finishDrag(false)，与预览插件 apply 的 docChanged 清空同一语义），杜绝释放
   * 时按旧下标误动他人行/列；meta-only（预览/探针）与纯选区事务不改下标语义，
   * 手势照常继续。
   */
  const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
    if (transaction.docChanged && drag) finishDrag(false)
    refresh()
  }
  const onWindowResize = (): void => refresh()
  editor.on("transaction", onTransaction)
  window.addEventListener("resize", onWindowResize)

  return {
    refresh,
    destroy() {
      // 标记先行：PM update 周期内 finishDrag/clearPreview 不得再 dispatch
      // （装饰由插件 apply 的 docChanged 清空兜底）。
      destroyed = true
      // 移除全部监听器与瞬态：NodeView 失活后不留任何悬挂资源。
      editor.off("transaction", onTransaction)
      window.removeEventListener("resize", onWindowResize)
      tbody.removeEventListener("pointerover", onTbodyPointerOver)
      wrapper.removeEventListener("pointerleave", onWrapperPointerLeave)
      finishDrag(false)
      closeOpMenu()
      clearPreview()
      for (const edge of Object.keys(edges) as Edge[]) edges[edge].remove()
      rowOp.remove()
      columnOp.remove()
    }
  }
}
