import { describe, expect, it } from "vitest"

import {
  buildReplacementFromShortcut,
  focusTargetIdFromShortcut,
  matchMarkdownShortcut
} from "./markdownShortcut"

describe("matchMarkdownShortcut", () => {
  describe("heading", () => {
    it.each([
      ["# ", 1],
      ["## ", 2],
      ["### ", 3],
      ["#### ", 4],
      ["##### ", 5]
    ])("matches `%s` as a level-%s heading", (input, level) => {
      // Given: an editable's textContent after typing the heading marker.
      // When: matching against the markdown shortcut table.
      const match = matchMarkdownShortcut(input)
      // Then: the match reports the correct heading level.
      expect(match).toEqual({ kind: "heading", level })
    })

    it("does not match six `#` because heading levels are capped at 5", () => {
      // NoteHeadingBlock.level 类型为 1|2|3|4|5，超出范围的 marker 不识别，
      // 避免生成与类型契约不符的块。
      expect(matchMarkdownShortcut("###### ")).toBeNull()
    })

    it("does not match `#` without a trailing space", () => {
      // 缺少尾随空格说明用户还没把 marker「确认」下来，可能继续输入别的字符。
      expect(matchMarkdownShortcut("#")).toBeNull()
    })

    it("does not match `# text` because there is extra text after the marker", () => {
      // 仅当空文本后立即按空格成立；用户继续输入后不应当被转回数字标题。
      expect(matchMarkdownShortcut("# text")).toBeNull()
    })
  })

  describe("checklist", () => {
    it("matches `[] ` as an unchecked checklist item", () => {
      expect(matchMarkdownShortcut("[] ")).toEqual({
        kind: "checklist",
        checked: false
      })
    })

    it("matches `[x] ` as a checked checklist item (lowercase x only)", () => {
      expect(matchMarkdownShortcut("[x] ")).toEqual({
        kind: "checklist",
        checked: true
      })
    })

    it("does not match `[X] ` because uppercase X is out of contract", () => {
      // 与 `blockSourceConversion.replaceChecklistItem` 的输出约定一致：
      // 勾选项以小写 `[x] ` 推导，大写 X 视为普通文本。
      expect(matchMarkdownShortcut("[X] ")).toBeNull()
    })

    it("does not match `[ ] ` (with a space between brackets) to keep the contract narrow", () => {
      // 需求只规定 `[] ` 与 `[x] ` 两种形式；`[ ] ` 不识别以保持规则简单。
      expect(matchMarkdownShortcut("[ ] ")).toBeNull()
    })

    it("does not match `[ ]` without trailing space", () => {
      expect(matchMarkdownShortcut("[]")).toBeNull()
    })
  })

  describe("quote", () => {
    it("matches `> ` as a quote block (legacy behavior preserved)", () => {
      // 既有 NoteTextBlock.handleInput 严格比较 `"> "`，本函数对其保持向后兼容。
      expect(matchMarkdownShortcut("> ")).toEqual({ kind: "quote" })
    })

    it("does not match `>` without trailing space", () => {
      expect(matchMarkdownShortcut(">")).toBeNull()
    })

    it("does not match `> keep this` because the marker must be the entire input", () => {
      expect(matchMarkdownShortcut("> keep this")).toBeNull()
    })
  })

  describe("code", () => {
    it("matches exactly three backticks as a code block (no trailing space required)", () => {
      expect(matchMarkdownShortcut("```")).toEqual({ kind: "code" })
    })

    it("does not match two backticks or four backticks", () => {
      expect(matchMarkdownShortcut("``")).toBeNull()
      expect(matchMarkdownShortcut("````")).toBeNull()
    })

    it("does not match three backticks followed by a space", () => {
      // 三反引号 + 空格视为普通 markdown 输入流程；本函数不识别该变体，
      // 避免与「用户先打三个反引号再继续输入语言名」的常见模式冲突。
      expect(matchMarkdownShortcut("``` ")).toBeNull()
    })
  })

  describe("normalization & edge cases", () => {
    it("treats &nbsp; (\\u00a0) as a regular space when matching `> `", () => {
      // 一些 IME / 粘贴路径会把空格转成 &nbsp; 仍应被识别为引用快捷键。
      expect(matchMarkdownShortcut(">\u00a0")).toEqual({ kind: "quote" })
    })

    it("strips zero-width spaces (\\u200B) before matching", () => {
      expect(matchMarkdownShortcut("\u200B> \u200B")).toEqual({
        kind: "quote"
      })
    })

    it("returns null when the input contains a newline", () => {
      // 防御：onInput 期间 contentEditable 不应出现换行（Enter 已 preventDefault 拆块）；
      // 仍保留此短路以避免在异常输入流中误判 marker。
      expect(matchMarkdownShortcut("# \nfoo")).toBeNull()
    })

    it("returns null for plain text without any marker", () => {
      expect(matchMarkdownShortcut("just text")).toBeNull()
      expect(matchMarkdownShortcut("")).toBeNull()
    })
  })
})

describe("buildReplacementFromShortcut", () => {
  it("builds an empty heading at the level indicated by the match", () => {
    const replacement = buildReplacementFromShortcut(
      { kind: "heading", level: 3 },
      "block-1"
    )
    // 初始 text 必须为空：onInput 触发瞬间 source.text 还残留 "# "，
    // 不复用 source.text 是为了防止 marker 污染新块的初始内容。
    expect(replacement).toEqual({
      id: "block-1",
      kind: "heading",
      level: 3,
      text: ""
    })
  })

  it("builds an empty checklist containing a single fresh item id", () => {
    const replacement = buildReplacementFromShortcut(
      { kind: "checklist", checked: true },
      "block-1"
    )
    expect(replacement).toEqual({
      id: "block-1",
      kind: "checklist",
      title: "",
      items: [{ id: expect.any(String), checked: true, text: "" }]
    })
  })

  it("builds an empty checklist with checked=false for the unchecked variant", () => {
    const replacement = buildReplacementFromShortcut(
      { kind: "checklist", checked: false },
      "block-1"
    )
    expect(replacement).toMatchObject({
      id: "block-1",
      kind: "checklist",
      items: [{ checked: false }]
    })
  })

  it("builds an empty quote", () => {
    const replacement = buildReplacementFromShortcut(
      { kind: "quote" },
      "block-1"
    )
    expect(replacement).toEqual({ id: "block-1", kind: "quote", text: "" })
  })

  it("builds an empty code block defaulted to plain-text language", () => {
    const replacement = buildReplacementFromShortcut(
      { kind: "code" },
      "block-1"
    )
    // language="text"：与可视化「转换菜单」中 convertBlockFormat 对 code 块的
    // 默认设置保持一致——避免默认为某种具体语言而误导用户。
    expect(replacement).toEqual({
      id: "block-1",
      kind: "code",
      language: "text",
      code: ""
    })
  })

  it("generates a fresh item id for each checklist replacement (no global reuse)", () => {
    const first = buildReplacementFromShortcut(
      { kind: "checklist", checked: false },
      "block-1"
    )
    const second = buildReplacementFromShortcut(
      { kind: "checklist", checked: false },
      "block-1"
    )
    if (first.kind !== "checklist" || second.kind !== "checklist") {
      throw new Error("Expected both replacements to be checklist blocks.")
    }
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id)
  })
})

describe("focusTargetIdFromShortcut", () => {
  it("selects the first checklist item id as focus target for a checklist match", () => {
    // 块容器本身没有 contentEditable；可编辑根是 item.id，
    // requestFocus 必须用 item.id 才能让 useBlockEditing 找到正确节点。
    const replacement = buildReplacementFromShortcut(
      { kind: "checklist", checked: false },
      "block-1"
    )
    if (replacement.kind !== "checklist") {
      throw new Error("Expected a checklist replacement.")
    }
    const itemId = replacement.items[0]?.id
    if (itemId === undefined) throw new Error("Expected a checklist item id.")
    expect(
      focusTargetIdFromShortcut({ kind: "checklist", checked: false }, replacement)
    ).toBe(itemId)
  })

  it("returns the block id for heading / quote / code matches", () => {
    // heading / quote / code 的 contentEditable 都建在 block.id 上，
    // 与 `NoteBlockFocus.editableIds` 的归类一致。
    const heading = buildReplacementFromShortcut(
      { kind: "heading", level: 1 },
      "block-1"
    )
    const quote = buildReplacementFromShortcut({ kind: "quote" }, "block-2")
    const code = buildReplacementFromShortcut({ kind: "code" }, "block-3")
    expect(
      focusTargetIdFromShortcut({ kind: "heading", level: 1 }, heading)
    ).toBe("block-1")
    expect(focusTargetIdFromShortcut({ kind: "quote" }, quote)).toBe("block-2")
    expect(focusTargetIdFromShortcut({ kind: "code" }, code)).toBe("block-3")
  })
})