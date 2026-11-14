import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { canApplyHnnTransaction } from "./transactionPermission"

/** Route physical Ctrl and Meta keys to the existing command owner on every OS.
 * No document-global listener, native history, snapshot stack or fallback. */
export const HnnHistoryKeys = Extension.create({
  name: "hnnHistoryKeys",
  priority: 2000,
  addProseMirrorPlugins() {
    const editor = this.editor
    let composing = false
    return [new Plugin({
      props: {
        handleDOMEvents: {
          compositionstart() { composing = true; return false },
          compositionend() { composing = false; return false }
        },
        handleKeyDown(view, event) {
          const key = event.key.toLowerCase()
          if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey) ||
              !(key === "z" || key === "y" && !event.shiftKey)) return false
          const target = event.target
          if (target instanceof Element && (target.closest("input, textarea, select, [role=dialog], [contenteditable=false]") ||
              !view.dom.contains(target))) return false
          if (!view.hasFocus() || !view.editable || !canApplyHnnTransaction(editor) ||
              composing || view.composing || event.isComposing || event.keyCode === 229) return false
          if (key === "y" || event.shiftKey) editor.commands.redo()
          else editor.commands.undo()
          // A recognized body shortcut is consumed even on an empty stack or
          // a host callback returning false; the browser must not undo separately.
          return true
        }
      }
    })]
  }
})
