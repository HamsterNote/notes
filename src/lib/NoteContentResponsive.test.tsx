/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"

const blocks = [{ id: "paragraph", kind: "paragraph", text: "Content" }] as const
const originalInnerWidth = window.innerWidth

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth
  })
})

describe("NoteContent responsive layout", () => {
  it("uses the window width for body padding at the 840px boundary", async () => {
    // Given: the viewport starts just above the compact-layout breakpoint.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 841
    })
    const view = render(<NoteContent blocks={blocks} title="Responsive" />)
    const body = view.container.querySelector<HTMLElement>(".hn-note-body")

    // Then: the body uses desktop padding.
    await waitFor(() => {
      expect(body?.style.getPropertyValue("--hn-body-padding-x")).toBe("4rem")
    })

    // When: only the window crosses down to the inclusive 840px boundary.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 840
    })
    window.dispatchEvent(new Event("resize"))

    // Then: compact padding is selected from window.innerWidth.
    await waitFor(() => {
      expect(body?.style.getPropertyValue("--hn-body-padding-x")).toBe("1.5rem")
    })
  })

  it("mounts the bottom toolbar only for a mobile device", async () => {
    // Given: the current browser identifies itself as a mobile device.
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36"
    )

    // When: an editable note is rendered.
    const view = render(<NoteContent blocks={blocks} title="Mobile" editable />)

    // Then: the shell owns a direct bottom-toolbar portal target.
    await waitFor(() => {
      const shell = view.container.querySelector(".hn-note-shell")
      const bottomBar = shell?.querySelector(":scope > .hn-note-bottom-bar")
      expect(bottomBar).not.toBeNull()
      expect(shell?.classList.contains("hn-note-shell--mobile")).toBe(true)
    })
  })

  it("mounts the bottom toolbar on narrow desktop viewports (<=840px)", async () => {
    // Given: a desktop browser with a narrow viewport at the 840px boundary.
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
    )
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 840
    })

    // When: an editable note is rendered.
    const view = render(<NoteContent blocks={blocks} title="Narrow" editable />)

    // Then: the bottom toolbar appears despite the desktop user agent.
    await waitFor(() => {
      const shell = view.container.querySelector(".hn-note-shell")
      const bottomBar = shell?.querySelector(":scope > .hn-note-bottom-bar")
      expect(bottomBar).not.toBeNull()
    })
  })

  it("hides the bottom toolbar on wide desktop viewports (>840px)", async () => {
    // Given: a desktop browser with a wide viewport.
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
    )
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024
    })

    // When: an editable note is rendered.
    const view = render(<NoteContent blocks={blocks} title="Wide" editable />)

    // Then: no bottom toolbar is mounted.
    await waitFor(() => {
      const shell = view.container.querySelector(".hn-note-shell")
      const bottomBar = shell?.querySelector(":scope > .hn-note-bottom-bar")
      expect(bottomBar).toBeNull()
    })
  })
})
