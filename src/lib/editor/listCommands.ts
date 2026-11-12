import type { Editor } from "@tiptap/core"
import { Fragment, type Node as PmNode, type ResolvedPos } from "@tiptap/pm/model"
import { liftListItem, sinkListItem, splitListItem } from "@tiptap/pm/schema-list"
import { EditorState, TextSelection, type Command, type Transaction } from "@tiptap/pm/state"
import { commitBudgetedTransaction, normalizeBudgetedCandidate } from "../hnn/budgetedTransaction"

export const LIST_TYPES = [
  { type: "bulletList", label: "无序列表" },
  { type: "orderedList", label: "有序列表" },
  { type: "taskList", label: "待办列表" }
] as const
export type ListType = typeof LIST_TYPES[number]["type"]
export const isList = (node: PmNode) => LIST_TYPES.some(({ type }) => type === node.type.name)
const isItem = (node: PmNode) => node.type.name === "listItem" || node.type.name === "taskItem"

export interface ListTarget {
  readonly node: PmNode
  readonly pos: number
  readonly first: number
  readonly end: number
  readonly paragraphs: boolean
}

export function canEditList(editor: Editor): boolean {
  return !editor.isDestroyed && editor.view.editable && !editor.view.composing
}

function itemContext($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (!isItem($pos.node(depth))) continue
    const node = $pos.node(depth - 1)
    if (!isList(node)) return null
    return { node, pos: $pos.before(depth - 1), index: $pos.index(depth - 1),
      itemPos: $pos.before(depth), depth }
  }
  return null
}

/** A block handle explicitly targets its container. Text selections never expand to it. */
export function resolveListTarget(editor: Editor, blockPos?: number): ListTarget | null {
  const { doc, selection } = editor.state
  if (blockPos !== undefined) {
    const node = doc.nodeAt(blockPos)
    if (!node) return null
    if (isList(node)) return { node, pos: blockPos, first: 0, end: node.childCount, paragraphs: false }
    if (node.type.name !== "paragraph") return null
    const $pos = doc.resolve(blockPos)
    return { node: $pos.parent, pos: $pos.depth ? $pos.before($pos.depth) : -1,
      first: $pos.index(), end: $pos.index() + 1, paragraphs: true }
  }
  if (!(selection instanceof TextSelection)) return null
  const { $from, $to, empty } = selection
  if ($from.parent.type.name !== "paragraph" || $to.parent.type.name !== "paragraph") return null
  const start = itemContext($from)
  let finish = itemContext($to)
  // Half-open selection ending at the first text position of the next item.
  if (!empty && finish && start?.pos === finish.pos && $to.pos === finish.itemPos + 2) {
    finish = itemContext(doc.resolve(Math.max(0, finish.itemPos - 1)))
  }
  if (start || finish) {
    if (!start || !finish || start.pos !== finish.pos || start.depth !== finish.depth) return null
    return { node: start.node, pos: start.pos, first: start.index, end: finish.index + 1, paragraphs: false }
  }
  if ($from.parent.type.name !== "paragraph" || $to.parent.type.name !== "paragraph" ||
      $from.depth !== $to.depth || $from.node($from.depth - 1) !== $to.node($to.depth - 1)) return null
  const depth = $from.depth - 1
  const parent = $from.node(depth)
  const first = $from.index(depth)
  const end = $to.index(depth) + (!empty && $to.parentOffset === 0 ? 0 : 1)
  if (end <= first) return null
  for (let i = first; i < end; i++) if (parent.child(i).type.name !== "paragraph") return null
  return { node: parent, pos: depth ? $from.before(depth) : -1, first, end, paragraphs: true }
}

function children(node: PmNode): PmNode[] {
  return Array.from({ length: node.childCount }, (_, i) => node.child(i))
}

/** Replacement steps map an entire container to a boundary. Restore surviving text by ID. */
function preserveTextSelection(editor: Editor, tr: Transaction): void {
  if (!(editor.state.selection instanceof TextSelection)) return
  const locate = ($pos: ResolvedPos): number | null => {
    const id: unknown = $pos.parent.attrs["nodeId"]
    if (!id || !$pos.parent.isTextblock) return null
    let result: number | null = null
    tr.doc.descendants((node, pos) => {
      if (node.attrs["nodeId"] === id) result = pos + 1 + Math.min($pos.parentOffset, node.content.size)
    })
    return result
  }
  const anchor = locate(editor.state.selection.$anchor)
  const head = locate(editor.state.selection.$head)
  if (anchor !== null && head !== null) tr.setSelection(TextSelection.create(tr.doc, anchor, head))
}

/** Build the full replacement without applying anything to the live state. No automatic joins. */
export function listConversionCandidate(editor: Editor, type: ListType | "paragraph", blockPos?: number): Transaction | null {
  if (!canEditList(editor)) return null
  const target = resolveListTarget(editor, blockPos)
  if (!target || !target.paragraphs && target.node.type.name === type || target.paragraphs && type === "paragraph") return null
  const selected = children(target.node).slice(target.first, target.end)
  const replacement: PmNode[] = []
  let from: number, to: number
  if (target.paragraphs) {
    from = target.pos + 1
    for (let i = 0; i < target.first; i++) from += target.node.child(i).nodeSize
    to = from + selected.reduce((sum, node) => sum + node.nodeSize, 0)
  } else {
    from = target.pos
    to = from + target.node.nodeSize
    let keptId = false
    const segment = (first: number, end: number) => {
      if (first === end) return
      replacement.push(target.node.type.create({ ...target.node.attrs,
        nodeId: keptId ? null : target.node.attrs["nodeId"] as unknown,
        ...(target.node.type.name === "orderedList" ? { start: Number(target.node.attrs["start"]) + first } : {})
      }, children(target.node).slice(first, end)))
      keptId = true
    }
    segment(0, target.first)
    if (type === "paragraph") {
      for (const item of selected) replacement.push(...children(item))
    } else {
      const itemType = editor.schema.nodes[type === "taskList" ? "taskItem" : "listItem"]!
      replacement.push(editor.schema.nodes[type]!.create({
        nodeId: keptId ? null : target.node.attrs["nodeId"] as unknown, ...(type === "orderedList" ? { start: 1, type: null } : {})
      }, selected.map(item => itemType.create({ nodeId: item.attrs["nodeId"] as unknown,
        ...(type === "taskList" ? { checked: false } : {}) }, item.content))))
      keptId = true
    }
    segment(target.end, target.node.childCount)
  }
  if (target.paragraphs && type !== "paragraph") {
    const itemType = editor.schema.nodes[type === "taskList" ? "taskItem" : "listItem"]!
    replacement.push(editor.schema.nodes[type]!.create(null, selected.map(node => itemType.create(null, node))))
  }
  try {
    const $from = editor.state.doc.resolve(from)
    const $to = editor.state.doc.resolve(to)
    const fragment = Fragment.fromArray(replacement)
    if (!$from.sameParent($to) || !$from.parent.canReplace($from.index(), $to.index(), fragment)) return null
    const tr = editor.state.tr.replaceWith(from, to, fragment)
    preserveTextSelection(editor, tr)
    return tr
  } catch { return null }
}

export function convertList(editor: Editor, type: ListType | "paragraph", blockPos?: number): boolean {
  const candidate = listConversionCandidate(editor, type, blockPos)
  return !!candidate && commitBudgetedTransaction(editor, candidate)
}

function captureCommand(editor: Editor, command: Command, state = editor.state): Transaction | null {
  let candidate: Transaction | null = null
  if (!command(state, tr => { candidate = tr })) return null
  return candidate
}

/** A task item cannot be lifted into a bullet container. Split that outer list,
 * promoting a separate container so task state and numbering remain meaningful. */
function liftMixedList(editor: Editor, target: ListTarget): Transaction | null {
  const $list = editor.state.doc.resolve(target.pos)
  const outerDepth = $list.depth - 1
  const outer = $list.node(outerDepth)
  const parent = $list.parent
  const parentIndex = $list.index(outerDepth)
  const listIndex = $list.index()
  const blocks = children(parent)
  const prefix = blocks.slice(0, listIndex)
  if (target.first > 0) prefix.push(target.node.copy(Fragment.fromArray(children(target.node).slice(0, target.first))))
  const before = outer.copy(Fragment.fromArray([...children(outer).slice(0, parentIndex), parent.copy(Fragment.fromArray(prefix))]))
  const items = children(target.node).slice(target.first, target.end)
  const tail = blocks.slice(listIndex + 1)
  if (target.end < target.node.childCount) tail.unshift(target.node.type.create({ ...target.node.attrs, nodeId: null,
    ...(target.node.type.name === "orderedList" ? { start: Number(target.node.attrs["start"]) + target.end } : {})
  }, children(target.node).slice(target.end)))
  if (tail.length) {
    const last = items[items.length - 1]!
    items[items.length - 1] = last.copy(last.content.append(Fragment.fromArray(tail)))
  }
  const promoted = target.node.type.create({ ...target.node.attrs,
    nodeId: target.first ? null : target.node.attrs["nodeId"] as unknown,
    ...(target.node.type.name === "orderedList" ? { start: Number(target.node.attrs["start"]) + target.first } : {})
  }, items)
  const replacement = [before, promoted]
  if (parentIndex + 1 < outer.childCount) replacement.push(outer.type.create({ ...outer.attrs, nodeId: null,
    ...(outer.type.name === "orderedList" ? { start: Number(outer.attrs["start"]) + parentIndex + 1 } : {})
  }, children(outer).slice(parentIndex + 1)))
  const from = $list.before(outerDepth), to = from + outer.nodeSize
  const $from = editor.state.doc.resolve(from), $to = editor.state.doc.resolve(to)
  if (!$from.parent.canReplace($from.index(), $to.index(), Fragment.fromArray(replacement))) return null
  const tr = editor.state.tr.replaceWith(from, to, replacement)
  preserveTextSelection(editor, tr)
  return tr
}

export function listIndentCandidate(editor: Editor, lift: boolean): Transaction | null {
  if (!canEditList(editor)) return null
  const target = resolveListTarget(editor)
  if (!target || target.paragraphs) return null
  if (!lift && target.first === 0) return null
  const $list = editor.state.doc.resolve(target.pos)
  if (lift && !isItem($list.parent)) return listConversionCandidate(editor, "paragraph")
  if (lift && isItem($list.parent) && $list.depth > 1 && isList($list.node($list.depth - 1)) &&
      $list.node($list.depth - 1).type !== target.node.type) return liftMixedList(editor, target)
  const type = target.node.firstChild!.type
  let from = target.pos + 1
  for (let i = 0; i < target.first; i++) from += target.node.child(i).nodeSize
  let to = from
  for (let i = target.first; i < target.end; i++) to += target.node.child(i).nodeSize
  const last = target.node.child(target.end - 1)
  const state = EditorState.create({ doc: editor.state.doc,
    selection: TextSelection.create(editor.state.doc, from + 2, to - last.nodeSize + 2 + last.firstChild!.content.size) })
  const tr = captureCommand(editor, (lift ? liftListItem : sinkListItem)(type), state)
  if (tr) preserveTextSelection(editor, tr)
  return tr
}

export function indentList(editor: Editor, lift: boolean): boolean {
  const candidate = listIndentCandidate(editor, lift)
  return !!candidate && commitBudgetedTransaction(editor, candidate)
}

export function enterList(editor: Editor): boolean {
  if (!canEditList(editor)) return false
  const target = resolveListTarget(editor)
  if (!target || target.paragraphs) return false
  const item = target.node.child(target.first)
  if (item.childCount === 1 && item.firstChild!.content.size === 0) return indentList(editor, true)
  const tr = captureCommand(editor, splitListItem(item.type, item.type.name === "taskItem" ? { checked: false } : undefined))
  // PM's itemAttrs parameter only applies at the end of a textblock. A split
  // in the middle otherwise inherits checked=true from the original item.
  if (tr && item.type.name === "taskItem") {
    const created = itemContext(tr.selection.$from)
    if (created) {
      const next = tr.doc.nodeAt(created.itemPos)!
      tr.setNodeMarkup(created.itemPos, undefined, { ...next.attrs, checked: false })
    }
  }
  return !!tr && commitBudgetedTransaction(editor, tr)
}

export function toggleTask(editor: Editor, pos: number): boolean {
  if (!canEditList(editor)) return false
  const node = editor.state.doc.nodeAt(pos)
  if (node?.type.name !== "taskItem") return false
  return commitBudgetedTransaction(editor, editor.state.tr.setNodeMarkup(pos, undefined,
    { ...node.attrs, checked: !node.attrs["checked"] }))
}

export function listConversionItems(editor: Editor, blockPosition?: () => number | undefined) {
  return [...LIST_TYPES, { type: "paragraph", label: "正文" } as const].map(({ type, label }) => ({
    label: `转换为${label}`,
    disabled: !!blockPosition && blockPosition() === undefined || !(() => {
      const tr = listConversionCandidate(editor, type, blockPosition?.())
      return tr && normalizeBudgetedCandidate(editor.schema, tr)
    })(),
    disabledReason: "当前类型、选区、权限或文档容量不支持此转换",
    onActivate: () => { if (!blockPosition || blockPosition() !== undefined) convertList(editor, type, blockPosition?.()) }
  }))
}
