import { type ReactElement, useEffect, useRef, useState } from "react"

import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText,
  updateCode
} from "./NoteContentEditing"
import { highlightCode } from "./syntaxHighlight"
import type { NoteCodeBlock as NoteCodeBlockData } from "./types"

type NoteCodeBlockProps = {
  readonly block: NoteCodeBlockData
  readonly ctx: EditContext
}

export const NoteCodeBlock = ({
  block,
  ctx
}: NoteCodeBlockProps): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx
  const [editing, setEditing] = useState(false)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const highlightedCode = highlightCode(block.code, block.language)

  useEffect(() => {
    if (!editing) return
    const editor = editorRef.current
    editor?.focus()
    const selection = window.getSelection()
    if (!editor || !selection) return
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [editing])

  return (
    <div className="hn-note-block-row">
      {renderBlockActionMenu(block, ctx)}
      <div className="hn-note-block-content">
        <section className="hn-note-code-card">
          <div className="hn-note-code-meta">
            <span>{block.language}</span>
            {block.filename ? <span>{block.filename}</span> : null}
          </div>
          {editable ? (
            editing ? (
              <div
                ref={editorRef}
                aria-multiline="true"
                role="textbox"
                tabIndex={0}
                {...editableProps(
                  (event) => {
                    const code = event.currentTarget.innerText
                      .replaceAll("\r\n", "\n")
                      .replaceAll("\r", "\n")
                    setEditing(false)
                    onBlocksChange?.(updateCode(blocks, block.id, code))
                  },
                  "hn-note-code-editor"
                )}
                onKeyDown={(event) =>
                  handleEditableBlockKeyDown({
                    ctx,
                    event,
                    mode: "plain-text",
                    sourceId: block.id
                  })
                }
                data-editable-block-id={block.id}
              >
                {block.code}
              </div>
            ) : (
              <button
                aria-label="编辑代码"
                className="hn-note-code-preview"
                data-editable-block-id={block.id}
                onFocus={() => setEditing(true)}
                type="button"
              >
                <code className="hljs" {...richText(highlightedCode)} />
              </button>
            )
          ) : (
            <pre>
              <code className="hljs" {...richText(highlightedCode)} />
            </pre>
          )}
        </section>
      </div>
    </div>
  )
}
