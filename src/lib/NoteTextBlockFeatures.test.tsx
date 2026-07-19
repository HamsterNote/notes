/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const blockFixture = (
  input:
    | { readonly id: string; readonly kind: "paragraph"; readonly text: string }
    | {
        readonly id: string
        readonly kind: "heading"
        readonly level: 2 | 3
        readonly text: string
      }
): NoteBlock =>
  input.kind === "heading"
    ? { id: input.id, kind: "heading", level: input.level, text: input.text }
    : { id: input.id, kind: "paragraph", text: input.text }

const TextBlockHarness = ({ initialBlock }: { initialBlock: NoteBlock }) => {
  const [blocks, setBlocks] = useState<readonly NoteBlock[]>([initialBlock])

  return (
    <NoteContent
      blocks={blocks}
      title="Text block features"
      editable
      onBlocksChange={setBlocks}
    />
  )
}

// 等待 text 块被替换成 survival selector 命中的目标块。
// waitFor 内部 query 命中后即视为转换完成。
const waitForBlock = async (
  view: ReturnType<typeof render>,
  selector: string
): Promise<Element | null> =>
  waitFor(() => {
    const node = view.container.querySelector(selector)
    expect(node).not.toBeNull()
    return node
  })

const typeIntoEditable = (
  view: ReturnType<typeof render>,
  blockId: string,
  text: string
): void => {
  const editable = view.container.querySelector<HTMLElement>(
    `[data-editable-block-id="${blockId}"]`
  )
  if (!editable)
    throw new Error(`Expected editable block ${blockId}.`)
  // 模拟用户键入触发字符串后 onInput 触发瞬间看到的 textContent。
  editable.focus()
  editable.textContent = text
  fireEvent.input(editable, { inputType: "insertText", data: " " })
}

describe("NoteContent markdown shortcuts", () => {
  describe("heading shortcut (`# ` … `##### `)", () => {
    it.each([
      ["# ", 1],
      ["## ", 2],
      ["### ", 3],
      ["#### ", 4],
      ["##### ", 5]
    ])(
      "converts `%s` into a focused heading level %s on a paragraph",
      async (marker, level) => {
        // Given: an empty editable paragraph.
        const view = render(
          <TextBlockHarness
            initialBlock={{ id: "p", kind: "paragraph", text: "" }}
          />
        )

        // When: the user types the heading marker.
        typeIntoEditable(view, "p", marker)

        // Then: the same block becomes a heading at the requested level.
        const heading = await waitForBlock(view, `.hn-note-heading--${level}`)
        expect(heading?.textContent).toBe("")
      }
    )

    it("does not convert `###### ` because heading levels are capped at 5", async () => {
      const view = render(
        <TextBlockHarness
          initialBlock={{ id: "p", kind: "paragraph", text: "" }}
        />
      )

      typeIntoEditable(view, "p", "###### ")

      // 仍为段落（不存在任何 heading）
      // 给 onInput 时间处理后再判断：waitFor 内 querySelector 期望 null 走Rejected 路径，
      // 改用 setTimeout 0 后断言，避免误把同步未渲染状态当作结论。
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(view.container.querySelector(".hn-note-heading")).toBeNull()
      expect(
        view.container.querySelector('[data-editable-block-id="p"]')
          ?.closest(".hn-note-text")
      ).not.toBeNull()
    })

    it("preserves heading level when the shortcut fires on an existing heading", async () => {
      // Given: a heading at level 2.
      const view = render(
        <TextBlockHarness
          initialBlock={{ id: "h", kind: "heading", level: 2, text: "" }}
        />
      )

      // When: the user types `### ` to upgrade it to level 3.
      typeIntoEditable(view, "h", "### ")

      // Then: the same block becomes a level-3 heading.
      const heading = await waitForBlock(view, ".hn-note-heading--3")
      expect(heading?.textContent).toBe("")
    })
  })

  it.each([
    { id: "dash-paragraph", kind: "paragraph", text: "", marker: "- " } as const,
    { id: "dash-heading", kind: "heading", level: 2, text: "", marker: "- " } as const,
    { id: "num-paragraph", kind: "paragraph", text: "", marker: "1. " } as const,
    { id: "num-heading", kind: "heading", level: 3, text: "", marker: "2. " } as const
  ])(
    "converts a $kind to a focused list when its text becomes `$marker`",
    async (testCase) => {
      const view = render(
        <TextBlockHarness
          initialBlock={blockFixture(
            testCase.kind === "heading"
              ? {
                  id: testCase.id,
                  kind: "heading",
                  level: testCase.level,
                  text: testCase.text
                }
              : { id: testCase.id, kind: "paragraph", text: testCase.text }
          )}
        />
      )
      const editable = view.container.querySelector<HTMLElement>(
        `[data-editable-block-id="${testCase.id}"]`
      )
      if (!editable) throw new Error(`Expected editable block ${testCase.id}.`)

      editable.focus()
      editable.textContent = testCase.marker
      fireEvent.input(editable, { data: " ", inputType: "insertText" })

      const expectedClass =
        testCase.marker === "- " ? "hn-note-unordered-list" : "hn-note-ordered-list"

      await waitFor(() => {
        const listItem = view.container.querySelector<HTMLElement>(
          `[data-editable-block-id="${testCase.id}"]`
        )
        expect(listItem?.closest(`.${expectedClass}`)).not.toBeNull()
        expect(listItem?.textContent).toBe("")
        expect(document.activeElement).toBe(listItem)
      })
    }
  )

  describe("checklist shortcut (`[] ` / `[x] `)", () => {
    it("converts `[] ` into an unchecked checklist item", async () => {
      const view = render(
        <TextBlockHarness
          initialBlock={{ id: "p", kind: "paragraph", text: "" }}
        />
      )

      typeIntoEditable(view, "p", "[] ")

      // 渲染出 checklist item 与未勾选空心圆 ○
      const item = await waitForBlock(view, ".hn-note-checklist-item")
      const checkbox = item?.querySelector(".hn-note-checkbox")
      expect(checkbox?.textContent).toBe("○")
    })

    it("converts `[x] ` into a checked checklist item", async () => {
      const view = render(
        <TextBlockHarness
          initialBlock={{ id: "p", kind: "paragraph", text: "" }}
        />
      )

      typeIntoEditable(view, "p", "[x] ")

      const item = await waitForBlock(view, ".hn-note-checklist-item")
      const checkbox = item?.querySelector(".hn-note-checkbox")
      expect(checkbox?.textContent).toBe("●")
    })

    it("does not convert `[X] ` (uppercase X variant) into a checklist", async () => {
      const view = render(
        <TextBlockHarness
          initialBlock={{ id: "p", kind: "paragraph", text: "" }}
        />
      )

      typeIntoEditable(view, "p", "[X] ")

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(view.container.querySelector(".hn-note-checklist-item")).toBeNull()
      // 仍是段落
      expect(
        view.container
          .querySelector('[data-editable-block-id="p"]')
          ?.closest(".hn-note-text")
      ).not.toBeNull()
    })
  })

  describe("code shortcut (```)", () => {
    it("converts three backticks immediately into a code block without trailing space", async () => {
      const view = render(
        <TextBlockHarness
          initialBlock={{ id: "p", kind: "paragraph", text: "" }}
        />
      )

      typeIntoEditable(view, "p", "```")

      const codeCard = await waitForBlock(view, ".hn-note-code-card")
      // 默认语言为 text，与可视化「转换菜单」中 code 块的默认值一致
      const langSelect = codeCard?.querySelector<HTMLSelectElement>(
        ".hn-note-code-lang-select"
      )
      expect(langSelect?.value).toBe("text")
    })

    it("does not convert three backticks followed by a space (``` )", async () => {
      const view = render(
        <TextBlockHarness
          initialBlock={{ id: "p", kind: "paragraph", text: "" }}
        />
      )

      typeIntoEditable(view, "p", "``` ")

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(view.container.querySelector(".hn-note-code-card")).toBeNull()
    })
  })

  describe("quote shortcut (`> `) — legacy behavior preserved", () => {
    it.each([
      { id: "paragraph", kind: "paragraph", text: "" } as const,
      { id: "heading", kind: "heading", level: 2, text: "" } as const
    ])(
      "converts a $kind to a focused quote when its text becomes `> `",
      async (block) => {
        // Given: an empty editable text block.
        const view = render(<TextBlockHarness initialBlock={block} />)
        const editable = view.container.querySelector<HTMLElement>(
          `[data-editable-block-id="${block.id}"]`
        )
        if (!editable) throw new Error(`Expected editable block ${block.id}.`)

        // When: the user types the quote shortcut marker.
        editable.focus()
        editable.textContent = "> "
        fireEvent.input(editable, { data: " ", inputType: "insertText" })

        // Then: the same block becomes an empty quote and keeps editing focus.
        await waitFor(() => {
          const quote = view.container.querySelector<HTMLElement>(
            `[data-editable-block-id="${block.id}"]`
          )
          expect(quote?.closest(".hn-note-quote")).not.toBeNull()
          expect(quote?.textContent).toBe("")
          expect(document.activeElement).toBe(quote)
        })
      }
    )

    it("does not convert a paragraph whose text merely starts with the quote marker", () => {
      // Given: an empty editable paragraph.
      const view = render(
        <TextBlockHarness
          initialBlock={{ id: "paragraph", kind: "paragraph", text: "" }}
        />
      )
      const editable = view.container.querySelector<HTMLElement>(
        '[data-editable-block-id="paragraph"]'
      )
      if (!editable) throw new Error("Expected editable paragraph.")

      // When: its text contains more than the exact shortcut marker.
      editable.textContent = "> keep this"
      fireEvent.input(editable, { data: "s", inputType: "insertText" })

      // Then: it remains a paragraph.
      expect(editable.closest(".hn-note-quote")).toBeNull()
      expect(editable.textContent).toBe("> keep this")
    })
  })
})