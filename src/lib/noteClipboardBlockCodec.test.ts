/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest"

import {
  cloneClipboardBlock,
  parseClipboardBlock,
} from "./noteClipboardBlockCodec"
import { parseStructuredClipboard } from "./noteStructuredClipboard"
import type { NoteBlock } from "./types"

describe("note clipboard block codec", () => {
  it("round-trips every structured block variant and regenerates nested IDs", () => {
    // Given: complete intermediate structures that must not disappear from an internal fragment.
    const blocks: readonly NoteBlock[] = [
      {
        id: "todo",
        kind: "todo",
        title: "Tasks",
        items: [{ id: "todo-item", checked: true, text: "Done" }],
      },
      {
        id: "cards",
        kind: "card",
        data: [{
          id: "orphan",
          parent: "outside-fragment",
          title: "Orphan",
          content: "Card",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        }],
      },
      { id: "quote", kind: "quote", text: "Quoted", author: "Author" },
      { id: "callout", kind: "callout", tone: "warning", title: "Watch", text: "Carefully" },
      { id: "table", kind: "table", rows: [["A", "B"], ["C", "D"]] },
      {
        id: "fold",
        kind: "collapsible",
        title: "Details",
        collapsed: false,
        blocks: [{ id: "nested", kind: "checklist", title: "Checks", items: [{ id: "check", checked: false, text: "Verify" }] }],
      },
    ]

    // When: the untrusted JSON shape is parsed and cloned for insertion.
    const parsed = blocks.map((block) => parseClipboardBlock(JSON.parse(JSON.stringify(block))))
    const cloned = parsed.flatMap((block) => block ? [cloneClipboardBlock(block)] : [])

    // Then: every structure survives while all persistent block and item IDs are fresh.
    expect(parsed).toEqual(blocks)
    expect(cloned.map((block) => block.kind)).toEqual(["todo", "card", "quote", "callout", "table", "collapsible"])
    expect(cloned.every((block, index) => block.id !== blocks[index]?.id)).toBe(true)
    expect(cloned[0]).toMatchObject({ kind: "todo", items: [{ checked: true, text: "Done" }] })
    expect(cloned[0]?.kind === "todo" ? cloned[0].items[0]?.id : undefined).not.toBe("todo-item")
    const fold = cloned[5]
    expect(fold?.kind).toBe("collapsible")
    if (fold?.kind !== "collapsible") throw new Error("Expected cloned collapsible block")
    expect(fold.blocks[0]?.id).not.toBe("nested")
    const checklist = fold.blocks[0]
    expect(checklist?.kind === "checklist" ? checklist.items[0]?.id : undefined).not.toBe("check")
    const cards = cloned[1]
    expect(cards?.kind === "card" ? cards.data[0]?.parent : "unexpected").toBeUndefined()
  })

  it("rejects malformed nested clipboard blocks", () => {
    // Given: a collapsible payload whose nested block violates the NoteBlock contract.
    const malformed = {
      id: "fold",
      kind: "collapsible",
      title: "Bad",
      collapsed: false,
      blocks: [{ id: "nested", kind: "todo", title: "Tasks", items: [{ checked: "yes" }] }],
    }

    // When: the clipboard boundary parses the payload.
    const parsed = parseClipboardBlock(malformed)

    // Then: the complete payload is rejected rather than partially restored.
    expect(parsed).toBeNull()
  })

  it("bounds recursive payloads and sanitizes rich fields at the clipboard boundary", () => {
    // Given: one deeply recursive payload and one payload containing unsafe rich HTML.
    let nested: unknown = { id: "leaf", kind: "paragraph", text: "Leaf" }
    for (let depth = 0; depth < 20; depth += 1) {
      nested = {
        id: `fold-${depth}`,
        kind: "collapsible",
        title: "Fold",
        collapsed: false,
        blocks: [nested],
      }
    }
    const unsafePayload = JSON.stringify({
      version: 2,
      leadingHtml: '<strong onclick="bad()">Lead</strong><script>bad()</script>',
      trailingHtml: '<a href="javascript:bad()">Tail</a>',
      slices: [{
        kind: "rich-block",
        block: { id: "rich", kind: "paragraph", text: '<em onclick="bad()">Safe</em><script>bad()</script>' },
      }],
      html: "ignored",
      text: "ignored",
    })

    // When: internal clipboard JSON crosses the untrusted parser boundary.
    const rejected = parseClipboardBlock(nested)
    const sanitized = parseStructuredClipboard(unsafePayload)

    // Then: excessive depth is rejected and every persisted rich field is normalized.
    expect(rejected).toBeNull()
    expect(sanitized).toMatchObject({
      leadingHtml: "<strong>Lead</strong>",
      trailingHtml: "<a>Tail</a>",
      slices: [{
        kind: "rich-block",
        block: { kind: "paragraph", text: "<em>Safe</em>" },
      }],
    })
  })

  it("sanitizes every table-row cell before returning an internal fragment", () => {
    // Given: an internal table row contains script content, event attributes, and an unsafe URL.
    const payload = JSON.stringify({
      version: 2,
      leadingHtml: "",
      trailingHtml: "",
      slices: [{
        kind: "table-row",
        cells: [
          '<strong onclick="bad()">Safe</strong><script>bad()</script>',
          '<a href="javascript:bad()">Tail</a>',
        ],
      }],
      html: "ignored",
      text: "ignored",
    })

    // When: the untrusted row crosses the internal clipboard parser boundary.
    const parsed = parseStructuredClipboard(payload)

    // Then: persisted cell HTML is normalized before any transaction can observe it.
    expect(parsed?.slices).toEqual([{
      kind: "table-row",
      cells: ["<strong>Safe</strong>", "<a>Tail</a>"],
    }])
  })

  it("rejects clipboard collections that exceed their structural budgets", () => {
    // Given: list, table, and row-slice payloads exceed their supported collection limits.
    const oversizedTodo = {
      id: "todo",
      kind: "todo",
      title: "Tasks",
      items: Array.from({ length: 257 }, (_, index) => ({
        id: `item-${index}`,
        checked: false,
        text: "Task",
      })),
    }
    const oversizedTable = {
      id: "table",
      kind: "table",
      rows: Array.from({ length: 257 }, () => ["Cell"]),
    }
    const oversizedRow = JSON.stringify({
      version: 2,
      leadingHtml: "",
      trailingHtml: "",
      slices: [{ kind: "table-row", cells: Array.from({ length: 65 }, () => "Cell") }],
      html: "ignored",
      text: "ignored",
    })

    // When: each collection crosses the untrusted clipboard boundary.
    const todo = parseClipboardBlock(oversizedTodo)
    const table = parseClipboardBlock(oversizedTable)
    const row = parseStructuredClipboard(oversizedRow)

    // Then: all oversized collections are rejected before allocation into a note snapshot.
    expect(todo).toBeNull()
    expect(table).toBeNull()
    expect(row).toBeNull()
  })
})
