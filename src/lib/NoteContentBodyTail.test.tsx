/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const BodyTailHarness = () => {
  const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
    { id: "existing", kind: "paragraph", text: "Existing paragraph" }
  ])

  return (
    <NoteContent
      blocks={blocks}
      title="Body tail"
      editable
      onBlocksChange={setBlocks}
    />
  )
}

describe("NoteContent body tail", () => {
  it("adds and focuses a paragraph when the blank body tail is clicked", async () => {
    // Given: an editable controlled note with content above its blank tail.
    const view = render(<BodyTailHarness />)
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")
    if (!body) throw new Error("Expected note body.")

    // When: the body-level blank area is clicked.
    fireEvent.click(body)

    // Then: a new empty paragraph is appended and receives focus.
    await waitFor(() => {
      const blocks = body.querySelectorAll(":scope > .hn-note-block")
      expect(blocks).toHaveLength(2)
      expect(document.activeElement).toBe(
        blocks.item(1).querySelector("[data-editable-block-id]")
      )
    })
  })
})
