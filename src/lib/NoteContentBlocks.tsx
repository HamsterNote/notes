import type { ReactElement } from "react"
import { renderChecklistBlock } from "./NoteChecklistBlock"
import { NoteCodeBlock } from "./NoteCodeEditorBlock"
import type { EditContext } from "./NoteContentEditing"
import { renderQuoteBlock } from "./NoteQuoteBlock"
import { renderCalloutBlock } from "./NoteSecondaryBlocks"
import { renderTableBlock } from "./NoteTableBlock"
import { renderHeadingBlock, renderParagraphBlock } from "./NoteTextBlocks"
import type { NoteBlock } from "./types"
import { assertNever } from "./utils"

export { richText } from "./NoteContentEditing"

export const renderBlock = (
  block: NoteBlock,
  ctx: EditContext
): ReactElement => {
  switch (block.kind) {
    case "heading":
      return renderHeadingBlock(block, ctx)
    case "paragraph":
      return renderParagraphBlock(block, ctx)
    case "checklist":
      return renderChecklistBlock(block, ctx)
    case "quote":
      return renderQuoteBlock(block, ctx)
    case "code":
      return <NoteCodeBlock key={block.id} block={block} ctx={ctx} />
    case "callout":
      return renderCalloutBlock(block, ctx)
    case "table":
      return renderTableBlock(block, ctx)
    default:
      return assertNever(block)
  }
}
