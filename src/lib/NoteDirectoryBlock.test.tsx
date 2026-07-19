/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

describe("NoteDirectoryBlock", () => {
  it("derives linked entries from the current heading blocks", () => {
    // Given: marker-only directory data and headings at different levels.
    const directory: NoteBlock = { id: "toc", kind: "directory" }
    const view = render(
      <NoteContent
        blocks={[
          directory,
          { id: "overview", kind: "heading", level: 1, text: "Overview" },
          { id: "details", kind: "heading", level: 3, text: "Details" }
        ]}
        title="Dynamic directory"
      />
    )

    // When: the surrounding heading data changes without changing the marker.
    view.rerender(
      <NoteContent
        blocks={[
          directory,
          { id: "overview", kind: "heading", level: 1, text: "Renamed" },
          { id: "next", kind: "heading", level: 2, text: "Next" }
        ]}
        title="Dynamic directory"
      />
    )

    // Then: the directory immediately reflects the current headings and anchors.
    expect(screen.queryByRole("link", { name: "Details" })).toBeNull()
    expect(
      screen.getByRole("link", { name: "Renamed" }).getAttribute("href")
    ).toBe("#overview")
    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href")
    ).toBe("#next")
  })

  it("labels headings whose rich text has no visible content", () => {
    // Given: headings that contain editor-only empty HTML representations.
    render(
      <NoteContent
        blocks={[
          { id: "toc", kind: "directory" },
          { id: "break", kind: "heading", level: 1, text: "<br>" },
          { id: "space", kind: "heading", level: 2, text: "&nbsp;" }
        ]}
        title="Empty heading directory"
      />
    )

    // When: the directory derives entries from those headings.
    const links = screen.getAllByRole("link", { name: "未命名标题" })

    // Then: every visually empty heading still has an accessible link label.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#break",
      "#space"
    ])
  })
})
