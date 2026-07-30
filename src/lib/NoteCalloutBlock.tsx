import type { ReactElement } from "react"

import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText,
  updateCalloutTitle,
  updateText
} from "./NoteContentEditing"
import type { NoteCalloutBlock as NoteCalloutBlockData } from "./types"
import { calloutToneLabelMap } from "./utils"

type NoteCalloutBlockProps = {
  readonly block: NoteCalloutBlockData
  readonly ctx: EditContext
}

export const NoteCalloutBlock = ({
  block,
  ctx
}: NoteCalloutBlockProps): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  return (
    <>
      {renderBlockActionMenu(block, ctx)}
      <aside className={`hn-note-callout hn-note-callout--${block.tone}`}>
        <div className="hn-note-callout-title-row">
          <span className="hn-note-chip hn-note-chip--strong">
            {calloutToneLabelMap[block.tone]}
          </span>
          {editable ? (
            <strong
              {...editableProps((editable) =>
                onBlocksChange?.(
                  updateCalloutTitle(
                    blocks,
                    block.id,
                    editable.innerHTML
                  )
                )
              )}
              {...richText(block.title)}
              data-note-region-id={`block:${block.id}:title`}
            />
          ) : (
            <strong
              data-note-region-id={`block:${block.id}:title`}
              {...richText(block.title)}
            />
          )}
        </div>
        {editable ? (
          <p
            {...editableProps((editable) =>
              onBlocksChange?.(
                updateText(blocks, block.id, editable.innerHTML)
              )
            )}
            onKeyDown={(event) =>
              handleEditableBlockKeyDown({
                ctx,
                event,
                mode: "rich-text",
                sourceId: block.id
              })
            }
            data-editable-block-id={block.id}
            data-note-region-id={`block:${block.id}`}
            {...richText(block.text)}
          />
        ) : (
          <p data-note-region-id={`block:${block.id}`} {...richText(block.text)} />
        )}
      </aside>
    </>
  )
}
