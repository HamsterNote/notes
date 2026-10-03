import { EditorState, Plugin, PluginKey, Transaction } from "@tiptap/pm/state"
import { Fragment, Node as ProseMirrorNode, Slice } from "@tiptap/pm/model"
import { UUID_V4_PATTERN } from "./limits"

/** 所有 HNN 持久节点（包括 inline atom hardBreak）都由全局 attr 持有 nodeId。 */
export const HNN_NODE_ID_TYPES = [
  "paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote",
  "codeBlock", "horizontalRule", "hardBreak", "table", "tableRow", "tableHeader",
  "tableCell", "taskList", "taskItem", "callout", "collapsible", "formula",
  "inlineFormula", "picture", "card", "drawing", "directory", "mention", "resource",
  "externalItem"
] as const

const HNN_NODE_ID_TYPE_SET = new Set<string>(HNN_NODE_ID_TYPES)

export function isHnnPersistentNodeName(name: string): boolean {
  return HNN_NODE_ID_TYPE_SET.has(name)
}

/** 不依赖旧模块的 RFC 4122 UUID-v4 生成器。 */
export function createHnnNodeId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 在 Tiptap 创建 EditorState 前规范化 JSON 初始文档，避免初始内容漏过 transaction 插件。 */
export function normalizeInitialHnnContent(content: unknown): Record<string, unknown> {
  // Editor 可以直接接收同一 @tiptap/pm/model 实例的 Node；先转成 JSON，不能把它降级为空文档。
  const source: unknown = content instanceof ProseMirrorNode ? content.toJSON() : content
  const root = source && typeof source === "object" && !Array.isArray(source)
    ? structuredClone(source) as Record<string, unknown>
    : { type: "doc", content: [{ type: "paragraph" }] }
  const seen = new Set<string>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    const node = value as Record<string, unknown>
    const type = node["type"]
    if (typeof type === "string" && isHnnPersistentNodeName(type)) {
      const attrs = node["attrs"] && typeof node["attrs"] === "object" && !Array.isArray(node["attrs"])
        ? node["attrs"] as Record<string, unknown>
        : {}
      const nodeId = attrs["nodeId"]
      attrs["nodeId"] = typeof nodeId === "string" && UUID_V4_PATTERN.test(nodeId) && !seen.has(nodeId)
        ? nodeId
        : uniqueNodeId(seen)
      seen.add(attrs["nodeId"] as string)
      node["attrs"] = attrs
    }
    if (typeof type === "string" && ["hardBreak", "inlineFormula", "mention", "resource"].includes(type)) delete node["marks"]
    if (Array.isArray(node["content"])) node["content"].forEach(visit)
  }
  visit(root)
  return root
}

function uniqueNodeId(existing: Set<string>): string {
  let nodeId = createHnnNodeId()
  while (existing.has(nodeId)) nodeId = createHnnNodeId()
  existing.add(nodeId)
  return nodeId
}

function collectValidNodeIds(document: ProseMirrorNode): Set<string> {
  const ids = new Set<string>()
  document.descendants((node) => {
    if (!isHnnPersistentNodeName(node.type.name)) return
    const nodeId: unknown = node.attrs["nodeId"]
    if (typeof nodeId === "string" && UUID_V4_PATTERN.test(nodeId) && !ids.has(nodeId)) ids.add(nodeId)
  })
  return ids
}

/** 将 Slice 内每个持久节点重写为新 UUID，确保不复用源或当前目标文档的身份。 */
export function rewritePastedHnnNodeIds(slice: Slice, existingIds: ReadonlySet<string> = new Set()): Slice {
  const used = new Set(existingIds)
  const rewrite = (node: ProseMirrorNode): ProseMirrorNode => {
    if (node.isText) return node
    const content = node.content.size === 0
      ? node.content
      : Fragment.fromArray(Array.from({ length: node.childCount }, (_, index) => rewrite(node.child(index))))
    const attrs = isHnnPersistentNodeName(node.type.name)
      ? { ...node.attrs, nodeId: uniqueNodeId(used) }
      : node.attrs
    return node.type.create(attrs, content, node.isInline && node.isAtom ? [] : node.marks)
  }
  return new Slice(Fragment.fromArray(Array.from({ length: slice.content.childCount }, (_, index) => rewrite(slice.content.child(index)))), slice.openStart, slice.openEnd)
}

/**
 * 修复新建、缺失、非法或重复 nodeId。它只在发现问题时返回 transaction，并标记
 * addToHistory=false，因此初始化与自动修复不产生用户可撤销历史步。
 */
export function createHnnNodeIdPlugin(getExistingIds?: () => ReadonlySet<string>): Plugin {
  return new Plugin({
    key: new PluginKey("hnnNodeIds"),
    state: {
      init(_config, state) {
        // 初始 doc 不会触发 transaction；直接以修复后的 doc 建立 state，因而无历史步。
        return repairHnnDocument(state)?.doc ?? state.doc
      },
      apply(_transaction, value) {
        return value
      }
    },
    appendTransaction(_transactions, _oldState, newState) {
      return repairHnnDocument(newState)
    },
    props: {
      transformPasted(slice) {
        return rewritePastedHnnNodeIds(slice, getExistingIds?.() ?? new Set())
      }
    }
  })
}

/** 统一修复持久身份及不能持久化 marks 的 inline atom；仅在确有改动时返回 transaction。 */
export function repairHnnDocument(state: EditorState): Transaction | null {
  const seen = new Set<string>()
  let transaction = state.tr
  let changed = false
  state.doc.descendants((node, position) => {
    const persistent = isHnnPersistentNodeName(node.type.name)
    const nodeId: unknown = node.attrs["nodeId"]
    const legalId = typeof nodeId === "string" && UUID_V4_PATTERN.test(nodeId) && !seen.has(nodeId)
    if (persistent && legalId) seen.add(nodeId)
    const attrs = persistent && !legalId ? { ...node.attrs, nodeId: uniqueNodeId(seen) } : node.attrs
    const marks = node.isInline && node.isAtom && node.marks.length > 0 ? [] : node.marks
    // text 节点没有 nodeId，不能 setNodeMarkup；只对持久节点与带 mark 的 inline atom 修复。
    if (persistent && !legalId || node.isInline && node.isAtom && marks !== node.marks) {
      transaction = transaction.setNodeMarkup(position, undefined, attrs, marks)
      changed = true
    }
  })
  return changed ? transaction.setMeta("addToHistory", false) : null
}

export function collectHnnNodeIds(document: ProseMirrorNode): Set<string> {
  return collectValidNodeIds(document)
}
