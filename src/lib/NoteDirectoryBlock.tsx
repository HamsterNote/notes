import type { ReactElement } from "react"

import { isVisibleHtmlEmpty } from "./blockEditing"
import { renderBlockActionMenu } from "./NoteBlockEditingControls"
import { type EditContext, richText } from "./NoteContentEditing"
import type {
  NoteDirectoryBlock as NoteDirectoryBlockData,
  NoteHeadingBlock
} from "./types"

type NoteDirectoryBlockProps = {
  readonly block: NoteDirectoryBlockData
  readonly ctx: EditContext
}

export const NoteDirectoryBlock = ({
  block,
  ctx
}: NoteDirectoryBlockProps): ReactElement => {
  const headings = ctx.blocks.filter(
    (candidate): candidate is NoteHeadingBlock => candidate.kind === "heading"
  )

  return (
    <>
      {renderBlockActionMenu(block, ctx)}
      <nav className="hn-note-directory" aria-label="目录">
        <strong className="hn-note-directory-title">目录</strong>
        {headings.length === 0 ? (
          <p className="hn-note-directory-empty">添加标题后，目录会自动生成。</p>
        ) : (
          <ol className="hn-note-directory-list">
            {headings.map((heading) => (
              <li
                key={heading.id}
                className={`hn-note-directory-item hn-note-directory-item--${heading.level}`}
              >
                <a href={`#${heading.id}`}>
                  {isVisibleHtmlEmpty(heading.text) ? (
                    "未命名标题"
                  ) : (
                    <span {...richText(heading.text)} />
                  )}
                </a>
              </li>
            ))}
          </ol>
        )}
      </nav>
    </>
  )
}
