import type { ReactElement } from "react"

import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText,
  toggleChecklistItem,
  updateChecklistItemText
} from "./NoteContentEditing"
import type { NoteChecklistBlock } from "./types"

export const renderChecklistBlock = (
  block: NoteChecklistBlock,
  ctx: EditContext
): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  return (
    <section
      className="hn-note-block hn-note-block--checklist"
      id={block.id}
      key={block.id}
    >
      {block.title ? (
        <div className="hn-note-section-header hn-note-structured-header">
          <span className="hn-note-chip">Checklist</span>
          <h3>{block.title}</h3>
        </div>
      ) : null}
      <ul className="hn-note-checklist" aria-label={block.title || "List"}>
        {block.items.map((item) => (
          <li className="hn-note-block-row" id={item.id} key={item.id}>
            {renderBlockActionMenu(block, ctx, {
              kind: "checklist-item",
              blockId: block.id,
              itemId: item.id
            })}
            <div className="hn-note-block-content hn-note-checklist-item">
                {editable ? (
                  <button
                    type="button"
                    aria-label={
                      item.checked ? "标记为未完成" : "标记为已完成"
                    }
                    className={[
                      "hn-note-checkbox",
                      "hn-note-checkbox--editable",
                      item.checked ? "hn-note-checkbox--checked" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() =>
                      onBlocksChange?.(
                        toggleChecklistItem(blocks, block.id, item.id)
                      )
                    }
                  >
                    {item.checked ? "●" : "○"}
                  </button>
                ) : (
                  <span
                    aria-hidden="true"
                    className={`hn-note-checkbox ${item.checked ? "hn-note-checkbox--checked" : ""}`}
                  >
                    {item.checked ? "●" : "○"}
                  </span>
                )}
                {editable ? (
                  <span
                    {...editableProps((event) =>
                      onBlocksChange?.(
                        updateChecklistItemText(
                          blocks,
                          block.id,
                          item.id,
                          event.currentTarget.innerHTML
                        )
                      )
                    )}
                    onKeyDown={(event) =>
                      handleEditableBlockKeyDown({
                        ctx,
                        event,
                        mode: "rich-text",
                        sourceId: item.id
                      })
                    }
                    data-editable-block-id={item.id}
                    role="textbox"
                    tabIndex={0}
                    {...richText(item.text)}
                  />
                ) : (
                  <span {...richText(item.text)} />
                )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
