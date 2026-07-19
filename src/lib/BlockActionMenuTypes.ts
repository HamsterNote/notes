import type { BlockConvertTarget } from "./blockConversion"
import type { NoteBlock, NoteBlockKind } from "./types"
import { assertNever } from "./utils"

export type { BlockConvertTarget } from "./blockConversion"

export type HeadingMenuItem = {
  readonly kind: "heading"
  readonly level: 1 | 2 | 3 | 4 | 5
  readonly label: string
}

export type StructuralMenuItem = {
  readonly kind:
    | "paragraph"
    | "todo"
    | "unorderedList"
    | "orderedList"
    | "quote"
    | "code"
    | "callout"
    | "table"
    | "formula"
    | "directory"
    | "collapsible"
  readonly label: string
}

export type MenuItem = HeadingMenuItem | StructuralMenuItem

export const blockMenuItems: readonly MenuItem[] = [
  { kind: "heading", level: 1, label: "H1" },
  { kind: "heading", level: 2, label: "H2" },
  { kind: "heading", level: 3, label: "H3" },
  { kind: "heading", level: 4, label: "H4" },
  { kind: "heading", level: 5, label: "H5" },
  { kind: "paragraph", label: "正文" },
  { kind: "todo", label: "Todo" },
  { kind: "unorderedList", label: "Unordered List" },
  { kind: "orderedList", label: "Ordered List" },
  { kind: "quote", label: "Quote" },
  { kind: "code", label: "Code" },
  { kind: "callout", label: "Callout" },
  { kind: "table", label: "Table" },
  { kind: "formula", label: "公式" },
  { kind: "directory", label: "目录" },
  { kind: "collapsible", label: "Collapsible" }
] satisfies readonly (BlockConvertTarget & { readonly label: string })[]

export const isCurrentBlockMenuItem = (
  item: MenuItem,
  kind: NoteBlockKind,
  headingLevel?: 1 | 2 | 3 | 4 | 5
): boolean =>
  item.kind === "heading"
    ? kind === "heading" && headingLevel === item.level
    : kind === item.kind

export const blockMenuItemTarget = (item: MenuItem): BlockConvertTarget => {
  switch (item.kind) {
    case "heading":
      return { kind: "heading", level: item.level }
    case "paragraph":
    case "todo":
    case "unorderedList":
    case "orderedList":
    case "quote":
    case "code":
    case "callout":
    case "table":
    case "formula":
    case "directory":
    case "collapsible":
      return { kind: item.kind }
    default:
      return assertNever(item)
  }
}

/**
 * 返回某种 block kind 的人类可读标签。
 * 接受 NoteBlock["kind"]（包含 todo / unorderedList / orderedList 等列表类型），
 * 以便列表块也能复用同一份标签逻辑。
 */
export const blockKindLabel = (
  kind: NoteBlock["kind"],
  headingLevel?: 1 | 2 | 3 | 4 | 5
): string => {
  switch (kind) {
    case "heading":
      return `标题 ${headingLevel ?? 1}`
    case "paragraph":
      return "正文"
    case "todo":
      return "Todo"
    case "unorderedList":
      return "Unordered List"
    case "orderedList":
      return "Ordered List"
    case "quote":
      return "Quote"
    case "code":
      return "Code"
    case "callout":
      return "Callout"
    case "table":
      return "Table"
    case "formula":
      return "公式"
    case "picture":
      return "图片"
    case "directory":
      return "目录"
    case "collapsible":
      return "Collapsible"
    default:
      return assertNever(kind)
  }
}
