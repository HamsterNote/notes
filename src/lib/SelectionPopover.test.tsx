/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from "@testing-library/react"
import { createRef, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const TextHarness = ({ initialBlock }: { initialBlock: NoteBlock }) => {
  const [blocks, setBlocks] = useState<readonly NoteBlock[]>([initialBlock])
  const containerRef = createRef<HTMLDivElement>()

  return (
    <div ref={containerRef}>
      <NoteContent
        blocks={blocks}
        title="Popover color"
        editable
        onBlocksChange={setBlocks}
      />
    </div>
  )
}

const dispatchSelectionChange = () => {
  document.dispatchEvent(new Event("selectionchange"))
}

describe("SelectionPopover text color", () => {
  beforeEach(() => {
    // jsdom does not implement execCommand, so provide a stub before spying.
    if (!("execCommand" in document)) {
      Object.defineProperty(document, "execCommand", {
        value: vi.fn(),
        configurable: true,
        writable: true
      })
    }

    // jsdom's Range does not implement getBoundingClientRect, but the
    // popover needs it to compute position.
    if (!("getBoundingClientRect" in Range.prototype)) {
      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        value: () => ({
          top: 100,
          bottom: 120,
          left: 50,
          width: 100,
          height: 20
        }),
        configurable: true,
        writable: true
      })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("applies foreColor and syncs the owning block HTML when a color swatch is clicked", async () => {
    // Given: an editable paragraph with selected text.
    const block = { id: "p1", kind: "paragraph", text: "Hello world" } as const
    const view = render(<TextHarness initialBlock={block} />)
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="p1"]'
    )
    if (!editable) throw new Error("Expected editable paragraph.")

    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockReturnValue(true)

    editable.focus()
    const range = document.createRange()
    range.setStart(editable.firstChild ?? editable, 0)
    range.setEnd(editable.firstChild ?? editable, 5)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    dispatchSelectionChange()

    // Then: the color swatch appears and applying it calls foreColor.
    await waitFor(() => {
      expect(
        document.body.querySelector('[aria-label="文字颜色：红色"]')
      ).not.toBeNull()
    })

    const redButton = document.body.querySelector<HTMLElement>(
      '[aria-label="文字颜色：红色"]'
    )
    if (!redButton) throw new Error("Expected red color button.")
    fireEvent.click(redButton)

    await waitFor(() => {
      expect(execCommandSpy).toHaveBeenCalledWith("foreColor", false, "#ef4444")
    })
  })

  it("still applies bold formatting from the popover", async () => {
    const block = { id: "p2", kind: "paragraph", text: "Bold me" } as const
    const view = render(<TextHarness initialBlock={block} />)
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="p2"]'
    )
    if (!editable) throw new Error("Expected editable paragraph.")

    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockReturnValue(true)

    editable.focus()
    const range = document.createRange()
    range.setStart(editable.firstChild ?? editable, 0)
    range.setEnd(editable.firstChild ?? editable, 4)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    dispatchSelectionChange()

    await waitFor(() => {
      expect(document.body.querySelector('[aria-label="粗体"]')).not.toBeNull()
    })

    const boldButton = document.body.querySelector<HTMLElement>(
      '[aria-label="粗体"]'
    )
    if (!boldButton) throw new Error("Expected bold button.")
    fireEvent.click(boldButton)

    await waitFor(() => {
      expect(execCommandSpy).toHaveBeenCalledWith("bold")
    })
  })

  it("highlights the bold button when queryCommandState reports bold active and clears styles via removeFormat", async () => {
    // Given: an editable paragraph with selected text and a popover already open,
    // simulating the browser reporting bold active for the current selection.
    const block = { id: "p3", kind: "paragraph", text: "Already bold" } as const
    const view = render(<TextHarness initialBlock={block} />)
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="p3"]'
    )
    if (!editable) throw new Error("Expected editable paragraph.")

    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockReturnValue(true)
    // jsdom 未实现 queryCommandState，先注入 stub 再 mock 实现，
    // 让 popover 在选区同步时把 bold 按钮视为已生效。
    if (typeof document.queryCommandState !== "function") {
      Object.defineProperty(document, "queryCommandState", {
        value: vi.fn(),
        configurable: true,
        writable: true
      })
    }
    vi
      .spyOn(document, "queryCommandState")
      .mockImplementation((command: string) => command === "bold")

    editable.focus()
    const range = document.createRange()
    range.setStart(editable.firstChild ?? editable, 0)
    range.setEnd(editable.firstChild ?? editable, 5)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    dispatchSelectionChange()

    // Then: the bold button carries the active modifier class and aria-pressed=true.
    await waitFor(() => {
      const boldBtn = document.body.querySelector<HTMLElement>(
        '[aria-label="粗体"]'
      )
      expect(boldBtn).not.toBeNull()
      expect(boldBtn?.classList.contains("hn-note-popover-btn--active")).toBe(
        true
      )
      expect(boldBtn?.getAttribute("aria-pressed")).toBe("true")
    })

    // And: clicking the clear-styles button calls execCommand("removeFormat").
    const clearButton = document.body.querySelector<HTMLElement>(
      '[aria-label="清除样式"]'
    )
    if (!clearButton) throw new Error("Expected clear styles button.")
    fireEvent.click(clearButton)

    await waitFor(() => {
      expect(execCommandSpy).toHaveBeenCalledWith("removeFormat")
    })
  })
})
