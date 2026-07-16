import type { ReactElement } from "react"

import { renderBlockActionMenu } from "./NoteBlockEditingControls"
import type { EditContext } from "./NoteContentEditing"
import type { NotePictureBlock as NotePictureBlockData } from "./types"

type NotePictureBlockProps = {
  readonly block: NotePictureBlockData
  readonly ctx: EditContext
}

export const NotePictureBlock = ({
  block,
  ctx
}: NotePictureBlockProps): ReactElement => (
  <div className="hn-note-block-row" id={block.id}>
    {renderBlockActionMenu(block, ctx)}
    <div className="hn-note-block-content">
      <figure className="hn-note-picture">
        <img
          src={block.url}
          alt={block.filename}
          width={block.width}
          height={block.height}
          decoding="async"
        />
      </figure>
    </div>
  </div>
)
