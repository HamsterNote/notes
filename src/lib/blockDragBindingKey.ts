import type { NoteBlock } from "./types"

const getBlockBindingKeys = (block: NoteBlock): readonly string[] => {
  switch (block.kind) {
    case "todo":
      return [
        `${block.id}:${block.kind}:${block.items.map((item) => item.id).join(",")}`
      ]
    case "quote":
      return [`${block.id}:${block.kind}:${block.text}`]
    case "collapsible":
      return [
        `${block.id}:${block.kind}:${block.collapsed}`,
        ...block.blocks.flatMap(getBlockBindingKeys)
      ]
    default:
      return [`${block.id}:${block.kind}`]
  }
}

export const getBlockBindingKey = (blocks: readonly NoteBlock[]): string =>
  blocks.flatMap(getBlockBindingKeys).join("\u0000")
