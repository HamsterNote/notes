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
 * - 文本块互转保留无损校验；复合块转文本块显式展平为正文纯文本（有损提示），
 *   引用目标无损包裹原块。所有转换走预算化事务与独立撤销边界。
 * - “下一行”包含表格/公式/图像：表格和公式用预算化单事务插入当前块之后；
 *   图像按 nodeId 打开确认模态框，确认后才进入统一上传通道。
 *
 * 所有变更都在激活瞬间重新解析 getPos 与当前文档：菜单打开期间的外部文档变化
 * 不会落到错位目标；只读会话在 blockReorder 侧已拦截，这里仍逐条 double-guard。
 */

import type { Editor } from "@tiptap/core"
import { type Node as ProseMirrorNode, type NodeType } from "@tiptap/pm/model"

import { encodeHnn } from "../hnn/codec"
import {
  captureChainTransaction,
  commitBudgetedTransaction,
  installHnnBudgetEncoder
} from "../hnn/budgetedTransaction"
import { openAnchoredMenu, type AnchoredMenuEntry, type AnchoredMenuHandle } from "../hnn/menuPopover"
import { reorderTopLevelBlock } from "./blockReorder"
import { CONVERSION_TARGETS, TEXT_BLOCK_TYPES, isLosslessConversion } from "./blockConversion"
import { openBlockDelete } from "./blockDelete"
import { isList, listConversionItems } from "./listCommands"

// 注入严格 HNN 编码器：见 budgetedTransaction 文件头“模块加载环”。blockMenu 不在
// extensions 的静态加载链上（extensions → tableEdgeControls），因此可安全 import codec，
// 并在任何 EditorSession 构造前完成注入。tableEdgeControls 与 blockMenu 共用同一预检。
installHnnBudgetEncoder(encodeHnn)

export interface BlockMenuCapabilities {
  readonly canUploadPicture: () => boolean
  readonly openPictureDialog: (nodeId: string, anchor: HTMLElement) => boolean
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

/** 复合容器才可有损展平；图片、画板等无正文的原子块不在此路径。 */
function canFlatten(node: ProseMirrorNode, targetType: NodeType): boolean {
  return !TEXT_BLOCK_TYPES.has(node.type.name) && node.isBlock && !node.isLeaf &&
    TEXT_BLOCK_TYPES.has(targetType.name)
}

/** 只取正文，块属性不混入正文；原子内联节点用其可读文本替代。 */
function flattenedText(node: ProseMirrorNode): string {
  return node.textBetween(0, node.content.size, "\n", (leaf) => {
    if (leaf.type.name === "hardBreak") return "\n"
    if (leaf.type.name === "inlineFormula" || leaf.type.name === "formula") return String(leaf.attrs["latex"] ?? "")
    return String(leaf.attrs["name"] ?? leaf.attrs["alt"] ?? "")
  })
}

export function getBlockCommands(editor: Editor, getPos: () => number | undefined, capabilities: BlockMenuCapabilities, menuAnchor?: HTMLElement) {

  /** 激活瞬间的实时块解析；块已不存在（外部删改）时返回 null，动作整体放弃。 */
  let resolveBlock = (): { pos: number; index: number; count: number; node: import("@tiptap/pm/model").Node } | null => {
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
  if (!initial || editor.isDestroyed || !editor.view.editable) return null
  const nodeId: unknown = initial.node.attrs["nodeId"]
  const resolveInitial = resolveBlock
  // Revalidate identity as well as position; a replacement at the same offset is not our target.
  resolveBlock = () => {
    if (editor.isDestroyed || !editor.view.editable) return null
    const block = resolveInitial()
    return block?.node.attrs["nodeId"] === nodeId ? block : null
  }

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

  const listItems = listConversionItems(editor, () => resolveBlock()?.pos)
  const conversionItems: AnchoredMenuEntry[] = CONVERSION_TARGETS.map((target) => {
    if (target.type === "paragraph" && isList(initial.node)) return listItems.find(item => item.label === "转换为正文")!
    const isTextBlock = TEXT_BLOCK_TYPES.has(initial.node.type.name)
    const targetType = editor.schema.nodes[target.type]
    const flatten = targetType !== undefined && canFlatten(initial.node, targetType)
    const lossless = targetType !== undefined && (isTextBlock || !initial.node.isLeaf) &&
      isLosslessConversion(initial.node, targetType)
    const isCurrent = initial.node.type.name === target.type &&
      (target.type !== "heading" || initial.node.attrs["level"] === target.attrs?.["level"])
    return {
      label: `转换为${target.label}`,
      disabled: (!lossless && !flatten) || isCurrent,
      ...(flatten ? { description: target.type === "heading"
        ? "仅保留正文第一行纯文本；丢弃其余行、嵌套结构、标记和块属性"
        : "正文按换行合并为纯文本；丢弃嵌套结构、标记和块属性" } : {}),
      disabledReason: !isTextBlock
        ? "该块包含复合结构，转换会丢失内容"
        : !lossless
          ? "该块包含标记或内联元素，转换会丢失内容"
          : "当前已是该类型",
      onActivate: () => {
        const block = resolveBlock()
        if (!block || !editor.view.editable) return
        const liveTargetType = editor.schema.nodes[target.type]
        if (!liveTargetType) return
        // 激活瞬间再次按实时块内容复核无损；菜单打开期间的文档变化可令初态可用的
        // 条目变为不兼容（或反之），此时整体放弃，零 doc/selection/history/dirty 变更。
        const flattenLive = canFlatten(block.node, liveTargetType)
        // 有损/无损路径变化后需要重新打开菜单，不能执行未经提示的展平。
        if (flattenLive !== flatten) return
        if (!flattenLive && !isLosslessConversion(block.node, liveTargetType)) return
        const { pos, node } = block
        // 单事务：无损路径保留内容/属性；有损路径只保留外层nodeId与提取的纯文本。
        // captureChainTransaction 只捕获不 dispatch，commitBudgetedTransaction 补齐新
        // 节点 ID、encodeHnn 整文档预算预检通过后才提交（含 512 节点/外壳上限）。
        const candidate = captureChainTransaction(editor, (chain) =>
          chain.command(({ tr }) => {
            if (flattenLive) {
              const text = flattenedText(node)
              const value = liveTargetType.name === "heading" ? text.split("\n", 1)[0]! : text
              const replacement = liveTargetType.create(
                { nodeId: node.attrs["nodeId"] as unknown, ...target.attrs },
                value ? editor.schema.text(value) : null
              )
              tr.replaceWith(pos, pos + node.nodeSize, replacement)
              return true
            }
            if (liveTargetType.name === "blockquote") {
              const range = tr.doc.resolve(pos).blockRange(tr.doc.resolve(pos + node.nodeSize))
              if (!range) return false
              // wrap 映射光标到原文本块内部；新外层 ID 由预算事务补齐，不复用子节点 ID。
              tr.wrap(range, [{ type: liveTargetType }])
              return true
            }
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
  conversionItems.push(...listItems.filter(item => item.label !== "转换为正文"))
  // A handle anchors every direct item: there is no preceding item for sinking.
  // Lifting the whole top-level container is the same lossless unwrap operation.
  const indentItems: AnchoredMenuEntry[] = isList(initial.node) ? [
    { label: "缩进", disabled: true, disabledReason: "整个列表没有前置同层项" },
    { ...listItems.find(item => item.label === "转换为正文")!, label: "反缩进" }
  ] : []

  /** 当前块之后的插入点（实时解析）。 */
  const insertPosAfterBlock = (): number | null => {
    const block = resolveBlock()
    if (!block) return null
    return block.pos + block.node.nodeSize
  }

  const insertItems: AnchoredMenuEntry[] = [
    {
      label: "表格",
      onActivate: () => {
        const pos = insertPosAfterBlock()
        if (pos === null || !editor.view.editable) return
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
      label: "公式",
      onActivate: () => {
        const pos = insertPosAfterBlock()
        if (pos === null || !editor.view.editable) return
        const candidate = captureChainTransaction(editor, (chain) =>
          chain.insertContentAt(pos, { type: "formula" })
        )
        if (candidate) commitBudgetedTransaction(editor, candidate)
      }
    },
    {
      label: "图像",
      disabled: !capabilities.canUploadPicture(),
      disabledReason: "宿主未提供图片上传能力",
      onActivate: () => {
        const block = resolveBlock()
        if (!block || !editor.view.editable || !capabilities.canUploadPicture()) return
        const targetId: unknown = block.node.attrs["nodeId"]
        const returnFocus = menuAnchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : document.body)
        if (typeof targetId === "string") capabilities.openPictureDialog(targetId, returnFocus)
      }
    }
  ]

  return { moveItems, conversionItems, insertItems, indentItems }
}

export function openBlockMenu(options: OpenBlockMenuOptions): AnchoredMenuHandle | null {
  const { editor, anchor, getPos, capabilities, onClosed } = options
  const commands = getBlockCommands(editor, getPos, capabilities, anchor)
  if (!commands) return null
  const initialId: unknown = editor.state.doc.nodeAt(getPos()!)?.attrs["nodeId"]
  return openAnchoredMenu({
    anchor,
    items: [...commands.moveItems, ...commands.indentItems, "divider", {
      label: "转换为",
      children: commands.conversionItems
    }, "divider", {
      label: "下一行",
      children: commands.insertItems
    }, "divider", {
      label: "删除",
      danger: true,
      onActivate: () => {
        const pos = getPos()
        const node = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null
        const id: unknown = node?.attrs["nodeId"]
        if (typeof id === "string" && id === initialId) openBlockDelete(editor, id, anchor)
      }
    }],
    ariaLabel: "块操作菜单",
    onClose: onClosed
  })
}
