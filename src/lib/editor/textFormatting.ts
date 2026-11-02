import type { Editor } from "@tiptap/core"
import { toggleMark } from "@tiptap/pm/commands"
import { TextSelection } from "@tiptap/pm/state"
import { captureChainTransaction, commitBudgetedTransaction, normalizeBudgetedCandidate } from "../hnn/budgetedTransaction"

export const TEXT_FORMATS = [
  { name: "bold", label: "加粗" },
  { name: "italic", label: "斜体" },
  { name: "underline", label: "下划线" }
] as const

export function textFormatState(editor: Editor, name: string): { disabled: boolean; pressed: boolean } {
  const { state } = editor
  const type = state.schema.marks[name]
  if (editor.isDestroyed || !editor.view.editable || editor.view.composing ||
      !(state.selection instanceof TextSelection) || !type) return { disabled: true, pressed: false }
  const { from, to, $from, empty } = state.selection
  if (empty) return {
    disabled: !$from.parent.type.allowsMarkType(type) || (state.storedMarks ?? $from.marks()).some(mark => mark.type !== type && mark.type.excludes(type)),
    pressed: !!type.isInSet(state.storedMarks ?? $from.marks())
  }
  let found = false
  let all = true
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isText || pos >= to || pos + node.nodeSize <= from || !parent?.type.allowsMarkType(type) || node.marks.some(mark => mark.type !== type && mark.type.excludes(type))) return
    found = true
    if (!type.isInSet(node.marks)) all = false
  })
  return { disabled: !found, pressed: found && all }
}

export function toggleTextFormat(editor: Editor, name: string): boolean {
  const format = textFormatState(editor, name)
  if (format.disabled) return false
  const type = editor.schema.marks[name]!
  const candidate = captureChainTransaction(editor, chain => editor.state.selection.empty
    ? chain.command(({ state, dispatch }) => toggleMark(type)(state, dispatch))
    : format.pressed ? chain.unsetMark(name) : chain.setMark(name))
  if (!candidate) return false
  if (candidate.docChanged) return commitBudgetedTransaction(editor, candidate)
  // Collapsed cursor: stored marks affect only subsequent input, without a history entry.
  if (!normalizeBudgetedCandidate(editor.schema, candidate)) return false
  editor.view.dispatch(candidate)
  return true
}
