import type { Ref } from "react"

export const noteBlockKinds = {
  heading: "heading",
  paragraph: "paragraph",
  todo: "todo",
  unorderedList: "unorderedList",
  orderedList: "orderedList",
  quote: "quote",
  code: "code",
  callout: "callout",
  table: "table",
  formula: "formula",
  picture: "picture",
  directory: "directory",
  collapsible: "collapsible",
  checklist: "checklist"
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

export type NoteTodoItem = {
  readonly id: string
  readonly checked: boolean
  readonly text: string
}

export type NoteTodoBlock = {
  readonly id: string
  readonly kind: "todo"
  readonly title: string
  readonly items: readonly NoteTodoItem[]
}

export type NoteUnorderedListBlock = {
  readonly id: string
  readonly kind: "unorderedList"
  readonly text: string
}

export type NoteOrderedListBlock = {
  readonly id: string
  readonly kind: "orderedList"
  readonly text: string
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

/** 公式块。formula 保存原始 LaTeX 源码，由渲染层以 display mode 展示。 */
export type NoteFormulaBlock = {
  readonly id: string
  readonly kind: "formula"
  readonly formula: string
}

/** 图片块。url 由宿主上传回调返回，filename 同时作为图片替代文本。 */
export type NotePictureBlock = {
  readonly id: string
  readonly kind: "picture"
  readonly url: string
  readonly filename: string
  readonly width?: number
  readonly height?: number
}

export type NoteDirectoryBlock = {
  readonly id: string
  readonly kind: "directory"
}

/**
 * 收缩块。可折叠/展开的容器型块，内部 blocks 可嵌套任意 NoteBlock（含 collapsible 自身）。
 * 展开后，内部完整内容块可通过拖拽手柄在容器内排序，也可在正文与折叠块之间移动。
 */
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

export type NoteCollapsibleBlock = {
  readonly id: string
  readonly kind: "collapsible"
  readonly title: string
  readonly collapsed: boolean
  readonly blocks: readonly NoteBlock[]
}

export type NoteBlock =
  | NoteHeadingBlock
  | NoteParagraphBlock
  | NoteTodoBlock
  | NoteUnorderedListBlock
  | NoteOrderedListBlock
  | NoteQuoteBlock
  | NoteCodeBlock
  | NoteCalloutBlock
  | NoteTableBlock
  | NoteFormulaBlock
  | NotePictureBlock
  | NoteDirectoryBlock
  | NoteChecklistBlock
  | NoteCollapsibleBlock

export const noteListLikeBlockKinds = [
  "todo",
  "unorderedList",
  "orderedList"
] as const

export type NoteListLikeBlockKind = (typeof noteListLikeBlockKinds)[number]

export const isListLikeBlockKind = (
  kind: NoteBlock["kind"]
): kind is NoteListLikeBlockKind =>
  kind === "todo" || kind === "unorderedList" || kind === "orderedList"

export type NoteTheme = "light" | "dark"

/** 可在编辑区通过 @ 选择并插入的链接对象。 */
export interface NoteLink {
  readonly id: string
  readonly name: string
}

export type NoteContentProps = {
  readonly blocks: readonly NoteBlock[]
  /** 输入 @ 时展示的可选链接列表。 */
  readonly links?: readonly NoteLink[]
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
   * todo 复选框可点击切换，callout/quote/code 等文本均可直接编辑。
   * 默认值: false（只读展示模式）
   */
  readonly editable?: boolean
  /**
   * 是否开启内容块选择模式。
   * 开启后 selectMode 优先于 editable，所有内容保持只读；点击内容块时高亮该块。
   * 默认值: false
   */
  readonly selectMode?: boolean
  /** 选择模式下点击内容块时触发，参数为被选块或子条目的 id（如 todo 单条目）。 */
  readonly onBlockSelect?: (blockId: string) => void
  /** 标题变更回调（仅 editable=true 时触发） */
  readonly onTitleChange?: (title: string) => void
  /** 摘要变更回调 */
  readonly onSummaryChange?: (summary: string) => void
  /** 内容块变更回调，参数为完整的最新 blocks 数组（不可变更新） */
  readonly onBlocksChange?: (blocks: NoteBlock[]) => void
  /**
   * 图片上传回调。base64 是浏览器 FileReader 生成的完整 data URL，
   * Promise 成功值应为最终用于展示图片的 URL。
   */
  readonly onPictureUpload?: (
    base64: string,
    filename: string
  ) => Promise<string>
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
  /**
   * @ 链接点击回调。当用户点击正文里已插入的 @ mention pill 时触发，
   * 参数为该 mention 对应的 NoteLink.id，由宿主决定后续跳转或展示逻辑。
   */
  readonly onLinkClick?: (id: string) => void
  /** 撤销/重做控制器实例（外部注入模式） */
  readonly undoRedoController?: NoteContentUndoRedoController
  /**
   * 内容顶部额外留白（px）。
   * 叠加在 hero 默认顶部内边距（2rem）之上，默认值: 0。
   */
  readonly topPadding?: number
  /**
   * 内容底部额外留白（px）。
   * 叠加在 body 默认底部内边距（2rem）之上，默认值: 0。
   */
  readonly bottomPadding?: number
  /** React 19 ref 手柄；同时提供撤销/重做与按内容 id 跳转能力。 */
  readonly ref?: Ref<NoteContentHandle>
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
 * NoteContent 组件对宿主暴露的完整 ref 手柄。
 * `scrollToBlock` 可定位块 id，也可定位 todo 条目 id。
 */
export type NoteContentHandle = NoteContentUndoRedoHandle & {
  readonly scrollToBlock: (blockId: string) => boolean
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
