/** @vitest-environment jsdom */
import { useState } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const mixedBlocks: readonly NoteBlock[] = [
  { id: "h1", kind: "heading", level: 1, text: "Heading" },
  { id: "para", kind: "paragraph", text: "Paragraph" },
  {
    id: "list",
    kind: "checklist",
    title: "List",
    items: [
      { id: "item-1", checked: false, text: "One" },
      { id: "item-2", checked: true, text: "Two" }
    ]
  },
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

  it("renders per-checklist-item add and convert handles", () => {
    // Given: a checklist with two items.
    const view = render(
      <NoteContent blocks={mixedBlocks} title="Checklist handles" editable />
    )

    // Then: each item row exposes its own pair, not a block-level pair.
    for (const itemId of ["item-1", "item-2"]) {
      const add = findHandle(view.container, itemId, "add")
      const convert = findHandle(view.container, itemId, "convert")
      expect(add, `add handle for ${itemId}`).not.toBeNull()
      expect(convert, `convert handle for ${itemId}`).not.toBeNull()
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
        mixedBlocks.find((b) => b.id === "table")!
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
      const rows = view.container.querySelectorAll(".hn-note-block-row")
      expect(rows.length).toBe(2)
      const tableRow = rows[0]!
      const newRow = rows[1]!
      expect(tableRow.id).toBe("table")
      expect(newRow.querySelector("[data-editable-block-id]")).not.toBeNull()
    })
  })

  it("inserts a new block after the containing checklist from any item add handle", async () => {
    // Given: a controlled note with a checklist followed by a sentinel block.
    const initialBlocks: readonly NoteBlock[] = [
      mixedBlocks.find((b) => b.id === "list")!,
      { id: "tail", kind: "paragraph", text: "Tail" }
    ]
    const Harness = () => {
      const [blocks, setBlocks] = useState(initialBlocks)
      return (
        <NoteContent
          blocks={blocks}
          title="Insert after checklist"
          editable
          onBlocksChange={setBlocks}
        />
      )
    }
    const view = render(<Harness />)

    // When: the second checklist item's add handle is used to insert a paragraph.
    const add = findHandle(view.container, "item-2", "add")
    if (!add) throw new Error("Expected item-2 add handle.")
    fireEvent.click(add)
    const item = await screen.findByRole("menuitem", { name: "正文" })
    fireEvent.click(item)

    // Then: the new paragraph is placed after the whole checklist, before tail.
    await waitFor(() => {
      const rows = view.container.querySelectorAll(".hn-note-block-row")
      expect(rows[0]!.id).toBe("item-1")
      expect(rows[1]!.id).toBe("item-2")
      expect(rows[2]!.querySelector("[data-editable-block-id]")).not.toBeNull()
      expect(rows[3]!.id).toBe("tail")
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
        blocks={[{
          id: "magic",
          kind: "paragraph",
          text: '<a href="hnmagic://open">Open</a>'
        }]}
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
