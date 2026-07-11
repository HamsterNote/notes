import { useRef, type CSSProperties, type FocusEvent, type ReactElement } from "react"

import "./styles.css"

import { SelectionPopover } from "./SelectionPopover"
import type { NoteBlock, NoteContentProps } from "./types"
import { assertNever, calloutToneLabelMap, formatUpdatedAt, getReadingMinutes } from "./utils"

/** 编辑上下文：向 renderBlock 传递可编辑状态和变更回调 */
type EditContext = {
  readonly editable: boolean
  readonly blocks: readonly NoteBlock[]
  readonly onBlocksChange: ((blocks: NoteBlock[]) => void) | undefined
}

// ===== 不可变更新工具：按判别联合类型安全地更新各字段 =====

/** 更新 heading / paragraph / quote / callout 的 text 字段 */
const updateText = (blocks: readonly NoteBlock[], id: string, text: string): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id) return block
    if (
      block.kind === "heading" ||
      block.kind === "paragraph" ||
      block.kind === "quote" ||
      block.kind === "callout"
    ) {
      return { ...block, text }
    }
    return block
  })

/** 更新 callout.title */
const updateCalloutTitle = (
  blocks: readonly NoteBlock[],
  id: string,
  title: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "callout") return block
    return { ...block, title }
  })

/** 更新 quote.author */
const updateQuoteAuthor = (
  blocks: readonly NoteBlock[],
  id: string,
  author: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "quote") return block
    return { ...block, author }
  })

/** 更新 code.code */
const updateCode = (blocks: readonly NoteBlock[], id: string, code: string): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== id || block.kind !== "code") return block
    return { ...block, code }
  })

/** 切换 checklist item 的 checked 状态 */
const toggleChecklistItem = (
  blocks: readonly NoteBlock[],
  blockId: string,
  itemId: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== blockId || block.kind !== "checklist") return block
    return {
      ...block,
      items: block.items.map((item) =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )
    }
  })

/** 更新 checklist item 的 text 字段 */
const updateChecklistItemText = (
  blocks: readonly NoteBlock[],
  blockId: string,
  itemId: string,
  text: string
): NoteBlock[] =>
  blocks.map((block) => {
    if (block.id !== blockId || block.kind !== "checklist") return block
    return {
      ...block,
      items: block.items.map((item) => (item.id === itemId ? { ...item, text } : item))
    }
  })

const editableProps = (
  onBlur: (event: FocusEvent<HTMLElement>) => void,
  baseClassName?: string
) => ({
  contentEditable: true,
  suppressContentEditableWarning: true,
  className: baseClassName ? `${baseClassName} hn-note-editable` : "hn-note-editable",
  spellCheck: false,
  onBlur
})

/**
 * 富文本渲染辅助：统一通过 dangerouslySetInnerHTML 注入文本。
 * 编辑态捕获的是 innerHTML，可携带 <b>/<i>/<u> 等格式标签，
 * 因此渲染态必须以 HTML 方式还原，否则标签会被当作纯文本展示。
 */
const richText = (value: string) => ({ dangerouslySetInnerHTML: { __html: value } })

const renderBlock = (block: NoteBlock, ctx: EditContext): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx

  switch (block.kind) {
    case "heading": {
      const HeadingTag = `h${block.level}` as const

      return (
        <section className="hn-note-block hn-note-block--heading" key={block.id}>
          {block.eyebrow ? <span className="hn-note-eyebrow">{block.eyebrow}</span> : null}
          <HeadingTag className={`hn-note-heading hn-note-heading--${block.level}`}>
            {editable ? (
              <span
                {...editableProps((event) =>
                  onBlocksChange?.(updateText(blocks, block.id, event.currentTarget.innerHTML))
                )}
                {...richText(block.text)}
              />
            ) : (
              <span {...richText(block.text)} />
            )}
          </HeadingTag>
        </section>
      )
    }

    case "paragraph":
      return (
        <p
          className={`hn-note-paragraph hn-note-paragraph--${block.tone ?? "default"}`}
          key={block.id}
        >
          {editable ? (
            <span
              {...editableProps((event) =>
                onBlocksChange?.(updateText(blocks, block.id, event.currentTarget.innerHTML))
              )}
              {...richText(block.text)}
            />
          ) : (
            <span {...richText(block.text)} />
          )}
        </p>
      )

    case "checklist":
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
                      onBlocksChange?.(toggleChecklistItem(blocks, block.id, item.id))
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

    case "quote":
      return (
        <blockquote className="hn-note-quote" key={block.id}>
          {editable ? (
            <p
              {...editableProps((event) =>
                onBlocksChange?.(updateText(blocks, block.id, event.currentTarget.innerHTML))
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
                  onBlocksChange?.(updateQuoteAuthor(blocks, block.id, event.currentTarget.innerHTML))
                )}
                {...richText(block.author)}
              />
            ) : (
              <footer {...richText(block.author)} />
            )
          ) : null}
        </blockquote>
      )

    case "code":
      return (
        <section className="hn-note-code-card" key={block.id}>
          <div className="hn-note-code-meta">
            <span>{block.language}</span>
            {block.filename ? <span>{block.filename}</span> : null}
          </div>
          {editable ? (
            <pre
              {...editableProps((event) =>
                onBlocksChange?.(updateCode(blocks, block.id, event.currentTarget.textContent ?? ""))
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

    case "callout":
      return (
        <aside className={`hn-note-callout hn-note-callout--${block.tone}`} key={block.id}>
          <div className="hn-note-callout-title-row">
            <span className="hn-note-chip hn-note-chip--strong">
              {calloutToneLabelMap[block.tone]}
            </span>
            {editable ? (
              <strong
                {...editableProps((event) =>
                  onBlocksChange?.(
                    updateCalloutTitle(blocks, block.id, event.currentTarget.innerHTML)
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
                onBlocksChange?.(updateText(blocks, block.id, event.currentTarget.innerHTML))
              )}
              {...richText(block.text)}
            />
          ) : (
            <p {...richText(block.text)} />
          )}
        </aside>
      )

    default:
      return assertNever(block)
  }
}

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
  // 主题色注入为 CSS 变量；未传则使用 CSS 中定义的默认值
  const shellStyle = themeColor
    ? ({ "--hn-theme": themeColor } as CSSProperties)
    : undefined
  // 笔记容器引用：选区 Popover 仅响应该容器内的文字选中
  const shellRef = useRef<HTMLElement>(null)

  return (
    <>
      <article className="hn-note-shell" ref={shellRef} style={shellStyle}>
        <header className="hn-note-hero">
          <div className="hn-note-hero-grid">
            <div>
              {tagLabel ? <span className="hn-note-badge">{tagLabel}</span> : null}
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
                      (event) => onSummaryChange?.(event.currentTarget.innerHTML),
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
          {blocks.map((block) => renderBlock(block, { editable, blocks, onBlocksChange }))}
        </div>
      </article>
      <SelectionPopover containerRef={shellRef} editable={editable} />
    </>
  )
}
