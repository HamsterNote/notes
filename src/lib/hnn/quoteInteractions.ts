import { Extension } from "@tiptap/core"
import { lift, splitBlock } from "@tiptap/pm/commands"
import { EditorState, Plugin, type Command, type Transaction } from "@tiptap/pm/state"
import { findWrapping } from "@tiptap/pm/transform"
import { captureChainTransaction, commitBudgetedTransaction, normalizeBudgetedCandidate } from "./budgetedTransaction"
import { canApplyHnnTransaction } from "./transactionPermission"

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
          if ($from.parent.type.name !== "paragraph") return false
          let depth = $from.depth - 1
          while (depth > 0 && $from.node(depth).type.name !== "blockquote") {
            if (["listItem", "taskItem"].includes($from.node(depth).type.name)) return false
            depth--
          }
          if (!depth) return false
          if (!canInput() || event.isComposing || event.keyCode === 229) return true
          let candidate: Transaction | null = null
          if (event.shiftKey) candidate = captureChainTransaction(editor, chain => chain.setHardBreak())
          else {
            const exit = state.selection.empty && $from.parent.content.size === 0 && depth === $from.depth - 1 &&
              $from.index(depth) === $from.node(depth).childCount - 1
            const command: Command = exit ? lift : splitBlock
            command(state, tr => { candidate = tr })
          }
          if (candidate) commitBudgetedTransaction(editor, candidate)
          return true
        }
      }
    })]
  }
})
