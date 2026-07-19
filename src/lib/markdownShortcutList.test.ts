import { describe, expect, it } from "vitest"

import {
  buildReplacementFromShortcut,
  focusTargetIdFromShortcut,
  matchMarkdownShortcut
} from "./markdownShortcut"

describe("markdown list shortcuts", () => {
  it.each([
    ["- ", "unorderedList"],
    ["1. ", "orderedList"],
    ["27. ", "orderedList"]
  ] as const)("matches `%s` as %s", (marker, kind) => {
    // Given: contentEditable 中只有一个完整的列表 marker。
    // When: 统一的 Markdown 快捷输入解析器处理它。
    const match = matchMarkdownShortcut(marker)

    // Then: 返回对应列表块类型，而不是让 marker 留在普通文本块中。
    expect(match).toEqual({ kind })
  })

  it.each(["-", "1.", "1. text", "- text"])(
    "does not match incomplete or non-empty marker `%s`",
    (marker) => {
      expect(matchMarkdownShortcut(marker)).toBeNull()
    }
  )

  it.each(["unorderedList", "orderedList"] as const)(
    "builds and focuses an empty %s block",
    (kind) => {
      const match =
        kind === "unorderedList"
          ? ({ kind: "unorderedList" } as const)
          : ({ kind: "orderedList" } as const)
      const replacement = buildReplacementFromShortcut(match, "block-1")

      expect(replacement).toEqual({ id: "block-1", kind, text: "" })
      expect(focusTargetIdFromShortcut(match, replacement)).toBe("block-1")
    }
  )
})
