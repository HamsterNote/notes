import type { NoteCalloutTone, NoteBlock } from "./types"

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

export const getReadingMinutes = (blocks: readonly NoteBlock[]): number => {
  const totalWords = blocks.reduce((count, block) => {
    switch (block.kind) {
      case "heading":
        return count + block.text.split(/\s+/u).length
      case "paragraph":
        return count + block.text.split(/\s+/u).length
      case "checklist":
        return count + block.items.reduce((itemCount, item) => itemCount + item.text.split(/\s+/u).length, 0)
      case "quote":
        return count + block.text.split(/\s+/u).length
      case "code":
        return count + Math.max(8, block.code.split(/\s+/u).length)
      case "callout":
        return count + block.text.split(/\s+/u).length
      default:
        return assertNever(block)
    }
  }, 0)

  return Math.max(1, Math.round(totalWords / 160))
}
