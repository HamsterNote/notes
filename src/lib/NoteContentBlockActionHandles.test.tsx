/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const mixedBlocks: readonly NoteBlock[] = [
  { id: "h1", kind: "heading", level: 1, text: "Heading" },
  { id: "para", kind: "paragraph", text: "Paragraph" },
  {
    id: "list",
    kind: "todo",
    title: "Todo",
    items: [
      { id: "item-1", checked: false, text: "One" },
      { id: "item-2", checked: true, text: "Two" }
    ]
  },
  { id: "ulist", kind: "unorderedList", text: "One" },
  { id: "olist", kind: "orderedList", text: "One" },
  {
    id: "table",
    kind: "table",
    rows: [
      ["A", "B"],
      ["C", "D"]
    ]
  },
  { id: "pic", kind: "picture", url: "blob:x", filename: "pic.png" },
  { id: "formula", kind: "formula", formula: "x^2" },
  { id: "quote", kind: "quote", text: "Quote" },
  { id: "quote-multi", kind: "quote", text: "First\nSecond\nThird" },
  { id: "code", kind: "code", language: "text", code: "code" },
  { id: "callout", kind: "callout", tone: "info", title: "Tip", text: "Text" }
]

const findHandle = (
  container: HTMLElement,
  blockId: string,
  mode: "add" | "convert"
) =>
  container.querySelector<HTMLElement>(
    `[data-block-id="${blockId}"][data-block-menu-mode="${mode}"]`
  )

const findBlock = (blockId: string): NoteBlock => {
  const block = mixedBlocks.find(({ id }) => id === blockId)
  if (!block) throw new Error(`Expected fixture block ${blockId}.`)
  return block
}

describe("NoteContent block action handles", () => {
  it("renders a paired add and convert handle for every actionable block", () => {
    // Given: an editable note with all supported block kinds.
    const view = render(
      <NoteContent blocks={mixedBlocks} title="Handles" editable />
    )

    // Then: every block id has exactly one add handle and one convert handle.
    const blockIds = [
      "h1",
      "para",
      "ulist",
      "olist",
      "table",
      "pic",
      "formula",
      "quote",
      "code",
      "callout"
    ]
    for (const id of blockIds) {
      const add = findHandle(view.container, id, "add")
      const convert = findHandle(view.container, id, "convert")
      expect(add, `add handle for ${id}`).not.toBeNull()
      expect(convert, `convert handle for ${id}`).not.toBeNull()
      expect(add?.textContent?.trim()).toBe("+")
      expect(convert?.getAttribute("aria-haspopup")).toBe("menu")
    }
  })

  it("renders block-level handles for unordered and ordered lists", () => {
    // Given: editable note with list blocks.
    const view = render(
      <NoteContent blocks={mixedBlocks} title="List handles" editable />
    )

    // Then: each list block has exactly one add and one convert handle.
    for (const id of ["ulist", "olist"]) {
      const add = findHandle(view.container, id, "add")
      const convert = findHandle(view.container, id, "convert")
      expect(add, `add handle for ${id}`).not.toBeNull()
      expect(convert, `convert handle for ${id}`).not.toBeNull()
    }
  })

  it("does not render per-item handles for list blocks", () => {
    // Given: editable note with list blocks.
    const view = render(
      <NoteContent blocks={mixedBlocks} title="List item handles" editable />
    )

    // Then: list item ids are not used as handle block ids.
    for (const itemId of ["ul-1", "ul-2", "ol-1", "ol-2"]) {
      expect(
        findHandle(view.container, itemId, "add"),
        `no add handle for ${itemId}`
      ).toBeNull()
      expect(
        findHandle(view.container, itemId, "convert"),
        `no convert handle for ${itemId}`
      ).toBeNull()
    }
  })

  it("renders per-todo-item add and convert handles", () => {
    // Given: a todo with two items.
    const view = render(
      <NoteContent blocks={mixedBlocks} title="Todo handles" editable />
    )

    // Then: each item row exposes its own pair, not a block-level pair.
    for (const itemId of ["item-1", "item-2"]) {
      const add = findHandle(view.container, itemId, "add")
      const convert = findHandle(view.container, itemId, "convert")
      expect(add, `add handle for ${itemId}`).not.toBeNull()
      expect(convert, `convert handle for ${itemId}`).not.toBeNull()
    }
  })

  it("renders per-quote-line add and convert handles for multi-line quotes", () => {
    // Given: a quote with three lines ("First\nSecond\nThird").
    const view = render(
      <NoteContent blocks={mixedBlocks} title="Quote handles" editable />
    )

    // Then: each line exposes its own handle pair.
    // quoteLineId("quote-multi", 0) === "quote-multi"
    // quoteLineId("quote-multi", 1) === "quote-multi-line-1"
    // quoteLineId("quote-multi", 2) === "quote-multi-line-2"
    const lineIds = ["quote-multi", "quote-multi-line-1", "quote-multi-line-2"]
    for (const lineId of lineIds) {
      const add = findHandle(view.container, lineId, "add")
      const convert = findHandle(view.container, lineId, "convert")
      expect(add, `add handle for ${lineId}`).not.toBeNull()
      expect(convert, `convert handle for ${lineId}`).not.toBeNull()
    }
  })

  it("hides both handle modes when the note is not editable", () => {
    // Given: a read-only note.
    const view = render(
      <NoteContent blocks={mixedBlocks} title="Read only" editable={false} />
    )

    // Then: no add or convert handles are mounted.
    const handles = view.container.querySelectorAll(".hn-note-block-handle")
    expect(handles.length).toBe(0)
  })

  it("inserts a paragraph after a table via the add handle", async () => {
    // Given: a controlled note containing only a table.
    const Harness = () => {
      const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
        findBlock("table")
      ])
      return (
        <NoteContent
          blocks={blocks}
          title="Insert after table"
          editable
          onBlocksChange={setBlocks}
        />
      )
    }
    const view = render(<Harness />)

    // When: the table's add handle is clicked and "正文" is selected.
    const add = findHandle(view.container, "table", "add")
    if (!add) throw new Error("Expected table add handle.")
    fireEvent.click(add)
    const item = await screen.findByRole("menuitem", { name: "正文" })
    fireEvent.click(item)

    // Then: a new paragraph block appears immediately after the table.
    await waitFor(() => {
      const blocks = view.container.querySelectorAll(
        ".hn-note-body > .hn-note-block"
      )
      expect(blocks.length).toBe(2)
      expect(blocks.item(0).id).toBe("table")
      expect(
        blocks.item(1).querySelector("[data-editable-block-id]")
      ).not.toBeNull()
    })
  })

  it("inserts a directory marker through the add menu", async () => {
    // Given: a controlled note with one heading source.
    const onChange = vi.fn<(blocks: NoteBlock[]) => void>()
    const Harness = () => {
      const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
        { id: "directory-anchor", kind: "heading", level: 1, text: "Overview" }
      ])
      return (
        <NoteContent
          blocks={blocks}
          title="Insert directory"
          editable
          onBlocksChange={(next) => {
            onChange(next)
            setBlocks(next)
          }}
        />
      )
    }
    const view = render(<Harness />)

    // When: Directory is selected from the heading's add menu.
    const add = findHandle(view.container, "directory-anchor", "add")
    if (!add) throw new Error("Expected directory-anchor add handle.")
    fireEvent.click(add)
    fireEvent.click(await screen.findByRole("menuitem", { name: "目录" }))

    // Then: a marker-only block is inserted immediately after the source.
    await waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toEqual([
        {
          id: "directory-anchor",
          kind: "heading",
          level: 1,
          text: "Overview"
        },
        expect.objectContaining({ kind: "directory" })
      ])
      const inserted = onChange.mock.calls.at(-1)?.[0]?.[1]
      expect(inserted).toEqual({ id: inserted?.id, kind: "directory" })
    })
  })

  it("opens the add menu without visually selecting a block type", async () => {
    // Given: a paragraph block whose current type also exists in the add menu.
    const view = render(
      <NoteContent blocks={[findBlock("para")]} title="Add menu focus" editable />
    )

    // When: the add handle opens the menu and its deferred focus logic settles.
    const add = findHandle(view.container, "para", "add")
    if (!add) throw new Error("Expected paragraph add handle.")
    fireEvent.click(add)
    const menu = await screen.findByRole("menu", { name: "插入新区块类型" })

    // Then: focus stays on the menu itself, so no block type looks preselected.
    await waitFor(() => expect(document.activeElement).toBe(menu))
    expect(menu.querySelector(":focus")).toBeNull()

    // And: keyboard users can still enter the list from the menu container.
    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "H1" })
    )
    fireEvent.keyDown(menu, { key: "Escape" })
    await waitFor(() => expect(menu.isConnected).toBe(false))
  })

  it("inserts a new block after the containing todo from any item add handle", async () => {
    // Given: a controlled note with a todo followed by a sentinel block.
    const initialBlocks: readonly NoteBlock[] = [
      findBlock("list"),
      { id: "tail", kind: "paragraph", text: "Tail" }
    ]
    const Harness = () => {
      const [blocks, setBlocks] = useState(initialBlocks)
      return (
      <NoteContent
        blocks={blocks}
        title="Insert after todo"
        editable
        onBlocksChange={setBlocks}
      />
      )
    }
    const view = render(<Harness />)

    // When: the second todo item's add handle is used to insert a paragraph.
    const add = findHandle(view.container, "item-2", "add")
    if (!add) throw new Error("Expected item-2 add handle.")
    fireEvent.click(add)
    const item = await screen.findByRole("menuitem", { name: "正文" })
    fireEvent.click(item)

    // Then: the new paragraph is placed after the whole todo, before tail.
    await waitFor(() => {
      const blocks = view.container.querySelectorAll(
        ".hn-note-body > [data-note-sortable-id]"
      )
      expect(blocks).toHaveLength(4)
      expect(blocks.item(0).id).toBe("item-1")
      expect(blocks.item(1).id).toBe("item-2")
      expect(
        blocks.item(2).querySelector("[data-editable-block-id]")
      ).not.toBeNull()
      expect(blocks.item(3).id).toBe("tail")
    })
  })

  it("inserts a new todo item immediately after the source item", async () => {
    // Given: a controlled todo with two items.
    const Harness = () => {
      const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
        findBlock("list")
      ])
      return (
        <NoteContent
          blocks={blocks}
          title="Insert todo item"
          editable
          onBlocksChange={setBlocks}
        />
      )
    }
    const view = render(<Harness />)

    // When: Todo is selected from the first item's add menu.
    const add = findHandle(view.container, "item-1", "add")
    if (!add) throw new Error("Expected item-1 add handle.")
    fireEvent.click(add)
    fireEvent.click(await screen.findByRole("menuitem", { name: "Todo" }))

    // Then: one empty item is inserted between the two existing items.
    await waitFor(() => {
      const items = Array.from(
        view.container.querySelectorAll<HTMLElement>(
          ".hn-note-body > .hn-note-todo-item"
        )
      )
      expect(items).toHaveLength(3)
      expect(items[0]?.id).toBe("item-1")
      expect(items[1]?.textContent).not.toContain("Two")
      expect(items[2]?.id).toBe("item-2")
      expect(view.container.querySelector(".hn-note-todo")).toBeNull()
    })
  })

  it("inserts a new quote line immediately after the source line", async () => {
    // Given: a controlled quote with two lines.
    const Harness = () => {
      const [blocks, setBlocks] = useState<readonly NoteBlock[]>([
        { id: "quote-lines", kind: "quote", text: "First\nSecond" }
      ])
      return (
        <NoteContent
          blocks={blocks}
          title="Insert quote line"
          editable
          onBlocksChange={setBlocks}
        />
      )
    }
    const view = render(<Harness />)

    // When: Quote is selected from the first line's add menu.
    const add = findHandle(view.container, "quote-lines", "add")
    if (!add) throw new Error("Expected first quote-line add handle.")
    fireEvent.click(add)
    fireEvent.click(await screen.findByRole("menuitem", { name: "Quote" }))

    // Then: an empty quote line is inserted before the original second line.
    await waitFor(() => {
      const lines = Array.from(
        view.container.querySelectorAll(".hn-note-quote-line p")
      ).map((line) => line.textContent)
      expect(lines).toEqual(["First", "", "Second"])
      expect(
        view.container.querySelectorAll(
          ".hn-note-body > .hn-note-quote-line"
        )
      ).toHaveLength(3)
    })
  })

  it("does not confuse a source id ending in '-add' with an add handle", () => {
    // Given: two blocks whose ids look like a source id and its add-menu suffix.
    const initialBlocks: readonly NoteBlock[] = [
      { id: "alpha", kind: "paragraph", text: "Alpha" },
      { id: "alpha-add", kind: "paragraph", text: "Alpha add" }
    ]
    const Harness = () => {
      const [blocks, setBlocks] = useState(initialBlocks)
      return (
        <NoteContent
          blocks={blocks}
          title="Ambiguous ids"
          editable
          onBlocksChange={setBlocks}
        />
      )
    }
    const view = render(<Harness />)

    // When: the add handle for "alpha" is opened.
    const add = findHandle(view.container, "alpha", "add")
    if (!add) throw new Error("Expected alpha add handle.")
    fireEvent.click(add)

    // Then: the convert handle for "alpha-add" stays closed.
    const otherConvert = findHandle(view.container, "alpha-add", "convert")
    expect(otherConvert?.getAttribute("aria-expanded")).toBe("false")
  })

  it("does not split a block when activating a magic link with Enter", () => {
    const onMagicLinkClick = vi.fn()
    const onBlocksChange = vi.fn()
    const view = render(
      <NoteContent
        blocks={[
          {
            id: "magic",
            kind: "paragraph",
            text: '<a href="hnmagic://open">Open</a>'
          }
        ]}
        title="Magic link"
        editable
        onBlocksChange={onBlocksChange}
        onMagicLinkClick={onMagicLinkClick}
      />
    )
    const link = view.container.querySelector<HTMLAnchorElement>("a")
    if (!link) throw new Error("Expected magic link.")
    link.focus()
    fireEvent.keyDown(link, { key: "Enter" })

    expect(onMagicLinkClick).toHaveBeenCalledWith("hnmagic://open")
    expect(onBlocksChange).not.toHaveBeenCalled()
  })
})
