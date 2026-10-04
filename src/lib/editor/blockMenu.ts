/**
 * 块操作菜单（DESIGN.md §9，OpenSpec migrate-to-tiptap-prosemirror 任务 7.5/D9）。
 *
 * 由 blockReorder 的手柄点击/键盘激活打开（installBlockReorder 注入 openMenu），
 * 语义与关闭路径（Esc 回焦/外部点击/scroll/resize）全部由 menuPopover 承担。
 *
 * 菜单能力：
 * - 上移/下移：与拖拽重排共享同一个 reorderTopLevelBlock 提交入口（同一
 *   single-transaction/undo 边界），首/末块禁用并说明原因——这就是键盘可用的
 *   块重排通道（D9）。
 * - 转换为正文/标题/代码块：仅 paragraph/heading/codeBlock 三种文本块之间开放，
 *   并且必须无损——按目标类型的 content 表达式（validContent）与 marks 规则判定：
 *   目标 codeBlock（text*、marks=""）只接受纯文本，源块含 link 等 marks 或
 *   mention/resource/inlineFormula/hardBreak 等内联 atom 时禁用并说明原因；菜单
 *   初态与激活瞬间都复核（文档变化后可从不兼容变兼容或反之）。所有转换经统一
 *   预算化事务（补齐 nodeId + encodeHnn 整文档预检）提交，随后补历史栅栏；绝不
 *   为转换丢弃 marks/内联结构，也绝不产生无法再编码的文档。
 * - 插入表格/公式/图片：插到当前块之后（合法空结构，预算化单事务 + 历史栅栏）；
 *   图片仅宿主提供上传回调时可用（DESIGN.md §12），激活后走与 picker 相同的
 *   hidden input → PictureUploadInstaller.enqueue 通道，占位/失败/重试语义一致。
 *
 * 所有变更都在激活瞬间重新解析 getPos 与当前文档：菜单打开期间的外部文档变化
 * 不会落到错位目标；只读会话在 blockReorder 侧已拦截，这里仍逐条 double-guard。
 */

import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode, NodeType } from "@tiptap/pm/model"

import { encodeHnn } from "../hnn/codec"
import {
  captureChainTransaction,
  commitBudgetedTransaction,
  installHnnBudgetEncoder
} from "../hnn/budgetedTransaction"
import { openAnchoredMenu, type AnchoredMenuEntry, type AnchoredMenuHandle } from "../hnn/menuPopover"
import { reorderTopLevelBlock } from "./blockReorder"

// 注入严格 HNN 编码器：见 budgetedTransaction 文件头“模块加载环”。blockMenu 不在
// extensions 的静态加载链上（extensions → tableEdgeControls），因此可安全 import codec，
// 并在任何 EditorSession 构造前完成注入。tableEdgeControls 与 blockMenu 共用同一预检。
installHnnBudgetEncoder(encodeHnn)

export interface BlockMenuCapabilities {
  /** 宿主是否提供图片上传（决定图片入口可用性，DESIGN.md §12）。 */
  readonly canUploadPicture: () => boolean
  /** 与 picker/paste/drop 相同的上传入队通道；position 为文档内插入点。 */
  readonly enqueuePictures: (files: Iterable<File>, position: number) => readonly string[]
}

export interface OpenBlockMenuOptions {
  readonly editor: Editor
  /** 定位与焦点归还的锚点（块手柄）。 */
  readonly anchor: HTMLElement
  readonly getPos: () => number | undefined
  readonly capabilities: BlockMenuCapabilities
  /** 菜单因任何原因关闭后恰好调用一次（blockReorder 据此复位手柄激活态）。 */
  readonly onClosed: () => void
}

/** 允许互相转换的文本块：内容完全内联，setBlockType 不丢任何结构。 */
const TEXT_BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock"])

interface ConversionTarget {
  readonly type: string
  readonly label: string
  readonly attrs?: Record<string, unknown>
}

const CONVERSION_TARGETS: readonly ConversionTarget[] = [
  { type: "paragraph", label: "正文" },
  { type: "heading", label: "标题 1", attrs: { level: 1 } },
  { type: "heading", label: "标题 2", attrs: { level: 2 } },
  { type: "heading", label: "标题 3", attrs: { level: 3 } },
  { type: "codeBlock", label: "代码块" }
]

/** 目标类型能否无损承接源块内容（切换目标时不丢 marks、mention/resource/inlineFormula/hardBreak）。 */
function isLosslessConversion(node: ProseMirrorNode, targetType: NodeType): boolean {
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

export function openBlockMenu(options: OpenBlockMenuOptions): AnchoredMenuHandle | null {
  const { editor, anchor, getPos, capabilities, onClosed } = options

  /** 激活瞬间的实时块解析；块已不存在（外部删改）时返回 null，动作整体放弃。 */
  const resolveBlock = (): { pos: number; index: number; count: number; node: import("@tiptap/pm/model").Node } | null => {
    const pos = getPos()
    if (typeof pos !== "number") return null
    const doc = editor.state.doc
    const node = doc.nodeAt(pos)
    if (!node) return null
    let index = -1
    let i = 0
    doc.forEach((_child, offset) => {
      if (offset === pos) index = i
      i += 1
    })
    if (index < 0) return null
    return { pos, index, count: doc.childCount, node }
  }

  const initial = resolveBlock()
  if (!initial || !editor.view.editable) return null

  const moveItems: AnchoredMenuEntry[] = [
    {
      label: "上移",
      disabled: initial.index === 0,
      disabledReason: "已是首个块",
      onActivate: () => {
        const block = resolveBlock()
        // boundary 语义：移动到 index-1 之前；reorderTopLevelBlock 自带单事务 +
        // closeHistory + 历史栅栏，与拖拽重排同一 undo 边界。
        if (block && block.index > 0) reorderTopLevelBlock(editor.view, block.index, block.index - 1)
      }
    },
    {
      label: "下移",
      disabled: initial.index >= initial.count - 1,
      disabledReason: "已是末个块",
      onActivate: () => {
        const block = resolveBlock()
        // 移动到 index+1 之后：boundary = index + 2（原始序列中第 boundary 块之前）。
        if (block && block.index < block.count - 1) reorderTopLevelBlock(editor.view, block.index, block.index + 2)
      }
    }
  ]

  const conversionItems: AnchoredMenuEntry[] = CONVERSION_TARGETS.map((target) => {
    const isTextBlock = TEXT_BLOCK_TYPES.has(initial.node.type.name)
    const targetType = editor.schema.nodes[target.type]
    // 初态即按 schema 判定无损：目标 content/marks 承接不了源块内容时禁用并说明原因，
    // 不改变视觉，也绝不静默 flatten。
    const lossless = isTextBlock && targetType !== undefined && isLosslessConversion(initial.node, targetType)
    const isCurrent = initial.node.type.name === target.type &&
      (target.type !== "heading" || initial.node.attrs["level"] === target.attrs?.["level"])
    return {
      label: `转换为${target.label}`,
      disabled: !lossless || isCurrent,
      disabledReason: !isTextBlock
        ? "该块包含复合结构，转换会丢失内容"
        : !lossless
          ? "该块包含标记或内联元素，转换会丢失内容"
          : "当前已是该类型",
      onActivate: () => {
        const block = resolveBlock()
        if (!block || !editor.view.editable) return
        if (!TEXT_BLOCK_TYPES.has(block.node.type.name)) return
        const liveTargetType = editor.schema.nodes[target.type]
        if (!liveTargetType) return
        // 激活瞬间再次按实时块内容复核无损；菜单打开期间的文档变化可令初态可用的
        // 条目变为不兼容（或反之），此时整体放弃，零 doc/selection/history/dirty 变更。
        if (!isLosslessConversion(block.node, liveTargetType)) return
        const { pos, node } = block
        // 单事务：attrs 函数形式保留 nodeId 等既有属性，目标缺的走 schema 默认；
        // 只有目标 content/marks 能完整承接源内容时才走到这里，PM 不会清除任何 marks。
        // captureChainTransaction 只捕获不 dispatch，commitBudgetedTransaction 补齐新
        // 节点 ID、encodeHnn 整文档预算预检通过后才提交（含 512 节点/外壳上限）。
        const candidate = captureChainTransaction(editor, (chain) =>
          chain.command(({ tr }) => {
            tr.setBlockType(pos, pos + node.nodeSize, liveTargetType, (current) => ({
              ...current.attrs,
              ...target.attrs
            }))
            return true
          })
        )
        if (candidate) commitBudgetedTransaction(editor, candidate)
      }
    }
  })

  /** 当前块之后的插入点（实时解析）。 */
  const insertPosAfterBlock = (): number | null => {
    const block = resolveBlock()
    if (!block) return null
    return block.pos + block.node.nodeSize
  }

  const insertItems: AnchoredMenuEntry[] = [
    {
      label: "插入表格",
      onActivate: () => {
        const pos = insertPosAfterBlock()
        if (pos === null || !editor.view.editable) return
        // 合法空结构（2 行 3 列含表头行）；捕获后补齐新节点 ID 并对最终候选整文档
        // encodeHnn 预算预检（节点/表格/512KiB 外壳），成功才单事务提交 + 历史栅栏。
        const cell = (type: string) => ({ type, content: [{ type: "paragraph" }] })
        const candidate = captureChainTransaction(editor, (chain) => chain.insertContentAt(pos, {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("tableHeader"), cell("tableHeader"), cell("tableHeader")] },
            { type: "tableRow", content: [cell("tableCell"), cell("tableCell"), cell("tableCell")] }
          ]
        }))
        if (candidate) commitBudgetedTransaction(editor, candidate)
      }
    },
    {
      label: "插入公式",
      onActivate: () => {
        const pos = insertPosAfterBlock()
        if (pos === null || !editor.view.editable) return
        // 公式块必须携带 codec 要求的非空 latex；省略 attrs 时取 schema 默认占位 "0"，
        // 使最终候选可被 encodeHnn 接受（空串会被严格 codec 拒绝）。点击“编辑公式”
        // 进入既有弹出编辑器改写。
        const candidate = captureChainTransaction(editor, (chain) =>
          chain.insertContentAt(pos, { type: "formula" })
        )
        if (candidate) commitBudgetedTransaction(editor, candidate)
      }
    },
    {
      label: "插入图片",
      disabled: !capabilities.canUploadPicture(),
      disabledReason: "宿主未提供图片上传能力",
      onActivate: () => {
        const pos = insertPosAfterBlock()
        if (pos === null || !capabilities.canUploadPicture()) return
        // 与 NoteEditor picker 同一通道：hidden input → enqueue(files, position)，
        // 占位/失败/重试/abort 语义与既有上传完全一致。
        const input = document.createElement("input")
        input.type = "file"
        input.accept = "image/*"
        input.multiple = true
        input.style.display = "none"
        input.addEventListener("change", () => {
          if (input.files && input.files.length > 0) capabilities.enqueuePictures(input.files, pos)
          input.remove()
        }, { once: true })
        document.body.appendChild(input)
        input.click()
      }
    }
  ]

  return openAnchoredMenu({
    anchor,
    items: [...moveItems, "divider", ...conversionItems, "divider", ...insertItems],
    ariaLabel: "块操作菜单",
    onClose: onClosed
  })
}
