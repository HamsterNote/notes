import type { Editor } from "@tiptap/core"
import type { Mark, Node } from "@tiptap/pm/model"
import { TextSelection, type Transaction } from "@tiptap/pm/state"
import { commitBudgetedTransaction } from "../hnn/budgetedTransaction"
import { isSafeHnnUrl } from "../hnn/urlPolicy"

export interface LinkTarget {
  readonly editor: Editor
  readonly doc: Node
  readonly from: number
  readonly to: number
  readonly title: string
  readonly href: string | null
  readonly commonMarks: readonly Mark[]
}
const canInput = (editor: Editor) => !editor.isDestroyed && editor.view.editable && !editor.view.composing

export function resolveLinkTarget(editor: Editor): LinkTarget | null {
  if (!canInput(editor)) return null
  const { doc, selection } = editor.state
  if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to)) return null
  const { $from } = selection, parent = $from.parent, link = editor.schema.marks["link"]!
  if (!parent.isTextblock || parent.type.name === "codeBlock" || !parent.type.allowsMarkType(link)) return null
  const pieces: Array<{ node: Node; from: number; to: number; link: Mark | undefined }> = []
  parent.forEach((node, offset) => pieces.push({ node, from: $from.start() + offset,
    to: $from.start() + offset + node.nodeSize, link: link.isInSet(node.marks) }))
  let from = selection.from, to = selection.to
  let touched = pieces.filter(piece => selection.empty ? piece.from <= from && from < piece.to : piece.from < to && piece.to > from)
  if (selection.empty && !touched[0]?.link) touched = pieces.filter(piece => piece.to === from && piece.link)
  if (!touched.length || touched.some(({ node }) => !node.isText || node.marks.some(mark => mark.type.name === "code"))) return null
  const existing = touched[0]!.link
  if (selection.empty && !existing || touched.some(piece => existing ? !piece.link?.eq(existing) : !!piece.link)) return null
  if (existing) {
    let first = pieces.indexOf(touched[0]!), last = pieces.indexOf(touched[touched.length - 1]!)
    while (first > 0 && pieces[first - 1]!.link?.eq(existing)) first--
    while (last + 1 < pieces.length && pieces[last + 1]!.link?.eq(existing)) last++
    touched = pieces.slice(first, last + 1)
    if (touched.some(({ node }) => !node.isText || node.marks.some(mark => mark.type.name === "code"))) return null
    from = touched[0]!.from; to = touched[touched.length - 1]!.to
  }
  const commonMarks = touched[0]!.node.marks.filter(mark => mark.type !== link &&
    touched.every(piece => !!mark.type.isInSet(piece.node.marks)?.eq(mark)) && !mark.type.excludes(link) && !link.excludes(mark.type))
  return { editor, doc, from, to, title: doc.textBetween(from, to), href: existing ? String(existing.attrs["href"]) : null, commonMarks }
}

export function commitLink(editor: Editor, target: LinkTarget, title: string, url: string, stale = false, remove = false):
  { ok: true } | { ok: false; message: string } {
  if (!canInput(editor)) return { ok: false, message: "当前不可编辑，请解除冻结或结束组合输入后重试" }
  if (stale || target.editor !== editor || editor.state.doc !== target.doc) return { ok: false, message: "正文已变化，请关闭后重新选择文字" }
  if (!remove && !title.trim()) return { ok: false, message: "链接标题不能为空" }
  const href = url.replace(/^ +| +$/gu, "")
  if (!remove && !isSafeHnnUrl(href)) return { ok: false, message: "URL 必须是合法的 http、https、mailto 或 hnmagic 绝对地址" }
  const type = editor.schema.marks["link"]!
  const tr = editor.state.tr
  if (remove) tr.removeMark(target.from, target.to, type)
  else if (title === target.title) tr.addMark(target.from, target.to, type.create({ href }))
  else tr.replaceWith(target.from, target.to, editor.schema.text(title, [...target.commonMarks, type.create({ href })]))
  if (tr.doc.eq(editor.state.doc)) return { ok: true }
  return commitBudgetedTransaction(editor, tr) ? { ok: true }
    : { ok: false, message: "文档容量或提交校验未通过，未保存更改" }
}

/** Ephemeral dialog owned by one view; no public editor API or persisted draft. */
export function openLinkEditor(editor: Editor, anchor: HTMLElement, onClose: () => void): (() => void) | null {
  const target = resolveLinkTarget(editor)
  if (!target) return null
  let closed = false, stale = false, submitting = false, composing = false
  const panel = document.createElement("form")
  panel.className = "hn-editor-link-dialog"
  panel.setAttribute("role", "dialog")
  panel.setAttribute("aria-label", "配置链接")
  const field = (name: string, value: string) => {
    const label = document.createElement("label")
    label.textContent = name
    const input = document.createElement("input")
    input.type = "text"; input.value = value
    label.append(input); panel.append(label)
    return input
  }
  const title = field("链接标题", target.title), url = field("URL", target.href ?? "")
  url.inputMode = "url"
  const hint = document.createElement("p")
  hint.textContent = "修改标题会移除非共有的混合格式；保留标题则保留原格式。"
  const error = document.createElement("p")
  error.setAttribute("role", "alert"); error.hidden = true
  const actions = document.createElement("div")
  actions.className = "hn-editor-toolbar-row"
  panel.append(hint, error, actions)
  const button = (name: string, run: () => void) => {
    const control = document.createElement("button")
    control.type = "button"; control.textContent = name
    control.addEventListener("click", run); actions.append(control)
    return control
  }
  const transaction = ({ transaction: tr }: { transaction: Transaction }) => {
    if (tr.docChanged && !submitting) stale = true
  }
  const close = (restore = true) => {
    if (closed) return
    closed = true
    editor.off("transaction", transaction)
    editor.off("destroy", destroy)
    document.removeEventListener("pointerdown", outside, true)
    window.removeEventListener("resize", position)
    window.visualViewport?.removeEventListener("resize", position)
    window.visualViewport?.removeEventListener("scroll", position)
    panel.remove(); onClose()
    if (restore && !editor.isDestroyed && editor.view.dom.isConnected) editor.view.focus()
  }
  const destroy = () => close(false)
  const outside = (event: Event) => { if (event.target instanceof globalThis.Node && !panel.contains(event.target)) close(false) }
  const submit = (remove = false) => {
    if (composing) return
    submitting = true
    const result = commitLink(editor, target, title.value, url.value, stale, remove)
    submitting = false
    if (result.ok) close()
    else { error.textContent = result.message; error.hidden = false }
  }
  button("保存", () => submit())
  if (target.href !== null) button("移除链接", () => submit(true))
  button("取消", () => close())
  panel.addEventListener("submit", event => { event.preventDefault(); submit() })
  panel.addEventListener("compositionstart", () => { composing = true })
  panel.addEventListener("compositionend", () => { composing = false })
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === "Tab") {
      const controls = Array.from(panel.querySelectorAll<HTMLElement>("input, button"))
      const index = controls.indexOf(document.activeElement as HTMLElement)
      event.preventDefault()
      controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length]?.focus()
    }
  })
  const rect = anchor.getBoundingClientRect()
  ;(editor.view.dom.closest(".hn-editor") ?? editor.view.dom.parentElement ?? document.body).append(panel)
  const position = () => {
    const viewport = window.visualViewport
    const left = (viewport?.offsetLeft ?? 0) + 8, top = (viewport?.offsetTop ?? 0) + 8
    const width = Math.max(0, (viewport?.width ?? window.innerWidth) - 16)
    const height = Math.max(0, (viewport?.height ?? window.innerHeight) - 16)
    panel.style.width = `${Math.min(360, width)}px`
    panel.style.maxHeight = `${height}px`
    const size = panel.getBoundingClientRect()
    panel.style.left = `${Math.max(left, Math.min(rect.left, left + width - size.width))}px`
    panel.style.top = `${Math.max(top, Math.min(rect.bottom + 4, top + height - size.height))}px`
  }
  position()
  window.addEventListener("resize", position)
  window.visualViewport?.addEventListener("resize", position)
  window.visualViewport?.addEventListener("scroll", position)
  editor.on("transaction", transaction)
  editor.on("destroy", destroy)
  document.addEventListener("pointerdown", outside, true)
  title.focus()
  return () => close(false)
}
