import { Schema, type MarkSpec, type NodeSpec } from "@tiptap/pm/model"

/**
 * HNN v1 唯一可持久化 schema。attrs 故意只列出必要数据，未来 NodeView/UI
 * 只能消费这些数据而不能把运行时状态、目录快照或任意宿主扩展写进 HNN。
 */
// PM 必须能生成 block+ 的填充节点；这些默认值只服务于 schema 内容表达式。
// codec 预校验仍要求 HNN JSON 显式给出每个持久 attr，绝不接受默认值持久化。
const requiredAttr = { default: null }
const nodeId = { nodeId: requiredAttr }

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  text: { group: "inline" },
  paragraph: { group: "block", content: "inline*", attrs: nodeId },
  heading: {
    group: "block",
    content: "inline*",
    attrs: { ...nodeId, level: requiredAttr }
  },
  bulletList: { group: "block", content: "listItem+", attrs: nodeId },
  orderedList: {
    group: "block",
    content: "listItem+",
    attrs: { ...nodeId, start: requiredAttr }
  },
  listItem: { content: "paragraph block*", attrs: nodeId },
  blockquote: { group: "block", content: "block+", attrs: nodeId },
  codeBlock: {
    group: "block",
    content: "text*",
    marks: "",
    attrs: { ...nodeId, language: requiredAttr, filename: requiredAttr }
  },
  horizontalRule: { group: "block", atom: true, attrs: nodeId },
  hardBreak: { group: "inline", inline: true, atom: true, selectable: false, attrs: nodeId },
  table: { group: "block", content: "tableRow+", attrs: nodeId },
  tableRow: { content: "(tableHeader | tableCell)+", attrs: nodeId },
  tableHeader: { content: "block+", attrs: nodeId },
  tableCell: { content: "block+", attrs: nodeId },
  taskList: { group: "block", content: "taskItem+", attrs: nodeId },
  taskItem: { content: "paragraph block*", attrs: { ...nodeId, checked: requiredAttr } },
  callout: {
    group: "block",
    content: "block+",
    attrs: { ...nodeId, tone: requiredAttr, title: requiredAttr }
  },
  collapsible: {
    group: "block",
    content: "block+",
    attrs: { ...nodeId, title: requiredAttr, collapsed: requiredAttr }
  },
  formula: { group: "block", atom: true, attrs: { ...nodeId, latex: requiredAttr } },
  inlineFormula: {
    group: "inline",
    inline: true,
    atom: true,
    marks: "",
    attrs: { ...nodeId, latex: requiredAttr }
  },
  picture: { group: "block", atom: true, attrs: { ...nodeId, src: requiredAttr, alt: requiredAttr } },
  card: { group: "block", atom: true, attrs: { ...nodeId, data: requiredAttr } },
  drawing: { group: "block", atom: true, attrs: { ...nodeId, data: requiredAttr } },
  // directory 只保留展示配置，条目必须由当前文档 heading 在运行时派生。
  directory: { group: "block", atom: true, attrs: { ...nodeId, config: requiredAttr } },
  mention: {
    group: "inline",
    inline: true,
    atom: true,
    marks: "",
    attrs: { ...nodeId, resourceId: requiredAttr, name: requiredAttr }
  },
  resource: {
    group: "block",
    atom: true,
    attrs: { ...nodeId, resourceId: requiredAttr, name: requiredAttr }
  },
  externalItem: {
    group: "block",
    atom: true,
    attrs: { ...nodeId, resourceId: requiredAttr, name: requiredAttr }
  }
}

const marks: Record<string, MarkSpec> = {
  bold: {},
  italic: {},
  strike: {},
  // code 是排他的，防止链接等 mark 在代码片段上产生含混持久化语义。
  code: { excludes: "_" },
  link: { attrs: { href: requiredAttr } }
}

export const hnnSchema = new Schema({ nodes, marks })

export const HNN_NODE_TYPES = new Set(Object.keys(nodes))
export const HNN_MARK_TYPES = new Set(Object.keys(marks))
