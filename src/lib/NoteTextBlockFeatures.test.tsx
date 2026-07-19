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

describe("NoteContent text block features", () => {
  it.each([
    { id: "paragraph", kind: "paragraph", text: "" } as const,
    { id: "heading", kind: "heading", level: 2, text: "" } as const
  ])("converts a $kind to a focused quote when its text becomes `> `", async (block) => {
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
