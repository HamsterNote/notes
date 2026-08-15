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

  it("marks only a truly empty title for placeholder display", () => {
    // Given: an editable title whose live DOM can contain text and break nodes.
    const view = render(<NoteContent blocks={[]} title="Draft" editable />)
    const title = view.getByRole("heading", { name: "Draft" })

    // When: the browser represents the cleared title as one break.
    title.innerHTML = "<br>"
    fireEvent.input(title)

    // Then: the title is marked empty so its placeholder remains visible.
    expect(title.getAttribute("data-placeholder-visible")).toBe("")

    // When: text exists beside a direct break node.
    title.innerHTML = "Title<br>"
    fireEvent.input(title)

    // Then: text nodes prevent the title from being treated as empty.
    expect(title.hasAttribute("data-placeholder-visible")).toBe(false)

    // When: text surrounds the break node.
    title.innerHTML = "Before<br>After"
    fireEvent.input(title)

    // Then: the non-empty title remains unmarked.
    expect(title.hasAttribute("data-placeholder-visible")).toBe(false)
  })

  it.each(["<strong><br></strong>", "<strong></strong>"])(
    "marks a visibly empty formatted title for placeholder display: %s",
    (emptyTitleHtml) => {
      // Given: an editable title whose formatting element remains after its text is cleared.
      const view = render(<NoteContent blocks={[]} title="Draft" editable />)
      const title = view.getByRole("heading", { name: "Draft" })

      // When: the live title DOM contains formatting but no visible text.
      title.innerHTML = emptyTitleHtml
      fireEvent.input(title)

      // Then: formatting-only markup does not suppress the title placeholder.
      expect(title.getAttribute("data-placeholder-visible")).toBe("")
    }
  )

  it("keeps the placeholder hidden for visible text inside formatting", () => {
    // Given: an editable title containing formatted visible text.
    const view = render(<NoteContent blocks={[]} title="Draft" editable />)
    const title = view.getByRole("heading", { name: "Draft" })

    // When: the live title DOM retains visible text inside the formatting node.
    title.innerHTML = "<strong>Title</strong>"
    fireEvent.input(title)

    // Then: the visible formatted title is not marked as empty.
    expect(title.hasAttribute("data-placeholder-visible")).toBe(false)
  })
})
