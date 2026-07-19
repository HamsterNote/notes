import type { ReactElement } from "react"
import { NoteCalloutBlock } from "./NoteCalloutBlock"
import { NoteCodeBlock } from "./NoteCodeEditorBlock"
import { NoteCollapsibleBlock } from "./NoteCollapsibleBlock"
import type { EditContext } from "./NoteContentEditing"
import { NoteDirectoryBlock } from "./NoteDirectoryBlock"
import { NoteFormulaBlock } from "./NoteFormulaBlock"
import { NoteListBlock } from "./NoteListBlock"
import { NotePictureBlock } from "./NotePictureBlock"
import { NoteQuoteBlock } from "./NoteQuoteBlock"
import { renderTableBlock } from "./NoteTableBlock"
import { NoteTextBlock } from "./NoteTextBlocks"
import { NoteTodoBlock } from "./NoteTodoBlock"
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
    case "todo":
      return <NoteTodoBlock block={block} ctx={ctx} />
    case "unorderedList":
      return <NoteListBlock block={block} ctx={ctx} />
    case "orderedList":
      return <NoteListBlock block={block} ctx={ctx} />
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
    case "directory":
      return <NoteDirectoryBlock block={block} ctx={ctx} />
    case "collapsible":
      return <NoteCollapsibleBlock block={block} ctx={ctx} />
    default:
      return assertNever(block)
  }
}
