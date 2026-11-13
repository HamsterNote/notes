import { Extension } from "@tiptap/core"
import { splitBlock } from "@tiptap/pm/commands"
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state"
import { Fragment, type Node as PmNode } from "@tiptap/pm/model"
import { findWrapping } from "@tiptap/pm/transform"
import { captureChainTransaction, commitBudgetedTransaction, normalizeBudgetedCandidate } from "./budgetedTransaction"
import { canApplyHnnTransaction } from "./transactionPermission"

/** Split only the contiguous quote chain: cells/items keep ownership of their contents. */
export function quoteExitCandidate(state: EditorState): Transaction | null {
  const { selection } = state
  if (!selection.$from.sameParent(selection.$to)) return null
  const tr = state.tr.deleteSelection()
  const { $from } = tr.selection
  if (!["paragraph", "heading"].includes($from.parent.type.name)) return null
  let outer = $from.depth - 1
  if (outer < 1 || $from.node(outer).type.name !== "blockquote") return null
  while (outer > 1 && $from.node(outer - 1).type.name === "blockquote") outer--
  const line = $from.parent
  const left = line.content.cut(0, $from.parentOffset)
  const right = line.content.cut($from.parentOffset)
  let before: PmNode[] = left.size ? [line.copy(left)] : []
  let after: PmNode[] = []
  for (let depth = $from.depth - 1; depth >= outer; depth--) {
    const quote = $from.node(depth), index = $from.index(depth)
    const children = Array.from({ length: quote.childCount }, (_, i) => quote.child(i))
    const prefix = [...children.slice(0, index), ...before]
    const suffix = [...after, ...children.slice(index + 1)]
    before = prefix.length ? [quote.copy(Fragment.fromArray(prefix))] : []
    after = suffix.length ? [quote.type.create({
      ...quote.attrs, nodeId: prefix.length ? null : quote.attrs["nodeId"] as unknown
    }, suffix)] : []
  }
  const paragraph = state.schema.nodes["paragraph"]!.create(null, right)
  const from = $from.before(outer), to = from + $from.node(outer).nodeSize
  const replacement = Fragment.fromArray([...before, paragraph, ...after])
  const $start = tr.doc.resolve(from)
  if (!$start.parent.canReplace($start.index(), $start.index() + 1, replacement)) return null
  tr.replaceWith(from, to, replacement)
  tr.setSelection(TextSelection.create(tr.doc, from + before.reduce((n, node) => n + node.nodeSize, 0) + 1))
  return tr.scrollIntoView()
}

export const HnnQuoteInteractions = Extension.create({
  name: "hnnQuoteInteractions",
  priority: 1200,
  addProseMirrorPlugins() {
    const editor = this.editor
    let composing = false
    const canInput = () => !editor.isDestroyed && editor.view.editable && !editor.view.composing && !composing
    return [new Plugin({
      filterTransaction(tr, state) {
        if (!tr.docChanged) return true
        let quote = false
        for (const doc of [state.doc, tr.doc]) doc.descendants(node => { if (node.type.name === "blockquote") quote = true })
        return !quote || canApplyHnnTransaction(editor) &&
          !!normalizeBudgetedCandidate(state.schema, EditorState.create({ doc: tr.doc }).tr)
      },
      props: {
        handleDOMEvents: {
          compositionstart() { composing = true; return false },
          compositionend() { composing = false; return false }
        },
        handleTextInput(_view, from, to, text) {
          const { state } = editor, { selection } = state
          const $from = state.doc.resolve(from)
          if (!canInput() || !selection.empty || from !== to || $from.parent.type.name !== "paragraph" ||
              $from.parent.textBetween(0, $from.parentOffset) + text !== "> ") return false
          const parent = $from.node($from.depth - 1)
          if (["listItem", "taskItem"].includes(parent.type.name) && $from.index($from.depth - 1) === 0) return false
          const start = $from.start()
          const literal = state.tr.insertText(text, from, to)
          const isolated = EditorState.create({ doc: literal.doc, selection: literal.selection })
          const wrapped = isolated.tr.delete(start, start + 2)
          const range = wrapped.doc.resolve(start).blockRange()
          const wrapping = range && findWrapping(range, state.schema.nodes["blockquote"]!, { author: null })
          const candidate = wrapping && range ? normalizeBudgetedCandidate(state.schema, wrapped.wrap(range, wrapping)) : null
          // Literal typing and the shortcut are separate history events: undo
          // restores '> ', rather than losing the key that triggered the rule.
          if (!commitBudgetedTransaction(editor, literal)) return true
          if (candidate && candidate.before.eq(editor.state.doc)) commitBudgetedTransaction(editor, candidate)
          return true
        },
        handleKeyDown(_view, event) {
          if (event.key !== "Enter" || event.altKey || event.ctrlKey || event.metaKey) return false
          const { state } = editor, { $from } = state.selection
          if (!["paragraph", "heading"].includes($from.parent.type.name)) return false
          const depth = $from.depth - 1
          if (depth < 1 || $from.node(depth).type.name !== "blockquote") return false
          if (!canInput() || event.isComposing || event.keyCode === 229) return true
          let candidate: Transaction | null = null
          if (event.shiftKey) candidate = captureChainTransaction(editor, chain => chain.setHardBreak())
          else if (state.selection.$from.sameParent(state.selection.$to)) candidate = quoteExitCandidate(state)
          else splitBlock(state, tr => { candidate = tr })

          if (candidate) commitBudgetedTransaction(editor, candidate)
          return true
        }
      }
    })]
  }
})
