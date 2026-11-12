import { Extension } from "@tiptap/core"
import type { Node } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

const listNames = new Set(["orderedList", "bulletList", "taskList"])
export function orderedListStyle(depth: number, explicit: unknown): string {
  return typeof explicit === "string" && ["1", "a", "A", "i", "I"].includes(explicit)
    ? explicit : ["1", "a", "i"][(depth - 1) % 3]!
}

export function listOrdinal(value: number, style: string): string {
  if (style === "a" || style === "A") {
    let result = "", n = value
    while (n > 0) { n--; result = String.fromCharCode(97 + n % 26) + result; n = Math.floor(n / 26) }
    return style === "A" ? result.toUpperCase() : result
  }
  if ((style === "i" || style === "I") && value >= 1 && value <= 3999) {
    let result = "", n = value
    for (const [amount, label] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"],
      [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) {
      while (n >= amount) { result += label; n -= amount }
    }
    return style === "I" ? result.toUpperCase() : result
  }
  return String(value)
}

export function listNumberingDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== "orderedList") return
    const $pos = doc.resolve(pos)
    let depth = 1
    for (let d = 1; d <= $pos.depth; d++) if (listNames.has($pos.node(d).type.name)) depth++
    const style = orderedListStyle(depth, node.attrs["type"] as unknown)
    let width = 1
    node.forEach((item, offset, index) => {
      const marker = listOrdinal(Number(node.attrs["start"]) + index, style)
      width = Math.max(width, marker.length)
      decorations.push(Decoration.node(pos + 1 + offset, pos + 1 + offset + item.nodeSize, { "data-hnn-marker": marker }))
    })
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {
      "data-hnn-list-style": style, style: `--hn-list-marker-width: ${width + 2}ch`
    }))
  })
  return DecorationSet.create(doc, decorations)
}

/** Display only: no derived attributes, normalization steps or history in HNN. */
export const HnnListNumbering = Extension.create({
  name: "hnnListNumbering",
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations: state => listNumberingDecorations(state.doc) } })]
  }
})
