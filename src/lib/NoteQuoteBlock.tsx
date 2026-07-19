import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from "react"

import { isVisibleHtmlEmpty, normalizeEditableHtml } from "./blockEditing"
import { quoteLineId, quoteTextLines } from "./blockSourceConversion"
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
import type { NoteQuoteBlock as NoteQuoteBlockData } from "./types"

// ── Quote 行键盘事件处理工具函数 ─────────────────────────────────────────────
type QuoteLineKeyDownInput = {
  readonly block: NoteQuoteBlockData
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

// ── Quote 单行组件 ──────────────────────────────────────────────────────────
// 每条 quote line 独立成一个组件，不搞聚合包装
type NoteQuoteLineProps = {
  readonly block: NoteQuoteBlockData
  readonly line: string
  readonly lineIndex: number
  readonly ctx: EditContext
  readonly showAuthor: boolean
  readonly containerId: string | undefined
}

const NoteQuoteLine = ({
  block,
  line,
  lineIndex,
  ctx,
  showAuthor,
  containerId
}: NoteQuoteLineProps): ReactElement => {
  const { editable, blocks, onBlocksChange, selectMode, selectedBlockId } = ctx
  const lineId = quoteLineId(block.id, lineIndex)
  const sortable = editable && onBlocksChange !== undefined

  return (
    <div
      className={[
        "hn-note-block",
        "hn-note-quote hn-note-quote-line",
        sortable ? "hn-note-sortable-block" : "",
        selectMode ? "hn-note-selectable-block" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      id={lineId}
      key={lineId}
      data-note-drag-container-id={containerId}
      {...(sortable
        ? {
            "data-note-sortable-id": lineId,
            "data-note-block-id": block.id
          }
        : {})}
      {...(editable
        ? {
            "data-note-drag-kind": "quote-line",
            "data-note-drag-parent-id": block.id
          }
        : {})}
      {...(selectMode
        ? {
            "data-note-select-id": lineId,
            role: "option" as const,
            "aria-selected": selectedBlockId === lineId,
            tabIndex: 0
          }
        : {})}
    >
      {editable
        ? renderBlockActionMenu(block, ctx, {
            kind: "quote-line",
            blockId: block.id,
            lineId,
            lineIndex
          })
        : null}
      <div
        className={[
          "hn-note-quote-content",
          "hn-note-quote",
          "hn-note-quote-line",
          lineIndex > 0 ? "hn-note-quote-line--continuation" : "",
          showAuthor ? "hn-note-quote-line--final" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {editable ? (
          <p
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
        ) : (
          <p {...richText(line)} />
        )}
        {showAuthor && block.author ? (
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
      </div>
    </div>
  )
}

// ── Quote 块组件 ────────────────────────────────────────────────────────────
type NoteQuoteBlockProps = {
  readonly block: NoteQuoteBlockData
  readonly ctx: EditContext
  readonly containerId?: string
}

export const NoteQuoteBlock = ({
  block,
  ctx,
  containerId
}: NoteQuoteBlockProps): ReactElement => {
  const lines = quoteTextLines(block.text)

  return (
    <>
      {lines.map((line, lineIndex) => (
        <NoteQuoteLine
          key={quoteLineId(block.id, lineIndex)}
          block={block}
          containerId={containerId}
          line={line}
          lineIndex={lineIndex}
          ctx={ctx}
          showAuthor={lineIndex === lines.length - 1}
        />
      ))}
    </>
  )
}
