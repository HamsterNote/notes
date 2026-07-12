import { describe, expect, expectTypeOf, it } from "vitest"
import {
  convertTextBlockFormat,
  createNextBlockId,
  deleteEmptyTextBlock,
  insertSplitBlock,
  isVisibleHtmlEmpty,
  normalizeEditableHtml,
  splitTextBlockAtHtml
} from "./blockEditing"
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
      sourceId: "intro"
    })

    // Then: persisted text is normalized before the new id is inserted.
    expect(result).toEqual([
      { id: "intro", kind: "paragraph", text: "Alpha" },
      { id: "intro-line", kind: "paragraph", text: "Beta<br>Gamma" },
      { id: "next", kind: "paragraph", text: "After" }
    ])
  })
})

describe("createNextBlockId", () => {
  it("generates deterministic collision-free line ids without time or randomness", () => {
    // Given: existing ids that collide with the base and first suffix.
    const blocks: readonly NoteBlock[] = [
      { id: "intro", kind: "paragraph", text: "A" },
      { id: "intro-line", kind: "paragraph", text: "B" },
      { id: "intro-line-1", kind: "paragraph", text: "C" },
      { id: "intro-line-3", kind: "paragraph", text: "D" }
    ]

    // When / Then: the first free deterministic suffix is selected.
    expect(createNextBlockId(blocks, "intro")).toBe("intro-line-2")
    expect(createNextBlockId(blocks, "other")).toBe("other-line")
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
})
