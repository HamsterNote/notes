import type { Editor } from "@tiptap/core"

// Body input stays locked while a drawer is open. The owning session separately
// authorizes its synchronous draft commit, including replication to peer views.
const documentPermissions = new WeakMap<Editor, () => boolean>()

export function registerHnnTransactionPermission(editor: Editor, allowed: () => boolean): () => void {
  documentPermissions.set(editor, allowed)
  return () => { documentPermissions.delete(editor) }
}

export function canApplyHnnTransaction(editor: Editor): boolean {
  return !editor.isDestroyed && (documentPermissions.get(editor)?.() ?? editor.view.editable)
}
