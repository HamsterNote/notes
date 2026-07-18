/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"

describe("NoteContent hero", () => {
  it("renders the public title, summary, tag, and metadata props", () => {
    // Given: a note using the documented hero props.
    const view = render(
      <NoteContent
        blocks={[{ id: "paragraph", kind: "paragraph", text: "Body" }]}
        title="Release notes"
        summary="What changed"
        tagLabel="Product"
        updatedAt="2026-07-17T00:00:00.000Z"
      />
    )

    // Then: the complete hero surface remains visible.
    expect(view.getByRole("heading", { name: "Release notes" })).toBeTruthy()
    expect(view.getByText("What changed")).toBeTruthy()
    expect(view.getByText("Product")).toBeTruthy()
    expect(view.getByText("Reading")).toBeTruthy()
    expect(view.getByText("Blocks")).toBeTruthy()
    expect(view.getByText("Updated")).toBeTruthy()
  })

  it("keeps title and summary editable through their public callbacks", () => {
    // Given: an editable note with controlled hero callbacks.
    const onTitleChange = vi.fn()
    const onSummaryChange = vi.fn()
    const view = render(
      <NoteContent
        blocks={[]}
        title="Draft title"
        summary="Draft summary"
        editable
        onTitleChange={onTitleChange}
        onSummaryChange={onSummaryChange}
      />
    )

    // When: both hero fields are edited and blurred.
    const title = view.getByRole("heading", { name: "Draft title" })
    const summary = view.getByText("Draft summary")
    title.innerHTML = "Published title"
    summary.innerHTML = "Published summary"
    fireEvent.blur(title)
    fireEvent.blur(summary)

    // Then: the public callbacks receive the edited HTML.
    expect(onTitleChange).toHaveBeenCalledWith("Published title")
    expect(onSummaryChange).toHaveBeenCalledWith("Published summary")
  })
})
