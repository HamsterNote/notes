/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

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

    // Then: the shell owns a direct portal target positioned by the component
    // library's viewport-edge bottom-bar mode.
    await waitFor(() => {
      const shell = view.container.querySelector(".hn-note-shell")
      const bottomBar = shell?.querySelector<HTMLElement>(
        ":scope > [data-note-bottom-bar]"
      )
      expect(bottomBar).not.toBeNull()
      expect(bottomBar?.classList.contains("hn-popover")).toBe(true)
      expect(bottomBar?.classList.contains("hn-note-bottom-toolbar")).toBe(true)
      expect(bottomBar?.style.position).toBe("fixed")
      expect(bottomBar?.style.bottom).toBe("16px")
      expect(bottomBar?.style.left).toBe("50%")
      expect(bottomBar?.style.transform).toBe("translateX(-50%)")
      expect(bottomBar?.style.zIndex).toBe("900")
      expect(shell?.classList.contains("hn-note-shell--mobile")).toBe(true)
      expect(shell?.classList.contains("hn-note-shell--bottom-toolbar")).toBe(true)
    })
  })

  it("keeps add and convert controls visible below 840px", async () => {
    // Given: a desktop browser one pixel below the bottom-toolbar breakpoint.
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
    )
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 839
    })

    // When: an editable note is rendered.
    const view = render(<NoteContent blocks={blocks} title="Narrow" editable />)

    // Then: the persistent toolbar exposes the same add and convert controls.
    await waitFor(() => {
      const shell = view.container.querySelector(".hn-note-shell")
      const bottomBar = shell?.querySelector(":scope > [data-note-bottom-bar]")
      expect(bottomBar).not.toBeNull()
      expect(
        bottomBar?.querySelector('[data-block-menu-mode="add"]')
      ).not.toBeNull()
      expect(
        bottomBar?.querySelector('[data-block-menu-mode="convert"]')
      ).not.toBeNull()
    })
  })

  it("merges block and selection actions into one bottom toolbar surface", async () => {
    // Given: a narrow editable note with a visible text selection.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 375
    })
    if (!("getBoundingClientRect" in Range.prototype)) {
      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          top: 120,
          bottom: 140,
          left: 40,
          right: 140,
          width: 100,
          height: 20,
          x: 40,
          y: 120,
          toJSON: () => ({})
        })
      })
    }
    const view = render(
      <NoteContent blocks={blocks} title="Unified toolbar" editable />
    )
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="paragraph"]'
    )
    if (!editable) throw new Error("Expected an editable paragraph.")
    const range = document.createRange()
    range.setStart(editable.firstChild ?? editable, 0)
    range.setEnd(editable.firstChild ?? editable, 4)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    // When: selection formatting actions become available.
    document.dispatchEvent(new Event("selectionchange"))

    // Then: block and text actions share the one component-library surface.
    await waitFor(() => {
      const bottomBar = view.container.querySelector<HTMLElement>(
        "[data-note-bottom-bar]"
      )
      const add = bottomBar?.querySelector<HTMLElement>(
        '[data-block-menu-mode="add"]'
      )
      const bold = bottomBar?.querySelector<HTMLElement>('[aria-label="粗体"]')
      expect(bottomBar?.getAttribute("role")).toBe("toolbar")
      expect(bottomBar?.querySelector(".hn-popover")).toBeNull()
      expect(add?.closest(".hn-popover")).toBe(bottomBar)
      expect(bold?.closest(".hn-popover")).toBe(bottomBar)
    })
  })

  it("keeps the 840px boundary on the desktop handle layout", async () => {
    // Given: a desktop browser exactly at 840px.
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
    )
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 840
    })

    // When: an editable note is rendered.
    const view = render(<NoteContent blocks={blocks} title="Boundary" editable />)

    // Then: no bottom toolbar is mounted.
    await waitFor(() => {
      const shell = view.container.querySelector(".hn-note-shell")
      const bottomBar = shell?.querySelector(":scope > [data-note-bottom-bar]")
      expect(bottomBar).toBeNull()
    })
  })

  it("uses the focused block actions from the persistent toolbar", async () => {
    // Given: a controlled note below 840px with two editable blocks.
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
    )
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 839
    })
    const Harness = () => {
      const [value, setValue] = useState<readonly NoteBlock[]>([
        { id: "first", kind: "paragraph", text: "First" },
        { id: "second", kind: "paragraph", text: "Second" }
      ])
      return (
        <NoteContent
          blocks={value}
          title="Toolbar actions"
          editable
          onBlocksChange={setValue}
        />
      )
    }
    const view = render(<Harness />)
    const second = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="second"]'
    )
    if (!second) throw new Error("Expected the second editable block.")

    // When: focus selects the second block and the bottom add control inserts text.
    fireEvent.focus(second)
    const bottomBar = view.container.querySelector("[data-note-bottom-bar]")
    const add = await waitFor(() => {
      const control = bottomBar?.querySelector<HTMLElement>(
        '[data-block-id="second"][data-block-menu-mode="add"]'
      )
      expect(control).not.toBeNull()
      return control
    })
    if (!add) throw new Error("Expected the bottom add control.")
    fireEvent.click(add)
    fireEvent.click(await screen.findByRole("menuitem", { name: "正文" }))

    // Then: insertion occurs immediately after the focused second block.
    await waitFor(() => {
      const renderedBlocks = view.container.querySelectorAll(
        ".hn-note-body > .hn-note-block"
      )
      expect(renderedBlocks).toHaveLength(3)
      expect(renderedBlocks.item(0).id).toBe("first")
      expect(renderedBlocks.item(1).id).toBe("second")
    })
  })

  it("toggles an open menu from the same persistent control", async () => {
    // Given: the persistent add control has opened its source block menu.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 839
    })
    const view = render(<NoteContent blocks={blocks} title="Toggle menu" editable />)
    const add = await waitFor(() => {
      const control = view.container.querySelector<HTMLButtonElement>(
        '[data-note-bottom-bar] [data-block-menu-mode="add"]'
      )
      expect(control).not.toBeNull()
      return control
    })
    if (!add) throw new Error("Expected the bottom add control.")
    fireEvent.click(add)
    expect(await screen.findByRole("menu", { name: "插入新区块类型" })).toBeTruthy()

    // When: the same visible proxy control is clicked again.
    fireEvent.mouseDown(add)
    fireEvent.click(add)

    // Then: the menu closes instead of being reopened by the proxy click.
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "插入新区块类型" })).toBeNull()
      expect(add.ariaExpanded).toBe("false")
    })
  })

  it("returns Escape focus to the persistent control", async () => {
    // Given: a menu was opened from the visible bottom add control.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 839
    })
    const view = render(<NoteContent blocks={blocks} title="Escape focus" editable />)
    const add = await waitFor(() => {
      const control = view.container.querySelector<HTMLButtonElement>(
        '[data-note-bottom-bar] [data-block-menu-mode="add"]'
      )
      expect(control).not.toBeNull()
      return control
    })
    if (!add) throw new Error("Expected the bottom add control.")
    fireEvent.click(add)
    expect(await screen.findByRole("menu", { name: "插入新区块类型" })).toBeTruthy()

    // When: the user dismisses the menu with Escape.
    fireEvent.keyDown(document, { key: "Escape" })

    // Then: focus returns to the visible proxy, not the hidden source handle.
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "插入新区块类型" })).toBeNull()
      expect(document.activeElement).toBe(add)
    })
  })
})
