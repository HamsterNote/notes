import type { BlockConvertTarget } from "./blockConversion"
import type { NoteBlockKind } from "./types"
import { assertNever } from "./utils"

export type { BlockConvertTarget } from "./blockConversion"

export type HeadingMenuItem = {
  readonly kind: "heading"
  readonly level: 1 | 2 | 3 | 4 | 5
  readonly label: string
}

export type StructuralMenuItem = {
  readonly kind: "paragraph" | "checklist" | "quote" | "code" | "callout"
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
  { kind: "checklist", label: "List" },
  { kind: "quote", label: "Quote" },
  { kind: "code", label: "Code" },
  { kind: "callout", label: "Callout" }
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
    case "checklist":
    case "quote":
    case "code":
    case "callout":
      return { kind: item.kind }
    default:
      return assertNever(item)
  }
}

export const blockKindLabel = (
  kind: NoteBlockKind,
  headingLevel?: 1 | 2 | 3 | 4 | 5
): string => {
  switch (kind) {
    case "heading":
      return `标题 ${headingLevel ?? 1}`
    case "paragraph":
      return "正文"
    case "checklist":
      return "List"
    case "quote":
      return "Quote"
    case "code":
      return "Code"
    case "callout":
      return "Callout"
    default:
      return assertNever(kind)
  }
}
