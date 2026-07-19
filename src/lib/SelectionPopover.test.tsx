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
})
