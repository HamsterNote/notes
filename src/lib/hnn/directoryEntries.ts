import type { Node as ProseMirrorNode } from "@tiptap/pm/model"

export interface HnnDirectoryEntry {
  nodeId: string
  level: number
  text: string
  position: number
}

/**
 * directory 不持久化条目。每次渲染或需要时从当前 PM 文档 heading 派生本视图模型。
 */
export function deriveHnnDirectoryEntries(document: ProseMirrorNode): HnnDirectoryEntry[] {
  const entries: HnnDirectoryEntry[] = []
  document.descendants((node, position) => {
    if (node.type.name !== "heading") return
    const nodeId: unknown = node.attrs["nodeId"]
    const level: unknown = node.attrs["level"]
    if (typeof nodeId !== "string" || typeof level !== "number") return
    entries.push({
      nodeId,
      level,
      text: node.textContent || "未命名标题",
      position
    })
  })
  return entries
}
