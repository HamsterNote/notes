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
  <>
    {renderBlockActionMenu(block, ctx)}
    <figure className="hn-note-picture">
      <img
        src={block.url}
        alt={block.filename}
        width={block.width}
        height={block.height}
        decoding="async"
      />
    </figure>
  </>
)
