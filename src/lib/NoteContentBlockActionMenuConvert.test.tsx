/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

// 该文件针对新的 convert handle 主菜单 + 子菜单结构补充回归覆盖。
// RTL 在 vitest 环境下不自动 cleanup，菜单 portal 残留会影响下一条用例，
// 因此显式 afterEach(cleanup) 保证 document.body 干净。
afterEach(cleanup)

type ChangeCapture = (blocks: NoteBlock[]) => void

const makeHarness = (
  initialBlocks: readonly NoteBlock[],
  onBlocksChange: ChangeCapture
) => {
  const Harness = () => {
    const [blocks, setBlocks] = useState<readonly NoteBlock[]>(initialBlocks)
    return (
      <NoteContent
        blocks={blocks}
        title="Convert menu test"
        editable
        onBlocksChange={(next) => {
          onBlocksChange(next)
          setBlocks(next)
        }}
      />
    )
  }
  return render(<Harness />)
}

const findConvertHandle = (container: HTMLElement, blockId: string) =>
  container.querySelector<HTMLElement>(
    `[data-block-id="${blockId}"][data-block-menu-mode="convert"]`
  )

describe("NoteContent convert handle main menu", () => {
  it("renders 转换成 / 删除 / 创建副本 three items when opened", async () => {
    const view = render(
      <NoteContent
        blocks={[{ id: "p", kind: "paragraph", text: "P" }]}
        title="Main menu items"
        editable
      />
    )

    const handle = findConvertHandle(view.container, "p")
    if (!handle) throw new Error("Expected convert handle.")
    fireEvent.click(handle)

    // 三个主菜单项同时可见；"转换成"含 › 箭头，用正则
    await screen.findByRole("menuitem", { name: /转换成/ })
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeDefined()
    expect(screen.getByRole("menuitem", { name: "创建副本" })).toBeDefined()
  })

  it("deletes the carrying block when 删除 is clicked", async () => {
    const onChange = vi.fn()
    const view = makeHarness(
      [
        { id: "para-a", kind: "paragraph", text: "Alpha" },
        { id: "para-b", kind: "paragraph", text: "Beta" }
      ],
      onChange
    )

    const handle = findConvertHandle(view.container, "para-a")
    if (!handle) throw new Error("Expected para-a convert handle.")
    fireEvent.click(handle)

    const deleteItem = await screen.findByRole("menuitem", { name: "删除" })
    fireEvent.click(deleteItem)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
      const next = onChange.mock.calls.at(-1)?.[0] as NoteBlock[] | undefined
      expect(next).toBeDefined()
      expect(next?.find((b) => b.id === "para-a")).toBeUndefined()
      expect(next?.find((b) => b.id === "para-b")).toBeDefined()
    })
  })

  it("duplicates the carrying todo block with regenerated ids when 创建副本 is clicked", async () => {
    const onChange = vi.fn()
    const view = makeHarness(
      [
        {
          id: "todo-src",
          kind: "todo",
          title: "Tasks",
          items: [{ id: "task-1", checked: false, text: "One" }]
        },
        { id: "tail", kind: "paragraph", text: "Tail" }
      ],
      onChange
    )

    // todo 项的 handle 使用 itemId 作为 data-block-id
    const handle = findConvertHandle(view.container, "task-1")
    if (!handle) throw new Error("Expected task-1 convert handle.")
    fireEvent.click(handle)

    const duplicate = await screen.findByRole("menuitem", { name: "创建副本" })
    fireEvent.click(duplicate)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
      const next = onChange.mock.calls.at(-1)?.[0] as NoteBlock[] | undefined
      expect(next).toBeDefined()
      const todos = next?.filter((b) => b.kind === "todo") ?? []
      expect(todos).toHaveLength(2)
      expect(todos[0]?.id).toBe("todo-src")
      expect(todos[1]?.id).not.toBe("todo-src")
      if (todos[1]?.kind === "todo") {
        expect(todos[1].title).toBe("Tasks")
        const clonedItem = todos[1].items[0]
        expect(clonedItem?.id).not.toBe("task-1")
        expect(clonedItem?.text).toBe("One")
      }
    })
  })

  it("converts format through the 转换成 submenu (paragraph → H1)", async () => {
    const onChange = vi.fn()
    const view = makeHarness(
      [{ id: "para-c", kind: "paragraph", text: "Hello" }],
      onChange
    )

    const handle = findConvertHandle(view.container, "para-c")
    if (!handle) throw new Error("Expected para-c convert handle.")
    fireEvent.click(handle)

    // 主菜单 "转换成" → 点击展开子菜单（含 H1..图片）
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /转换成/ })).toBeDefined()
    )
    fireEvent.click(screen.getByRole("menuitem", { name: /转换成/ }))

    // 子菜单的 H1 项出现并触发转换
    await screen.findByRole("menuitem", { name: "H1" })
    fireEvent.click(screen.getByRole("menuitem", { name: "H1" }))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
      const next = onChange.mock.calls.at(-1)?.[0] as NoteBlock[] | undefined
      expect(next).toBeDefined()
      const heading = next?.find((b) => b.id === "para-c")
      expect(heading?.kind).toBe("heading")
    })
  })

  it("converts a populated paragraph to an empty directory marker", async () => {
    // Given: a controlled paragraph carrying rich source content.
    const onChange = vi.fn()
    const view = makeHarness(
      [{ id: "directory-source", kind: "paragraph", text: "<b>Discard me</b>" }],
      onChange
    )

    // When: Directory is selected from the convert submenu.
    const handle = findConvertHandle(view.container, "directory-source")
    if (!handle) throw new Error("Expected directory-source convert handle.")
    fireEvent.click(handle)
    fireEvent.click(await screen.findByRole("menuitem", { name: /转换成/ }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "目录" }))

    // Then: the controlled value contains no field from the source content.
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
      expect(onChange.mock.calls.at(-1)?.[0]).toEqual([
        { id: "directory-source", kind: "directory" }
      ])
    })
  })

  it("opens the 转换成 submenu without focusing a format", async () => {
    // Given: a paragraph whose current format is represented in the submenu.
    const view = render(
      <NoteContent
        blocks={[{ id: "p", kind: "paragraph", text: "P" }]}
        title="Convert submenu focus"
        editable
      />
    )
    const handle = findConvertHandle(view.container, "p")
    if (!handle) throw new Error("Expected convert handle.")

    // When: the convert handle and then the 转换成 submenu are opened.
    fireEvent.click(handle)
    fireEvent.click(await screen.findByRole("menuitem", { name: /转换成/ }))
    const submenu = await screen.findByRole("menu", { name: "转换成" })

    // Then: no format receives focus until keyboard navigation enters the list.
    await waitFor(() => expect(document.activeElement).toBe(submenu))
    expect(submenu.querySelector(":focus")).toBeNull()
    fireEvent.keyDown(submenu, { key: "ArrowDown" })
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "H1" })
    )

    // And: Escape closes only the submenu and returns focus to 转换成.
    fireEvent.keyDown(submenu, { key: "Escape" })
    await waitFor(() => expect(submenu.isConnected).toBe(false))
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: /转换成/ })
    )
  })
})
