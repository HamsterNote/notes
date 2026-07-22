import type {
  FormEvent,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent
} from "react"

import type { BlockConvertTarget } from "./BlockActionMenu"
import { BlockActionMenu } from "./BlockActionMenu"
import { blockMenuStateKey } from "./NoteBlockEditingControls"
import { type EditContext, editableProps, richText } from "./NoteContentEditing"
import type { NoteHeadingBlock, NoteParagraphBlock } from "./types"

type EditTextBlock = NoteHeadingBlock | NoteParagraphBlock

type EditableTextLayoutInput = {
  readonly block: EditTextBlock
  readonly onInput: (event: FormEvent<HTMLElement>) => void
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
  onInput,
  onKeyDown,
  onTextChange
}: EditableTextLayoutInput): ReactElement => (
  <span
    {...editableProps(
      (editable) => onTextChange(editable.innerHTML),
      block.kind === "paragraph"
        ? `hn-note-text hn-note-text--${block.tone ?? "default"}`
        : undefined
    )}
    onInput={onInput}
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
        onOpenChange={(open) => ctx.onBlockMenuOpenChange(convertMenuId, open)}
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
    <>
      {block.eyebrow ? (
        <span className="hn-note-eyebrow">{block.eyebrow}</span>
      ) : null}
      {actionMenu}
      <HeadingTag className={`hn-note-heading hn-note-heading--${block.level}`}>
        {ctx.editable ? editableText : <span {...richText(block.text)} />}
      </HeadingTag>
    </>
  )
}
