import type { Editor } from "@tiptap/core"
import { Selection } from "@tiptap/pm/state"
import { commitBudgetedTransaction } from "../hnn/budgetedTransaction"
import { canApplyHnnTransaction } from "../hnn/transactionPermission"

/** An editor is bound to one session for its entire lifetime. Never reuse a dialog across editors. */
export function openBlockDelete(editor: Editor, nodeId: string, anchor: HTMLElement): void {
  if (!canApplyHnnTransaction(editor) || !editor.view.editable || editor.view.composing) return
  const version = editor.state.doc
  const root = anchor.closest(".hn-editor") ?? editor.view.dom.parentElement ?? document.body
  const backdrop = document.createElement("div")
  backdrop.className = "hn-picture-dialog-backdrop hn-block-delete-backdrop"
  const dialog = document.createElement("div")
  dialog.className = "hn-picture-dialog"
  dialog.setAttribute("role", "dialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.setAttribute("aria-label", "删除内容块？")
  const title = document.createElement("h2")
  title.textContent = "删除内容块？"
  const description = document.createElement("p")
  description.textContent = "将删除此块及其全部内容，可撤销"
  const error = document.createElement("p")
  error.setAttribute("role", "alert")
  const cancel = document.createElement("button")
  cancel.type = "button"
  cancel.textContent = "取消"
  const confirm = document.createElement("button")
  confirm.type = "button"
  confirm.textContent = "确认删除"
  const actions = document.createElement("div")
  actions.className = "hn-picture-dialog__actions"
  actions.append(cancel, confirm)
  dialog.append(title, description, error, actions)
  backdrop.append(dialog)
  let closed = false, stale = false, composing = false
  const restore = () => {
    if (editor.isDestroyed) return
    if (anchor.isConnected) anchor.focus()
    else editor.view.focus()
  }
  const close = (focus = true) => {
    if (closed) return
    closed = true
    observer.disconnect()
    editor.off("transaction", changed)
    editor.off("destroy", destroyed)
    editor.view.dom.removeEventListener("compositionstart", compositionStart)
    editor.view.dom.removeEventListener("compositionend", compositionEnd)
    backdrop.remove()
    if (focus) restore()
  }
  const expired = () => {
    stale = true
    error.textContent = "内容已变化，请重新打开删除确认"
    confirm.disabled = true
  }
  const changed = () => {
    if (!editor.view.editable || !canApplyHnnTransaction(editor)) close(false)
    else if (editor.state.doc !== version) expired()
  }
  const destroyed = () => close(false)
  const compositionStart = () => { composing = true }
  const compositionEnd = () => { composing = false }
  const observer = new MutationObserver(changed)
  observer.observe(editor.view.dom, { attributes: true, attributeFilter: ["contenteditable"] })
  editor.on("transaction", changed)
  editor.on("destroy", destroyed)
  editor.view.dom.addEventListener("compositionstart", compositionStart)
  editor.view.dom.addEventListener("compositionend", compositionEnd)
  cancel.onclick = () => close()
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close() })
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === "Tab") {
      event.preventDefault()
      const controls = confirm.disabled ? [cancel] : [cancel, confirm]
      const index = controls.indexOf(document.activeElement as HTMLButtonElement)
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]!.focus()
    }
  })
  confirm.onclick = () => {
    if (closed || stale || editor.isDestroyed) return
    if (!canApplyHnnTransaction(editor) || !editor.view.editable || composing || editor.view.composing) return
    if (editor.state.doc !== version) { expired(); return }
    let pos: number | undefined
    editor.state.doc.forEach((node, offset) => { if (node.attrs["nodeId"] === nodeId) pos = offset })
    if (pos === undefined) { expired(); return }
    const node = editor.state.doc.nodeAt(pos)!
    const tr = editor.state.tr
    if (tr.doc.childCount === 1) tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodes["paragraph"]!.create())
    else tr.delete(pos, pos + node.nodeSize)
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), pos < tr.doc.content.size ? 1 : -1))
    if (!commitBudgetedTransaction(editor, tr)) {
      error.textContent = "无法删除此块，请检查编辑权限或文档容量"
      return
    }
    close(false)
    editor.view.focus()
  }
  root.append(backdrop)
  cancel.focus()
}
