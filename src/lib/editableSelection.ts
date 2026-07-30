const endpointElement = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement

const editableRoot = (node: Node): HTMLElement | null => {
  const element = endpointElement(node)
  const nearest = element?.closest<HTMLElement>("[contenteditable]") ?? null
  return nearest?.getAttribute("contenteditable") === "true" ? nearest : null
}

export const findEditableBlockById = (
  container: ParentNode,
  blockId: string
): HTMLElement | null => {
  const candidates =
    container.querySelectorAll<HTMLElement>("[data-editable-block-id]")
  for (const candidate of candidates) {
    if (candidate.getAttribute("data-editable-block-id") === blockId) {
      return candidate
    }
  }
  return null
}

export const isRangeInSingleEditableRoot = (
  range: Range,
  container: HTMLElement
): boolean => {
  if (!container.contains(range.startContainer)) return false
  if (!container.contains(range.endContainer)) return false

  const startRoot = editableRoot(range.startContainer)
  const endRoot = editableRoot(range.endContainer)
  return startRoot !== null && startRoot === endRoot && container.contains(startRoot)
}

// 跨块选区守卫：起终点都落在 container 内，且各自位于某个 contenteditable=true 根
// （允许是不同根）。用于 SelectionPopover 的展示与跨块格式化分支判定。
export const isRangeInNoteEditableScope = (
  range: Range,
  container: HTMLElement
): boolean => {
  if (!container.contains(range.startContainer)) return false
  if (!container.contains(range.endContainer)) return false
  const startRoot = editableRoot(range.startContainer)
  const endRoot = editableRoot(range.endContainer)
  return (
    startRoot !== null &&
    endRoot !== null &&
    container.contains(startRoot) &&
    container.contains(endRoot)
  )
}

// 起终点位于不同 contenteditable 根时返回 true，用于在跨块模式下禁用 createLink 等
// 依赖单一 selection 的操作。
export const isRangeCrossMultipleEditableRoots = (range: Range): boolean => {
  const startRoot = editableRoot(range.startContainer)
  const endRoot = editableRoot(range.endContainer)
  return startRoot !== null && endRoot !== null && startRoot !== endRoot
}

// 计算 outer range 与单个 editable root 的交集 sub-range；不相交返回 null。
//   - outer 起点落在 root 内 -> sub.start = outer.start
//   - outer 起点在 root 之前 -> sub.start = root, 0
//   - outer 起点在 root 之后 -> 无交集，返回 null
//   终点同理。
// 注意：root 包含 outer 起点用 `root.contains(outer.startContainer)`；外层 SelectionPopover
// 已经过 isRangeInNoteEditableScope 守卫，但跨块场景下 outer.start 可能不在当前 root 内，
// 此时 sub.start 取 root 的首位置（outer 起点在 root 之前）或跳过该 root（之后）。
const intersectRangeWithEditableRoot = (
  outer: Range,
  root: HTMLElement
): Range | null => {
  const startInRoot = root.contains(outer.startContainer)
  const endInRoot = root.contains(outer.endContainer)
  // 起点在 root 之后或终点在 root 之前都视为无交集。
  // 用 compareBoundaryPoints 比较更稳健，避开 contains 对属性节点的边界情况。
  // outer vs root 整体：root 作为节点取 [0, childNodes.length]
  // compareBoundaryPoints 语义：返回 this.boundary vs source.boundary 的 -1/0/1
  //   - END_TO_START: this.start vs source.end；> 0 表示 outer.start > root.end -> root 在 outer 之前
  //   - START_TO_END: this.end vs source.start；< 0 表示 outer.end < root.start -> root 在 outer 之后
  const rootRange = document.createRange()
  rootRange.selectNodeContents(root)
  if (
    outer.compareBoundaryPoints(Range.END_TO_START, rootRange) > 0 ||
    outer.compareBoundaryPoints(Range.START_TO_END, rootRange) < 0
  ) {
    return null
  }

  const sub = document.createRange()
  // sub.start = max(outer.start, root.start)：outer.start 在 root 之前 -> 用 root 起点；否则用 outer.start
  if (
    startInRoot ||
    outer.compareBoundaryPoints(Range.START_TO_START, rootRange) >= 0
  ) {
    sub.setStart(outer.startContainer, outer.startOffset)
  } else {
    sub.setStart(root, 0)
  }
  // sub.end = min(outer.end, root.end)：outer.end 在 root 之后 -> 用 root 终点；否则用 outer.end
  if (
    endInRoot ||
    outer.compareBoundaryPoints(Range.END_TO_END, rootRange) <= 0
  ) {
    sub.setEnd(outer.endContainer, outer.endOffset)
  } else {
    sub.setEnd(root, root.childNodes.length)
  }
  if (sub.collapsed) return null
  return sub
}

// 遍历 outer range 涵盖的每个 editable root，回调 (subRange, rootEl)。
// 调用顺序按 DOM 中 editable root 的出现顺序（querySelectorAll 的文档顺序），
// 便于跨块格式化时按从上到下顺序处理。
export const forEachEditableRootInRange = (
  range: Range,
  container: HTMLElement,
  cb: (subRange: Range, rootEl: HTMLElement) => void
): void => {
  const roots = container.querySelectorAll<HTMLElement>('[contenteditable="true"]')
  // 先收集所有 (sub, root) 对，再逐个执行 cb。
  // 避免 cb 内的 DOM 操作（如 unwrapElement）触发 jsdom 对 outer range 边界的
  // 自动更新，导致后续 root 的 sub 计算失效。
  const pairs: Array<{ sub: Range; root: HTMLElement }> = []
  for (const root of roots) {
    if (root.closest("[data-note-atomic-id]")) continue
    const sub = intersectRangeWithEditableRoot(range, root)
    if (sub === null) continue
    pairs.push({ sub, root })
  }
  for (const { sub, root } of pairs) {
    cb(sub, root)
  }
}
