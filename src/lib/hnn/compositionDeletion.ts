import { Extension } from "@tiptap/core"
import { DOMParser, Fragment, type Node as PmNode, type ParseOptions, type TagParseRule } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"

type Deletion = {
  doc: PmNode; node: PmNode; block: HTMLElement; view: EditorView
  before: globalThis.Node[]; after: globalThis.Node[]
}
// Preserve PM's widget/NodeView rules, including this internal parser hook.
type ViewParseOptions = ParseOptions & { ruleFromNode?: (node: globalThis.Node) => Omit<TagParseRule, "tag"> | null }

/**
 * WebKit can remove an entire composing textblock, leaving a root BR (or its
 * same-task commit). Parsing that as a new block can make PM synthesize Enter
 * against the OLD model. Capture the verified deletion in beforeinput and parse
 * its native replacement as the original textblock at observer delivery.
 * No native DOM writes, input cancellation, dispatch, timers or inferred text.
 */
export const HnnCompositionDeletion = Extension.create({
  name: "hnnCompositionDeletion",
  addProseMirrorPlugins() {
    let pending: Deletion | null = null
    // End is not a deletion boundary: WebKit may send it before the final
    // delete/commit. Explicit user activity or a final commit ends this phase,
    // rather than a time window or view.composing alone.
    let composition = false
    const clear = () => { pending = null; composition = false; return false }
    class CompositionParser extends DOMParser {
      override parse(dom: globalThis.Node, options: ViewParseOptions = {}): PmNode {
        const deletion = pending
        if (!deletion || dom !== deletion.view.dom) return super.parse(dom, options)
        const { view, doc, node, block, before, after } = deletion
        if (!view.editable || doc !== view.state.doc || view.dom.contains(block)) {
          pending = null
          return super.parse(dom, options)
        }
        const children = Array.from(dom.childNodes)
        const start = before.length, end = children.length - after.length
        // Match the original block's exact slot, including its neighbours and
        // widgets. Never transfer identity to a different or ambiguous edit.
        const from = options.from ?? 0, to = options.to ?? children.length
        if (start < from || end > to) return super.parse(dom, options)
        pending = null
        if (end <= start || !before.every((child, i) => children[i] === child)
          || !after.every((child, i) => children[end + i] === child)) return super.parse(dom, options)
        const replacement = children.slice(start, end)
        const container = replacement.length === 1 && /^(P|H[1-6])$/.test(replacement[0]!.nodeName)
          ? replacement[0]! : dom
        // Only a root inline run or one native textblock can replace the block.
        // Nested/list/table/multi-block DOM remains on the ordinary PM path.
        if (container === dom && replacement.some(child => child.nodeType !== 3
          && !/^(BR|SPAN|STRONG|EM|B|I|U|S|A|CODE)$/.test(child.nodeName))) return super.parse(dom, options)
        if (replacement.some(child => child.nodeType === 1
          && (child as Element).querySelector("p,h1,h2,h3,h4,h5,h6,div,ul,ol,table"))) return super.parse(dom, options)

        const positions = options.findPositions ?? []
        // Parse three ranges without moving/cloning native nodes. This retains
        // PM's NodeView/widget rules and selection lookup on the original DOM.
        const read = (parent: globalThis.Node, opts: ViewParseOptions) => {
          const find: NonNullable<ParseOptions["findPositions"]> = positions.map(pos => ({ node: pos.node, offset: pos.offset }))
          if (parent !== dom) for (const pos of find) if (pos.node === dom && pos.offset >= start && pos.offset <= end) {
            pos.node = parent
            pos.offset = pos.offset === start ? 0 : parent.childNodes.length
          }
          const parsed = super.parse(parent, { ...opts, findPositions: find })
          return { parsed, find }
        }
        const prefix = read(dom, { ...options, to: start })
        const middleOptions = { ...options, topNode: node, topMatch: node.type.contentMatch,
          preserveWhitespace: node.type.whitespace === "pre" ? "full" as const : options.preserveWhitespace ?? false,
          from: container === dom ? start : 0, to: container === dom ? end : container.childNodes.length,
          ruleFromNode: (child: globalThis.Node) => container === dom && child === replacement[replacement.length - 1] && child.nodeName === "BR"
            ? { ignore: true } : options.ruleFromNode?.(child) ?? null }
        const middle = read(container, middleOptions)
        const content = prefix.parsed.content.append(Fragment.from(middle.parsed))
        const topMatch = (options.topMatch ?? prefix.parsed.type.contentMatch).matchFragment(content)
        if (!topMatch) return super.parse(dom, options)
        const suffix = read(dom, { ...options, from: end, topMatch })
        // Apply middle positions last: a root caret beside BR belongs INSIDE
        // the restored block, not to a boundary outside it.
        for (const [part, shift] of [[prefix, 0], [suffix, content.size], [middle, prefix.parsed.content.size + 1]] as const) {
          for (let i = 0; i < part.find.length; i++) if (part.find[i]!.pos != null) positions[i]!.pos = part.find[i]!.pos! + shift
        }
        return prefix.parsed.copy(content.append(suffix.parsed.content))
      }
    }
    const parser = new CompositionParser(this.editor.schema, DOMParser.fromSchema(this.editor.schema).rules)
    const capture = (view: EditorView, event: InputEvent): false => {
      if (event.inputType !== "deleteCompositionText") {
        // A commit may replace BR before the observer runs. Keep the verified
        // slot until that parse, even across compositionend and beforeinput.
        if (event.inputType === "insertFromComposition" || event.inputType === "insertText") composition = false
        else if (event.inputType !== "insertCompositionText") clear()
        return false
      }
      pending = null
      if ((!composition && !view.composing) || !view.editable || typeof event.getTargetRanges !== "function") return false
      const ranges = event.getTargetRanges()
      if (ranges.length !== 1) return false
      const range = ranges[0]!
      if (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer)) return false
      try {
        const from = view.posAtDOM(range.startContainer, range.startOffset)
        const to = view.posAtDOM(range.endContainer, range.endOffset)
        const doc = view.state.doc, $from = doc.resolve(from), $to = doc.resolve(to)
        if (from >= to || $from.depth !== 1 || !$from.sameParent($to) || !$from.parent.isTextblock
          || from !== $from.start() || to !== $from.end()) return false
        const block = view.nodeDOM($from.before())
        if (!(block instanceof HTMLElement) || block.parentNode !== view.dom) return false
        const nativeRange = view.dom.ownerDocument.createRange()
        nativeRange.setStart(range.startContainer, range.startOffset)
        nativeRange.setEnd(range.endContainer, range.endOffset)
        if (nativeRange.toString() !== doc.textBetween(from, to)) return false
        const children = Array.from(view.dom.childNodes), index = children.indexOf(block)
        pending = { doc, node: $from.parent, block, view, before: children.slice(0, index), after: children.slice(index + 1) }
      } catch { /* Detached or stale browser ranges stay on PM's normal path. */ }
      return false
    }
    return [new Plugin({
      props: {
        domParser: parser,
        handleDOMEvents: {
          beforeinput: capture,
          compositionstart() { clear(); composition = true; return false },
          // Retain the phase and pending parse across compositionend.
          pointerdown: clear,
          keydown(view, event) { return !view.composing && !event.isComposing && event.keyCode !== 229 ? clear() : false },
          blur: clear
        }
      },
      view: () => ({
        update(view) { if (pending && pending.doc !== view.state.doc) pending = null },
        destroy: clear
      })
    })]
  }
})
