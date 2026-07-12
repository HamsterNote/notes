import type { ReactElement } from "react"

import type { EditContext } from "./NoteContentEditing"
import {
  renderCalloutBlock,
  renderChecklistBlock,
  renderCodeBlock,
  renderQuoteBlock
} from "./NoteSecondaryBlocks"
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
      return renderCodeBlock(block, ctx)
    case "callout":
      return renderCalloutBlock(block, ctx)
    default:
      return assertNever(block)
  }
}
