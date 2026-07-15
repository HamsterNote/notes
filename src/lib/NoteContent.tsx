import { type CSSProperties, type FocusEvent, useImperativeHandle, useRef } from "react"

import "./styles.css"

import { createNextBlockId, isVisibleHtmlEmpty } from "./blockEditing"
import { renderBlock, richText } from "./NoteContentBlocks"
import { updateText } from "./NoteContentEditing"
import { SelectionPopover } from "./SelectionPopover"
import { DISABLED_CONTROLLER } from "./noteContentUndoRedo"
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
  onBlur: (event: FocusEvent<HTMLElement>) => {
    const related = event.relatedTarget as HTMLElement | null
    if (related?.closest?.(".hn-note-popover")) return
    onBlur(event)
  }
})

export const NoteContent = ({
  blocks,
  summary,
  tagLabel,
  title,
  updatedAt,
  theme = "light",
  themeColor,
  editable = false,
  onTitleChange,
  onSummaryChange,
  onBlocksChange,
  onMagicLinkConfigure,
  onMagicLinkClick,
  ref: undoRedoRef,
  undoRedoController
}: NoteContentProps) => {
  const readingMinutes = getReadingMinutes(blocks)
  const shellStyle = themeColor
    ? ({ "--hn-theme": themeColor } as CSSProperties)
    : undefined
  const shellRef = useRef<HTMLElement>(null)
  const controller = undoRedoController ?? DISABLED_CONTROLLER
  useImperativeHandle(undoRedoRef, () => controller, [controller])
  const { openBlockMenuId, requestFocus, handleBlockMenuOpenChange } =
    useBlockEditing(shellRef)

  return (
    <>
      <article
        className={`hn-note-shell hn-note-shell--${theme}`}
        data-theme={theme}
        ref={shellRef}
        style={shellStyle}
        onClick={(event) => {
          // 拦截 hnmagic:// 链接点击：禁止原生跳转，交给宿主处理
          const anchor = (event.target as HTMLElement | null)?.closest("a")
          if (!anchor) return
          const href = anchor.getAttribute("href")
          if (href?.startsWith("hnmagic://")) {
            event.preventDefault()
            onMagicLinkClick?.(href)
          }
        }}
        onKeyDown={(event) => {
          // 键盘等价：Enter/Space 激活 hnmagic:// 链接时同样拦截原生跳转
          if (event.key !== "Enter" && event.key !== " ") return
          const anchor = (event.target as HTMLElement | null)?.closest("a")
          if (!anchor) return
          const href = anchor.getAttribute("href")
          if (href?.startsWith("hnmagic://")) {
            event.preventDefault()
            onMagicLinkClick?.(href)
          }
        }}
      >
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
          {/* 可编辑模式下，点击正文下方空白区域新建空段落 */}
          {editable && onBlocksChange ? (
            <button
              type="button"
              aria-label="新建一行"
              className="hn-note-body-tail"
              onClick={() => {
                const lastBlock = blocks[blocks.length - 1]
                if (
                  lastBlock &&
                  (lastBlock.kind === "paragraph" ||
                    lastBlock.kind === "heading") &&
                  isVisibleHtmlEmpty(lastBlock.text)
                ) {
                  requestFocus?.(lastBlock.id, "start")
                  return
                }
                const newId = createNextBlockId(
                  blocks,
                  lastBlock?.id ?? "block"
                )
                onBlocksChange([
                  ...blocks,
                  { id: newId, kind: "paragraph", text: "" }
                ])
                requestFocus?.(newId, "start")
              }}
            />
          ) : null}
        </div>
      </article>
      {editable && openBlockMenuId === null ? (
        <SelectionPopover
          containerRef={shellRef}
          onMagicLinkConfigure={onMagicLinkConfigure}
          onContentChange={(blockId, innerHtml) => {
            onBlocksChange?.(updateText(blocks, blockId, innerHtml))
          }}
        />
      ) : null}
    </>
  )
}
