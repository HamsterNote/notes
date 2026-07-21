/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getCardCanvasGeometry,
  restoreCardCanvasCoordinates,
  translateCardCanvasCoordinates
} from "./cardGeometry"
import { NoteContent } from "./NoteContent"
import type { NoteCardBlock as NoteCardBlockData } from "./types"

afterEach(cleanup)

const block: NoteCardBlockData = {
  id: "card-block-1",
  kind: "card",
  data: [
    {
      id: "card-1",
      title: "Release health",
      content: "Ready to ship",
      x: 24,
      y: 32,
      width: 240,
      height: 144
    }
  ]
}

describe("NoteCardBlock", () => {
  it("blocks preview interaction and opens the full card dialog", () => {
    // Given: a note renders a card canvas in its normal preview state.
    render(<NoteContent blocks={[block]} title="Cards" />)

    // When: the user activates the single preview interaction layer.
    const preview = screen.getByRole("button", { name: "打开卡片" })
    expect(preview.querySelector(".cards-card-canvas__wrapper")).toBeDefined()
    expect(preview.querySelector("[inert]")).not.toBeNull()
    fireEvent.click(preview)

    // Then: the complete canvas opens in a modal dialog.
    const dialog = screen.getByRole("dialog", { name: "卡片编辑器" })
    expect(dialog).toBeDefined()
    expect(within(dialog).getByText("Release health")).toBeDefined()
    expect(dialog.closest(".hn-note-shell")).not.toBeNull()
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "完成" })
    )
    expect(dialog.querySelector(".hn-note-card-dialog-body--with-inspector")).toBeNull()
  })

  it("writes card edits back through the controlled block callback", () => {
    // Given: the card block is editable and controlled by the host.
    const onBlocksChange = vi.fn()
    render(
      <NoteContent
        blocks={[block]}
        title="Cards"
        editable
        onBlocksChange={onBlocksChange}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "打开卡片" }))
    fireEvent.click(
      within(screen.getByRole("dialog")).getByText("Release health")
    )
    expect(
      screen
        .getByRole("dialog")
        .querySelector(".hn-note-card-dialog-body--with-inspector")
    ).not.toBeNull()

    // When: the selected card title changes in the dialog inspector.
    fireEvent.change(screen.getByRole("textbox", { name: "卡片标题" }), {
      target: { value: "Release ready" }
    })

    // Then: the host receives the complete updated card block.
    expect(onBlocksChange).toHaveBeenLastCalledWith([
      {
        ...block,
        data: [{ ...block.data[0], title: "Release ready" }]
      }
    ])
  })

  it("closes on Escape and restores focus to the preview", () => {
    // Given: the card dialog is open.
    render(<NoteContent blocks={[block]} title="Cards" />)
    const preview = screen.getByRole("button", { name: "打开卡片" })
    fireEvent.click(preview)

    // When: the user presses Escape.
    fireEvent.keyDown(document, { key: "Escape" })

    // Then: the dialog closes and keyboard focus returns to its trigger.
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(preview)
  })

  it("keeps Tab focus inside the modal dialog", () => {
    // Given: an editable card is selected and every dialog field is visible.
    render(<NoteContent blocks={[block]} title="Cards" editable />)
    fireEvent.click(screen.getByRole("button", { name: "打开卡片" }))
    const dialog = screen.getByRole("dialog", { name: "卡片编辑器" })
    const closeButton = within(dialog).getByRole("button", { name: "完成" })
    fireEvent.click(within(dialog).getByText("Release health"))
    const contentInput = within(dialog).getByRole("textbox", { name: "卡片内容" })

    // When: focus moves backward from the first control and forward from the last.
    closeButton.focus()
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })

    // Then: both directions wrap within the dialog instead of reaching the page.
    expect(document.activeElement).toBe(contentInput)
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(closeButton)
  })

  it("fits a distant card into the dialog canvas without changing its data", () => {
    // Given: persisted card coordinates are far from the canvas origin.
    const distantBlock: NoteCardBlockData = {
      ...block,
      data: [
        {
          id: "card-1",
          title: "Release health",
          content: "Ready to ship",
          x: 4_000,
          y: 3_000,
          width: 240,
          height: 144
        }
      ]
    }
    render(<NoteContent blocks={[distantBlock]} title="Cards" />)

    // When: the user opens the full card dialog.
    fireEvent.click(screen.getByRole("button", { name: "打开卡片" }))

    // Then: the visual stage is normalized to the card bounds instead of
    // allocating thousands of empty pixels before the card.
    const dialog = screen.getByRole("dialog", { name: "卡片编辑器" })
    const stage = dialog.querySelector<HTMLElement>(".hn-note-card-dialog-stage")
    expect(stage?.style.width).toBe("720px")
    expect(within(dialog).getByText("Release health")).toBeDefined()
  })

  it("keeps the dialog origin stable while a card moves", () => {
    // Given: the dialog opened with a normalized coordinate origin.
    const geometry = getCardCanvasGeometry(block.data)
    const movedCanvasCards = geometry.cards.map((card) => ({
      ...card,
      x: card.x + 80
    }))

    // When: canvas coordinates are persisted and rendered with the same origin.
    const persistedCards = restoreCardCanvasCoordinates(
      movedCanvasCards,
      geometry
    )
    const rerenderedCards = translateCardCanvasCoordinates(
      persistedCards,
      geometry
    )
    const geometryCard = geometry.cards[0]

    // Then: the visual movement remains instead of being normalized away.
    expect(rerenderedCards[0]?.x).toBe(
      geometryCard === undefined ? undefined : geometryCard.x + 80
    )
  })
})
