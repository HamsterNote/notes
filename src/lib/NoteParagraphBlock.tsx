import type { ReactElement } from "react"

import type { EditContext } from "./NoteContentEditing"
import { richText } from "./NoteContentEditing"
import type { NoteParagraphBlock } from "./types"

type RenderParagraphBlockInput = {
  readonly block: NoteParagraphBlock
  readonly ctx: EditContext
  readonly actionMenu: ReactElement | null
  readonly editableText: ReactElement
}

export const renderParagraphBlockLayout = ({
  block,
  ctx,
  actionMenu,
  editableText
}: RenderParagraphBlockInput): ReactElement => {
  const className = `hn-note-text hn-note-text--${block.tone ?? "default"}`
  const externalItem = block.externalItem
  return (
    <>
      {actionMenu}
      {externalItem?.clickable === true && ctx.externalItemsClickable ? (
        <span
          className={`${className} hn-note-external-item--clickable`}
          data-note-external-block-id={block.id}
          data-note-region-id={`block:${block.id}`}
          role="link"
          tabIndex={0}
          {...richText(block.text)}
        />
      ) : ctx.editable ? (
        editableText
      ) : (
        <span
          className={className}
          data-note-region-id={`block:${block.id}`}
          {...richText(block.text)}
        />
      )}
    </>
  )
}
