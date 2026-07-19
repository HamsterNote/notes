import { describe, expect, it } from "vitest"

// Phase 2 「特殊块转 paragraph」单元测试：
// 直接覆盖 blockDowngrade.ts 中的 resolveSpecialBlockSourceForBackspace 与
// downgradeEmptySpecialBlockToParagraph。这些纯函数不依赖 DOM，因此可在 node 环境下运行。

import {
  canDowngradeEmptySpecialBlock,
  downgradeEmptySpecialBlockToParagraph,
  resolveSpecialBlockSourceForBackspace
} from "./blockDowngrade"
import { quoteTextLines } from "./blockSourceConversion"
import type {
  NoteBlock,
  NoteCalloutBlock,
  NoteChecklistBlock,
  NoteQuoteBlock
} from "./types"

const callout = (id: string, text: string, title = "Tip"): NoteCalloutBlock => ({
  id,
  kind: "callout",
  tone: "info",
  title,
  text
})

const checklist = (
  id: string,
  items: Array<{ id: string; checked?: boolean; text: string }>,
  title = ""
): NoteChecklistBlock => ({
  id,
  kind: "checklist",
  title,
  items: items.map((item) => ({
    id: item.id,
    checked: item.checked ?? false,
    text: item.text
  }))
})

const quote = (id: string, text: string, author?: string): NoteQuoteBlock => ({
  id,
  kind: "quote",
  text,
  ...(author === undefined ? {} : { author })
})

const paragraph = (id: string, text = ""): NoteBlock => ({
  id,
  kind: "paragraph",
  text
})

describe("blockDowngrade.resolveSpecialBlockSourceForBackspace", () => {
  it("callout.text 的 sourceId 命中 block.id → 返回 block source", () => {
    const blocks: NoteBlock[] = [callout("c1", "")]
    expect(resolveSpecialBlockSourceForBackspace(blocks, "c1")).toEqual({
      kind: "block",
      blockId: "c1"
    })
  })

  it("checklist item.id 命中 → 返回 checklist-item source", () => {
    const blocks: NoteBlock[] = [
      checklist("ck1", [
        { id: "i1", text: "" },
        { id: "i2", text: "" }
      ])
    ]
    expect(resolveSpecialBlockSourceForBackspace(blocks, "i2")).toEqual({
      kind: "checklist-item",
      blockId: "ck1",
      itemId: "i2"
    })
  })

  it("paragraph / heading 等非特殊块 → 返回 undefined（走常规删除路径）", () => {
    const blocks: NoteBlock[] = [paragraph("p1", "")]
    expect(resolveSpecialBlockSourceForBackspace(blocks, "p1")).toBeUndefined()
  })
})

describe("blockDowngrade.canDowngradeEmptySpecialBlock", () => {
  it("callout with empty text → true", () => {
    const blocks: NoteBlock[] = [callout("c1", "")]
    expect(
      canDowngradeEmptySpecialBlock(blocks, { kind: "block", blockId: "c1" })
    ).toBe(true)
  })

  it("callout with non-empty text → false", () => {
    const blocks: NoteBlock[] = [callout("c1", "x")]
    expect(
      canDowngradeEmptySpecialBlock(blocks, { kind: "block", blockId: "c1" })
    ).toBe(false)
  })

  it("checklist item with empty text → true", () => {
    const blocks: NoteBlock[] = [
      checklist("ck1", [{ id: "i1", text: "" }])
    ]
    expect(
      canDowngradeEmptySpecialBlock(blocks, {
        kind: "checklist-item",
        blockId: "ck1",
        itemId: "i1"
      })
    ).toBe(true)
  })

  it("checklist item with content → false", () => {
    const blocks: NoteBlock[] = [
      checklist("ck1", [{ id: "i1", text: "hello" }])
    ]
    expect(
      canDowngradeEmptySpecialBlock(blocks, {
        kind: "checklist-item",
        blockId: "ck1",
        itemId: "i1"
      })
    ).toBe(false)
  })

  it("quote line at empty content → true", () => {
    const blocks: NoteBlock[] = [quote("q1", "\nsecond")]
    expect(
      canDowngradeEmptySpecialBlock(blocks, {
        kind: "quote-line",
        blockId: "q1",
        lineId: "q1-line-0",
        lineIndex: 0
      })
    ).toBe(true)
  })

  it("quote line with content → false", () => {
    const blocks: NoteBlock[] = [quote("q1", "first")]
    expect(
      canDowngradeEmptySpecialBlock(blocks, {
        kind: "quote-line",
        blockId: "q1",
        lineId: "q1",
        lineIndex: 0
      })
    ).toBe(false)
  })

  it("quote line index out-of-range → false", () => {
    const blocks: NoteBlock[] = [quote("q1", "only")]
    expect(
      canDowngradeEmptySpecialBlock(blocks, {
        kind: "quote-line",
        blockId: "q1",
        lineId: "q1-line-3",
        lineIndex: 3
      })
    ).toBe(false)
  })
})

describe("blockDowngrade: callout.text", () => {
  it("空 callout（带 title/tone）→ 整块变 paragraph 保留 block.id，丢弃 title/tone；focusId = block.id", () => {
    const blocks: NoteBlock[] = [
      paragraph("p0", "before"),
      callout("c1", "", "Important"),
      paragraph("p2", "after")
    ]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: { kind: "block", blockId: "c1" }
    })
    expect(result.focusId).toBe("c1")
    expect(result.blocks).toEqual<NoteBlock[]>([
      paragraph("p0", "before"),
      paragraph("c1", ""),
      paragraph("p2", "after")
    ])
  })
})

describe("blockDowngrade: checklist item", () => {
  it("单 item：整块原地变 paragraph 保留 block.id；focusId = block.id", () => {
    const blocks: NoteBlock[] = [
      paragraph("p0", "before"),
      checklist("ck1", [{ id: "i1", text: "" }], "Tasks"),
      paragraph("p2", "after")
    ]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "checklist-item",
        blockId: "ck1",
        itemId: "i1"
      }
    })
    expect(result.focusId).toBe("ck1")
    expect(result.blocks).toEqual<NoteBlock[]>([
      paragraph("p0", "before"),
      paragraph("ck1", ""),
      paragraph("p2", "after")
    ])
  })

  it("多 item：拆出空 paragraph 保留 item.id；before 段保留 title，after 段不展示 title", () => {
    const blocks: NoteBlock[] = [
      paragraph("p0", "before"),
      checklist(
        "ck1",
        [
          { id: "i1", text: "task1" },
          { id: "i2", text: "" }, // 待降级的空 item
          { id: "i3", text: "task3", checked: true }
        ],
        "Tasks"
      ),
      paragraph("p4", "after")
    ]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "checklist-item",
        blockId: "ck1",
        itemId: "i2"
      }
    })
    expect(result.focusId).toBe("i2")
    const substituted = result.blocks
    // 整体顺序：p0 → before checklist (i1, title Tasks) → paragraph i2 → after checklist (i3, no title) → p4
    expect(substituted).toHaveLength(5)
    expect(substituted[0]).toEqual(paragraph("p0", "before"))
    expect(substituted[1]?.kind).toBe("checklist")
    if (substituted[1]?.kind === "checklist") {
      expect(substituted[1].id).toBe("ck1")
      expect(substituted[1].title).toBe("Tasks")
      expect(substituted[1].items.map((i) => i.id)).toEqual(["i1"])
    }
    expect(substituted[2]).toEqual(paragraph("i2", ""))
    expect(substituted[3]?.kind).toBe("checklist")
    if (substituted[3]?.kind === "checklist") {
      expect(substituted[3].id).not.toBe("ck1") // 新 id
      expect(substituted[3].title).toBe("") // after 段不再展示 title
      expect(substituted[3].items.map((i) => i.id)).toEqual(["i3"])
    }
    expect(substituted[4]).toEqual(paragraph("p4", "after"))
  })

  it("多 item 第一个空：before 段不存在；after 段保留 title", () => {
    const blocks: NoteBlock[] = [
      checklist(
        "ck1",
        [
          { id: "i1", text: "" },
          { id: "i2", text: "task2" }
        ],
        "Tasks"
      )
    ]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "checklist-item",
        blockId: "ck1",
        itemId: "i1"
      }
    })
    expect(result.focusId).toBe("i1")
    const substituted = result.blocks
    expect(substituted).toHaveLength(2)
    expect(substituted[0]).toEqual(paragraph("i1", ""))
    expect(substituted[1]?.kind).toBe("checklist")
    if (substituted[1]?.kind === "checklist") {
      expect(substituted[1].id).not.toBe("ck1")
      expect(substituted[1].title).toBe("Tasks") // before 段为空 → after 段保留 title
      expect(substituted[1].items.map((i) => i.id)).toEqual(["i2"])
    }
  })

  it("多 item 最后一个空：after 段不存在；before 段保留原 title", () => {
    const blocks: NoteBlock[] = [
      checklist(
        "ck1",
        [
          { id: "i1", text: "task1", checked: true },
          { id: "i2", text: "" }
        ],
        "Tasks"
      )
    ]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "checklist-item",
        blockId: "ck1",
        itemId: "i2"
      }
    })
    expect(result.focusId).toBe("i2")
    const substituted = result.blocks
    expect(substituted).toHaveLength(2)
    expect(substituted[0]?.kind).toBe("checklist")
    if (substituted[0]?.kind === "checklist") {
      expect(substituted[0].id).toBe("ck1")
      expect(substituted[0].title).toBe("Tasks")
      expect(substituted[0].items.map((i) => i.id)).toEqual(["i1"])
    }
    expect(substituted[1]).toEqual(paragraph("i2", ""))
  })
})

describe("blockDowngrade: quote line", () => {
  it("单行 quote（无 author）：整块变 paragraph 保留 block.id，丢弃可能的 author；focusId = block.id", () => {
    const blocks: NoteBlock[] = [quote("q1", "")]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "quote-line",
        blockId: "q1",
        lineId: "q1",
        lineIndex: 0
      }
    })
    expect(result.focusId).toBe("q1")
    expect(result.blocks).toEqual<NoteBlock[]>([paragraph("q1", "")])
  })

  it("单行 quote（有 author）：整块变 paragraph 保留 block.id，丢弃 author", () => {
    const blocks: NoteBlock[] = [quote("q1", "", "Alice")]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "quote-line",
        blockId: "q1",
        lineId: "q1",
        lineIndex: 0
      }
    })
    expect(result.focusId).toBe("q1")
    expect(result.blocks).toEqual<NoteBlock[]>([paragraph("q1", "")])
  })

  it("多行 quote lineIndex=0（无 author）：当前行变 paragraph 保留 block.id，其余行作为独立 quote（新 id）在后", () => {
    const blocks: NoteBlock[] = [quote("q1", "\nsecond\nthird")]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "quote-line",
        blockId: "q1",
        lineId: "q1",
        lineIndex: 0
      }
    })
    expect(result.focusId).toBe("q1")
    const substituted = result.blocks
    expect(substituted).toHaveLength(2)
    expect(substituted[0]).toEqual(paragraph("q1", ""))
    expect(substituted[1]?.kind).toBe("quote")
    if (substituted[1]?.kind === "quote") {
      expect(substituted[1].id).not.toBe("q1") // 后片段使用新 createNoteId
      expect(substituted[1].author).toBeUndefined() // 无 author 时不携带 author
      expect(quoteTextLines(substituted[1].text)).toEqual(["second", "third"])
    }
  })

  it("多行 quote lineIndex=0（有 author）：当前行变 paragraph 保留 block.id；后片段 quote 携带 author", () => {
    const blocks: NoteBlock[] = [quote("q1", "\nsecond", "Bob")]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "quote-line",
        blockId: "q1",
        lineId: "q1",
        lineIndex: 0
      }
    })
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toEqual(paragraph("q1", ""))
    expect(result.blocks[1]?.kind).toBe("quote")
    if (result.blocks[1]?.kind === "quote") {
      expect(result.blocks[1].author).toBe("Bob")
      expect(quoteTextLines(result.blocks[1].text)).toEqual(["second"])
    }
  })

  it("lineIndex>0：拆出空 paragraph（新 id），前片段保留 quote 含 block.id 且无 author", () => {
    const blocks: NoteBlock[] = [
      quote("q1", "first\n\nthird", "Alice") // 三行：first / 空 / third
    ]
    const result = downgradeEmptySpecialBlockToParagraph({
      blocks,
      source: {
        kind: "quote-line",
        blockId: "q1",
        lineId: "q1-line-1",
        lineIndex: 1
      }
    })
    expect(result.focusId).not.toBe("q1") // lineIndex>0 用 createNoteId
    expect(typeof result.focusId).toBe("string")
    const substituted = result.blocks
    // 前片段 quote(id=q1, lines=["first"]) → paragraph(新id, "") → 后片段 quote(新id, lines=["third"], author=Alice)
    expect(substituted).toHaveLength(3)
    expect(substituted[0]?.kind).toBe("quote")
    if (substituted[0]?.kind === "quote") {
      expect(substituted[0].id).toBe("q1")
      expect(substituted[0].author).toBeUndefined() // 多行时后片段持有 author
      expect(quoteTextLines(substituted[0].text)).toEqual(["first"])
    }
    expect(substituted[1]).toEqual(paragraph(result.focusId, ""))
    expect(substituted[2]?.kind).toBe("quote")
    if (substituted[2]?.kind === "quote") {
      expect(substituted[2].id).not.toBe("q1")
      expect(substituted[2].author).toBe("Alice")
      expect(quoteTextLines(substituted[2].text)).toEqual(["third"])
    }
  })
})