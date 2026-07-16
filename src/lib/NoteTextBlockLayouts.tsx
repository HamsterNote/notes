import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from "react"

import type { BlockConvertTarget } from "./BlockActionMenu"
import { BlockActionMenu } from "./BlockActionMenu"
import { blockMenuStateKey } from "./NoteBlockEditingControls"
import { type EditContext, editableProps, richText } from "./NoteContentEditing"
import type { NoteHeadingBlock, NoteParagraphBlock } from "./types"

type EditTextBlock = NoteHeadingBlock | NoteParagraphBlock

type EditableTextLayoutInput = {
  readonly block: EditTextBlock
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  readonly onTextChange: (text: string) => void
}

type BlockActionMenuLayoutInput = {
  readonly block: EditTextBlock
  readonly ctx: EditContext
  readonly onSelect: (target: BlockConvertTarget) => string
}

type HeadingBlockLayoutInput = {
  readonly block: NoteHeadingBlock
  readonly ctx: EditContext
  readonly actionMenu: ReactElement | null
  readonly editableText: ReactElement
}

export const renderEditableTextLayout = ({
  block,
  onKeyDown,
  onTextChange
}: EditableTextLayoutInput): ReactElement => (
  <span
    {...editableProps((event) => onTextChange(event.currentTarget.innerHTML))}
    onKeyDown={onKeyDown}
    data-editable-block-id={block.id}
    role="textbox"
    tabIndex={0}
    {...richText(block.text)}
  />
)

export const renderBlockActionMenuLayout = ({
  block,
  ctx,
  onSelect
}: BlockActionMenuLayoutInput): ReactElement => {
  const convertMenuId = blockMenuStateKey("convert", {
    kind: "block",
    blockId: block.id
  })

  if (block.kind === "heading") {
    return (
      <BlockActionMenu
        mode="convert"
        open={ctx.openBlockMenuId === convertMenuId}
        onOpenChange={(open) =>
          ctx.onBlockMenuOpenChange(convertMenuId, open)
        }
        blockId={block.id}
        kind="heading"
        headingLevel={block.level}
        onSelect={onSelect}
      />
    )
  }

  return (
    <BlockActionMenu
      mode="convert"
      open={ctx.openBlockMenuId === convertMenuId}
      onOpenChange={(open) => ctx.onBlockMenuOpenChange(convertMenuId, open)}
      blockId={block.id}
      kind="paragraph"
      onSelect={onSelect}
    />
  )
}

export const renderHeadingBlockLayout = ({
  block,
  ctx,
  actionMenu,
  editableText
}: HeadingBlockLayoutInput): ReactElement => {
  const HeadingTag = `h${block.level}` as const

  return (
    <section className="hn-note-block hn-note-block--heading" key={block.id}>
      {block.eyebrow ? (
        <span className="hn-note-eyebrow">{block.eyebrow}</span>
      ) : null}
      <div className="hn-note-block-row" id={block.id}>
        {actionMenu}
        <div className="hn-note-block-content">
          <HeadingTag
            className={`hn-note-heading hn-note-heading--${block.level}`}
          >
            {ctx.editable ? editableText : <span {...richText(block.text)} />}
          </HeadingTag>
        </div>
      </div>
    </section>
  )
}
