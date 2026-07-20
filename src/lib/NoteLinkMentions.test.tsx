/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock, NoteLink } from "./types"

const links: readonly NoteLink[] = [
  { id: "roadmap", name: "Product roadmap" },
  { id: "release-notes", name: "Release notes" }
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const MentionHarness = ({ onLinkClick }: { onLinkClick?: (id: string) => void }) => {
  const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
    { id: "paragraph", kind: "paragraph", text: "" }
  ])

  return (
    <NoteContent
      blocks={blocks}
      links={links}
      title="Mention links"
      editable
      onBlocksChange={setBlocks}
      {...(onLinkClick ? { onLinkClick } : {})}
    />
  )
}

const typeAtCaret = (editable: HTMLElement, text: string): void => {
  editable.focus()
  // 追加模式：若 editable 已有 text node 且新 text 是旧 text 的扩展，
  // 只 appendData 追加新字符，保留原 text node —— 这样 live triggerRange、
  // dismiss 标记（text node + offset）才能在连续输入时保持有效，
  // 行为也更贴近真实用户逐字输入。
  const existing = editable.firstChild
  if (existing instanceof Text && text.startsWith(existing.data) && text !== existing.data) {
    const appended = text.slice(existing.data.length)
    existing.appendData(appended)
    const range = document.createRange()
    range.setStart(existing, text.length)
    range.collapse(true)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected document selection.")
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.input(editable, { data: appended.at(-1), inputType: "insertText" })
    return
  }
  editable.textContent = text
  const textNode = editable.firstChild
  if (!textNode) throw new Error("Expected editable text node.")

  const range = document.createRange()
  range.setStart(textNode, text.length)
  range.collapse(true)
  const selection = window.getSelection()
  if (!selection) throw new Error("Expected document selection.")
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.input(editable, { data: text.at(-1), inputType: "insertText" })
}

const editableParagraph = (container: HTMLElement): HTMLElement => {
  const editable = container.querySelector<HTMLElement>(
    '[data-editable-block-id="paragraph"]'
  )
  if (!editable) throw new Error("Expected editable paragraph.")
  return editable
}

/** 把光标手动设到 editable 文本节点的指定 offset，并派发 selectionchange 事件。
 *  包在 act() 里确保 useEffect（依赖 menu）先重新绑定 selectionchange 监听器，
 *  否则在 menu 刚打开后立即派发 selectionchange 会被旧闭包吞掉（menu === null 不动作）。 */
const moveCaretTo = (editable: HTMLElement, offset: number): void => {
  const textNode = editable.firstChild
  if (!textNode) throw new Error("Expected editable text node.")
  act(() => {
    const range = document.createRange()
    range.setStart(textNode, offset)
    range.collapse(true)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected document selection.")
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
  })
}

describe("NoteContent link mentions", () => {
  it("opens the link options when the user types @ in editable content", () => {
    // Given: an editable paragraph and a list of links.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)

    // When: the user types an @ at the caret.
    typeAtCaret(editable, "Meet @")

    // Then: the available links appear in a listbox below the caret.
    expect(screen.getByRole("listbox", { name: "可选链接" }).hidden).toBe(false)
    expect(
      screen
        .getByRole("option", { name: "Product roadmap" })
        .getAttribute("aria-selected")
    ).toBe("true")
    expect(
      screen.getByRole("option", { name: "Release notes" }).hidden
    ).toBe(false)
  })

  it("moves the active option with arrow keys and inserts it with Enter", () => {
    // Given: an open link option list.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)
    typeAtCaret(editable, "Meet @")

    // When: the user moves down and confirms the second option.
    fireEvent.keyDown(editable, { key: "ArrowDown" })
    expect(
      screen
        .getByRole("option", { name: "Release notes" })
        .getAttribute("aria-selected")
    ).toBe("true")
    fireEvent.keyDown(editable, { key: "Enter" })

// Then: the trigger is replaced by a persisted inline mention.
    expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()
    const mention = editable.querySelector<HTMLElement>(
      '[data-note-link-id="release-notes"]'
    )
    expect(mention?.textContent).toBe("Release notes")
    expect(editable.textContent).toBe("Meet Release notes\u00a0")
  })

  it("closes the link options with Escape without changing content", () => {
    // Given: an open link option list.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)
    typeAtCaret(editable, "Meet @")

    // When: the user presses Escape.
    fireEvent.keyDown(editable, { key: "Escape" })

    // Then: the options close and the typed trigger remains untouched.
    expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()
    expect(editable.textContent).toBe("Meet @")
  })

  it("keeps the menu closed after Escape even if the user keeps typing into the same @", () => {
    // Given: an @ trigger whose menu was dismissed with Escape.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)
    typeAtCaret(editable, "Meet @")
    fireEvent.keyDown(editable, { key: "Escape" })
    expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()

    // When: the user continues typing into the same @ trigger.
    typeAtCaret(editable, "Meet @r")

    // Then: the menu stays closed — the dismiss mark suppresses re-opening.
    expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()
    expect(editable.textContent).toBe("Meet @r")
  })

  it("closes the link options when the caret moves to the left of the @ trigger", () => {
    // Given: an open link option list.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)
    typeAtCaret(editable, "Meet @")

    // When: the caret moves to the left of the @ (manual selection + selectionchange).
    // "Meet @" 中 @ 位于 offset 5，把光标移到 offset 5 即位于触发 @ 起始处。
    moveCaretTo(editable, 5)

    // Then: the options close — cursor at or left of the trigger @ closes the menu.
    expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()
    expect(editable.textContent).toBe("Meet @")
  })

  it("filters the options by the query typed after @", () => {
    // Given: an editable paragraph.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)

    // When: the user types @ followed by a query that matches only one link.
    typeAtCaret(editable, "Meet @rel")

    // Then: only the matching link remains in the listbox.
    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(1)
    expect(options[0]?.textContent).toContain("Release notes")
    expect(
      screen.queryByRole("option", { name: "Product roadmap" })
    ).toBeNull()
  })

  it("keeps the listbox open with an empty-state hint when no link matches the query", () => {
    // Given: an editable paragraph.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)

    // When: the user types @ followed by a query that matches nothing.
    typeAtCaret(editable, "Meet @zzz")

    // Then: the listbox stays open and shows a non-interactive empty hint.
    const listbox = screen.getByRole("listbox", { name: "可选链接" })
    expect(listbox.hidden).toBe(false)
    expect(screen.queryByRole("option")).toBeNull()
    const hint = listbox.querySelector(".hn-note-mention-empty")
    expect(hint?.textContent).toBe("无匹配结果")
  })

  it("closes the link options when the editable loses focus", () => {
    // Given: an open link option list.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)
    typeAtCaret(editable, "Meet @")
    expect(screen.getByRole("listbox", { name: "可选链接" }).hidden).toBe(false)

    // When: the editable fires focusout (focus leaves the editable).
    fireEvent.focusOut(editable)

    // Then: the options close — blur of the trigger editable closes the menu.
    expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()
  })

  it("replaces the whole @query range with a mention pill when confirming with Enter", () => {
    // Given: an open menu with a query that narrows to a single link.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)
    typeAtCaret(editable, "Meet @rel")

    // When: the user presses Enter on the single filtered option.
    fireEvent.keyDown(editable, { key: "Enter" })

    // Then: the entire `@rel` range is replaced by the mention pill + nbsp spacer.
    expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()
    const mention = editable.querySelector<HTMLElement>(
      '[data-note-link-id="release-notes"]'
    )
    expect(mention?.textContent).toBe("Release notes")
    expect(editable.textContent).toBe("Meet Release notes\u00a0")
  })

  it("replaces the whole @query range with a mention pill when clicking an option", () => {
    // Given: an open menu with a query that narrows to a single link.
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)
    typeAtCaret(editable, "Meet @rel")

    // When: the user clicks the single filtered option.
    const option = screen.getByRole("option")
    fireEvent.click(option)

    // Then: the entire `@rel` range is replaced by the mention pill + nbsp spacer.
    expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()
    expect(editable.textContent).toBe("Meet Release notes\u00a0")
  })

  it("places the options above the caret when they would overflow the viewport", () => {
    // Given: a caret close to the bottom of the viewport.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains("hn-note-mention-menu")) {
          const top = Number.parseFloat(this.style.top)
          return DOMRect.fromRect({ height: 176, width: 260, x: 24, y: top })
        }
        return DOMRect.fromRect({ height: 30, width: 600, x: 24, y: 700 })
      }
    )
    const view = render(<MentionHarness />)
    const editable = editableParagraph(view.container)

    // When: the user opens the options.
    typeAtCaret(editable, "Meet @")

    // Then: the menu flips above the caret instead of overflowing below it.
    expect(screen.getByRole("listbox", { name: "可选链接" }).style.top).toBe(
      "516px"
    )
  })

  it("invokes onLinkClick with the link id when the user clicks an inserted pill", () => {
    // Given: a mention pill already inserted into the paragraph.
    const onLinkClick = vi.fn()
    const view = render(<MentionHarness onLinkClick={onLinkClick} />)
    const editable = editableParagraph(view.container)
    typeAtCaret(editable, "Meet @")
    fireEvent.keyDown(editable, { key: "ArrowDown" })
    fireEvent.keyDown(editable, { key: "Enter" })

    // When: the user clicks the inserted pill.
    const mention = editable.querySelector<HTMLElement>(
      '[data-note-link-id="release-notes"]'
    )
    if (!mention) throw new Error("Expected inserted mention pill.")
    fireEvent.click(mention)

    // Then: onLinkClick receives the corresponding link id.
    expect(onLinkClick).toHaveBeenCalledTimes(1)
    expect(onLinkClick).toHaveBeenCalledWith("release-notes")
  })
})
