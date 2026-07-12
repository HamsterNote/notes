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
  <div
    className={`hn-note-paragraph hn-note-paragraph--${block.tone ?? "default"}`}
    key={block.id}
  >
    <div className="hn-note-block-row">
      {actionMenu}
      <div className="hn-note-block-content">
        {ctx.editable ? editableText : <span {...richText(block.text)} />}
      </div>
    </div>
  </div>
)
