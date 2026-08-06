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
}: RenderParagraphBlockInput): ReactElement => (
  <>
    {actionMenu}
    {ctx.editable ? (
      editableText
    ) : (
      <span
        className={`hn-note-text hn-note-text--${block.tone ?? "default"}`}
        data-note-region-id={`block:${block.id}`}
        {...richText(block.text)}
      />
    )}
  </>
)
