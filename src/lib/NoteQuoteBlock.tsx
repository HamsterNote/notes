import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent
} from "react"

import {
  isVisibleHtmlEmpty,
  normalizeEditableHtml
} from "./blockEditing"
import {
  quoteLineId,
  quoteTextLines
} from "./blockSourceConversion"
import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText,
  updateQuoteAuthor
} from "./NoteContentEditing"
import {
  deleteQuoteLine,
  splitQuoteLine,
  updateQuoteLine
} from "./quoteLineEditing"
import type { NoteQuoteBlock } from "./types"

type QuoteLineKeyDownInput = {
  readonly block: NoteQuoteBlock
  readonly ctx: EditContext
  readonly event: ReactKeyboardEvent<HTMLElement>
  readonly lineIndex: number
}

const htmlBeforeCaret = (element: HTMLElement, range: Range): string => {
  const beforeRange = document.createRange()
  beforeRange.selectNodeContents(element)
  beforeRange.setEnd(range.startContainer, range.startOffset)
  const container = document.createElement("div")
  container.appendChild(beforeRange.cloneContents())
  return container.innerHTML
}

const handleQuoteLineKeyDown = ({
  block,
  ctx,
  event,
  lineIndex
}: QuoteLineKeyDownInput): void => {
  const { blocks, onBlocksChange, requestFocus } = ctx
  if (!onBlocksChange) return
  const element = event.currentTarget
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    if (!range.collapsed) range.deleteContents()
    const afterRange = document.createRange()
    afterRange.selectNodeContents(element)
    afterRange.setStart(range.endContainer, range.endOffset)
    const afterContainer = document.createElement("div")
    afterContainer.appendChild(afterRange.extractContents())
    onBlocksChange(
      splitQuoteLine(
        blocks,
        block.id,
        lineIndex,
        element.innerHTML,
        afterContainer.innerHTML
      )
    )
    requestFocus?.(quoteLineId(block.id, lineIndex + 1), "start")
    return
  }

  if (event.key === "Enter" && event.shiftKey) {
    handleEditableBlockKeyDown({
      ctx,
      event,
      mode: "rich-text",
      sourceId: block.id
    })
    return
  }

  if (event.key !== "Backspace" || !selection.isCollapsed) return
  if (
    !isVisibleHtmlEmpty(htmlBeforeCaret(element, range)) ||
    !isVisibleHtmlEmpty(element.innerHTML)
  ) {
    return
  }

  event.preventDefault()
  onBlocksChange(deleteQuoteLine(blocks, block.id, lineIndex))
  requestFocus?.(
    lineIndex === 0 ? block.id : quoteLineId(block.id, lineIndex - 1),
    "end"
  )
}

export const renderQuoteBlock = (
  block: NoteQuoteBlock,
  ctx: EditContext
): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx
  const lines = quoteTextLines(block.text)

  if (!editable) {
    return (
      <div className="hn-note-block-row" id={block.id} key={block.id}>
        <div className="hn-note-block-content">
          <blockquote className="hn-note-quote">
            <p {...richText(block.text.replaceAll("\n", "<br>"))} />
            {block.author ? <footer {...richText(block.author)} /> : null}
          </blockquote>
        </div>
      </div>
    )
  }

  return (
    <div className="hn-note-block-row" id={block.id} key={block.id}>
      {renderBlockActionMenu(block, ctx)}
      <div className="hn-note-block-content">
        <blockquote className="hn-note-quote">
          {lines.map((line, lineIndex) => {
            const lineId = quoteLineId(block.id, lineIndex)
            return (
              <p
                key={lineId}
                {...editableProps((event) =>
                  onBlocksChange?.(
                    updateQuoteLine(
                      blocks,
                      block.id,
                      lineIndex,
                      normalizeEditableHtml(event.currentTarget.innerHTML)
                    )
                  )
                )}
                onKeyDown={(event) =>
                  handleQuoteLineKeyDown({ block, ctx, event, lineIndex })
                }
                data-editable-block-id={lineId}
                {...richText(line)}
              />
            )
          })}
          {block.author ? (
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
          ) : null}
        </blockquote>
      </div>
    </div>
  )
}
