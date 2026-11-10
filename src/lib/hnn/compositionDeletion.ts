import { Extension } from "@tiptap/core"
import { DOMParser, type Node as PmNode, type ParseOptions, type TagParseRule } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"

type Deletion = { doc: PmNode; node: PmNode; block: HTMLElement; view: EditorView }
// prosemirror-view supplies this parser hook, marked @internal in model's
// declarations. Preserve its widget/NodeView rules for every untagged node.
type ViewParseOptions = ParseOptions & { ruleFromNode?: (node: globalThis.Node) => Omit<TagParseRule, "tag"> | null }

/**
 * WebKit can replace an entire composing paragraph with a root BR when it
 * deletes the preedit. PM's DOM diff can mistake that empty structure for Enter
 * and split the OLD model, resurrecting the preedit. Parse that native BR as the
 * emptied textblock so the normal DOM observer applies a text deletion instead.
 * Never cancel input, dispatch during native input, or infer a final commit.
 */
export const HnnCompositionDeletion = Extension.create({
  name: "hnnCompositionDeletion",
  addProseMirrorPlugins() {
    let pending: Deletion | null = null
    const replacements = new WeakMap<globalThis.Node, Deletion>()
    const clear = () => { pending = null; return false }
    class CompositionParser extends DOMParser {
      override parse(dom: globalThis.Node, options: ViewParseOptions = {}): PmNode {
        const ruleFromNode = options.ruleFromNode
        const parseOptions: ViewParseOptions = { ...options, ruleFromNode: node => {
          const deletion = replacements.get(node)
          if (deletion) {
            replacements.delete(node)
            if (deletion.doc === deletion.view.state.doc && deletion.view.dom.contains(node)) {
              return { node: deletion.node.type.name, attrs: deletion.node.attrs }
            }
          }
          return ruleFromNode?.(node) ?? null
        } }
        return super.parse(dom, parseOptions)
      }
    }
    const parser = new CompositionParser(this.editor.schema, DOMParser.fromSchema(this.editor.schema).rules)
    const capture = (view: EditorView, event: InputEvent): false => {
      pending = null
      if (event.inputType !== "deleteCompositionText" || !view.composing || !view.editable
        || typeof event.getTargetRanges !== "function") return false
      const ranges = event.getTargetRanges()
      if (ranges.length !== 1) return false
      const range = ranges[0]!
      if (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer)) return false
      try {
        const from = view.posAtDOM(range.startContainer, range.startOffset)
        const to = view.posAtDOM(range.endContainer, range.endOffset)
        const doc = view.state.doc, $from = doc.resolve(from), $to = doc.resolve(to)
        // Only a whole top-level textblock can disappear into a root BR. Keep
        // ordinary inline edits and nested/table/list composition on PM's path.
        if (from >= to || $from.depth !== 1 || !$from.sameParent($to) || !$from.parent.isTextblock
          || from !== $from.start() || to !== $from.end()) return false
        const block = view.nodeDOM($from.before())
        if (!(block instanceof HTMLElement) || block.parentNode !== view.dom) return false
        const nativeRange = view.dom.ownerDocument.createRange()
        nativeRange.setStart(range.startContainer, range.startOffset)
        nativeRange.setEnd(range.endContainer, range.endOffset)
        // Do not use stale model positions if preceding native input has not
        // yet reached the model. Missing/unsupported ranges fall back to PM.
        if (nativeRange.toString() !== doc.textBetween(from, to)) return false
        pending = { doc, node: $from.parent, block, view }
      } catch { /* Browser ranges can become detached; leave them to PM. */ }
      return false
    }
    return [new Plugin({
      props: {
        domParser: parser,
        handleDOMEvents: {
          beforeinput: capture,
          input(view, event) {
            const deletion = pending
            pending = null
            if (event.inputType !== "deleteCompositionText" || !deletion
              || !view.editable || deletion.doc !== view.state.doc || view.dom.contains(deletion.block)) return clear()
            const selection = view.dom.ownerDocument.getSelection()
            if (!selection?.isCollapsed || selection.anchorNode !== view.dom || selection.focusNode !== view.dom) return clear()
            const at = selection.anchorOffset
            const after = view.dom.childNodes[at], before = view.dom.childNodes[at - 1]
            const replacement = after?.nodeName === "BR" ? after : before?.nodeName === "BR" ? before : undefined
            if (!replacement) return clear()
            // Keep the tag on this exact BR until the observer parses it, even
            // if compositionend/another beforeinput occurs in the same task.
            replacements.set(replacement, deletion)
            return false
          },
          compositionstart: clear,
          compositionend: clear,
          blur: clear
        }
      },
      view: () => ({ destroy: clear })
    })]
  }
})
