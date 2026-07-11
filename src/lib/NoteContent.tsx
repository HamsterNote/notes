import type { ReactElement } from "react"

import "./styles.css"

import type { NoteBlock, NoteContentProps } from "./types"
import { assertNever, calloutToneLabelMap, formatUpdatedAt, getReadingMinutes } from "./utils"

const renderBlock = (block: NoteBlock): ReactElement => {
  switch (block.kind) {
    case "heading": {
      const HeadingTag = `h${block.level}` as const

      return (
        <section className="hn-note-block hn-note-block--heading" key={block.id}>
          {block.eyebrow ? <span className="hn-note-eyebrow">{block.eyebrow}</span> : null}
          <HeadingTag className={`hn-note-heading hn-note-heading--${block.level}`}>{block.text}</HeadingTag>
        </section>
      )
    }

    case "paragraph":
      return (
        <p className={`hn-note-paragraph hn-note-paragraph--${block.tone ?? "default"}`} key={block.id}>
          {block.text}
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
                <span
                  aria-hidden="true"
                  className={`hn-note-checkbox ${item.checked ? "hn-note-checkbox--checked" : ""}`}
                >
                  {item.checked ? "●" : "○"}
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )

    case "quote":
      return (
        <blockquote className="hn-note-quote" key={block.id}>
          <p>{block.text}</p>
          {block.author ? <footer>{block.author}</footer> : null}
        </blockquote>
      )

    case "code":
      return (
        <section className="hn-note-code-card" key={block.id}>
          <div className="hn-note-code-meta">
            <span>{block.language}</span>
            {block.filename ? <span>{block.filename}</span> : null}
          </div>
          <pre>
            <code>{block.code}</code>
          </pre>
        </section>
      )

    case "callout":
      return (
        <aside className={`hn-note-callout hn-note-callout--${block.tone}`} key={block.id}>
          <div className="hn-note-callout-title-row">
            <span className="hn-note-chip hn-note-chip--strong">{calloutToneLabelMap[block.tone]}</span>
            <strong>{block.title}</strong>
          </div>
          <p>{block.text}</p>
        </aside>
      )

    default:
      return assertNever(block)
  }
}

export const NoteContent = ({ blocks, summary, tagLabel, title, updatedAt }: NoteContentProps) => {
  const readingMinutes = getReadingMinutes(blocks)

  return (
    <article className="hn-note-shell">
      <header className="hn-note-hero">
        <div className="hn-note-hero-grid">
          <div>
            {tagLabel ? <span className="hn-note-badge">{tagLabel}</span> : null}
            <h1>{title}</h1>
            {summary ? <p className="hn-note-summary">{summary}</p> : null}
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

      <div className="hn-note-body">{blocks.map((block) => renderBlock(block))}</div>
    </article>
  )
}
