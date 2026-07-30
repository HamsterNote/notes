/** @vitest-environment jsdom */

import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => new DOMRect(),
})

describe("NoteContent continuous selection fallback", () => {
  it("commits a body-only multi-region deletion through one blocks callback", () => {
    // Given: two body regions and no whole-note transaction callback.
    const onBlocksChange = vi.fn<(blocks: NoteBlock[]) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[
          { id: "front", kind: "paragraph", text: "Alpha" },
          { id: "back", kind: "paragraph", text: "Omega" },
        ]}
        onBlocksChange={onBlocksChange}
      />,
    )
    const front = container.querySelector<HTMLElement>('[data-note-region-id="block:front"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:back"]')
    if (!(front?.firstChild instanceof Text) || !(back?.firstChild instanceof Text)) {
      throw new Error("Expected body text regions")
    }
    const range = document.createRange()
    range.setStart(front.firstChild, 2)
    range.setEnd(back.firstChild, 2)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the selected body range is deleted.
    ;(container.querySelector("article") ?? container).dispatchEvent(new InputEvent(
      "beforeinput",
      { bubbles: true, cancelable: true, inputType: "deleteContentForward" },
    ))

    // Then: one blocks snapshot is committed without requiring a whole-note callback.
    expect(onBlocksChange).toHaveBeenCalledOnce()
    expect(onBlocksChange).toHaveBeenCalledWith([
      { id: "front", kind: "paragraph", text: "Alega" },
    ])
  })

  it("blocks a cross-field mutation even when the resulting title is unchanged", () => {
    // Given: a title-to-body selection whose merged title equals the original title.
    const onBlocksChange = vi.fn<(blocks: NoteBlock[]) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="AB"
        blocks={[{ id: "body", kind: "paragraph", text: "XB" }]}
        onBlocksChange={onBlocksChange}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected title and body text regions")
    }
    const range = document.createRange()
    range.setStart(title.firstChild, 1)
    range.setEnd(body.firstChild, 1)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the cross-field range is deleted without a whole-note callback.
    ;(container.querySelector("article") ?? container).dispatchEvent(new InputEvent(
      "beforeinput",
      { bubbles: true, cancelable: true, inputType: "deleteContentForward" },
    ))

    // Then: the body fallback is not used merely because the merged title is still AB.
    expect(onBlocksChange).not.toHaveBeenCalled()
  })
})
