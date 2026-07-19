/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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

  it.each(["ArrowLeft", "ArrowRight"] as const)(
    "closes the link options when the user presses %s without changing content",
    (key) => {
      // Given: an open link option list.
      const view = render(<MentionHarness />)
      const editable = editableParagraph(view.container)
      typeAtCaret(editable, "Meet @")

      // When: the user presses a horizontal arrow key.
      fireEvent.keyDown(editable, { key })

      // Then: the options close and the typed trigger remains untouched.
      // 光标按浏览器默认行为移动，菜单关闭但不干预默认动作。
      expect(screen.queryByRole("listbox", { name: "可选链接" })).toBeNull()
      expect(editable.textContent).toBe("Meet @")
    }
  )

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
