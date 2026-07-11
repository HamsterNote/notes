export const noteBlockKinds = {
  heading: "heading",
  paragraph: "paragraph",
  checklist: "checklist",
  quote: "quote",
  code: "code",
  callout: "callout"
} as const

export type NoteBlockKind = (typeof noteBlockKinds)[keyof typeof noteBlockKinds]

export type NoteHeadingBlock = {
  readonly id: string
  readonly kind: "heading"
  readonly level: 1 | 2 | 3
  readonly text: string
  readonly eyebrow?: string
}

export type NoteParagraphBlock = {
  readonly id: string
  readonly kind: "paragraph"
  readonly text: string
  readonly tone?: "default" | "muted" | "accent"
}

export type NoteChecklistItem = {
  readonly id: string
  readonly checked: boolean
  readonly text: string
}

export type NoteChecklistBlock = {
  readonly id: string
  readonly kind: "checklist"
  readonly title: string
  readonly items: readonly NoteChecklistItem[]
}

export type NoteQuoteBlock = {
  readonly id: string
  readonly kind: "quote"
  readonly text: string
  readonly author?: string
}

export type NoteCodeBlock = {
  readonly id: string
  readonly kind: "code"
  readonly language: string
  readonly filename?: string
  readonly code: string
}

export type NoteCalloutTone = "info" | "success" | "warning"

export type NoteCalloutBlock = {
  readonly id: string
  readonly kind: "callout"
  readonly tone: NoteCalloutTone
  readonly title: string
  readonly text: string
}

export type NoteBlock =
  | NoteHeadingBlock
  | NoteParagraphBlock
  | NoteChecklistBlock
  | NoteQuoteBlock
  | NoteCodeBlock
  | NoteCalloutBlock

export type NoteContentProps = {
  readonly blocks: readonly NoteBlock[]
  readonly title: string
  readonly summary?: string
  readonly updatedAt?: string
  readonly tagLabel?: string
}
