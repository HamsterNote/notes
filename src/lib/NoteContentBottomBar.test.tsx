/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"

const blocks = [{ id: "paragraph", kind: "paragraph", text: "Content" }] as const
const originalInnerWidth = window.innerWidth

afterEach(() => {
  cleanup()
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth
  })
})

describe("NoteContent bottom toolbar", () => {
  it.each(["light", "dark"] as const)(
    "uses the %s theme requested by the note",
    async (theme) => {
      // Given: a compact viewport that renders the persistent editing toolbar.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 839
      })

      // When: the note renders in the requested theme.
      const view = render(
        <NoteContent
          blocks={blocks}
          title={`${theme} bottom toolbar`}
          editable
          theme={theme}
        />
      )

      // Then: the component-library Popover receives the same theme.
      await waitFor(() => {
        expect(
          view.container
            .querySelector("[data-note-bottom-bar]")
            ?.getAttribute("data-theme")
        ).toBe(theme)
      })
    }
  )

  it("uses the requested viewport bottom offset", async () => {
    // Given: a compact viewport that renders the persistent editing toolbar.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 839
    })

    // When: the consumer requests a custom distance from the viewport bottom.
    const view = render(
      <NoteContent
        blocks={blocks}
        title="Custom bottom offset"
        editable
        bottomBarOffset={48}
      />
    )

    // Then: the component-library Popover receives that exact edge offset.
    await waitFor(() => {
      const bottomBar = view.container.querySelector<HTMLElement>(
        "[data-note-bottom-bar]"
      )
      expect(bottomBar?.style.bottom).toBe("48px")
    })
  })
})
