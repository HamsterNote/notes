import { Fragment, type Node as ProseMirrorNode, type NodeType } from "@tiptap/pm/model"

/** 允许互相转换的文本块：内容完全内联，setBlockType 不丢任何结构。 */
export const TEXT_BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock"])

export interface ConversionTarget {
  readonly type: string
  readonly label: string
  readonly attrs?: Record<string, unknown>
}

export const CONVERSION_TARGETS: readonly ConversionTarget[] = [
  { type: "paragraph", label: "正文" },
  { type: "heading", label: "标题 1", attrs: { level: 1 } },
  { type: "heading", label: "标题 2", attrs: { level: 2 } },
  { type: "heading", label: "标题 3", attrs: { level: 3 } },
  { type: "codeBlock", label: "代码块" },
  { type: "blockquote", label: "引用" }
]

/** 目标类型能否无损承接源块内容（切换目标时不丢 marks、mention/resource/inlineFormula/hardBreak）。 */
export function isLosslessConversion(node: ProseMirrorNode, targetType: NodeType): boolean {
  // 引用是容器：原文本块整体作为子节点，保留其类型、attrs、nodeId 与内联结构。
  if (targetType.name === "blockquote") return targetType.validContent(Fragment.from(node))
  // 目标 content 表达式必须整体接受源内容：codeBlock 的 text* 会拒绝 mention/resource/
  // inlineFormula/hardBreak 等内联 atom（validContent 直接给出 schema 层的答案）。
  if (!targetType.validContent(node.content)) return false
  const marksSpec: unknown = targetType.spec.marks
  // marks=""：目标不允许任何 mark，源上不得有带 marks 的文本（如 link/bold），
  // 也不得含内联 atom（atom 不能进 text*，但此处再兜一层，避免未来 schema 漂移）。
  if (marksSpec === "") {
    let lossless = true
    node.descendants((child) => {
      if (lossless && !child.isText && child.isInline) lossless = false
      if (lossless && child.isText && child.marks.length > 0) lossless = false
      return lossless
    })
    return lossless
  }
  // 显式 mark 白名单：源上任何不在白名单内的 mark 都会丢。
  if (Array.isArray(marksSpec)) {
    const allowed = new Set(marksSpec.map((mark) => (mark as { readonly name: string }).name))
    let lossless = true
    node.descendants((child) => {
      if (lossless && child.marks.some((mark) => !allowed.has(mark.type.name))) lossless = false
      return lossless
    })
    return lossless
  }
  // marks 未声明 === 全部 mark 放行（paragraph/heading）。
  return true
}

