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
  /**
   * 主题色（CSS 颜色字符串），影响徽章、边框、高亮等强调元素。
   * 传入后组件会在根节点设置 `--hn-theme` CSS 变量。
   * 默认值: "#3b82f6"（蓝色）
   */
  readonly themeColor?: string
  /**
   * 是否开启内联编辑。
   * 开启后标题、摘要、各文本字段变为 contentEditable，
   * checklist 复选框可点击切换，callout/quote/code 等文本均可直接编辑。
   * 默认值: false（只读展示模式）
   */
  readonly editable?: boolean
  /** 标题变更回调（仅 editable=true 时触发） */
  readonly onTitleChange?: (title: string) => void
  /** 摘要变更回调 */
  readonly onSummaryChange?: (summary: string) => void
  /** 内容块变更回调，参数为完整的最新 blocks 数组（不可变更新） */
  readonly onBlocksChange?: (blocks: NoteBlock[]) => void
}
