import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { closeHistory } from "@tiptap/pm/history"
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"

/**
 * 顶层内容块重排（OpenSpec migrate-to-tiptap-prosemirror D10 / 任务 6.5）。
 *
 * - 仅 PM doc 顶层子块可重排：手柄只以 widget decoration 挂在顶层子块起点，
 *   嵌套列表项、表格内部节点结构上拿不到手柄，也不是合法重排目标。
 * - 桌面端：手柄原生 `draggable` + `data-drag-handle`，dragstart 即 stopPropagation
 *   （PM 的 view.dragging 保持 null，可据此区分内部拖拽），drop 在 document capture
 *   阶段 preventDefault + stopImmediatePropagation，PM 原生 drop 不会二次执行；
 *   另有插件 handleDOMEvents.drop/dragover 双保险：仅认领携带重排 MIME 的事件，
 *   外部图片/文件 drop 不携带此 MIME，原样交还 PM，未来图片 drop 不会双写。
 * - 移动端：手柄 Pointer Events 长按 500ms 启动；长按阈值前的位移（>10px）、
 *   提前抬起、pointercancel、卸载都会取消挂起手势且不产生任何事务，原生滚动保留。
 *   长按未激活的快速点按（click）不拖拽，改为打开块操作菜单（DESIGN.md §9）。
 * - 手柄同时是块操作菜单入口（D9/任务 7.5）：可聚焦按钮（role/tabindex/aria），
 *   点击、Enter/Space/ArrowDown 打开菜单，菜单内提供键盘可用的上移/下移（与拖拽
 *   共享同一提交入口）；菜单打开期间手柄保持 token 激活态，关闭后 aria-expanded
 *   复位；拖拽手势结束后的残余 click 被抑制，不会误开菜单。
 * - 两端复用同一个位置计算（computeInsertionBoundary，DESIGN.md §13 垂直中点规则）
 *   与同一个提交入口（reorderTopLevelBlock），文档变更恰好一个 PM transaction；
 *   closeHistory 使重排与前序输入分属不同 undo 事件，提交后再补一个无 step 的
 *   meta-only 历史栅栏 transaction，保证紧随其后的相邻输入也独立成组：
 *   一步撤销只还原这次重排（PM closeHistory 只重置 prevTime/prevRanges，
 *   不阻止后续 500ms 内相邻输入并入，见 prosemirror-history applyTransaction）。
 * - 手势捕获的 fromIndex 只在文档不变的窗口内有效：pending/active 期间任何
 *   docChanged 都保守取消手势（不提交错块），drop 以自身 clientY 刷新最终落点；
 *   只读视图（view.editable=false）手势与程序化提交都被拒绝，handle 由 CSS 隐藏。
 * - 拖拽预览（3px 主题线）与源块高亮以 PM 持有的 node decorations 渲染
 *   （bug-7.5-2 修复）：类由 PM 自己写进内容 DOM，DOMObserver 的重绘不再抹掉，
 *   整个手势期间持续可见；装饰只经 meta-only transaction 更新（无 step），
 *   doc/selection/history 零扰动，且随 docChanged 自动清空（保守取消）。手柄的
 *   --dragging 类仍直写 widget DOM——PM 对 widget 内部 mutation 一律 ignore，
 *   不触发重绘，类在整个手势期间存活。
 */

/** 桌面原生拖拽的自定义 MIME。绝不写 text/html，避免 PM 原生 drop 解析出 slice。 */
export const HNN_BLOCK_REORDER_MIME = "application/x-hnn-block-reorder"

/** 移动端长按启动拖拽的阈值（DESIGN.md §13 的 500ms）。 */
export const HNN_REORDER_HOLD_MS = 500

/** 长按激活前允许的指尖位移；超过即取消挂起拖拽，把滚动手势还给浏览器。 */
const HNN_REORDER_TOUCH_SLOP_PX = 10

const HANDLE_CLASS = "hn-editor-block-handle"
const HANDLE_GLYPH_CLASS = "hn-editor-block-handle-glyph"
const HANDLE_DRAGGING_CLASS = "hn-editor-block-handle--dragging"
const HANDLE_MENU_OPEN_CLASS = "hn-editor-block-handle--menu-open"
const BLOCK_DRAGGING_CLASS = "hn-editor-block-dragging"
const DROP_BEFORE_CLASS = "hn-editor-block-drop-before"
const DROP_AFTER_CLASS = "hn-editor-block-drop-after"

/**
 * 块操作菜单的注入入口（DESIGN.md §9，任务 7.5/D9）：手柄点击（无拖移位）或
 * 键盘 Enter/Space/ArrowDown 激活时调用，返回菜单关闭函数；返回 undefined 表示
 * 菜单未打开（如块已失效），手柄激活态立即复位。onClosed 由菜单在任何关闭路径
 * （Esc/外部点击/scroll/resize/执行完成）后恰好调用一次。菜单实现不得导给宿主。
 */
export interface BlockReorderOptions {
  readonly openMenu?: (
    anchor: HTMLElement,
    getPos: () => number | undefined,
    onClosed: () => void
  ) => ((restoreFocus?: boolean) => void) | void
}

/** 单个顶层块的垂直跨度（viewport 坐标），供插入边界的纯计算使用。 */
export type BlockReorderSpan = Readonly<{ top: number; bottom: number }>

/**
 * 垂直中点规则（DESIGN.md §13）：clientY 越过多少个块的中点，插入边界就落在第
 * 几个块之后。返回 0..spans.length 的边界下标。spans 必须按文档顺序（即垂直顺序）。
 */
export function computeInsertionBoundary(spans: readonly BlockReorderSpan[], clientY: number): number {
  let boundary = 0
  for (const span of spans) {
    if (clientY > (span.top + span.bottom) / 2) boundary += 1
    else break
  }
  return boundary
}

type TopLevelChild = Readonly<{ node: ProseMirrorNode; offset: number }>

function topLevelChildren(doc: ProseMirrorNode): TopLevelChild[] {
  const children: TopLevelChild[] = []
  doc.forEach((child, offset) => {
    children.push({ node: child, offset })
  })
  return children
}

/**
 * 提交一次顶层块重排：把第 fromIndex 个顶层块移动到 boundary 边界（0..块数，
 * 语义为“原顺序中第 boundary 个块之前”）。boundary === fromIndex 或 fromIndex + 1
 * 是原地放置，连同非法下标一起按 no-op 处理——不产生 transaction，不污染历史与
 * dirty 基准。合法移动的文档变更恰好一个 transaction（delete + insert 同一节点实例），
 * nodeId 随节点本身保留。历史隔离分两半：
 * - closeHistory(tr) 重置 prevTime/prevRanges，使重排与前序输入分属不同 undo 事件；
 * - 紧随其后补一个无 step 的 meta-only 栅栏 transaction 再次重置二者——PM 的分组规则
 *   会把 500ms 内与插入区间相邻的后续输入并入当前事件，栅栏令后续输入另起一组。
 *   栅栏不改变文档、不产生历史条目、不触发 update/dirty。
 * 最终：第一步撤销只还原这次重排，重排前后的编辑各有独立 undo step。
 */
export function reorderTopLevelBlock(view: EditorView, fromIndex: number, boundary: number): boolean {
  // 只读视图不接受程序化重排（手势入口另有 guard，这里兜住直接调用）。
  if (!view.editable) return false
  // NaN、小数、±Infinity 一律视为非法下标：不 throw、零事务。
  if (!Number.isInteger(fromIndex) || !Number.isInteger(boundary)) return false
  const children = topLevelChildren(view.state.doc)
  if (fromIndex < 0 || fromIndex >= children.length) return false
  if (boundary < 0 || boundary > children.length) return false
  if (boundary === fromIndex || boundary === fromIndex + 1) return false
  const { node, offset } = children[fromIndex]!
  // 删除后 fromIndex 之后的所有顶层块 offset 左移 nodeSize；插入位置换算到删除后坐标。
  const insertPos = boundary > fromIndex
    ? (boundary === children.length ? view.state.doc.content.size : children[boundary]!.offset) - node.nodeSize
    : children[boundary]!.offset
  const tr = view.state.tr.delete(offset, offset + node.nodeSize).insert(insertPos, node)
  // 移动后整块选中，标出落点；NodeSelection 也避免光标留在块内造成半编辑错觉。
  tr.setSelection(NodeSelection.create(tr.doc, insertPos))
  closeHistory(tr)
  view.dispatch(tr)
  // 无 step 的历史栅栏：applyTransaction 重置 prevTime/prevRanges 后直接返回，
  // 不产生文档变更与历史条目，但确保后续相邻输入不会并入本次重排的 undo 事件。
  view.dispatch(closeHistory(view.state.tr))
  return true
}

/** 一次进行中的重排手势（桌面原生拖拽或移动端指针拖拽）。 */
type ActiveGesture = {
  kind: "native" | "pointer"
  pointerId: number | null
  fromIndex: number
  handle: HTMLElement
  boundary: number | null
}

/** 移动端长按挂起态：尚未激活，任何位移/抬起/取消都直接撤销，不触碰文档。 */
type PendingHold = {
  pointerId: number
  startX: number
  startY: number
  fromIndex: number
  handle: HTMLElement
  timer: number
}

/** 桌面 drag 事件的最小结构（jsdom 没有 DragEvent，测试以结构性字段构造）。 */
type ReorderDragEvent = Event & {
  dataTransfer: {
    setData(type: string, value: string): void
    /** 现代浏览器的 DataTransfer.types 为 frozen string[]；用于识别重排拖拽。 */
    readonly types?: readonly string[]
    effectAllowed: string
    dropEffect: string
    setDragImage?: (element: Element, x: number, y: number) => void
  } | null
  clientX: number
  clientY: number
}

/** 指针事件的最小结构（jsdom 没有 PointerEvent）。 */
type ReorderPointerEvent = Event & {
  pointerId: number
  pointerType: string
  clientX: number
  clientY: number
}

type LiveSpan = { top: number; bottom: number; dom: HTMLElement | null }

/**
 * 在编辑会话上安装顶层块重排，返回卸载函数。手柄是 PM widget decoration（带
 * nodeId key，节点移动/编辑时 DOM 复用且 getPos 实时），随插件注销整体移除。
 */
export function installBlockReorder(editor: Editor, options: BlockReorderOptions = {}): () => void {
  const view = editor.view
  const pluginKey = new PluginKey<DecorationSet>("hnnBlockReorder")
  let gesture: ActiveGesture | null = null
  let pendingHold: PendingHold | null = null
  let uninstalled = false
  /** 拖拽结束后残余 click 的抑制标志：pointer drop 后浏览器补发的 click 不得开菜单。 */
  let suppressHandleClick = false
  /** 当前打开的块菜单（同一时间至多一个）与其锚点手柄。 */
  let menuClose: ((restoreFocus?: boolean) => void) | null = null
  let menuAnchor: HTMLElement | null = null

  const blockDomAt = (index: number): HTMLElement | null => {
    const child = topLevelChildren(view.state.doc)[index]
    if (!child) return null
    const dom = view.nodeDOM(child.offset)
    return dom instanceof HTMLElement ? dom : null
  }

  const resolveFromIndex = (getPos: () => number | undefined): number => {
    const pos = getPos()
    if (typeof pos !== "number") return -1
    return topLevelChildren(view.state.doc).findIndex((child) => child.offset === pos)
  }

  const closeHandleMenu = (restoreFocus = false): void => {
    const close = menuClose
    if (!close) return
    menuClose = null
    menuAnchor = null
    close(restoreFocus)
  }

  /**
   * 打开（或切换关闭）手柄的块操作菜单。只读、未注入 openMenu、块已失效时拒绝；
   * 再次激活同一手柄为切换关闭（焦点归还手柄），激活另一手柄则先关旧菜单。
   */
  const openHandleMenu = (handle: HTMLElement, getPos: () => number | undefined): void => {
    if (!view.editable || !options.openMenu) return
    if (menuClose) {
      const sameAnchor = menuAnchor === handle
      closeHandleMenu(sameAnchor)
      if (sameAnchor) return
    }
    if (resolveFromIndex(getPos) < 0) return
    handle.classList.add(HANDLE_MENU_OPEN_CLASS)
    handle.setAttribute("aria-expanded", "true")
    menuAnchor = handle
    const maybeClose = options.openMenu(handle, getPos, () => {
      // 菜单的任何关闭路径（Esc/外部点击/scroll/resize/执行完成）都经此复位。
      menuClose = null
      menuAnchor = null
      handle.classList.remove(HANDLE_MENU_OPEN_CLASS)
      handle.setAttribute("aria-expanded", "false")
    })
    if (typeof maybeClose !== "function") {
      // 菜单未打开（块已失效等）：立即复位激活态。
      menuAnchor = null
      handle.classList.remove(HANDLE_MENU_OPEN_CLASS)
      handle.setAttribute("aria-expanded", "false")
      return
    }
    menuClose = maybeClose
  }

  const collectLiveSpans = (): LiveSpan[] => {
    const spans: LiveSpan[] = []
    view.state.doc.forEach((_child, offset) => {
      const dom = view.nodeDOM(offset)
      const element = dom instanceof HTMLElement ? dom : null
      const rect = element?.getBoundingClientRect()
      spans.push({ top: rect?.top ?? 0, bottom: rect?.bottom ?? 0, dom: element })
    })
    return spans
  }

  // ---- 拖拽视觉（bug-7.5-2 修复）：源块高亮与 3px 落点线由 PM 持有的 node
  // decorations 渲染。直写内容 DOM 的 class 会被 PM DOMObserver 的重绘抹掉
  // （真实浏览器里激活后 ~7-28ms 即消失）；装饰类由 PM 自己写进 DOM，任何重绘
  // 都从装饰重建，整个手势期间持续可见。更新走 meta-only transaction（无 step），
  // doc/selection/history 零扰动；docChanged 时 apply 直接清空（保守取消）。
  const dragVisualKey = new PluginKey<DecorationSet>("hnnBlockReorderDrag")

  /** 当前已派发的拖拽视觉（去重）：相同状态不重复发 transaction。 */
  let lastDragVisual: { fromIndex: number; boundary: number | null } | null = null

  /** 把手势视觉（源高亮 + 落点指示线）构建为 PM node decorations。 */
  const buildDragDecorations = (visual: { fromIndex: number; boundary: number | null }): DecorationSet => {
    const doc = view.state.doc
    const children = topLevelChildren(doc)
    const decorations: Decoration[] = []
    const source = children[visual.fromIndex]
    if (source) {
      decorations.push(
        Decoration.node(source.offset, source.offset + source.node.nodeSize, { class: BLOCK_DRAGGING_CLASS })
      )
    }
    if (visual.boundary !== null) {
      // 末尾边界没有“后一个块”，用最后一块的 after 线表示；其余用第 boundary 块的 before 线。
      const isEnd = visual.boundary >= children.length
      const target = isEnd ? children[children.length - 1] : children[visual.boundary]
      if (target) {
        decorations.push(
          Decoration.node(target.offset, target.offset + target.node.nodeSize, {
            class: isEnd ? DROP_AFTER_CLASS : DROP_BEFORE_CLASS
          })
        )
      }
    }
    return DecorationSet.create(doc, decorations)
  }

  /** 派发一次拖拽视觉更新；相同状态去重，null 清空。 */
  const setDragVisual = (visual: { fromIndex: number; boundary: number | null } | null): void => {
    if (visual === null && lastDragVisual === null) return
    if (uninstalled || editor.isDestroyed) return
    if (
      visual !== null &&
      lastDragVisual !== null &&
      visual.fromIndex === lastDragVisual.fromIndex &&
      visual.boundary === lastDragVisual.boundary
    ) {
      return
    }
    lastDragVisual = visual
    const decorations = visual ? buildDragDecorations(visual) : DecorationSet.empty
    view.dispatch(view.state.tr.setMeta(dragVisualKey, decorations))
  }

  const updateBoundary = (target: ActiveGesture, clientY: number): void => {
    const spans = collectLiveSpans()
    if (spans.length === 0) return
    target.boundary = computeInsertionBoundary(spans, clientY)
    setDragVisual({ fromIndex: target.fromIndex, boundary: target.boundary })
  }

  // ---- 监听器集合：全部在手势期注册、收尾即移除，卸载时幂等兜底 ----

  const onNativeDragOver = (event: Event): void => {
    const active = gesture
    if (!active || active.kind !== "native") return
    if (!(event.target instanceof window.Node) || !view.dom.contains(event.target)) {
      // 拖出编辑区：只清预览（源高亮保留），不拦截宿主/浏览器自己的拖拽处理。
      active.boundary = null
      setDragVisual({ fromIndex: active.fromIndex, boundary: null })
      return
    }
    // 手势期内的 dragover 完全归重排：preventDefault 允许 drop，PM 不再参与。
    event.preventDefault()
    event.stopImmediatePropagation()
    const dragEvent = event as ReorderDragEvent
    if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "move"
    updateBoundary(active, dragEvent.clientY)
  }

  const onNativeDrop = (event: Event): void => {
    const active = gesture
    if (!active || active.kind !== "native") return
    if (!(event.target instanceof window.Node) || !view.dom.contains(event.target)) return
    // 阻止浏览器默认动作与 PM 原生 drop（同一 view.dom 上的监听器不再收到本次事件）。
    event.preventDefault()
    event.stopImmediatePropagation()
    // 浏览器不保证 drop 前还有一次同位置 dragover：drop 自带坐标才是最终落点，
    // 提交前必须用它刷新一次边界。
    const dragEvent = event as ReorderDragEvent
    if (typeof dragEvent.clientY === "number") updateBoundary(active, dragEvent.clientY)
    finishGesture(true)
  }

  const onSelectStart = (event: Event): void => {
    event.preventDefault()
  }

  const onTouchMove = (event: Event): void => {
    // 激活后阻止本次触摸手势的后续原生滚动（非 passive 才能生效）。
    event.preventDefault()
  }

  const addNativeListeners = (): void => {
    document.addEventListener("dragover", onNativeDragOver, true)
    document.addEventListener("drop", onNativeDrop, true)
  }

  const removeNativeListeners = (): void => {
    document.removeEventListener("dragover", onNativeDragOver, true)
    document.removeEventListener("drop", onNativeDrop, true)
  }

  const addActivePointerListeners = (): void => {
    document.addEventListener("pointermove", onActivePointerMove)
    document.addEventListener("pointerup", onActivePointerUp)
    document.addEventListener("pointercancel", onActivePointerCancel)
    document.addEventListener("selectstart", onSelectStart, true)
    document.addEventListener("touchmove", onTouchMove, { passive: false })
  }

  const removeActivePointerListeners = (): void => {
    document.removeEventListener("pointermove", onActivePointerMove)
    document.removeEventListener("pointerup", onActivePointerUp)
    document.removeEventListener("pointercancel", onActivePointerCancel)
    document.removeEventListener("selectstart", onSelectStart, true)
    document.removeEventListener("touchmove", onTouchMove)
  }

  function finishGesture(commit: boolean): void {
    const active = gesture
    if (!active) return
    gesture = null
    removeNativeListeners()
    removeActivePointerListeners()
    // 手柄 --dragging 直写 widget DOM：PM 对 widget 内部 mutation 一律 ignore，
    // 不触发重绘（内容 DOM 已不再有任何手写 class，重绘路径整体消失）。
    active.handle.classList.remove(HANDLE_DRAGGING_CLASS)
    // 先清视觉装饰（meta-only，不碰 doc/selection/history），再按需提交重排。
    setDragVisual(null)
    if (active.kind === "pointer" && active.pointerId !== null) {
      try {
        active.handle.releasePointerCapture?.(active.pointerId)
      } catch {
        // jsdom 与部分浏览器对未捕获/已结束 pointer 抛错；释放失败无害。
      }
      // pointer drop 后浏览器会补发一个 click：吃掉它避免误开菜单；
      // pointercancel 不产生 click，标志立即复位。
      suppressHandleClick = commit
    }
    if (commit && active.boundary !== null) {
      reorderTopLevelBlock(view, active.fromIndex, active.boundary)
    }
  }

  function cancelPendingHold(): void {
    const pending = pendingHold
    if (!pending) return
    pendingHold = null
    window.clearTimeout(pending.timer)
    document.removeEventListener("pointermove", onPendingPointerMove)
    document.removeEventListener("pointerup", onPendingPointerUp)
    document.removeEventListener("pointercancel", onPendingPointerCancel)
  }

  function onPendingPointerMove(event: Event): void {
    const pending = pendingHold
    if (!pending) return
    const pointerEvent = event as ReorderPointerEvent
    if (pointerEvent.pointerId !== pending.pointerId) return
    const dx = pointerEvent.clientX - pending.startX
    const dy = pointerEvent.clientY - pending.startY
    // 阈值前移动即取消：浏览器接管滚动，本次手势不产生任何拖拽。
    if (Math.hypot(dx, dy) > HNN_REORDER_TOUCH_SLOP_PX) cancelPendingHold()
  }

  function onPendingPointerUp(event: Event): void {
    const pending = pendingHold
    if (!pending) return
    if ((event as ReorderPointerEvent).pointerId !== pending.pointerId) return
    cancelPendingHold()
  }

  function onPendingPointerCancel(event: Event): void {
    const pending = pendingHold
    if (!pending) return
    if ((event as ReorderPointerEvent).pointerId !== pending.pointerId) return
    cancelPendingHold()
  }

  function onActivePointerMove(event: Event): void {
    const active = gesture
    if (!active || active.kind !== "pointer") return
    const pointerEvent = event as ReorderPointerEvent
    if (pointerEvent.pointerId !== active.pointerId) return
    updateBoundary(active, pointerEvent.clientY)
  }

  function onActivePointerUp(event: Event): void {
    const active = gesture
    if (!active || active.kind !== "pointer") return
    if ((event as ReorderPointerEvent).pointerId !== active.pointerId) return
    finishGesture(true)
  }

  function onActivePointerCancel(event: Event): void {
    const active = gesture
    if (!active || active.kind !== "pointer") return
    if ((event as ReorderPointerEvent).pointerId !== active.pointerId) return
    // 指针取消只清理瞬态，绝不提交（DESIGN.md §13）。
    finishGesture(false)
  }

  function activatePointerDrag(): void {
    const pending = pendingHold
    if (!pending) return
    pendingHold = null
    document.removeEventListener("pointermove", onPendingPointerMove)
    document.removeEventListener("pointerup", onPendingPointerUp)
    document.removeEventListener("pointercancel", onPendingPointerCancel)
    if (uninstalled) return
    gesture = {
      kind: "pointer",
      pointerId: pending.pointerId,
      fromIndex: pending.fromIndex,
      handle: pending.handle,
      boundary: pending.fromIndex
    }
    pending.handle.classList.add(HANDLE_DRAGGING_CLASS)
    setDragVisual({ fromIndex: pending.fromIndex, boundary: null })
    // 激活后清除原生文本选区，剩余手势期间禁止再生成（DESIGN.md §13）。
    window.getSelection()?.removeAllRanges()
    try {
      pending.handle.setPointerCapture?.(pending.pointerId)
    } catch {
      // jsdom 无 pointer capture；真实浏览器对失效 pointer 可能抛错，均不致命。
    }
    addActivePointerListeners()
  }

  const onHandleDragStart = (event: ReorderDragEvent, handle: HTMLElement, getPos: () => number | undefined): void => {
    if (!view.editable || gesture) {
      event.preventDefault()
      return
    }
    const fromIndex = resolveFromIndex(getPos)
    if (fromIndex < 0) {
      event.preventDefault()
      return
    }
    // 不让 PM 的 dragstart 接管：view.dragging 保持 null，drop 由我们独占。
    event.stopPropagation()
    const sourceDom = blockDomAt(fromIndex)
    const dataTransfer = event.dataTransfer
    if (dataTransfer) {
      dataTransfer.setData(HNN_BLOCK_REORDER_MIME, String(fromIndex))
      // text/plain 兜底为空串：PM 原生 drop 即使意外触发也解析不出 slice。
      dataTransfer.setData("text/plain", "")
      dataTransfer.effectAllowed = "move"
      if (sourceDom && typeof dataTransfer.setDragImage === "function") {
        const rect = sourceDom.getBoundingClientRect()
        try {
          dataTransfer.setDragImage(sourceDom, event.clientX - rect.left, event.clientY - rect.top)
        } catch {
          // setDragImage 失败不影响拖拽本身。
        }
      }
    }
    gesture = {
      kind: "native",
      pointerId: null,
      fromIndex,
      handle,
      boundary: fromIndex
    }
    handle.classList.add(HANDLE_DRAGGING_CLASS)
    setDragVisual({ fromIndex, boundary: null })
    addNativeListeners()
  }

  const onHandlePointerDown = (event: ReorderPointerEvent, handle: HTMLElement, getPos: () => number | undefined): void => {
    // 鼠标走原生 draggable；这里只接管触摸/笔。
    if (event.pointerType === "mouse") return
    if (!view.editable || gesture || pendingHold) return
    const fromIndex = resolveFromIndex(getPos)
    if (fromIndex < 0) return
    pendingHold = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fromIndex,
      handle,
      timer: window.setTimeout(activatePointerDrag, HNN_REORDER_HOLD_MS)
    }
    document.addEventListener("pointermove", onPendingPointerMove)
    document.addEventListener("pointerup", onPendingPointerUp)
    document.addEventListener("pointercancel", onPendingPointerCancel)
  }

  const createHandle = (_view: EditorView, getPos: () => number | undefined): HTMLElement => {
    const handle = document.createElement("span")
    handle.className = HANDLE_CLASS
    handle.setAttribute("data-drag-handle", "")
    handle.setAttribute("draggable", "true")
    // 显式落 contenteditable 属性：PM 只写 JS property，jsdom 不保证反射为属性。
    handle.setAttribute("contenteditable", "false")
    // 手柄同时是块操作菜单入口（DESIGN.md §9/D9）：可聚焦按钮，键盘可达；
    // 拖拽能力经原生 draggable（桌面）与长按（移动端）保留，不改重排手势。
    handle.setAttribute("role", "button")
    handle.setAttribute("tabindex", "0")
    handle.setAttribute("aria-label", "块操作菜单")
    handle.setAttribute("aria-haspopup", "menu")
    handle.setAttribute("aria-expanded", "false")
    const glyph = document.createElement("span")
    glyph.className = HANDLE_GLYPH_CLASS
    glyph.textContent = "⋮⋮"
    handle.appendChild(glyph)

    // 手柄按下不交给 PM（不移动 selection），但不 preventDefault，原生拖拽需要默认行为。
    handle.addEventListener("mousedown", (event) => event.stopPropagation())
    // 移动端长按弹出的上下文菜单会打断拖拽手势。
    handle.addEventListener("contextmenu", (event) => event.preventDefault())
    handle.addEventListener("dragstart", (event) => onHandleDragStart(event as ReorderDragEvent, handle, getPos))
    handle.addEventListener("dragend", () => finishGesture(false))
    handle.addEventListener("pointerdown", (event) => onHandlePointerDown(event as ReorderPointerEvent, handle, getPos))
    // 无拖位移的点击（桌面单击 / 移动端快速点按）打开块操作菜单；
    // 拖拽手势结束后的残余 click 已被 suppressHandleClick 抑制。
    handle.addEventListener("click", () => {
      if (suppressHandleClick) {
        suppressHandleClick = false
        return
      }
      openHandleMenu(handle, getPos)
    })
    // span 无原生按钮键盘行为：Enter/Space/ArrowDown 显式打开菜单（菜单内 roving
    // 焦点接管后续键盘操作，Esc 关闭后焦点归还手柄）。
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return
      event.preventDefault()
      event.stopPropagation()
      openHandleMenu(handle, getPos)
    })
    return handle
  }

  const buildDecorations = (doc: ProseMirrorNode): DecorationSet => {
    const widgets: Decoration[] = []
    doc.forEach((child, offset) => {
      // 只为顶层子块挂手柄（嵌套结构结构上无入口）；key 取持久 nodeId，
      // 块移动/编辑后 widget DOM 复用，getPos 由 PM 实时换算。
      const nodeId = typeof child.attrs["nodeId"] === "string" ? child.attrs["nodeId"] : `offset-${offset}`
      widgets.push(Decoration.widget(offset, createHandle, {
        side: -1,
        key: `hnn-reorder-${nodeId}`,
        ignoreSelection: true
      }))
    })
    return DecorationSet.create(doc, widgets)
  }

  /** 事件是否携带重排 MIME：激活手势结束后滞留的拖拽事件也可据此识别并吞掉。 */
  const carriesReorderMime = (event: Event): boolean => {
    const types = (event as ReorderDragEvent).dataTransfer?.types
    return types != null && types.includes(HNN_BLOCK_REORDER_MIME)
  }

  /** 该拖拽事件是否归重排手势所有：手势激活中，或携带重排 MIME。 */
  const ownsDragEvent = (event: Event): boolean => gesture != null || carriesReorderMime(event)

  const plugin = new Plugin({
    key: pluginKey,
    state: {
      init: (_config, instance) => buildDecorations(instance.doc),
      apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old)
    },
    props: {
      decorations: (state) => pluginKey.getState(state),
      handleDOMEvents: {
        // 双保险：PM 的 dispatchEvent 先跑插件 handleDOMEvents，返回 true（或事件已
        // preventDefault）即跳过内建 editHandlers。仅认领携带重排 MIME 的 drop/dragover
        // ——手势期的事件在 document capture 阶段已被 stopImmediatePropagation，走不到
        // 这里；这里兜住的是滞留/绕过 capture 的重排拖拽。外部图片、文件 drop 不携带
        // 此 MIME，原样交还 PM，未来图片 drop 与本重排互不双写。
        dragover: (_view, event) => {
          if (!ownsDragEvent(event)) return false
          event.preventDefault()
          return true
        },
        drop: (_view, event) => {
          if (!ownsDragEvent(event)) return false
          event.preventDefault()
          return true
        }
      }
    }
  })

  editor.registerPlugin(plugin)

  // 拖拽视觉装饰插件（bug-7.5-2）：预览线/源高亮由 PM 持有的 decorations 渲染，
  // PM 重绘（DOMObserver flush、无关 transaction）都从装饰重建类，不再被抹掉；
  // docChanged 即清空——手势同时被 onExternalDocChange 保守取消，不会留下错位残留。
  editor.registerPlugin(new Plugin({
    key: dragVisualKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, old) => {
        const meta: unknown = tr.getMeta(dragVisualKey)
        if (meta instanceof DecorationSet) return meta
        if (tr.docChanged) return DecorationSet.empty
        return old
      }
    },
    props: {
      decorations: (state) => dragVisualKey.getState(state)
    }
  }))

  // 手势捕获的 fromIndex 只在文档不变的窗口内有效：pending 500ms 或 active 期间
  // 文档一旦发生任何外部变更（前序插删、源块被删等），fromIndex 即可能指向错误
  // 的块。采取保守无副作用策略：docChanged 即取消全部 pending/active 手势，绝不
  // 提交错块。TipTap 的 update 事件只在 docChanged transaction 后触发；本模块自身
  // 的提交在 gesture 置空后才 dispatch，不会自取消。
  const onExternalDocChange = (): void => {
    cancelPendingHold()
    finishGesture(false)
  }
  editor.on("update", onExternalDocChange)

  return () => {
    uninstalled = true
    editor.off("update", onExternalDocChange)
    cancelPendingHold()
    finishGesture(false)
    closeHandleMenu(false)
    if (!editor.isDestroyed) {
      editor.unregisterPlugin(dragVisualKey)
      editor.unregisterPlugin(pluginKey)
    }
  }
}
