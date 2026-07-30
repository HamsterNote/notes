/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

const linkedBlock: NoteCardBlockData = {
  ...block,
  data: [
    {
      id: "card-1",
      title: "Release health",
      content: "Ready to ship",
      x: 24,
      y: 32,
      width: 240,
      height: 144,
      linkedCardIds: ["card-2"]
    },
    {
      id: "card-2",
      title: "Launch notes",
      content: "Publish the release notes",
      x: 360,
      y: 180,
      width: 240,
      height: 144
    }
  ]
}

describe("NoteCardBlock", () => {
  it("blocks preview interaction and opens the full card drawer", async () => {
    // Given: a note renders a card canvas in its normal preview state.
    render(
      <NoteContent
        blocks={[block]}
        title="Cards"
        theme="dark"
        themeColor="#f97316"
      />
    )

    // When: the user activates the single preview interaction layer.
    const preview = screen.getByRole("button", { name: "打开卡片" })
    expect(preview.querySelector(".cards-card-canvas__wrapper")).toBeDefined()
    expect(preview.querySelector("[inert]")).not.toBeNull()
    fireEvent.click(preview)

    // Then: the complete canvas opens in a bottom drawer at 60% viewport height.
    const dialog = screen.getByRole("dialog", { name: "卡片编辑器" })
    expect(dialog).toBeDefined()
    expect(within(dialog).getByText("Release health")).toBeDefined()
    // 组件库 Drawer 固定 Portal 到 document.body，不再挂进 .hn-note-shell
    expect(dialog.parentElement?.closest(".hn-note-shell")).toBeNull()
    // Portal 面板必须自己建立主题变量作用域，不能依赖已断开的祖先继承链。
    expect(dialog.classList.contains("hn-note-shell")).toBe(true)
    expect(dialog.classList.contains("hn-note-shell--dark")).toBe(true)
    expect(dialog.classList.contains("hn-note-card-drawer")).toBe(true)
    expect(dialog.classList.contains("hn-drawer__panel--bottom")).toBe(true)
    expect(dialog.style.getPropertyValue("--hn-drawer-size")).toBe("60vh")
    expect(dialog.style.getPropertyValue("--hn-theme")).toBe("#f97316")
    // 打开时焦点经 requestAnimationFrame 送入面板内第一个可聚焦元素（完成按钮）
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("button", { name: "完成" })
      )
    )
    expect(dialog.querySelector(".hn-note-card-drawer-body--with-inspector")).toBeNull()
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
        .querySelector(".hn-note-card-drawer-body--with-inspector")
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

  it("selects a card link and deletes it from its popover", () => {
    // Given: an editable card canvas contains one dashed link.
    const onBlocksChange = vi.fn()
    render(
      <NoteContent
        blocks={[linkedBlock]}
        title="Cards"
        editable
        themeColor="#f97316"
        onBlocksChange={onBlocksChange}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "打开卡片" }))

    // When: the user selects the link and activates its icon-only delete action.
    const link = screen.getByRole("button", {
      name: "Release health 到 Launch notes 的连线"
    })
    fireEvent.click(link)
    expect(link.getAttribute("aria-pressed")).toBe("true")
    expect(link.getAttribute("x1")).toBe("272")
    expect(link.getAttribute("x2")).toBe("368")
    const deleteButton = screen.getByRole("button", { name: "删除连线" })
    expect(deleteButton.querySelector("svg")).not.toBeNull()
    expect(deleteButton.textContent).toBe("")
    fireEvent.click(deleteButton)

    // Then: only that target id is removed and the host receives the full block.
    expect(onBlocksChange).toHaveBeenLastCalledWith([
      {
        ...linkedBlock,
        data: [
          { ...linkedBlock.data[0], linkedCardIds: [] },
          linkedBlock.data[1]
        ]
      }
    ])
    expect(screen.queryByRole("button", { name: "删除连线" })).toBeNull()
  })

  it("passes the note mode and theme color into both card canvases", () => {
    // Given: a dark note uses a custom accent color.
    render(
      <NoteContent
        blocks={[linkedBlock]}
        title="Cards"
        theme="dark"
        themeColor="#f97316"
      />
    )

    // When: the preview and dialog canvases are rendered.
    fireEvent.click(screen.getByRole("button", { name: "打开卡片" }))
    const canvases = document.querySelectorAll<HTMLElement>(
      ".hn-note-card-canvas"
    )

    // Then: both use the cards dark mode and expose the note accent token.
    expect(canvases).toHaveLength(2)
    for (const canvas of canvases) {
      expect(canvas.getAttribute("data-theme")).toBe("dark")
      expect(canvas.style.getPropertyValue("--hn-card-theme")).toBe("#f97316")
    }
  })

  it("closes on Escape and restores focus to the preview", async () => {
    // Given: the card dialog is open.
    render(<NoteContent blocks={[block]} title="Cards" />)
    const preview = screen.getByRole("button", { name: "打开卡片" })
    // 焦点还原依赖打开前的 activeElement；真实浏览器点击会聚焦触发按钮，
    // fireEvent.click 不会，这里显式聚焦以对齐真实交互
    preview.focus()
    fireEvent.click(preview)

    // When: the user presses Escape.
    // 组件库 Dialog 的 Esc 挂在面板 onKeyDown 上（焦点已被送入面板），事件需派发在面板内；
    // 关闭有 180ms 退场动画，动画结束才卸载并回焦
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })

    // Then: the dialog closes and keyboard focus returns to its trigger.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
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
    // 焦点循环挂在面板 onKeyDown 上，事件需从面板内的聚焦元素派发
    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true })

    // Then: both directions wrap within the dialog instead of reaching the page.
    expect(document.activeElement).toBe(contentInput)
    fireEvent.keyDown(contentInput, { key: "Tab" })
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
    const stage = dialog.querySelector<HTMLElement>(".hn-note-card-drawer-stage")
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
