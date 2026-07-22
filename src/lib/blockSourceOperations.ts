/**
 * 基于区 BlockSource（block / todo-item / quote-line）的整体块级操作：
 * - 删除（deleteBlockSource）：移除 source 所在的承载块并通过 NoteBlockFocus 解析后续焦点
 * - 创建副本（duplicateBlockSource）：在承载块下方深拷贝一份，所有 id 重新生成
 *
 * 设计决策：根据 BlockSource 简化语义，"删除当前 block"固定指其承载块。
 * 即：
 *   source.kind === "block"      → 直接操作该块
 *   source.kind === "todo-item"  → 操作承载它的 todo 块
 *   source.kind === "quote-line" → 操作承载它的 quote 块
 * 这样不会出现"删了某 todo item 之后块变空"的边界场景。
 */

import type { BlockSource } from "./blockSourceConversion"
import type { DeletionFocusTarget } from "./NoteBlockFocus"
import { resolveDeletionFocus } from "./NoteBlockFocus"
import { createNoteId } from "./noteId"
import type { NoteBlock, NoteTodoItem } from "./types"
import { assertNever } from "./utils"

// ===== 公共输入 / 输出类型 =====

type DeleteBlockSourceInput = {
  readonly blocks: readonly NoteBlock[]
  readonly source: BlockSource
}

type DeleteBlockSourceResult = {
  readonly blocks: NoteBlock[]
  /** 删除后需要被聚焦的可编辑位置；为 undefined 表示当前无可聚焦对象（例如笔记被清空） */
  readonly focusTarget: DeletionFocusTarget | undefined
}

type DuplicateBlockSourceInput = {
  readonly blocks: readonly NoteBlock[]
  readonly source: BlockSource
}

type DuplicateBlockSourceResult = {
  readonly blocks: NoteBlock[]
  /** 新克隆块的 id；调用方可基于此 id 进行焦点切换 */
  readonly focusBlockId: string | undefined
}

// ===== 内部工具 =====

/**
 * 解析 BlockSource 指向的"承载块 id"。
 * 三种 source kind 的承载块都是 `source.blockId`，
 * 这个函数主要起显式语义解释作用，便于后续读者理解。
 */
const resolveSourceBlockId = (source: BlockSource): string => source.blockId

/**
 * 深拷贝单个 block 并为它（以及内部子结构）分配全新的 id。
 *
 * - todo 块：除 block id 外，每条 item 都要重新生成 id，
 *   避免副本 item 与原 item id 冲突。
 * - quote 块：line id 派生自 block id（参考 quoteLineId），改 block id 自动产生新 line id。
 * - table / callout / code / formula / picture / heading / paragraph 等：
 *   只需要替换 block.id，其他 readonly 字段共享引用是安全的（不可变更新语义）。
 */
const cloneBlockWithNewId = (block: NoteBlock): NoteBlock => {
  const newId = createNoteId()
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "unorderedList":
    case "orderedList":
    case "code":
    case "callout":
    case "table":
    case "formula":
    case "picture":
    case "card":
    case "drawing":
    case "directory":
      // 无 id 子结构：仅替换 block.id 即可
      return { ...block, id: newId }
    case "todo":
    case "checklist": {
      // 为每条 item 生成新 id，保持 item 内容文本/勾选状态不变
      const items: NoteTodoItem[] = block.items.map((item) => ({
        ...item,
        id: createNoteId()
      }))
      return { ...block, id: newId, items }
    }
    case "quote":
      // quote lines 用 quoteLineId(blockId, lineIndex) 派生 id，
      // 改 blockId 即得到所有 line 新 id
      return { ...block, id: newId }
    case "collapsible": {
      // 递归克隆内部子块，确保嵌套块（含子 collapsible）都拿到全新 id
      const blocks = block.blocks.map((child) => cloneBlockWithNewId(child))
      return { ...block, id: newId, blocks }
    }
    default:
      return assertNever(block)
  }
}

// ===== 导出操作 =====

/**
 * 删除 BlockSource 指向的承载块，返回新的 blocks 数组与应被聚焦的目标。
 *
 * 若 source 的承载块不存在（已并发移除），原样返回 blocks 且不产生 focusTarget，
 * 调用方应当忽略本次删除请求，避免阻塞后续交互。
 */
export const deleteBlockSource = ({
  blocks,
  source
}: DeleteBlockSourceInput): DeleteBlockSourceResult => {
  const sourceBlockId = resolveSourceBlockId(source)
  const nextBlocks = blocks.filter((block) => block.id !== sourceBlockId)

  // 未找到承载块时避免触发多余的 onBlocksChange
  if (nextBlocks.length === blocks.length) {
    return { blocks: nextBlocks, focusTarget: undefined }
  }

  // 复用 NoteBlockFocus 中的"删除后聚焦"启发式：
  // 优先聚焦下一个可编辑块；否则回退到前一个；再否则到首个可编辑块
  const focusTarget = resolveDeletionFocus({
    after: nextBlocks,
    before: blocks,
    sourceId: sourceBlockId
  })

  return { blocks: nextBlocks, focusTarget }
}

/**
 * 在 BlockSource 指向的承载块下方插入一份深拷贝。
 * 副本的 block id 与 todo items id 都重新生成，确保与原块无 id 冲突。
 *
 * 返回新的 blocks 数组与副本块的 id；调用方基于 focusBlockId 切换焦点。
 */
export const duplicateBlockSource = ({
  blocks,
  source
}: DuplicateBlockSourceInput): DuplicateBlockSourceResult => {
  const sourceBlockId = resolveSourceBlockId(source)
  const sourceIndex = blocks.findIndex((block) => block.id === sourceBlockId)

  // 未找到承载块时无可复制对象，原样返回（不阻塞后续逻辑）
  if (sourceIndex < 0) {
    return { blocks: [...blocks], focusBlockId: undefined }
  }

  const sourceBlock = blocks[sourceIndex]
  if (sourceBlock === undefined) {
    return { blocks: [...blocks], focusBlockId: undefined }
  }

  const clone = cloneBlockWithNewId(sourceBlock)

  // 紧接原块下方插入副本
  const nextBlocks: NoteBlock[] = blocks.slice()
  nextBlocks.splice(sourceIndex + 1, 0, clone)

  return { blocks: nextBlocks, focusBlockId: clone.id }
}
