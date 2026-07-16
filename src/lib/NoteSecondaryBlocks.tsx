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
import type { NoteCalloutBlock } from "./types"
import { calloutToneLabelMap } from "./utils"

export const renderCalloutBlock = (
  block: NoteCalloutBlock,
  ctx: EditContext
): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  return (
    <div className="hn-note-block-row" id={block.id} key={block.id}>
      {renderBlockActionMenu(block, ctx)}
      <div className="hn-note-block-content">
        <aside className={`hn-note-callout hn-note-callout--${block.tone}`}>
          <div className="hn-note-callout-title-row">
        <span className="hn-note-chip hn-note-chip--strong">
          {calloutToneLabelMap[block.tone]}
        </span>
        {editable ? (
          <strong
            {...editableProps((event) =>
              onBlocksChange?.(
                updateCalloutTitle(
                  blocks,
                  block.id,
                  event.currentTarget.innerHTML
                )
              )
            )}
            {...richText(block.title)}
          />
        ) : (
          <strong {...richText(block.title)} />
        )}
          </div>
          {editable ? (
            <p
              {...editableProps((event) =>
                onBlocksChange?.(
                  updateText(blocks, block.id, event.currentTarget.innerHTML)
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
              {...richText(block.text)}
            />
          ) : (
            <p {...richText(block.text)} />
          )}
        </aside>
      </div>
    </div>
  )
}
