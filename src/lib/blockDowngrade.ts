// Phase 2: 在「特殊块（callout / checklist / quote）」的空白编辑点上按 Backspace 时，
// 第一次 Backspace 先把该特殊块降级为普通 paragraph（保留 source 的稳定 id），
// 第二次再走常规的 deleteEmptyTextBlock 路径把该 paragraph 删除。
//
// 这样做的好处是：用户从「我想取消这个特殊块」到「我想删一行」有两次独立的撤销/重做机会，
// 避免一刀切的删除导致未预期地丢失整块或 author/title。

import {
  type BlockSource,
  quoteTextLines
} from "./blockSourceConversion"
import { isVisibleHtmlEmpty } from "./blockEditing"
import { createNoteId } from "./noteId"
import type {
  NoteBlock,
  NoteChecklistBlock,
  NoteQuoteBlock
} from "./types"

/**
 * 三类「可降级」来源对应的行为：
 *  - block & callout：整块变 paragraph
 *  - checklist-item：单 item 整块变 paragraph；多 item 时拆出独立空 paragraph
 *  - quote-line：当前行拆出独立 paragraph；其它行维持 quote 拼接
 */
export type DowngradeResult = {
  readonly blocks: NoteBlock[]
  readonly focusId: string
}

type DowngradeInput = {
  readonly blocks: readonly NoteBlock[]
  readonly source: BlockSource
}

// 判断 source 是否落在「可降级为 paragraph 的特殊块」中，且其对应文本为可见空白。
// quote-line 的 lineIndex 越界返回 false；checklist 的缺失 item 也返回 false。
export const canDowngradeEmptySpecialBlock = (
  blocks: readonly NoteBlock[],
  source: BlockSource
): boolean => {
  const block = blocks.find((b) => b.id === source.blockId)
  if (!block) return false
  switch (source.kind) {
    case "block":
      // 只把 callout 视为可降级特殊块；其他 kind 走常规删除路径
      if (block.kind !== "callout") return false
      return isVisibleHtmlEmpty(block.text)
    case "todo-item":
      return false
    case "checklist-item": {
      if (block.kind !== "checklist") return false
      const item = block.items.find((i) => i.id === source.itemId)
      return item !== undefined && isVisibleHtmlEmpty(item.text)
    }
    case "quote-line": {
      if (block.kind !== "quote") return false
      const lines = quoteTextLines(block.text)
      const line = lines[source.lineIndex]
      return line !== undefined && isVisibleHtmlEmpty(line)
    }
  }
}

// 在 handleEditableBlockKeyDown 的 Backspace 分支里把 sourceId 反解析为 BlockSource：
//   - sourceId 命中 block.id 且为 callout → {kind:"block"}
//   - sourceId 命中 checklist item.id → {kind:"checklist-item"}
// paragraph/heading/code 等非特殊块 / quote-line（quote 走自己的 keydown）返回 undefined。
export const resolveSpecialBlockSourceForBackspace = (
  blocks: readonly NoteBlock[],
  sourceId: string
): BlockSource | undefined => {
  const blockById = blocks.find((b) => b.id === sourceId)
  if (blockById?.kind === "callout") {
    return { kind: "block", blockId: sourceId }
  }
  for (const block of blocks) {
    if (block.kind !== "checklist") continue
    if (block.items.some((item) => item.id === sourceId)) {
      return { kind: "checklist-item", blockId: block.id, itemId: sourceId }
    }
  }
  return undefined
}

const emptyParagraph = (id: string): NoteBlock => ({
  id,
  kind: "paragraph",
  text: ""
})

const replaceBlockInPlace = (
  blocks: readonly NoteBlock[],
  blockId: string,
  next: (block: NoteBlock) => NoteBlock
): NoteBlock[] => blocks.map((b) => (b.id === blockId ? next(b) : b))

// callout：整块变空 paragraph 保留 block.id，丢弃 title/tone。
const downgradeCallout = (
  blocks: readonly NoteBlock[],
  blockId: string
): DowngradeResult => ({
  blocks: replaceBlockInPlace(blocks, blockId, () => emptyParagraph(blockId)),
  focusId: blockId
})

// checklist item：单 item 整块变 paragraph；多 item 时拆出独立空 paragraph。
const downgradeChecklistItem = (
  blocks: readonly NoteBlock[],
  block: NoteChecklistBlock,
  itemId: string
): DowngradeResult => {
  // 单 item：整块原地变 paragraph 保留 block.id
  if (block.items.length === 1) {
    return {
      blocks: replaceBlockInPlace(blocks, block.id, () => emptyParagraph(block.id)),
      focusId: block.id
    }
  }
  // 多 item：拆出空 paragraph（保留 item.id），原 checklist 切成 before/after 两段。
  const itemIndex = block.items.findIndex((i) => i.id === itemId)
  if (itemIndex < 0) {
    return { blocks: [...blocks], focusId: itemId }
  }
  const before = block.items.slice(0, itemIndex)
  const after = block.items.slice(itemIndex + 1)
  const nextBlocks = blocks.flatMap<NoteBlock>((b) => {
    if (b.id !== block.id || b.kind !== "checklist") return [b]
    const segments: NoteBlock[] = []
    if (before.length > 0) {
      segments.push({ ...b, items: before })
    }
    segments.push(emptyParagraph(itemId))
    if (after.length > 0) {
      // after 段保留原 checklist 形状；title 在 before 已开过头，after 段不再展示
      segments.push({
        ...b,
        id: createNoteId(),
        title: before.length > 0 ? "" : b.title,
        items: after
      })
    }
    return segments
  })
  return { blocks: nextBlocks, focusId: itemId }
}

// quote line：把当前行拆出空 paragraph；原 quote 块的其他行保留 quote。
//   - 单行：整块直接变 paragraph，block.id 保留，丢弃 author。
//   - 多行 + 当前 lineIndex=0：保留 block.id 作为新 paragraph 的 id；后片段为新 quote block
//     （用 createNoteId），携带原 author。
//   - 多行 + 当前 lineIndex>0：前片段保留为 quote，仍用 block.id（不携带 author——因为 author
//     只在最后一行展示，被后片段接管）；当前 paragraph 用 createNoteId；后片段为新 quote
//     block 携带原 author；当前行为末尾时则没有后片段，author 丢弃。
// 这里不复用 convertBlockSource，因为 convertBlockFormat 在 quote→paragraph 路径会提取 author
// 作为 rich text，与「降级为空 paragraph」语义不符。
const quoteSegment = (
  id: string,
  lines: readonly string[],
  author?: string
): NoteQuoteBlock => ({
  id,
  kind: "quote",
  text: lines.join("\n"),
  ...(author === undefined ? {} : { author })
})

const downgradeQuoteLine = (
  blocks: readonly NoteBlock[],
  source: Extract<BlockSource, { kind: "quote-line" }>
): DowngradeResult => {
  const block = blocks.find((b): b is NoteQuoteBlock => b.id === source.blockId && b.kind === "quote")
  if (!block) {
    return { blocks: [...blocks], focusId: source.lineId }
  }
  const lines = quoteTextLines(block.text)
  const line = lines[source.lineIndex]
  if (line === undefined) {
    return { blocks: [...blocks], focusId: source.lineId }
  }
  const beforeLines = lines.slice(0, source.lineIndex)
  const afterLines = lines.slice(source.lineIndex + 1)
  const replacementId = source.lineIndex === 0 ? source.blockId : createNoteId()
  const isOnlyLine = beforeLines.length === 0 && afterLines.length === 0

  const nextBlocks = blocks.flatMap<NoteBlock>((b) => {
    if (b.id !== source.blockId || b.kind !== "quote") return [b]
    const segments: NoteBlock[] = []
    if (isOnlyLine) {
      segments.push(emptyParagraph(replacementId))
      return segments
    }
    if (beforeLines.length > 0) {
      // 前片段保留 block.id；author 由后片段接管（无后片段时也丢弃 author）
      segments.push(quoteSegment(b.id, beforeLines, undefined))
    }
    segments.push(emptyParagraph(replacementId))
    if (afterLines.length > 0) {
      segments.push(quoteSegment(createNoteId(), afterLines, b.author))
    }
    return segments
  })

  return { blocks: nextBlocks, focusId: replacementId }
}

// 主入口：根据 source.kind 派发到对应降级路径。
export const downgradeEmptySpecialBlockToParagraph = ({
  blocks,
  source
}: DowngradeInput): DowngradeResult => {
  switch (source.kind) {
    case "block":
      return downgradeCallout(blocks, source.blockId)
    case "todo-item":
      return { blocks: [...blocks], focusId: source.itemId }
    case "checklist-item": {
      const block = blocks.find(
        (b): b is NoteChecklistBlock =>
          b.id === source.blockId && b.kind === "checklist"
      )
      if (!block) return { blocks: [...blocks], focusId: source.itemId }
      return downgradeChecklistItem(blocks, block, source.itemId)
    }
    case "quote-line":
      return downgradeQuoteLine(blocks, source)
  }
}