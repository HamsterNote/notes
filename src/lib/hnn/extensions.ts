import { Extension, getSchema, Node, type Extensions } from "@tiptap/core"
import Link from "@tiptap/extension-link"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import StarterKit from "@tiptap/starter-kit"
import { createHnnNodeIdPlugin, HNN_NODE_ID_TYPES, normalizeInitialHnnContent } from "./nodeId"
import { isSafeHnnUrl } from "./urlPolicy"

const nodeIdAttr = { default: null }
const persistentNodeTypes = [...HNN_NODE_ID_TYPES]

/** 只包含未来 HNN v1 可持久化结构的封闭 runtime extension 集合。 */
export function createHnnExtensions(): Extensions {
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
    }
  })

  const customBlock = (name: string, attrs: Record<string, unknown>, content = ""): Node =>
    Node.create({ name, group: "block", atom: content === "", content: content || undefined, addAttributes: () => attrs })
  const customInline = (name: string, attrs: Record<string, unknown>): Node =>
    Node.create({ name, group: "inline", inline: true, atom: true, marks: "", addAttributes: () => attrs })

  const HnnBlockquote = Node.create({
    name: "blockquote",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
      return { nodeId: nodeIdAttr, author: { default: null } }
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
      undoRedo: false,
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

/** schema 只可从同一封闭 runtime extension 集合取得。 */
export const hnnRuntimeSchema = getSchema(createHnnExtensions())

export const HNN_NODE_TYPES = new Set(Object.keys(hnnRuntimeSchema.nodes))
export const HNN_MARK_TYPES = new Set(Object.keys(hnnRuntimeSchema.marks))
