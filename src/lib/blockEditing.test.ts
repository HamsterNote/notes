import { describe, expect, expectTypeOf, it } from "vitest"
import {
  convertBlockFormat,
  convertTextBlockFormat,
  deleteEmptyTextBlock,
  insertBlockAfter,
  insertSplitBlock,
  isVisibleHtmlEmpty,
  normalizeEditableHtml,
  splitTextBlockAtHtml
} from "./blockEditing"
import { resolveBackspaceFocus, resolveDeletionFocus } from "./NoteBlockFocus"
import type { NoteBlock, NoteHeadingBlock, NoteParagraphBlock } from "./types"

const paragraphBlock: NoteParagraphBlock = {
  id: "intro",
  kind: "paragraph",
  text: "Launch notes",
  tone: "accent"
}

const headingBlock: NoteHeadingBlock = {
  eyebrow: "Release",
  id: "title",
  kind: "heading",
  level: 2,
  text: "Public beta"
}

const headingLevels = [1, 2, 3, 4, 5] as const

describe("convertTextBlockFormat", () => {
  it("converts a paragraph to every heading level while preserving id/text and dropping tone", () => {
    for (const level of headingLevels) {
      // Given: a paragraph with presentation-only tone metadata.
      const block = paragraphBlock

      // When: the block is converted to a concrete heading level.
      const converted = convertTextBlockFormat(block, {
        kind: "heading",
        level
      })

      // Then: only id/text survive; tone must not leak into heading output.
      expect(converted).toEqual({
        id: "intro",
        kind: "heading",
        level,
        text: "Launch notes"
      })
    }
  })

  it("converts a heading to a paragraph while preserving id/text and dropping eyebrow", () => {
    // Given: a heading with eyebrow-only heading metadata.
    const block = headingBlock

    // When: the block is converted back to paragraph format.
    const converted = convertTextBlockFormat(block, { kind: "paragraph" })

    // Then: only paragraph fields remain.
    expect(converted).toEqual({
      id: "title",
      kind: "paragraph",
      text: "Public beta"
    })
  })

  it("constrains format conversion inputs to heading or paragraph blocks", () => {
    // Given: the public helper parameter type.
    type FormatSourceBlock = Parameters<typeof convertTextBlockFormat>[0]

    // When / Then: non-text NoteBlock variants are excluded by contract.
    expectTypeOf<FormatSourceBlock>().toEqualTypeOf<
      NoteHeadingBlock | NoteParagraphBlock
    >()
  })
})

describe("convertBlockFormat", () => {
  it.each([
    [
      "todo",
      {
        id: "tasks",
        kind: "todo",
        title: "Tasks & notes",
        items: [
          { id: "done", checked: true, text: "Done" },
          { id: "next", checked: false, text: "<em>Next</em>" }
        ]
      },
      "<strong>Tasks &amp; notes</strong><br>[x] Done<br>[ ] <em>Next</em>"
    ],
    [
      "quote",
      {
        id: "quote",
        kind: "quote",
        text: "Insight",
        author: "Ada & Lin"
      },
      "Insight<br>Ada &amp; Lin"
    ],
    [
      "callout",
      {
        id: "notice",
        kind: "callout",
        tone: "warning",
        title: "Heads <up>",
        text: "Read this"
      },
      "<strong>Heads &lt;up&gt;</strong><br>Read this"
    ],
    [
      "code",
      {
        id: "sample",
        kind: "code",
        language: "tsx",
        filename: "App.tsx",
        code: "const node = <tag>"
      },
      "<strong>App.tsx (tsx)</strong><br>const node = &lt;tag&gt;"
    ]
  ] satisfies readonly (readonly [string, NoteBlock, string])[])(
    "preserves all visible %s content when converting to a paragraph",
    (_label, block, expectedText) => {
      // Given: a structured block with visible primary and metadata content.
      // When: the user explicitly converts it through the block action menu.
      const converted = convertBlockFormat(block, { kind: "paragraph" })

      // Then: every visible field is flattened into the resulting rich text.
      expect(converted).toEqual({
        id: block.id,
        kind: "paragraph",
        text: expectedText
      })
    }
  )
})

describe("editable HTML normalization", () => {
  it("normalizes contentEditable block wrappers while preserving soft <br> breaks", () => {
    // Given: browser-ish contentEditable HTML with div wrappers and soft breaks.
    const html = "<div>Alpha</div><div>Beta<br />Gamma</div>"

    // When: the HTML is normalized for storage.
    const normalized = normalizeEditableHtml(html)

    // Then: block wrappers become stable <br> separators; soft breaks survive.
    expect(normalized).toBe("Alpha<br>Beta<br>Gamma")
  })

  it.each([
    ["empty string", ""],
    ["whitespace", " \n\t  "],
    ["bare br", "<br>"],
    ["self-closing br", "<br />"],
    ["empty div line", "<div><br></div>"]
  ] as const)("detects empty visible text for %s", (_label, html) => {
    // Given: HTML that renders no visible characters.
    const candidate = html

    // When: visible emptiness is checked.
    const empty = isVisibleHtmlEmpty(candidate)

    // Then: editing commands may treat it as empty.
    expect(empty).toBe(true)
  })
})

describe("splitTextBlockAtHtml", () => {
  it.each([
    ["start", "", "Alpha", "", "Alpha"],
    ["middle", "Alpha", "Beta", "Alpha", "Beta"],
    ["end", "Alpha", "", "Alpha", ""]
  ] as const)(
    "splits a paragraph at the %s caret position",
    (_label, beforeHtml, afterHtml, beforeText, afterText) => {
      // Given: a paragraph and deterministic id for the inserted block.
      const block: NoteParagraphBlock = {
        id: "body",
        kind: "paragraph",
        text: ""
      }

      // When: the block is split around the caret HTML fragments.
      const split = splitTextBlockAtHtml({
        afterHtml,
        beforeHtml,
        block,
        nextId: "body-line"
      })

      // Then: both halves are paragraphs with normalized text.
      expect(split).toEqual([
        { id: "body", kind: "paragraph", text: beforeText },
        { id: "body-line", kind: "paragraph", text: afterText }
      ])
    }
  )

  it("preserves paragraph tone on the inserted split block", () => {
    // Given: a toned paragraph and deterministic id for the inserted paragraph.
    const block: NoteParagraphBlock = {
      id: "body",
      kind: "paragraph",
      text: "",
      tone: "muted"
    }

    // When: the paragraph is split around the caret HTML fragments.
    const split = splitTextBlockAtHtml({
      afterHtml: "Beta",
      beforeHtml: "Alpha",
      block,
      nextId: "body-line"
    })

    // Then: both halves keep the source paragraph format metadata.
    expect(split).toEqual([
      { id: "body", kind: "paragraph", text: "Alpha", tone: "muted" },
      { id: "body-line", kind: "paragraph", text: "Beta", tone: "muted" }
    ])
  })

  it.each([
    ["start", "", "Title", "", "Title"],
    ["middle", "Public", "Beta", "Public", "Beta"],
    ["end", "Public", "", "Public", ""]
  ] as const)(
    "splits a heading at the %s caret position into matching heading blocks",
    (_label, beforeHtml, afterHtml, beforeText, afterText) => {
      // Given: a heading and deterministic id for the inserted heading.
      const block: NoteHeadingBlock = {
        id: "hero",
        kind: "heading",
        level: 1,
        text: ""
      }

      // When: the heading is split around the caret HTML fragments.
      const split = splitTextBlockAtHtml({
        afterHtml,
        beforeHtml,
        block,
        nextId: "hero-line"
      })

      // Then: both halves keep the source heading level.
      expect(split).toEqual([
        { id: "hero", kind: "heading", level: 1, text: beforeText },
        { id: "hero-line", kind: "heading", level: 1, text: afterText }
      ])
    }
  )
})

describe("insertSplitBlock", () => {
  it("flushes normalized HTML before inserting the split block", () => {
    // Given: blocks around the source paragraph and unnormalized caret HTML.
    const blocks: readonly NoteBlock[] = [
      paragraphBlock,
      { id: "next", kind: "paragraph", text: "After" }
    ]

    // When: the source block is split.
    const result = insertSplitBlock({
      afterHtml: "Beta<div>Gamma</div>",
      beforeHtml: "<div>Alpha</div>",
      blocks,
      nextId: "intro-line",
      sourceId: "intro"
    })

    // Then: persisted text is normalized before the new id is inserted.
    expect(result).toEqual([
      { id: "intro", kind: "paragraph", text: "Alpha" },
      { id: "intro-line", kind: "paragraph", text: "Beta<br>Gamma" },
      { id: "next", kind: "paragraph", text: "After" }
    ])
  })

  it("creates a paragraph after a heading instead of cloning the heading", () => {
    // Given: a heading split around the caret.
    const blocks: readonly NoteBlock[] = [
      { id: "heading", kind: "heading", level: 2, text: "AlphaBeta" }
    ]

    // When: Enter creates the following block.
    const result = insertSplitBlock({
      afterHtml: "Beta",
      beforeHtml: "Alpha",
      blocks,
      nextId: "heading-line",
      sourceId: "heading"
    })

    // Then: the source keeps its type, while the new block is plain text.
    expect(result).toEqual([
      { id: "heading", kind: "heading", level: 2, text: "Alpha" },
      { id: "heading-line", kind: "paragraph", text: "Beta" }
    ])
  })

  it.each(["unorderedList", "orderedList"] as const)(
    "keeps %s for the block created by Enter",
    (kind) => {
      // Given: a list item split around the caret.
      const blocks: readonly NoteBlock[] = [
        { id: "list", kind, text: "AlphaBeta" }
      ]

      // When: Enter creates the following item.
      const result = insertSplitBlock({
        afterHtml: "Beta",
        beforeHtml: "Alpha",
        blocks,
        nextId: "list-line",
        sourceId: "list"
      })

      // Then: both halves remain list items of the same type.
      expect(result).toEqual([
        { id: "list", kind, text: "Alpha" },
        { id: "list-line", kind, text: "Beta" }
      ])
    }
  )

  it("inserts a todo item after the edited item", () => {
    // Given: a todo with an item being split in the middle.
    const blocks: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "todo",
        title: "Tasks",
        items: [{ id: "first", checked: true, text: "AlphaBeta" }]
      }
    ]

    // When: Enter splits the item around the caret.
    const result = insertSplitBlock({
      afterHtml: "Beta",
      beforeHtml: "Alpha",
      blocks,
      nextId: "first-line",
      sourceId: "first"
    })

    // Then: a new unchecked todo item follows the edited item.
    expect(result).toEqual([
      {
        id: "tasks",
        kind: "todo",
        title: "Tasks",
        items: [
          { id: "first", checked: true, text: "Alpha" },
          { id: "first-line", checked: false, text: "Beta" }
        ]
      }
    ])
  })

  it("inserts an item in a persisted legacy checklist", () => {
    // Given: a legacy checklist item being split in the middle.
    const blocks: readonly NoteBlock[] = [
      {
        id: "legacy-checklist",
        kind: "checklist",
        title: "Imported tasks",
        items: [{ id: "legacy-item", checked: true, text: "AlphaBeta" }]
      }
    ]

    // When: Enter splits the persisted item around the caret.
    const result = insertSplitBlock({
      afterHtml: "Beta",
      beforeHtml: "Alpha",
      blocks,
      nextId: "legacy-item-line",
      sourceId: "legacy-item"
    })

    // Then: the block shape and title survive, while a new unchecked item follows.
    expect(result).toEqual([
      {
        id: "legacy-checklist",
        kind: "checklist",
        title: "Imported tasks",
        items: [
          { id: "legacy-item", checked: true, text: "Alpha" },
          { id: "legacy-item-line", checked: false, text: "Beta" }
        ]
      }
    ])
  })

  it.each([
    {
      id: "notice",
      kind: "callout",
      tone: "info",
      title: "Notice",
      text: "AlphaBeta"
    },
    {
      id: "sample",
      kind: "code",
      code: "AlphaBeta",
      language: "text"
    }
  ] satisfies readonly NoteBlock[])(
    "keeps $kind unchanged because Enter is handled inside the block",
    (block) => {
      // Given: a multiline block whose editor owns the Enter key.
      const blocks: readonly NoteBlock[] = [block]

      // When: the generic split helper is called defensively.
      const result = insertSplitBlock({
        afterHtml: "Beta",
        beforeHtml: "Alpha",
        blocks,
        nextId: "new-block",
        sourceId: block.id
      })

      // Then: the generic helper does not clone or convert the block.
      expect(result).toEqual(blocks)
    }
  )
})

describe("insertBlockAfter", () => {
  it("inserts an empty block of the selected type after the referenced block", () => {
    // Given: a single paragraph and a request to add a heading after it.
    const blocks: readonly NoteBlock[] = [paragraphBlock]

    // When: the new block is inserted.
    const result = insertBlockAfter({
      blocks,
      blockId: "intro",
      nextId: "intro-line",
      target: { kind: "heading", level: 2 }
    })

    // Then: the original block is preserved and a new empty heading follows it.
    expect(result).toEqual([
      paragraphBlock,
      { id: "intro-line", kind: "heading", level: 2, text: "" }
    ])
  })

  it("generates a todo with the correct default item id", () => {
    // Given: a single paragraph.
    const blocks: readonly NoteBlock[] = [paragraphBlock]

    // When: inserting a todo after it.
    const result = insertBlockAfter({
      blocks,
      blockId: "intro",
      todoItemId: "32ff2214-ad42-42c1-a50a-a663f4b6d601",
      nextId: "89430e11-f481-4d80-ab93-6c065784b0a6",
      target: { kind: "todo" }
    })

    // Then: the new todo has an empty title and a single empty item.
    expect(result).toEqual([
      paragraphBlock,
      {
        id: "89430e11-f481-4d80-ab93-6c065784b0a6",
        kind: "todo",
        title: "",
        items: [
          {
            id: "32ff2214-ad42-42c1-a50a-a663f4b6d601",
            checked: false,
            text: ""
          }
        ]
      }
    ])
  })

  it("returns an unchanged copy when the referenced block is missing", () => {
    // Given: a block list that does not contain the requested id.
    const blocks: readonly NoteBlock[] = [paragraphBlock]

    // When / Then: insertion is a no-op (but returns a new array for immutability).
    const result = insertBlockAfter({
      blocks,
      blockId: "missing",
      nextId: "b2643bb7-c68b-4f4d-b9b7-631151c64161",
      target: { kind: "paragraph" }
    })
    expect(result).toEqual(blocks)
    expect(result).not.toBe(blocks)
  })
})

describe("deleteEmptyTextBlock", () => {
  it("flushes normalized HTML and keeps a non-empty source block", () => {
    // Given: delete is requested while the editable still has visible text.
    const blocks: readonly NoteBlock[] = [paragraphBlock]

    // When: the current HTML is normalized before delete handling.
    const result = deleteEmptyTextBlock({
      blocks,
      currentHtml: "<div>Edited</div><div>Text</div>",
      sourceId: "intro"
    })

    // Then: the block is updated instead of deleted.
    expect(result).toEqual([
      { id: "intro", kind: "paragraph", text: "Edited<br>Text" }
    ])
  })

  it("deletes an empty text block when another block remains", () => {
    // Given: a visibly empty paragraph before a following block.
    const blocks: readonly NoteBlock[] = [
      { id: "empty", kind: "paragraph", text: "Old" },
      { id: "after", kind: "paragraph", text: "After" }
    ]

    // When: the empty block is deleted.
    const result = deleteEmptyTextBlock({
      blocks,
      currentHtml: "<div><br></div>",
      sourceId: "empty"
    })

    // Then: only the neighboring block remains.
    expect(result).toEqual([{ id: "after", kind: "paragraph", text: "After" }])
  })

  it.each(["unorderedList", "orderedList"] as const)(
    "downgrades an empty %s to a stable paragraph when another block remains",
    (kind) => {
      // Given: an empty list item before another block.
      const blocks: readonly NoteBlock[] = [
        { id: "empty-list", kind, text: "" },
        { id: "after", kind: "paragraph", text: "After" }
      ]

      // When: Backspace is pressed at the start of the empty list item.
      const result = deleteEmptyTextBlock({
        blocks,
        currentHtml: "<br>",
        sourceId: "empty-list"
      })

      // Then: the row remains with the same id and becomes a paragraph.
      expect(result).toEqual([
        { id: "empty-list", kind: "paragraph", text: "" },
        { id: "after", kind: "paragraph", text: "After" }
      ])
    }
  )

  it("replaces the last empty block with one stable empty paragraph", () => {
    // Given: the document only has one visibly empty heading block.
    const blocks: readonly NoteBlock[] = [
      { id: "solo", kind: "heading", level: 3, text: "Old" }
    ]

    // When: Backspace delete is applied to the final block.
    const result = deleteEmptyTextBlock({
      blocks,
      currentHtml: "<br>",
      sourceId: "solo"
    })

    // Then: the stable id is reused for a single empty paragraph.
    expect(result).toEqual([{ id: "solo", kind: "paragraph", text: "" }])
  })

  it("deletes an empty todo item while preserving its todo", () => {
    // Given: a todo containing one empty item and one remaining item.
    const blocks: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "todo",
        title: "Tasks",
        items: [
          { id: "empty", checked: false, text: "Old" },
          { id: "after", checked: false, text: "After" }
        ]
      }
    ]

    // When: Backspace is applied to the empty item.
    const result = deleteEmptyTextBlock({
      blocks,
      currentHtml: "<br>",
      sourceId: "empty"
    })

    // Then: only that item is removed, not the whole todo block.
    expect(result).toEqual([
      {
        id: "tasks",
        kind: "todo",
        title: "Tasks",
        items: [{ id: "after", checked: false, text: "After" }]
      }
    ])
  })

  it("downgrades a single-item empty todo to paragraph when other blocks exist", () => {
    // Given: a single-item todo block with empty content, alongside another block.
    const blocks: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "todo",
        title: "Tasks",
        items: [{ id: "only", checked: true, text: "" }]
      },
      { id: "after", kind: "paragraph", text: "After" }
    ]

    // When: Backspace is pressed on the empty todo item.
    const result = deleteEmptyTextBlock({
      blocks,
      currentHtml: "<br>",
      sourceId: "only"
    })

    // Then: the todo block becomes a paragraph, keeping its block id.
    expect(result).toEqual([
      { id: "tasks", kind: "paragraph", text: "" },
      { id: "after", kind: "paragraph", text: "After" }
    ])
  })

  it.each([
    [
      "quote author",
      { id: "quote", kind: "quote", text: "Old", author: "Ada" },
      { id: "quote", kind: "quote", text: "", author: "Ada" }
    ],
    [
      "callout title",
      {
        id: "callout",
        kind: "callout",
        tone: "info",
        title: "Read me",
        text: "Old"
      },
      {
        id: "callout",
        kind: "callout",
        tone: "info",
        title: "Read me",
        text: ""
      }
    ],
    [
      "code metadata",
      {
        id: "code",
        kind: "code",
        language: "tsx",
        filename: "App.tsx",
        code: "Old"
      },
      {
        id: "code",
        kind: "code",
        language: "tsx",
        filename: "App.tsx",
        code: ""
      }
    ]
  ] satisfies readonly (readonly [string, NoteBlock, NoteBlock])[])(
    "keeps a block with visible %s when its primary field is empty",
    (_label, source, expected) => {
      // Given: a structured block whose secondary content remains visible.
      const blocks: readonly NoteBlock[] = [
        source,
        { id: "after", kind: "paragraph", text: "After" }
      ]

      // When: Backspace is applied to its empty primary field.
      const result = deleteEmptyTextBlock({
        blocks,
        currentHtml: "<br>",
        sourceId: source.id
      })

      // Then: the structured block remains and only its primary field is cleared.
      expect(result).toEqual([
        expected,
        { id: "after", kind: "paragraph", text: "After" }
      ])
    }
  )
})

describe("resolveDeletionFocus", () => {
  it("focuses the replacement paragraph after deleting the only todo item", () => {
    // Given: a one-item todo is replaced by a stable empty paragraph.
    const before: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "todo",
        title: "Tasks",
        items: [{ id: "only", checked: false, text: "" }]
      }
    ]
    const after: readonly NoteBlock[] = [
      { id: "tasks", kind: "paragraph", text: "" }
    ]

    // When: the focus destination is resolved after item deletion.
    const target = resolveDeletionFocus({ after, before, sourceId: "only" })

    // Then: the replacement block receives focus at its start.
    expect(target).toEqual({ id: "tasks", position: "start" })
  })
})

describe("resolveBackspaceFocus", () => {
  it("keeps focus on the downgraded paragraph when a single-item todo follows other blocks", () => {
    // Given: a heading precedes a one-item todo that Backspace downgrades to a paragraph.
    const before: readonly NoteBlock[] = [
      { id: "intro", kind: "heading", level: 1, text: "Intro" },
      {
        id: "tasks",
        kind: "todo",
        title: "",
        items: [{ id: "only", checked: false, text: "" }]
      }
    ]
    const after: readonly NoteBlock[] = [
      { id: "intro", kind: "heading", level: 1, text: "Intro" },
      { id: "tasks", kind: "paragraph", text: "" }
    ]

    // When: the Backspace focus destination is resolved for the emptied item.
    const target = resolveBackspaceFocus({ after, before, sourceId: "only" })

    // Then: the caret stays on the downgraded paragraph instead of jumping to the previous block.
    expect(target).toEqual({ id: "tasks", position: "start" })
  })

  it("moves focus to the previous item when one of several todo items is removed", () => {
    // Given: a two-item todo whose second empty item is removed by Backspace.
    const before: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "todo",
        title: "",
        items: [
          { id: "first", checked: false, text: "One" },
          { id: "second", checked: false, text: "" }
        ]
      }
    ]
    const after: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "todo",
        title: "",
        items: [{ id: "first", checked: false, text: "One" }]
      }
    ]

    // When: the Backspace focus destination is resolved.
    const target = resolveBackspaceFocus({ after, before, sourceId: "second" })

    // Then: the caret lands at the end of the remaining previous item.
    expect(target).toEqual({ id: "first", position: "end" })
  })

  it("focuses the surviving paragraph when the single-item todo is the only block", () => {
    // Given: a one-item todo is the only block and becomes a paragraph.
    const before: readonly NoteBlock[] = [
      {
        id: "tasks",
        kind: "todo",
        title: "",
        items: [{ id: "only", checked: false, text: "" }]
      }
    ]
    const after: readonly NoteBlock[] = [
      { id: "tasks", kind: "paragraph", text: "" }
    ]

    // When: the Backspace focus destination is resolved.
    const target = resolveBackspaceFocus({ after, before, sourceId: "only" })

    // Then: the caret stays on the downgraded paragraph.
    expect(target).toEqual({ id: "tasks", position: "start" })
  })
})
