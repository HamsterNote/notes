import { type Ref } from "react"

export const noteBlockKinds = {
  heading: "heading",
  paragraph: "paragraph",
  checklist: "checklist",
  quote: "quote",
  code: "code",
  callout: "callout",
  table: "table"
} as const

export type NoteBlockKind = (typeof noteBlockKinds)[keyof typeof noteBlockKinds]

export type NoteHeadingBlock = {
  readonly id: string
  readonly kind: "heading"
  readonly level: 1 | 2 | 3 | 4 | 5
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

/**
 * 表格块。rows 为二维数组，rows[r][c] 表示第 r 行第 c 列单元格的富文本 HTML。
 * 第一行（rows[0]）作为表头。每个单元格文本内换行用 <br> 表示。
 */
export type NoteTableBlock = {
  readonly id: string
  readonly kind: "table"
  readonly rows: readonly (readonly string[])[]
}

export type NoteBlock =
  | NoteHeadingBlock
  | NoteParagraphBlock
  | NoteChecklistBlock
  | NoteQuoteBlock
  | NoteCodeBlock
  | NoteCalloutBlock
  | NoteTableBlock

export type NoteTheme = "light" | "dark"

export type NoteContentProps = {
  readonly blocks: readonly NoteBlock[]
  readonly title: string
  readonly summary?: string
  readonly updatedAt?: string
  readonly tagLabel?: string
  /** 组件内容主题。外层背景与容器装饰仍由使用方负责。默认值: "light" */
  readonly theme?: NoteTheme
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
  /**
   * 魔法链接配置回调。在选区弹出层的"链接"配置面板中点击"魔法链接"按钮时调用。
   * 为 async 函数，返回的字符串将作为链接的 URL（建议以 `hnmagic://` 开头以便识别）。
   */
  readonly onMagicLinkConfigure?: () => Promise<string>
  /**
   * 魔法链接点击回调。当用户点击以 `hnmagic://` 开头的链接时触发，
   * 同时会禁止原生链接跳转能力，将控制权交给宿主。
   */
  readonly onMagicLinkClick?: (url: string) => void
  /** 撤销/重做控制器实例（外部注入模式） */
  readonly undoRedoController?: NoteContentUndoRedoController
  /** React 19 ref 手柄，暴露 undo/redo 方法（对内编辑模式） */
  readonly ref?: Ref<NoteContentUndoRedoHandle>
}

// ── Undo/Redo public types ──────────────────────────────────────────────────

/**
 * 某一时刻的笔记内容快照，供 undo/redo 系统消费。
 */
export type NoteContentUndoRedoSnapshot = {
  readonly title: string
  readonly summary?: string
  readonly blocks: readonly NoteBlock[]
}

/**
 * 对外暴露的撤销/重做手柄。
 * 宿主可通过 ref 或 controller 绑定到 NoteContent 组件。
 */
export type NoteContentUndoRedoHandle = {
  readonly undo: () => boolean
  readonly redo: () => boolean
  readonly canUndo: () => boolean
  readonly canRedo: () => boolean
  readonly resetHistory: () => void
}

/**
 * NoteContentUndoRedoHandle 的别名，语义上区分“由外部注入的控制器”。
 */
export type NoteContentUndoRedoController = NoteContentUndoRedoHandle

/**
 * `useNoteContentUndoRedo` hook 的返回值类型。
 * 包含当前快照、变更方法、撤销/重做状态与方法以及控制器实例。
 */
export type UseNoteContentUndoRedoResult = {
  readonly present: NoteContentUndoRedoSnapshot
  readonly setTitle: (title: string) => void
  readonly setSummary: (summary: string | undefined) => void
  readonly setBlocks: (blocks: readonly NoteBlock[]) => void
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undo: () => boolean
  readonly redo: () => boolean
  readonly resetHistory: (nextSnapshot?: NoteContentUndoRedoSnapshot) => void
  readonly controller: NoteContentUndoRedoController
}
