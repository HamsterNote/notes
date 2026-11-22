import type { Editor } from "@tiptap/core"
import type { Transaction } from "@tiptap/pm/state"
import { isSafeHnnUrl } from "../hnn/urlPolicy"
import { deleteLinkBlock, openLinkEditor, resolveLinkTarget, type LinkTarget } from "./linkEditing"
import type { HostReferenceActivation } from "./types"

export type LinkBlockInteractionOptions = Readonly<{
  activate?: (reference: HostReferenceActivation) => void
  openExternal?: (href: string) => void
}>

export function openExternalLink(href: string): void {
  if (href.startsWith("mailto:")) {
    window.location.assign(href)
    return
  }
  window.open(href, "_blank", "noopener,noreferrer")
}

function validTarget(editor: Editor, target: LinkTarget): boolean {
  return !editor.isDestroyed && target.editor === editor && target.doc === editor.state.doc &&
    target.href !== null && isSafeHnnUrl(target.href)
}

export function installLinkBlockInteractions(
  editor: Editor,
  options: LinkBlockInteractionOptions = {}
): () => void {
  const view = editor.view
  let closeCurrent: (() => void) | null = null

  const open = (anchor: HTMLAnchorElement, position: number): void => {
    const target = resolveLinkTarget(editor, { position, allowReadOnly: true })
    if (!target?.href) return
    closeCurrent?.()
    const panel = document.createElement("div")
    panel.className = "hn-editor-link-dialog hn-editor-link-popover"
    panel.setAttribute("role", "dialog")
    panel.setAttribute("aria-label", "链接操作")
    const error = document.createElement("p")
    error.setAttribute("role", "alert")
    error.hidden = true
    const row = document.createElement("div")
    row.className = "hn-editor-toolbar-row"
    panel.append(error, row)
    let closed = false
    const close = (restoreFocus = true): void => {
      if (closed) return
      closed = true
      editor.off("transaction", onTransaction)
      editor.off("destroy", onDestroy)
      document.removeEventListener("pointerdown", outside, true)
      document.removeEventListener("scroll", positionPanel, true)
      window.removeEventListener("resize", positionPanel)
      window.visualViewport?.removeEventListener("resize", positionPanel)
      window.visualViewport?.removeEventListener("scroll", positionPanel)
      observer?.disconnect()
      panel.remove()
      if (closeCurrent === close) closeCurrent = null
      if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true })
    }
    const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
      if (transaction.docChanged) close(false)
    }
    const onDestroy = (): void => close(false)
    const outside = (event: Event): void => {
      if (event.target instanceof globalThis.Node && !panel.contains(event.target)) close(false)
    }
    const add = (label: string, run: () => void, disabled = false): void => {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = label
      button.disabled = disabled
      button.addEventListener("click", run)
      row.append(button)
    }
    add("跳转", () => {
      if (!validTarget(editor, target)) { close(false); return }
      const href = target.href!
      close()
      if (href.startsWith("hnmagic:")) options.activate?.({ kind: "hnmagic", href })
      else (options.openExternal ?? openExternalLink)(href)
    })
    add("编辑", () => {
      if (!view.editable || view.composing || !validTarget(editor, target)) return
      close(false)
      editor.commands.setTextSelection({ from: target.from, to: target.to })
      openLinkEditor(editor, anchor, () => undefined)
    }, !view.editable)
    add("删除", () => {
      if (!view.editable || view.composing || !validTarget(editor, target)) return
      const result = deleteLinkBlock(editor, target)
      if (result.ok) close(false)
      else { error.textContent = result.message; error.hidden = false }
    }, !view.editable)
    panel.addEventListener("keydown", event => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      close()
    })
    ;(view.dom.closest(".hn-editor") ?? view.dom.parentElement ?? document.body).append(panel)
    const positionPanel = (): void => {
      if (!anchor.isConnected) { close(false); return }
      const rect = anchor.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 8
      const top = (viewport?.offsetTop ?? 0) + 8
      const width = Math.max(0, (viewport?.width ?? window.innerWidth) - 16)
      const height = Math.max(0, (viewport?.height ?? window.innerHeight) - 16)
      panel.style.maxWidth = `${width}px`
      panel.style.maxHeight = `${height}px`
      const size = panel.getBoundingClientRect()
      panel.style.left = `${Math.max(left, Math.min(rect.left, left + width - size.width))}px`
      panel.style.top = `${Math.max(top, Math.min(rect.bottom + 4, top + height - size.height))}px`
    }
    positionPanel()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionPanel)
    observer?.observe(view.dom)
    observer?.observe(anchor)
    editor.on("transaction", onTransaction)
    editor.on("destroy", onDestroy)
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("scroll", positionPanel, true)
    window.addEventListener("resize", positionPanel)
    window.visualViewport?.addEventListener("resize", positionPanel)
    window.visualViewport?.addEventListener("scroll", positionPanel)
    closeCurrent = close
    panel.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
  }

  const resolveAnchor = (target: EventTarget | null): { anchor: HTMLAnchorElement; position: number } | null => {
    if (!(target instanceof Element)) return null
    const anchor = target.closest("a[href]")
    if (!(anchor instanceof HTMLAnchorElement) || !view.dom.contains(anchor)) return null
    try {
      return { anchor, position: view.posAtDOM(anchor, 0) }
    } catch {
      return null
    }
  }
  const onClick = (event: MouseEvent): void => {
    const hit = resolveAnchor(event.target)
    if (!hit) return
    event.preventDefault()
    event.stopPropagation()
    open(hit.anchor, hit.position)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return
    const hit = resolveAnchor(event.target)
    if (!hit) return
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat && !event.isComposing && !view.composing) open(hit.anchor, hit.position)
  }
  const onAuxClick = (event: MouseEvent): void => {
    if (resolveAnchor(event.target)) event.preventDefault()
  }
  view.dom.addEventListener("click", onClick, true)
  view.dom.addEventListener("keydown", onKeyDown, true)
  view.dom.addEventListener("auxclick", onAuxClick, true)
  return () => {
    closeCurrent?.()
    closeCurrent = null
    view.dom.removeEventListener("click", onClick, true)
    view.dom.removeEventListener("keydown", onKeyDown, true)
    view.dom.removeEventListener("auxclick", onAuxClick, true)
  }
}
