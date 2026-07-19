import type { NoteBlock, NoteCalloutTone, NoteHeadingBlock } from "./types"

type HeadingLevelTag = "h1" | "h2" | "h3" | "h4" | "h5"

export const assertNever = (value: never): never => {
  throw new Error(`Unhandled note block: ${JSON.stringify(value)}`)
}

export const formatUpdatedAt = (value: string): string => {
  const date = new Date(value)

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(date)
}

export const calloutToneLabelMap: Record<NoteCalloutTone, string> = {
  info: "Info",
  success: "Ready",
  warning: "Watch"
}

export const headingLevelClassName = (
  level: NoteHeadingBlock["level"]
): string => {
  switch (level) {
    case 1:
      return "hn-note-heading hn-note-heading--1"
    case 2:
      return "hn-note-heading hn-note-heading--2"
    case 3:
      return "hn-note-heading hn-note-heading--3"
    case 4:
      return "hn-note-heading hn-note-heading--4"
    case 5:
      return "hn-note-heading hn-note-heading--5"
    default:
      return assertNever(level)
  }
}

export const headingLevelTag = (
  level: NoteHeadingBlock["level"]
): HeadingLevelTag => {
  switch (level) {
    case 1:
      return "h1"
    case 2:
      return "h2"
    case 3:
      return "h3"
    case 4:
      return "h4"
    case 5:
      return "h5"
    default:
      return assertNever(level)
  }
}

const countBlockWords = (block: NoteBlock): number => {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "quote":
    case "callout":
      return block.text.split(/\s+/u).length
    case "todo":
    case "checklist":
      return block.items.reduce(
        (itemCount, item) => itemCount + item.text.split(/\s+/u).length,
        0
      )
    case "unorderedList":
    case "orderedList":
      return block.text.split(/\s+/u).length
    case "code":
      return Math.max(8, block.code.split(/\s+/u).length)
    case "table":
      return block.rows.reduce(
        (cellCount, row) =>
          cellCount +
          row.reduce(
            (rowCount, cell) => rowCount + cell.split(/\s+/u).length,
            0
          ),
        0
      )
    case "formula":
      return Math.max(4, block.formula.split(/\s+/u).length)
    case "collapsible":
      // 容器块：标题字数 + 递归统计内部子块
      return (
        block.title.split(/\s+/u).length +
        block.blocks.reduce((sum, child) => sum + countBlockWords(child), 0)
      )
    case "picture":
    case "directory":
      return 0
    default:
      return assertNever(block)
  }
}

export const getReadingMinutes = (blocks: readonly NoteBlock[]): number => {
  const totalWords = blocks.reduce(
    (count, block) => count + countBlockWords(block),
    0
  )

  return Math.max(1, Math.round(totalWords / 160))
}
