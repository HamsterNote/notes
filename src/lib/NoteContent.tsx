import { type CSSProperties, type FocusEvent, useRef } from "react"

import "./styles.css"

import { renderBlock, richText } from "./NoteContentBlocks"
import { SelectionPopover } from "./SelectionPopover"
import type { NoteContentProps } from "./types"
import { useBlockEditing } from "./useBlockEditing"
import { formatUpdatedAt, getReadingMinutes } from "./utils"

const editableProps = (
  onBlur: (event: FocusEvent<HTMLElement>) => void,
  baseClassName?: string
) => ({
  contentEditable: true,
  suppressContentEditableWarning: true,
  className: baseClassName
    ? `${baseClassName} hn-note-editable`
    : "hn-note-editable",
  spellCheck: false,
  onBlur
})

export const NoteContent = ({
  blocks,
  summary,
  tagLabel,
  title,
  updatedAt,
  themeColor,
  editable = false,
  onTitleChange,
  onSummaryChange,
  onBlocksChange
}: NoteContentProps) => {
  const readingMinutes = getReadingMinutes(blocks)
  const shellStyle = themeColor
    ? ({ "--hn-theme": themeColor } as CSSProperties)
    : undefined
  const shellRef = useRef<HTMLElement>(null)
  const { openBlockMenuId, requestFocus, handleBlockMenuOpenChange } =
    useBlockEditing(shellRef)

  return (
    <>
      <article className="hn-note-shell" ref={shellRef} style={shellStyle}>
        <header className="hn-note-hero">
          <div className="hn-note-hero-grid">
            <div>
              {tagLabel ? (
                <span className="hn-note-badge">{tagLabel}</span>
              ) : null}
              {editable ? (
                <h1
                  {...editableProps((event) =>
                    onTitleChange?.(event.currentTarget.innerHTML)
                  )}
                  {...richText(title)}
                />
              ) : (
                <h1 {...richText(title)} />
              )}
              {summary ? (
                editable ? (
                  <p
                    {...editableProps(
                      (event) =>
                        onSummaryChange?.(event.currentTarget.innerHTML),
                      "hn-note-summary"
                    )}
                    {...richText(summary)}
                  />
                ) : (
                  <p className="hn-note-summary" {...richText(summary)} />
                )
              ) : null}
            </div>

            <dl className="hn-note-facts" aria-label="Note metadata">
              <div>
                <dt>Reading</dt>
                <dd>{readingMinutes} min</dd>
              </div>
              <div>
                <dt>Blocks</dt>
                <dd>{blocks.length}</dd>
              </div>
              {updatedAt ? (
                <div>
                  <dt>Updated</dt>
                  <dd>{formatUpdatedAt(updatedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </header>

        <div className="hn-note-body">
          {blocks.map((block) =>
            renderBlock(block, {
              editable,
              blocks,
              openBlockMenuId,
              onBlocksChange,
              requestFocus,
              onBlockMenuOpenChange: handleBlockMenuOpenChange
            })
          )}
        </div>
      </article>
      {editable && openBlockMenuId === null ? (
        <SelectionPopover containerRef={shellRef} />
      ) : null}
    </>
  )
}
