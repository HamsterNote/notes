import { Extension, type Editor } from "@tiptap/core"
import { Fragment } from "@tiptap/pm/model"
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state"
import { CONVERSION_TARGETS, isLosslessConversion, type ConversionTarget } from "./blockConversion"
import { listConversionCandidate, type ListType } from "./listCommands"
import { commitBudgetedTransaction, normalizeBudgetedCandidate } from "../hnn/budgetedTransaction"
import { canApplyHnnTransaction } from "../hnn/transactionPermission"

export const SLASH_TARGETS: readonly ConversionTarget[] = [...CONVERSION_TARGETS,
  { type: "orderedList", label: "有序列表" }, { type: "bulletList", label: "无序列表" }, { type: "taskList", label: "待办列表" }]

/** Isolated candidate: consume the trigger and convert one logical line, never its outer container. */
export function slashConversionCandidate(editor: Editor, target: ConversionTarget): Transaction | null {
  const { selection } = editor.state, { $from } = selection
  if (!selection.empty || !["paragraph", "heading"].includes($from.parent.type.name) ||
      $from.parent.textBetween(0, 1) !== "/" || !canApplyHnnTransaction(editor) || editor.view.composing) return null
  const start = $from.start(), pos = start - 1
  const tr = editor.state.tr.delete(start, start + 1)
  const line = tr.doc.nodeAt(pos)!
  const type = editor.schema.nodes[target.type]
  if (!type) return null
  try {
    if (["orderedList", "bulletList", "taskList"].includes(target.type) ||
        target.type === "paragraph" && ["listItem", "taskItem"].includes($from.node($from.depth - 1).type.name)) {
      // The existing list command owns item splitting, checked state and numbering.
      // Headings first become paragraphs on this candidate only.
      if (line.type.name === "heading") tr.setNodeMarkup(pos, editor.schema.nodes["paragraph"], { nodeId: line.attrs["nodeId"] as unknown })
      tr.setSelection(TextSelection.create(tr.doc, start))
      const isolated = EditorState.create({ doc: tr.doc, selection: tr.selection })
      const proxy = { state: isolated, schema: editor.schema, view: editor.view, isDestroyed: editor.isDestroyed } as Editor
      const converted = listConversionCandidate(proxy, target.type as ListType | "paragraph")
      if (!converted) return null
      for (const step of converted.steps) tr.step(step)
    } else {
      if (line.type.name === target.type && (target.type !== "heading" || line.attrs["level"] === target.attrs?.["level"])) return null
      if (!isLosslessConversion(line, type)) return null
      const replacement = target.type === "blockquote" ? type.create(null, line)
        : type.create({ nodeId: line.attrs["nodeId"] as unknown, ...target.attrs }, line.content)
      const $pos = tr.doc.resolve(pos)
      if (!$pos.parent.canReplace($pos.index(), $pos.index() + 1, Fragment.from(replacement))) return null
      tr.replaceWith(pos, pos + line.nodeSize, replacement)
    }
    // Locate the surviving line by identity after list/wrapper replacement.
    let caret: number | undefined
    tr.doc.descendants((node, offset) => {
      if (node.isTextblock && node.attrs["nodeId"] === line.attrs["nodeId"]) caret = offset + 1
    })
    if (caret === undefined) return null
    tr.setSelection(TextSelection.create(tr.doc, caret))
    return normalizeBudgetedCandidate(editor.schema, tr)
  } catch { return null }
}

let sequence = 0
export const HnnSlashCommands = Extension.create({
  name: "hnnSlashCommands",
  priority: 1400,
  addProseMirrorPlugins() {
    const editor = this.editor
    let composing = false
    let active: { doc: Editor["state"]["doc"]; lineId: unknown; start: number; menu: HTMLElement; buttons: HTMLButtonElement[]; index: number; root: Element } | null = null
    const canInput = () => !editor.isDestroyed && editor.view.editable && canApplyHnnTransaction(editor) && !composing && !editor.view.composing
    const close = () => {
      if (!active) return
      const root = active.root
      active.menu.remove()
      active = null
      editor.view.dom.removeAttribute("data-hnn-slash-open")
      root.dispatchEvent(new CustomEvent("hn-editor-popover-close", { detail: "slash", bubbles: true }))
      editor.view.dom.removeAttribute("aria-controls")
      editor.view.dom.removeAttribute("aria-activedescendant")
      editor.view.dom.removeAttribute("aria-expanded")
    }
    const valid = () => !!active && canInput() && active.doc === editor.state.doc &&
      editor.state.selection.empty && editor.state.selection.$from.parent.attrs["nodeId"] === active.lineId
    const choose = (index: number) => {
      if (!active) return
      active.index = index
      active.buttons.forEach((button, i) => button.setAttribute("aria-selected", String(i === index)))
      const button = active.buttons[index]
      if (button) {
        editor.view.dom.setAttribute("aria-activedescendant", button.id)
        button.scrollIntoView?.({ block: "nearest" })
      }
    }
    const submit = (index: number) => {
      if (!valid() || !active || active.buttons[index]?.disabled !== false) { close(); return }
      const tr = slashConversionCandidate(editor, SLASH_TARGETS[index]!)
      if (!tr) { close(); return }
      close()
      commitBudgetedTransaction(editor, tr)
      editor.view.focus()
    }
    const place = () => {
      if (!active) return
      const coords = editor.view.coordsAtPos(active.start + 1)
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      if (coords.bottom < top || coords.top > top + height || coords.right < left || coords.left > left + width) { close(); return }
      const menu = active.menu
      const belowSpace = top + height - 8 - coords.bottom - 4
      const aboveSpace = coords.top - top - 8 - 4
      const naturalHeight = menu.scrollHeight || menu.getBoundingClientRect().height
      const below = naturalHeight <= belowSpace || belowSpace >= aboveSpace
      const available = Math.max(0, below ? belowSpace : aboveSpace)
      if (available < 32) { close(); return }
      menu.style.maxHeight = `${available}px`
      const rect = menu.getBoundingClientRect()
      const y = below ? coords.bottom + 4 : coords.top - rect.height - 4
      menu.style.left = `${Math.max(left + 8, Math.min(coords.left, left + width - rect.width - 8))}px`
      menu.style.top = `${y}px`
    }
    const open = (start: number) => {
      close()
      const menu = document.createElement("div")
      menu.className = "hn-editor-menu hn-editor-slash-menu"
      menu.id = `hn-slash-${++sequence}`
      menu.setAttribute("role", "listbox")
      menu.setAttribute("aria-label", "转换当前行")
      const root = editor.view.dom.closest(".hn-editor") ?? editor.view.dom.parentElement ?? document.body
      editor.view.dom.setAttribute("data-hnn-slash-open", "")
      root.dispatchEvent(new CustomEvent("hn-editor-popover-open", { detail: "slash", bubbles: true }))
      const buttons = SLASH_TARGETS.map((target, i) => {
        const button = document.createElement("button")
        button.type = "button"
        button.id = `${menu.id}-${i}`
        button.setAttribute("role", "option")
        button.tabIndex = -1
        button.textContent = target.label
        button.disabled = !slashConversionCandidate(editor, target)
        if (button.disabled) {
          button.title = "当前类型、父结构、格式或容量不支持此转换"
          button.setAttribute("aria-description", button.title)
        }
        button.addEventListener("mousedown", event => event.preventDefault())
        button.addEventListener("click", () => { if (active?.menu === menu) submit(i) })
        menu.append(button)
        return button
      })
      active = { doc: editor.state.doc, lineId: editor.state.selection.$from.parent.attrs["nodeId"], start, menu, buttons, index: -1, root }
      root.append(menu)
      editor.view.dom.setAttribute("aria-controls", menu.id)
      editor.view.dom.setAttribute("aria-expanded", "true")
      choose(buttons.findIndex(button => !button.disabled))
      place()
    }
    const outside = (event: Event) => {
      if (active && event.target instanceof Node && !active.menu.contains(event.target) && !editor.view.dom.contains(event.target)) close()
    }
    const otherPopover = (event: Event) => {
      if (active && (event as CustomEvent).detail !== "slash" && event.target === active.root) close()
    }
    const layout = () => { if (valid()) place(); else close() }
    return [new Plugin({
      props: {
        handleTextInput(_view, from, to, text) {
          if (active) close()
          const { selection } = editor.state, $from = editor.state.doc.resolve(from)
          if (text !== "/" || from !== to || !selection.empty || $from.parentOffset !== 0 ||
              !["paragraph", "heading"].includes($from.parent.type.name) || !canInput()) return false
          const tr = normalizeBudgetedCandidate(editor.schema, editor.state.tr.insertText("/", from, to))
          if (!tr) return true
          editor.view.dispatch(tr)
          if (editor.state.doc.eq(tr.doc)) open(from)
          return true
        },
        handleDOMEvents: {
          compositionstart() { composing = true; close(); return false },
          compositionend() { composing = false; return false },
          blur() { close(); return false }
        },
        handleKeyDown(_view, event) {
          if (!active) return false
          if (!valid() || event.isComposing || event.keyCode === 229) { close(); return false }
          const keys = ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]
          if (!keys.includes(event.key)) { close(); return false }
          if (event.key === "Escape") { close(); return true }
          if (event.key === "Enter") { submit(active.index); return true }
          const available = active.buttons.map((b, i) => b.disabled ? -1 : i).filter(i => i >= 0)
          const current = available.indexOf(active.index)
          const index = event.key === "Home" ? available[0] : event.key === "End" ? available.at(-1)
            : available[(current + (event.key === "ArrowDown" ? 1 : -1) + available.length) % available.length]
          if (index !== undefined) choose(index)
          return true
        }
      },
      view() {
        document.addEventListener("pointerdown", outside, true)
        document.addEventListener("hn-editor-popover-open", otherPopover)
        window.addEventListener("resize", layout)
        window.addEventListener("scroll", layout, true)
        window.visualViewport?.addEventListener("resize", layout)
        window.visualViewport?.addEventListener("scroll", layout)
        return {
          update() { if (active && !valid()) close() },
          destroy() {
            close()
            document.removeEventListener("pointerdown", outside, true)
            document.removeEventListener("hn-editor-popover-open", otherPopover)
            window.removeEventListener("resize", layout)
            window.removeEventListener("scroll", layout, true)
            window.visualViewport?.removeEventListener("resize", layout)
            window.visualViewport?.removeEventListener("scroll", layout)
          }
        }
      }
    })]
  }
})
