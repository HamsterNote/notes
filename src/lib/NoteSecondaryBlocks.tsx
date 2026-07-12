import type { ReactElement } from "react"

import {
  type EditContext,
  editableProps,
  richText,
  toggleChecklistItem,
  updateCalloutTitle,
  updateChecklistItemText,
  updateCode,
  updateQuoteAuthor,
  updateText
} from "./NoteContentEditing"
import type {
  NoteCalloutBlock,
  NoteChecklistBlock,
  NoteCodeBlock,
  NoteQuoteBlock
} from "./types"
import { calloutToneLabelMap } from "./utils"

export const renderChecklistBlock = (
  block: NoteChecklistBlock,
  ctx: EditContext
): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  return (
    <section className="hn-note-block hn-note-block--checklist" key={block.id}>
      <div className="hn-note-section-header">
        <span className="hn-note-chip">Checklist</span>
        <h3>{block.title}</h3>
      </div>
      <ul className="hn-note-checklist" aria-label={block.title}>
        {block.items.map((item) => (
          <li className="hn-note-checklist-item" key={item.id}>
            {editable ? (
              <button
                type="button"
                aria-label={item.checked ? "标记为未完成" : "标记为已完成"}
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
                {...richText(item.text)}
              />
            ) : (
              <span {...richText(item.text)} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export const renderQuoteBlock = (
  block: NoteQuoteBlock,
  ctx: EditContext
): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  return (
    <blockquote className="hn-note-quote" key={block.id}>
      {editable ? (
        <p
          {...editableProps((event) =>
            onBlocksChange?.(
              updateText(blocks, block.id, event.currentTarget.innerHTML)
            )
          )}
          {...richText(block.text)}
        />
      ) : (
        <p {...richText(block.text)} />
      )}
      {block.author ? (
        editable ? (
          <footer
            {...editableProps((event) =>
              onBlocksChange?.(
                updateQuoteAuthor(
                  blocks,
                  block.id,
                  event.currentTarget.innerHTML
                )
              )
            )}
            {...richText(block.author)}
          />
        ) : (
          <footer {...richText(block.author)} />
        )
      ) : null}
    </blockquote>
  )
}

export const renderCodeBlock = (
  block: NoteCodeBlock,
  ctx: EditContext
): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  return (
    <section className="hn-note-code-card" key={block.id}>
      <div className="hn-note-code-meta">
        <span>{block.language}</span>
        {block.filename ? <span>{block.filename}</span> : null}
      </div>
      {editable ? (
        <pre
          {...editableProps((event) =>
            onBlocksChange?.(
              updateCode(
                blocks,
                block.id,
                event.currentTarget.textContent ?? ""
              )
            )
          )}
        >
          <code>{block.code}</code>
        </pre>
      ) : (
        <pre>
          <code>{block.code}</code>
        </pre>
      )}
    </section>
  )
}

export const renderCalloutBlock = (
  block: NoteCalloutBlock,
  ctx: EditContext
): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  return (
    <aside
      className={`hn-note-callout hn-note-callout--${block.tone}`}
      key={block.id}
    >
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
          {...richText(block.text)}
        />
      ) : (
        <p {...richText(block.text)} />
      )}
    </aside>
  )
}
