import type { ReactElement } from "react"
import { NoteCalloutBlock } from "./NoteCalloutBlock"
import { NoteChecklistBlock } from "./NoteChecklistBlock"
import { NoteCodeBlock } from "./NoteCodeEditorBlock"
import type { EditContext } from "./NoteContentEditing"
import { NoteFormulaBlock } from "./NoteFormulaBlock"
import { NotePictureBlock } from "./NotePictureBlock"
import { NoteQuoteBlock } from "./NoteQuoteBlock"
import { renderTableBlock } from "./NoteTableBlock"
import { NoteTextBlock } from "./NoteTextBlocks"
import type { NoteBlock } from "./types"
import { assertNever } from "./utils"

export { richText } from "./NoteContentEditing"

export const renderBlock = (
  block: NoteBlock,
  ctx: EditContext
): ReactElement => {
  switch (block.kind) {
    case "heading":
      return <NoteTextBlock block={block} ctx={ctx} />
    case "paragraph":
      return <NoteTextBlock block={block} ctx={ctx} />
    case "checklist":
      return <NoteChecklistBlock block={block} ctx={ctx} />
    case "quote":
      return <NoteQuoteBlock block={block} ctx={ctx} />
    case "code":
      return <NoteCodeBlock key={block.id} block={block} ctx={ctx} />
    case "callout":
      return <NoteCalloutBlock block={block} ctx={ctx} />
    case "table":
      return renderTableBlock(block, ctx)
    case "formula":
      return <NoteFormulaBlock key={block.id} block={block} ctx={ctx} />
    case "picture":
      return <NotePictureBlock key={block.id} block={block} ctx={ctx} />
    default:
      return assertNever(block)
  }
}
