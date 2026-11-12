import { Extension } from "@tiptap/core"
import { TaskItem } from "@tiptap/extension-list"
import { isHistoryTransaction } from "@tiptap/pm/history"
import { EditorState, Plugin } from "@tiptap/pm/state"
import { normalizeBudgetedCandidate } from "./budgetedTransaction"
import { canApplyHnnTransaction } from "./transactionPermission"
import { convertList, enterList, indentList, isList, resolveListTarget, toggleTask } from "../editor/listCommands"

/** Native checkbox focus/Space, without Tiptap's focus() or unbudgeted attr command. */
export const HnnTaskItem = TaskItem.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node
      const dom = document.createElement("li")
      dom.dataset["type"] = "taskItem"
      const label = document.createElement("label")
      label.contentEditable = "false"
      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      const contentDOM = document.createElement("div")
      label.append(checkbox)
      dom.append(label, contentDOM)
      const sync = () => {
        checkbox.checked = current.attrs["checked"] === true
        checkbox.setAttribute("aria-label", `待办：${current.firstChild?.textContent || "空白事项"}`)
        checkbox.setAttribute("aria-disabled", String(!editor.view.editable))
        dom.dataset["checked"] = String(checkbox.checked)
        dom.setAttribute("nodeid", String(current.attrs["nodeId"]))
      }
      const change = () => {
        const pos = getPos()
        if (typeof pos === "number") toggleTask(editor, pos)
        sync() // Restore native toggles rejected by permission, IME or budget checks.
      }
      checkbox.addEventListener("change", change)
      const refresh = () => { if (!editor.isDestroyed) sync() }
      editor.on("transaction", refresh)
      // view is not yet mounted when the NodeView is first constructed.
      checkbox.checked = current.attrs["checked"] === true
      checkbox.setAttribute("aria-label", `待办：${current.firstChild?.textContent || "空白事项"}`)
      dom.dataset["checked"] = String(checkbox.checked)
      dom.setAttribute("nodeid", String(current.attrs["nodeId"]))
      return {
        dom, contentDOM,
        update(updated) {
          if (updated.type !== current.type) return false
          current = updated
          sync()
          return true
        },
        stopEvent: event => !!event.target && label.contains(event.target as globalThis.Node),
        ignoreMutation: mutation => mutation.type !== "selection" && !contentDOM.contains(mutation.target),
        destroy() {
          checkbox.removeEventListener("change", change)
          editor.off("transaction", refresh)
        }
      }
    }
  }
}).configure({ nested: true })

/** Intercept ahead of built-in list keymaps; rejection must not fall through to them. */
export const HnnListInteractions = Extension.create({
  name: "hnnListInteractions",
  priority: 1100,
  addKeyboardShortcuts() {
    return Object.fromEntries((["orderedList", "bulletList", "taskList"] as const).map((type, index) =>
      [`Mod-Shift-${index + 7}`, () => { convertList(this.editor, type); return true }]))
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      filterTransaction(tr, state) {
        if (!tr.docChanged) return true
        let hasList = false
        for (const doc of [state.doc, tr.doc]) doc.descendants(node => { if (isList(node)) hasList = true })
        if (!hasList) return true
        if (!canApplyHnnTransaction(editor)) return false
        // History restores explicit list structure, including empty items after
        // Enter replaced all selected text. Generic delete cleanup would lift it.
        if (isHistoryTransaction(tr)) tr.setMeta("preventClearDocument", true)
        // Validate native typing, list input rules and delete keymaps too. Work on a copy:
        // the normal node-ID append plugin repairs the accepted live transaction.
        return !!normalizeBudgetedCandidate(state.schema, EditorState.create({ doc: tr.doc }).tr)
      },
      view(view) {
        const refresh = () => view.dom.querySelectorAll<HTMLInputElement>('li[data-type="taskItem"] > label > input')
          .forEach(checkbox => checkbox.setAttribute("aria-disabled", String(!view.editable)))
        refresh()
        return { update: refresh }
      },
      props: {
        handleKeyDown(_view, event) {
          if (event.key !== "Enter" && event.key !== "Tab") return false
          if (event.key === "Enter" && (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)) return false
          const target = resolveListTarget(editor)
          if (!target || target.paragraphs) return false
          if (event.isComposing || event.keyCode === 229 || editor.view.composing) return true
          if (event.key === "Enter") enterList(editor)
          else indentList(editor, event.shiftKey)
          return true
        }
      }
    })]
  }
})
