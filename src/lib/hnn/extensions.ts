import { Extension, getSchema, Node, type Extensions } from "@tiptap/core"
import Link from "@tiptap/extension-link"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import StarterKit from "@tiptap/starter-kit"
import { createHnnNodeIdPlugin, HNN_NODE_ID_TYPES, normalizeInitialHnnContent } from "./nodeId"
import { isSafeHnnUrl } from "./urlPolicy"

const nodeIdAttr = { default: null }
const persistentNodeTypes = [...HNN_NODE_ID_TYPES]

function buildHnnExtensions(includeUndoRedo: boolean): Extensions {
  // HNN 只持久化 href，不能让 Link 的 HTML 展示 attrs 进入 PM JSON。
  const HnnLink = Link.extend({
    addAttributes() {
      return {
        href: { default: null }
      }
    }
  }).configure({
    autolink: false,
    linkOnPaste: false,
    openOnClick: false,
    protocols: ["hnmagic"],
    isAllowedUri: (url: string) => isSafeHnnUrl(url)
  })

  const HnnCodeBlock = Node.create({
    name: "codeBlock",
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    addAttributes() {
      return {
        language: { default: "plaintext" },
        filename: { default: "untitled" }
      }
    },
    renderHTML({ HTMLAttributes }) {
      return ["pre", HTMLAttributes, ["code", 0]]
    }
  })

  const customBlock = (name: string, attrs: Record<string, unknown>, content = ""): Node =>
    Node.create({
      name,
      group: "block",
      atom: content === "",
      content: content || undefined,
      addAttributes: () => attrs,
      // Phase 5 仅提供无交互的安全 DOM 表示；正式 NodeView 归入后续内容界面阶段。
      renderHTML: ({ HTMLAttributes }) => content
        ? ["div", { ...HTMLAttributes, "data-hnn-node": name }, 0]
        : ["div", { ...HTMLAttributes, "data-hnn-node": name, contenteditable: "false" }, `[${name}]`]
    })
  const customInline = (name: string, attrs: Record<string, unknown>): Node =>
    Node.create({
      name,
      group: "inline",
      inline: true,
      atom: true,
      marks: "",
      addAttributes: () => attrs,
      // 原子行内节点不能执行交互；仅显示可识别、不可编辑的最小占位内容。
      renderHTML: ({ HTMLAttributes }) => ["span", { ...HTMLAttributes, "data-hnn-node": name, contenteditable: "false" }, `[${name}]`]
    })

  const HnnBlockquote = Node.create({
    name: "blockquote",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
      return { nodeId: nodeIdAttr, author: { default: null } }
    },
    renderHTML({ HTMLAttributes }) {
      return ["blockquote", HTMLAttributes, 0]
    }
  })

  const HnnNodeIds = Extension.create({
    name: "hnnNodeIds",
    priority: 10_000,
    addGlobalAttributes() {
      return [{
        types: persistentNodeTypes,
        attributes: { nodeId: nodeIdAttr }
      }]
    },
    addProseMirrorPlugins() {
      return [createHnnNodeIdPlugin()]
    },
    onBeforeCreate() {
      // 此时 Tiptap 尚未创建 EditorState；直接替换 JSON 避免初始文档产生修复历史。
      this.editor.options.content = normalizeInitialHnnContent(this.editor.options.content)
    }
  })

  return [
    StarterKit.configure({
      codeBlock: false,
      blockquote: false,
      link: false,
      dropcursor: false,
      gapcursor: false,
      // codec schema 不需要 history；编辑会话仅通过此封闭装配启用官方 UndoRedo。
      undoRedo: includeUndoRedo ? {} : false,
      underline: false,
      trailingNode: false
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    HnnBlockquote,
    HnnLink,
    HnnCodeBlock,
    customBlock("callout", { tone: { default: "info" }, title: { default: "Callout" } }, "block+"),
    customBlock("collapsible", { title: { default: "Details" }, collapsed: { default: false } }, "block+"),
    customBlock("formula", { latex: { default: "0" } }),
    customInline("inlineFormula", { latex: { default: "0" } }),
    customBlock("picture", { src: { default: "https://example.invalid/" }, alt: { default: "Image" } }),
    customBlock("card", { data: { default: "{}" } }),
    customBlock("drawing", { data: { default: "{}" } }),
    customBlock("directory", { config: { default: "headings" } }),
    customInline("mention", { resourceId: { default: "resource" }, name: { default: "Resource" } }),
    customInline("resource", { resourceId: { default: "resource" }, name: { default: "Resource" } }),
    customBlock("externalItem", { resourceId: { default: "external" }, name: { default: "External item" } }),
    HnnNodeIds
  ]
}

/** 只包含未来 HNN v1 可持久化结构的封闭 runtime extension 集合。 */
export function createHnnExtensions(): Extensions {
  return buildHnnExtensions(false)
}

/** 编辑会话专用的闭合装配；宿主没有扩展、schema 或 history 注入入口。 */
export function createHnnEditorExtensions(): Extensions {
  return buildHnnExtensions(true)
}

/** schema 只可从同一封闭 runtime extension 集合取得。 */
export const hnnRuntimeSchema = getSchema(createHnnExtensions())

export const HNN_NODE_TYPES = new Set(Object.keys(hnnRuntimeSchema.nodes))
export const HNN_MARK_TYPES = new Set(Object.keys(hnnRuntimeSchema.marks))
