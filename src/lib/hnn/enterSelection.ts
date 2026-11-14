import { Extension } from "@tiptap/core"
import { Plugin, TextSelection } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"

function nativeSelection(view: EditorView) {
  const selection = view.dom.ownerDocument.getSelection()
  if (!selection?.anchorNode || !selection.focusNode) return null
  return {
    anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset
  }
}

/** Resolve browser navigation before any Enter keymap consumes the model range. */
export const HnnEnterSelection = Extension.create({
  name: "hnnEnterSelection",
  priority: 1300,
  addProseMirrorPlugins() {
    let written: ReturnType<typeof nativeSelection> = null
    return [new Plugin({
      view(view) {
        written = nativeSelection(view)
        return {
          // A model transaction owns the selection it just rendered, including
          // explicit selection commands. Only subsequent native movement wins.
          update(view) { written = nativeSelection(view) }
        }
      },
      props: {
        handleDOMEvents: {
          keydown(view, event) {
            if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 ||
                view.composing || !view.editable || !view.hasFocus() ||
                !(view.state.selection instanceof TextSelection)) return false
            const current = nativeSelection(view)
            if (!current || !view.dom.contains(current.anchorNode) || !view.dom.contains(current.focusNode)) return false
            if (written && current.anchorNode === written.anchorNode && current.anchorOffset === written.anchorOffset &&
                current.focusNode === written.focusNode && current.focusOffset === written.focusOffset) return false
            const anchor = view.posAtDOM(current.anchorNode, current.anchorOffset)
            const head = view.posAtDOM(current.focusNode, current.focusOffset)
            const $anchor = view.state.doc.resolve(anchor), $head = view.state.doc.resolve(head)
            // Node/cell selections and non-text boundaries keep their owners.
            if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) return false
            const selection = TextSelection.create(view.state.doc, anchor, head)
            if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection))
            return false
          }
        }
      }
    })]
  }
})
