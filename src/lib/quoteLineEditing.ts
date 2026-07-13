import { normalizeEditableHtml } from "./blockEditing"
import { quoteTextLines } from "./blockSourceConversion"
import type { NoteBlock, NoteQuoteBlock } from "./types"

const replaceQuote = (
  blocks: readonly NoteBlock[],
  blockId: string,
  update: (block: NoteQuoteBlock) => NoteBlock | null
): NoteBlock[] =>
  blocks.flatMap((block) => {
    if (block.id !== blockId || block.kind !== "quote") return [block]
    const replacement = update(block)
    return replacement === null ? [] : [replacement]
  })

export const updateQuoteLine = (
  blocks: readonly NoteBlock[],
  blockId: string,
  lineIndex: number,
  text: string
): NoteBlock[] =>
  replaceQuote(blocks, blockId, (block) => {
    const lines = [...quoteTextLines(block.text)]
    if (lines[lineIndex] === undefined) return block
    lines[lineIndex] = normalizeEditableHtml(text)
    return { ...block, text: lines.join("\n") }
  })

export const splitQuoteLine = (
  blocks: readonly NoteBlock[],
  blockId: string,
  lineIndex: number,
  beforeHtml: string,
  afterHtml: string
): NoteBlock[] =>
  replaceQuote(blocks, blockId, (block) => {
    const lines = [...quoteTextLines(block.text)]
    if (lines[lineIndex] === undefined) return block
    lines.splice(
      lineIndex,
      1,
      normalizeEditableHtml(beforeHtml),
      normalizeEditableHtml(afterHtml)
    )
    return { ...block, text: lines.join("\n") }
  })

export const deleteQuoteLine = (
  blocks: readonly NoteBlock[],
  blockId: string,
  lineIndex: number
): NoteBlock[] =>
  replaceQuote(blocks, blockId, (block) => {
    const lines = [...quoteTextLines(block.text)]
    if (lines[lineIndex] === undefined) return block
    if (lines.length > 1) {
      lines.splice(lineIndex, 1)
      return { ...block, text: lines.join("\n") }
    }
    if (block.author?.trim()) return { ...block, text: "" }
    if (blocks.length === 1) {
      return { id: block.id, kind: "paragraph", text: "" }
    }
    return null
  })
