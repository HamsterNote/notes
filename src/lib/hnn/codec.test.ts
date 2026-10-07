import { describe, expect, it, vi } from "vitest"
import { TableMap } from "@tiptap/pm/tables"
import { decodeHnn, encodeHnn, HnnCodecError } from "./codec"
import { HNN_LIMITS, HNN_SCHEMA_VERSION } from "./limits"
import { HNN_MARK_TYPES, HNN_NODE_TYPES, hnnSchema } from "./schema"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003"
]

function paragraph(text = "Title", nodeId = ids[0]): Record<string, unknown> {
  return { type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] }
}

function validHnn(): Record<string, unknown> {
  return { schemaVersion: HNN_SCHEMA_VERSION, data: { type: "doc", content: [paragraph()] } }
}

function generatedId(index: number): string {
  return `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`
}

function shellBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/** 构造刚好满足目标 UTF-8 外壳大小的纯 ASCII 文档，用于边界检查。 */
function shellAtBytes(targetBytes: number): Record<string, unknown> {
  const content: Record<string, unknown>[] = [paragraph("x", generatedId(0))]
  const data = { type: "doc", content }
  const shell: Record<string, unknown> = { schemaVersion: 1, data }
  let nextId = 1
  while (shellBytes(shell) < targetBytes) {
    const current = shellBytes(shell)
    const withText = structuredClone(shell)
    ;((withText["data"] as Record<string, unknown>)["content"] as unknown[]).push(paragraph("x", generatedId(nextId)))
    const overhead = shellBytes(withText) - current - 1
    const remaining = targetBytes - current
    if (remaining > overhead && remaining - overhead <= HNN_LIMITS.maxAttrBytes) {
      content.push(paragraph("x".repeat(remaining - overhead), generatedId(nextId)))
      break
    }
    content.push(paragraph("x".repeat(HNN_LIMITS.maxAttrBytes), generatedId(nextId)))
    nextId += 1
  }
  expect(shellBytes(shell)).toBe(targetBytes)
  return shell
}

function richHnn(): Record<string, unknown> {
  let nextId = 0
  const nodeId = () => generatedId(nextId++)
  const inline = [
    { type: "text", text: "bold", marks: [{ type: "bold" }] },
    { type: "text", text: "italic", marks: [{ type: "italic" }] },
    { type: "text", text: "strike", marks: [{ type: "strike" }] },
    { type: "text", text: "code", marks: [{ type: "code" }] },
    { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.test/path" } }] },
    { type: "hardBreak", attrs: { nodeId: nodeId() } },
    { type: "inlineFormula", attrs: { nodeId: nodeId(), latex: "x^2" } },
    { type: "mention", attrs: { nodeId: nodeId(), resourceId: "note-1", name: "Ada" } }
  ]
  const blockParagraph = (text: string) => ({ type: "paragraph", attrs: { nodeId: nodeId() }, content: [{ type: "text", text }] })
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [
        { type: "heading", attrs: { nodeId: nodeId(), level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", attrs: { nodeId: nodeId() }, content: inline },
        { type: "bulletList", attrs: { nodeId: nodeId() }, content: [{ type: "listItem", attrs: { nodeId: nodeId() }, content: [blockParagraph("bullet")] }] },
        { type: "orderedList", attrs: { nodeId: nodeId(), start: 2, type: null }, content: [{ type: "listItem", attrs: { nodeId: nodeId() }, content: [blockParagraph("ordered")] }] },
        { type: "taskList", attrs: { nodeId: nodeId() }, content: [{ type: "taskItem", attrs: { nodeId: nodeId(), checked: true }, content: [blockParagraph("task")] }] },
        { type: "blockquote", attrs: { nodeId: nodeId(), author: "Ada" }, content: [blockParagraph("quote")] },
        { type: "codeBlock", attrs: { nodeId: nodeId(), language: "ts", filename: "note.ts" }, content: [{ type: "text", text: "const note = 1" }] },
        { type: "horizontalRule", attrs: { nodeId: nodeId() } },
        { type: "table", attrs: { nodeId: nodeId() }, content: [{ type: "tableRow", attrs: { nodeId: nodeId() }, content: [{ type: "tableHeader", attrs: { nodeId: nodeId(), colspan: 1, rowspan: 1, colwidth: null, align: "center" }, content: [blockParagraph("head")] }, { type: "tableCell", attrs: { nodeId: nodeId(), colspan: 2, rowspan: 1, colwidth: [120, 120], align: "left" }, content: [blockParagraph("cell")] }] }] },
        { type: "callout", attrs: { nodeId: nodeId(), tone: "info", title: "Note" }, content: [blockParagraph("callout")] },
        { type: "collapsible", attrs: { nodeId: nodeId(), title: "More", collapsed: false }, content: [blockParagraph("details")] },
        { type: "formula", attrs: { nodeId: nodeId(), latex: "E=mc^2" } },
        { type: "picture", attrs: { nodeId: nodeId(), src: "https://example.test/image.png", alt: "Image" } },
        { type: "card", attrs: { nodeId: nodeId(), data: "{\"title\":\"Card\"}" } },
        { type: "drawing", attrs: { nodeId: nodeId(), data: "{\"version\":1}" } },
        { type: "directory", attrs: { nodeId: nodeId(), config: "headings" } },
        { type: "paragraph", attrs: { nodeId: nodeId() }, content: [{ type: "resource", attrs: { nodeId: nodeId(), resourceId: "resource-1", name: "Resource" } }] },
        { type: "externalItem", attrs: { nodeId: nodeId(), resourceId: "external-1", name: "External" } }
      ]
    }
  }
}

function diagnostics(input: unknown): HnnCodecError {
  try {
    decodeHnn(input)
    throw new Error("expected HnnCodecError")
  } catch (error) {
    expect(error).toBeInstanceOf(HnnCodecError)
    return error as HnnCodecError
  }
}

describe("HNN v1 codec", () => {
  it("registers only the closed v1 node and mark registry", () => {
    expect([...HNN_NODE_TYPES].sort()).toEqual([
      "blockquote", "bulletList", "callout", "card", "codeBlock", "collapsible", "directory", "doc", "drawing", "externalItem", "formula", "hardBreak", "heading", "horizontalRule", "inlineFormula", "listItem", "mention", "orderedList", "paragraph", "picture", "resource", "table", "tableCell", "tableHeader", "tableRow", "taskItem", "taskList", "text"
    ])
    expect([...HNN_MARK_TYPES].sort()).toEqual(["bold", "code", "italic", "link", "strike"])
    expect(hnnSchema.topNodeType.name).toBe("doc")
  })

  it("roundtrips canonical documents with the exact v1 shell and leaves input unchanged", () => {
    const input = validHnn()
    const before = JSON.stringify(input)
    const output = encodeHnn(decodeHnn(input))

    expect(output).toEqual(input)
    expect(Object.keys(output).sort()).toEqual(["data", "schemaVersion"])
    expect(output.schemaVersion).toBe(1)
    expect(JSON.stringify(input)).toBe(before)
  })

  it("roundtrips PM-canonical omitted content for empty inline and text blocks", () => {
    const emptyBlocks = [
      { type: "paragraph", attrs: { nodeId: ids[0] } },
      { type: "heading", attrs: { nodeId: ids[1], level: 2 } },
      { type: "codeBlock", attrs: { nodeId: ids[2], language: "txt", filename: "empty.txt" } }
    ]

    for (const block of emptyBlocks) {
      const input = { schemaVersion: HNN_SCHEMA_VERSION, data: { type: "doc", content: [block] } }
      const pmCanonical: unknown = hnnSchema.nodeFromJSON(input.data).toJSON()

      expect(pmCanonical).toEqual(input.data)
      expect(encodeHnn(decodeHnn(input))).toEqual(input)
    }
  })

  it("roundtrips every closed standard and custom node with only documented attrs", () => {
    const input = richHnn()
    expect(encodeHnn(decodeHnn(input))).toEqual(input)
    expect(JSON.stringify(input)).not.toContain("directoryItems")
  })

  it("rejects invalid shells and data metadata with JSON-pointer diagnostics", () => {
    for (const [input, path] of [
      [null, "/"],
      [{ schemaVersion: 1, data: validHnn()["data"], title: "top-level metadata" }, "/title"],
      [{ schemaVersion: 2, data: validHnn()["data"] }, "/schemaVersion"],
      [{ schemaVersion: 1 }, "/data"],
      ...["title", "summary", "tag", "time"].map((metadata) => [
        { schemaVersion: 1, data: { ...(validHnn()["data"] as Record<string, unknown>), [metadata]: "not metadata" } },
        `/data/${metadata}`
      ] as const)
    ] as const) {
      expect(diagnostics(input).diagnostics.some((item) => item.path === path)).toBe(true)
    }
  })

  it("rejects unknown nodes, marks, attrs, required attrs and invalid nesting", () => {
    const unknownNode = validHnn()
    ;((unknownNode["data"] as Record<string, unknown>)["content"] as unknown[])[0] = { type: "unknown" }
    expect(diagnostics(unknownNode).diagnostics.some((item) => item.code === "unknown-node")).toBe(true)

    const unknownMark = validHnn()
    const text = (((unknownMark["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]
    text!["marks"] = [{ type: "rainbow" }]
    expect(diagnostics(unknownMark).diagnostics.some((item) => item.code === "unknown-mark")).toBe(true)

    const unknownAttr = validHnn()
    ;(((unknownAttr["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["attrs"] as Record<string, unknown>)["extra"] = true
    expect(diagnostics(unknownAttr).diagnostics.some((item) => item.code === "unknown-key")).toBe(true)

    const docAttrs = validHnn()
    ;(docAttrs["data"] as Record<string, unknown>)["attrs"] = { nodeId: ids[3] }
    expect(diagnostics(docAttrs).diagnostics.some((item) => item.code === "forbidden-attrs")).toBe(true)

    const missingAttr = validHnn()
    delete (((missingAttr["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["attrs"] as Record<string, unknown>)["nodeId"]
    expect(diagnostics(missingAttr).diagnostics.some((item) => item.code === "missing-attr")).toBe(true)

    const invalidNesting = validHnn()
    ;((invalidNesting["data"] as Record<string, unknown>)["content"] as unknown[])[0] = { type: "tableRow", attrs: { nodeId: ids[0] }, content: [] }
    expect(diagnostics(invalidNesting).diagnostics.some((item) => item.code === "invalid-nesting")).toBe(true)
  })

  it("enforces attrs, URL policy, UUID v4 and duplicate node IDs", () => {
    const heading = { schemaVersion: 1, data: { type: "doc", content: [{ type: "heading", attrs: { nodeId: ids[0], level: 7 }, content: [{ type: "text", text: "H" }] }] } }
    expect(diagnostics(heading).diagnostics.some((item) => item.path.endsWith("/level"))).toBe(true)

    const unsafeLink = validHnn()
    const linkText = (((unsafeLink["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]
    linkText!["marks"] = [{ type: "link", attrs: { href: "java\u200bscript:alert(1)" } }]
    expect(diagnostics(unsafeLink).diagnostics.some((item) => item.code === "unsafe-url")).toBe(true)

    const badId = validHnn()
    ;(((badId["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["attrs"] as Record<string, unknown>)["nodeId"] = "123e4567-e89b-32d3-a456-426614174000"
    expect(diagnostics(badId).diagnostics.some((item) => item.code === "invalid-node-id")).toBe(true)

    const emptyAuthor = validHnn()
    ;((emptyAuthor["data"] as Record<string, unknown>)["content"] as unknown[])[0] = { type: "blockquote", attrs: { nodeId: ids[0], author: "" }, content: [paragraph("quote", ids[1])] }
    expect(diagnostics(emptyAuthor).diagnostics.some((item) => item.path.endsWith("/author"))).toBe(true)

    const duplicate = validHnn()
    ;((duplicate["data"] as Record<string, unknown>)["content"] as unknown[]).push(paragraph("again", ids[0]))
    expect(diagnostics(duplicate).diagnostics.some((item) => item.code === "duplicate-node-id")).toBe(true)

    for (const href of ["http://example.test", "https://example.test", "mailto:notes@example.test", "hnmagic://note/1"]) {
      const allowed = validHnn()
      const allowedText = (((allowed["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]
      allowedText!["marks"] = [{ type: "link", attrs: { href } }]
      expect(() => decodeHnn(allowed)).not.toThrow()
    }
  })

  it("rejects malformed JSON, duplicate/excluded marks and malformed content", () => {
    expect(diagnostics(new Date()).diagnostics[0]?.code).toBe("unsafe-input")

    const duplicateMarks = validHnn()
    const duplicateText = (((duplicateMarks["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]
    duplicateText!["marks"] = [{ type: "bold" }, { type: "bold" }]
    expect(diagnostics(duplicateMarks).diagnostics.some((item) => item.code === "duplicate-mark")).toBe(true)

    const excludedMarks = validHnn()
    const excludedText = (((excludedMarks["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]
    excludedText!["marks"] = [{ type: "code" }, { type: "italic" }]
    expect(diagnostics(excludedMarks).diagnostics.some((item) => item.code === "excluded-mark")).toBe(true)

    const malformedContent = validHnn()
    ;(malformedContent["data"] as Record<string, unknown>)["content"] = "not-an-array"
    expect(diagnostics(malformedContent).diagnostics.some((item) => item.code === "missing-content")).toBe(true)

    const unorderedMarks = validHnn()
    const unorderedText = (((unorderedMarks["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]
    unorderedText!["marks"] = [{ type: "italic" }, { type: "bold" }]
    expect(diagnostics(unorderedMarks).diagnostics).toContainEqual(
      expect.objectContaining({ path: "/data/content/0/content/0/marks/1", code: "non-canonical-mark-order" })
    )
  })

  it("严格限制表格几何、colwidth 形状和空行，并接受有效表格", () => {
    let nextId = 1
    const tableId = () => generatedId(nextId++)
    const cell = (attrs: Record<string, unknown>) => ({ type: "tableCell", attrs: { nodeId: tableId(), colspan: 1, rowspan: 1, colwidth: null, align: null, ...attrs }, content: [paragraph("cell", tableId())] })
    const table = (rows: unknown[]) => ({ schemaVersion: 1, data: { type: "doc", content: [{ type: "table", attrs: { nodeId: ids[0] }, content: rows }] } })
    const row = (cells: unknown[]) => ({ type: "tableRow", attrs: { nodeId: tableId() }, content: cells })
    expect(() => decodeHnn(table([row([cell({})])] ))).not.toThrow()
    expect(diagnostics(table([row([])])).diagnostics.some((item) => item.code === "invalid-content")).toBe(true)
    expect(diagnostics(table([row([cell({ colspan: HNN_LIMITS.maxNodes })])])).diagnostics.some((item) => item.path.endsWith("/colspan"))).toBe(true)
    expect(diagnostics(table([row([cell({ colspan: 2, colwidth: [100] })])])).diagnostics.some((item) => item.path.endsWith("/colwidth"))).toBe(true)
    expect(diagnostics(table([row([cell({})]), row([cell({}), cell({})])])).diagnostics).toContainEqual(
      expect.objectContaining({ path: "/data/content/0", code: "invalid-table-geometry" })
    )
  })

  it("在 TableMap 分配前拒绝大跨度表格", () => {
    let nextId = 1
    const tableId = () => generatedId(nextId++)
    const rows = Array.from({ length: 170 }, () => ({
      type: "tableRow",
      attrs: { nodeId: tableId() },
      content: [{
        type: "tableCell",
        attrs: { nodeId: tableId(), colspan: 510, rowspan: 1, colwidth: null, align: null },
        content: [paragraph("cell", tableId())]
      }]
    }))
    const get = vi.spyOn(TableMap, "get")
    try {
      const error = diagnostics({ schemaVersion: 1, data: { type: "doc", content: [{ type: "table", attrs: { nodeId: ids[0] }, content: rows }] } })
      expect(error.diagnostics).toContainEqual(
        expect.objectContaining({ path: "/data/content/0", code: "invalid-table-geometry" })
      )
      expect(get).not.toHaveBeenCalled()
    } finally {
      get.mockRestore()
    }
  })

  it("显式保留 v1 Phase2 省略的官方默认 attrs，并在输出时规范化", () => {
    const input = { schemaVersion: 1, data: { type: "doc", content: [{ type: "orderedList", attrs: { nodeId: ids[0], start: 1 }, content: [{ type: "listItem", attrs: { nodeId: ids[1] }, content: [{ type: "paragraph", attrs: { nodeId: ids[2] }, content: [{ type: "text", text: "one" }] }] }] }, { type: "table", attrs: { nodeId: ids[3] }, content: [{ type: "tableRow", attrs: { nodeId: generatedId(4) }, content: [{ type: "tableCell", attrs: { nodeId: generatedId(5) }, content: [paragraph("legacy cell", generatedId(6))] }] }] }] } }
    const output = encodeHnn(decodeHnn(input)).data
    const content = output["content"] as Record<string, unknown>[]
    const row = (content[1]?.["content"] as Record<string, unknown>[])[0]
    const cell = (row?.["content"] as Record<string, unknown>[])[0]
    expect(Array.isArray(content)).toBe(true)
    expect(content[0]?.["attrs"]).toMatchObject({ type: null })
    expect(cell?.["attrs"]).toMatchObject({ colspan: 1, rowspan: 1, colwidth: null, align: null })
  })

  it("按原始 v1 外壳计算字节上限，并对规范输出超限的两个编码入口统一失败", () => {
    let nextId = 0
    const nodeId = () => generatedId(nextId++)
    const legacyCell = () => ({
      type: "tableCell",
      attrs: { nodeId: nodeId() },
      content: [paragraph("cell", nodeId())]
    })
    const content: Record<string, unknown>[] = [{
      type: "table",
      attrs: { nodeId: nodeId() },
      content: Array.from({ length: 2 }, () => ({
        type: "tableRow",
        attrs: { nodeId: nodeId() },
        content: Array.from({ length: 64 }, legacyCell)
      }))
    }]
    // 512 个节点正好用尽，避免测试本身依赖超过节点预算的填充方式。
    for (let index = 0; index < 62; index += 1) content.push(paragraph("x", nodeId()))
    const legacy = { schemaVersion: 1, data: { type: "doc", content } }
    let remaining = HNN_LIMITS.maxShellBytes - shellBytes(legacy)
    for (const block of content.slice(1)) {
      const text = ((block["content"] as Record<string, unknown>[])[0]?.["text"] as string | undefined)
      const addition = Math.min(remaining, HNN_LIMITS.maxAttrBytes - (text?.length ?? 0))
      if (addition <= 0) continue
      ;((block["content"] as Record<string, unknown>[])[0]!)["text"] = `${text}${"x".repeat(addition)}`
      remaining -= addition
    }
    expect(remaining).toBe(0)
    expect(shellBytes(legacy)).toBe(HNN_LIMITS.maxShellBytes)

    const document = decodeHnn(legacy)
    expect(document.textContent).toContain("cell")

    // 两个入口必须一致：PM Node（canonical）与原始 record（旧 v1 data）都必须在最终
    // canonical 输出超限时硬失败，不能返回不可再 decode 的 HNN。
    for (const entry of [document, legacy["data"] as Record<string, unknown>] as const) {
      const error = (() => {
        try {
          encodeHnn(entry)
          throw new Error("expected canonical persistence limit failure")
        } catch (caught) {
          expect(caught).toBeInstanceOf(HnnCodecError)
          return caught as HnnCodecError
        }
      })()
      expect(error.diagnostics).toContainEqual(expect.objectContaining({ code: "shell-too-large" }))
    }
  })

  it("takes one safe descriptor snapshot before validation and never re-reads a caller Proxy", () => {
    const safeData = validHnn()["data"]
    const unsafeData = { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: ids[0] }, content: [{ type: "text", text: "unsafe" }] }] }
    let dataDescriptorReads = 0
    const proxy = new Proxy({ schemaVersion: 1, data: safeData }, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "data") {
          dataDescriptorReads += 1
          if (dataDescriptorReads > 1) {
            return { configurable: true, enumerable: true, value: unsafeData, writable: true }
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
      get() {
        throw new Error("codec must not read Proxy values through get")
      }
    })

    const document = decodeHnn(proxy)
    expect(dataDescriptorReads).toBe(1)
    expect(document.textContent).toBe("Title")
    expect(document.toJSON()).toEqual(safeData)
  })

  it("为跨文本重复的 immutable mark attrs 创建独立快照，同时仍拒绝实际循环", () => {
    const sharedLink = { type: "link", attrs: { href: "https://example.test/shared" } }
    const input = {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "paragraph",
          attrs: { nodeId: ids[0] },
          content: [
            { type: "text", text: "first", marks: [sharedLink] },
            { type: "hardBreak", attrs: { nodeId: ids[1] } },
            { type: "text", text: "second", marks: [sharedLink] }
          ]
        }]
      }
    }
    expect(() => encodeHnn(input.data)).not.toThrow()

    const cycle = validHnn()
    const data = cycle["data"] as Record<string, unknown>
    data["self"] = data
    expect(diagnostics(cycle).diagnostics[0]).toMatchObject({ code: "unsafe-input" })
  })

  it("rejects unsafe descriptors, custom properties, cycles and pathological depth as codec errors", () => {
    const accessor = validHnn()
    const accessorGet = () => validHnn()["data"]
    const accessorDescriptor = { enumerable: true, get: accessorGet }
    Object.defineProperty(accessor, "data", accessorDescriptor)
    expect(diagnostics(accessor).diagnostics[0]?.code).toBe("unsafe-input")
    expect(Object.getOwnPropertyDescriptor(accessor, "data")).toMatchObject({ enumerable: true })

    const setter = validHnn()
    const setterSet = () => undefined
    const setterDescriptor = { enumerable: true, set: setterSet }
    Object.defineProperty(setter, "later", setterDescriptor)
    expect(diagnostics(setter).diagnostics[0]?.code).toBe("unsafe-input")
    expect(Object.getOwnPropertyDescriptor(setter, "later")).toMatchObject({ enumerable: true })

    const symbolKey = validHnn()
    const hiddenSymbol = Symbol("hidden")
    Object.defineProperty(symbolKey, hiddenSymbol, { enumerable: true, value: true })
    expect(diagnostics(symbolKey).diagnostics[0]?.code).toBe("unsafe-input")
    expect(Object.getOwnPropertySymbols(symbolKey)).toContain(hiddenSymbol)

    const nonEnumerable = validHnn()
    Object.defineProperty(nonEnumerable, "hidden", { enumerable: false, value: true })
    expect(diagnostics(nonEnumerable).diagnostics[0]?.code).toBe("unsafe-input")
    expect(Object.getOwnPropertyDescriptor(nonEnumerable, "hidden")?.enumerable).toBe(false)

    const customPrototype = Object.create(null) as Record<string, unknown>
    const customPrototypeInput = validHnn()
    Object.setPrototypeOf(customPrototypeInput, customPrototype)
    expect(diagnostics(customPrototypeInput).diagnostics[0]?.code).toBe("unsafe-input")

    const arrayProperty = [paragraph()]
    Object.defineProperty(arrayProperty, "extra", { enumerable: true, value: true })
    expect(diagnostics({ schemaVersion: 1, data: { type: "doc", content: arrayProperty } }).diagnostics[0]?.code).toBe("unsafe-input")

    const sparse = new Array<Record<string, unknown>>(1)
    expect(diagnostics({ schemaVersion: 1, data: { type: "doc", content: sparse } }).diagnostics[0]?.code).toBe("unsafe-input")

    const cycle = validHnn()
    ;(cycle["data"] as Record<string, unknown>)["self"] = cycle
    const cycleData = cycle["data"]
    const cycleError = diagnostics(cycle)
    expect(cycleError.diagnostics[0]?.code).toBe("unsafe-input")
    expect(cycle["data"]).toBe(cycleData)
    expect((cycleData as Record<string, unknown>)["self"]).toBe(cycle)

    let nested: Record<string, unknown> = paragraph("deep", generatedId(0))
    for (let index = 1; index < 10_000; index += 1) {
      nested = { type: "blockquote", attrs: { nodeId: generatedId(index) }, content: [nested] }
    }
    const deep = { schemaVersion: 1, data: { type: "doc", content: [nested] } }
    const error = diagnostics(deep)
    expect(error).toBeInstanceOf(HnnCodecError)
    expect(error.diagnostics.some((item) => item.code === "snapshot-depth-limit")).toBe(true)
  })

  it("rejects a non-doc root, unsafe Unicode URL characters and marked codeBlock text locally", () => {
    const root = { schemaVersion: 1, data: paragraph("not a doc", ids[0]) }
    expect(diagnostics(root).diagnostics).toContainEqual(
      expect.objectContaining({ path: "/data/type", code: "invalid-root" })
    )

    for (const unsafeCharacter of ["\u0000", "\u0085", "\u007f", "\u00ad", "\u034f", "\u061c", "\u180b", "\u200b", "\u200f", "\u2028", "\u2029", "\u202a", "\u202e", "\u2060", "\u206f", "\u3164", "\ufeff", "\ud800", "\udc00", "\udb40\udc01"]) {
      const input = validHnn()
      const text = (((input["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]
      text!["marks"] = [{ type: "link", attrs: { href: `https://example.test/${unsafeCharacter}x` } }]
      expect(diagnostics(input).diagnostics).toContainEqual(
        expect.objectContaining({ path: "/data/content/0/content/0/marks/0/attrs/href", code: "unsafe-url" })
      )
    }

    const markedCode = {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "codeBlock",
          attrs: { nodeId: ids[0], language: "ts", filename: "marked.ts" },
          content: [{ type: "text", text: "const marked = true", marks: [{ type: "bold" }] }]
        }]
      }
    }
    expect(diagnostics(markedCode).diagnostics).toContainEqual(
      expect.objectContaining({ path: "/data/content/0/content/0/marks", code: "forbidden-mark" })
    )
  })

  it("accepts exact resource limits and rejects one over", () => {
    const atAttrLimit = validHnn()
    ;((atAttrLimit["data"] as Record<string, unknown>)["content"] as unknown[])[0] = {
      type: "card",
      attrs: { nodeId: ids[0], data: "x".repeat(HNN_LIMITS.maxAttrBytes - 2) }
    }
    expect(() => decodeHnn(atAttrLimit)).not.toThrow()

    const overAttrLimit = structuredClone(atAttrLimit)
    ;((((overAttrLimit["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["attrs"] as Record<string, unknown>)["data"]) = "x".repeat(HNN_LIMITS.maxAttrBytes)
    expect(diagnostics(overAttrLimit).diagnostics.some((item) => item.code === "attr-too-large")).toBe(true)

    const atNodeLimit = validHnn()
    ;((atNodeLimit["data"] as Record<string, unknown>)["content"] as unknown[]) = [
      ...Array.from(
        { length: (HNN_LIMITS.maxNodes - 2) / 2 },
        (_, index) => paragraph("x", generatedId(index))
      ),
      { type: "horizontalRule", attrs: { nodeId: generatedId(255) } }
    ]
    expect(() => decodeHnn(atNodeLimit)).not.toThrow()

    const overNodes = structuredClone(atNodeLimit)
    ;((overNodes["data"] as Record<string, unknown>)["content"] as unknown[]).push({ type: "horizontalRule", attrs: { nodeId: "123e4567-e89b-42d3-a456-999999999999" } })
    expect(diagnostics(overNodes).diagnostics.some((item) => item.code === "node-limit")).toBe(true)

    let nested: Record<string, unknown> = paragraph("deep", generatedId(30))
    for (let index = 29; index >= 1; index -= 1) {
      nested = { type: "blockquote", attrs: { nodeId: generatedId(index) }, content: [nested] }
    }
    const atDepthLimit = { schemaVersion: 1, data: { type: "doc", content: [nested] } }
    expect(() => decodeHnn(atDepthLimit)).not.toThrow()

    const oneOverDepth = structuredClone(atDepthLimit)
    ;((oneOverDepth["data"] as Record<string, unknown>)["content"] as unknown[]) = [{ type: "blockquote", attrs: { nodeId: generatedId(0) }, content: [nested] }]
    expect(diagnostics(oneOverDepth).diagnostics.some((item) => item.code === "depth-limit")).toBe(true)
  })

  it("attr 双重限制：原始 UTF-8 与转义后 JSON 字节均需不超上限", () => {
    // 4095 个引号：原始 4095 字节通过 requiredString，JSON 序列化恰好 2+2×4095 = 8192 → 接受
    const atJsonLimit = validHnn()
    ;((atJsonLimit["data"] as Record<string, unknown>)["content"] as unknown[])[0] = {
      type: "card",
      attrs: { nodeId: ids[0], data: "\"".repeat(HNN_LIMITS.maxAttrBytes / 2 - 1) }
    }
    expect(() => decodeHnn(atJsonLimit)).not.toThrow()

    // 4096 个引号：原始 4096 仍未超原始上限，但 JSON 序列化 8194 > 8192 → attr-too-large
    const overJsonLimit = structuredClone(atJsonLimit)
    ;((((overJsonLimit["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["attrs"] as Record<string, unknown>)["data"]) = "\"".repeat(HNN_LIMITS.maxAttrBytes / 2)
    expect(diagnostics(overJsonLimit).diagnostics.some((item) => item.code === "attr-too-large")).toBe(true)

    // 未配对代理项：原始各计 3 字节，JSON 转义后各计 6 字节，双重口径同时生效
    const surrogatePair = validHnn()
    ;((surrogatePair["data"] as Record<string, unknown>)["content"] as unknown[])[0] = {
      type: "card",
      attrs: { nodeId: ids[0], data: "\udc00\udc00".repeat(Math.floor(HNN_LIMITS.maxAttrBytes / 6)) }
    }
    // 每个 "\udc00\udc00" 原始 6 字节、JSON 12 字节 + 2 外层引号：repeat(1365) → 原始 8190、JSON 16382
    expect(diagnostics(surrogatePair).diagnostics.some((item) => item.code === "attr-too-large")).toBe(true)
  })

  it("rejects noncanonical JSON, oversized shells, and preserves failed JSON input bytes", () => {
    const noncanonical = validHnn()
    ;(((noncanonical["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]!["marks"] = []
    expect(diagnostics(noncanonical).diagnostics.some((item) => item.code === "non-canonical")).toBe(true)

    for (const block of [
      { type: "paragraph", attrs: { nodeId: ids[0] }, content: [] },
      { type: "heading", attrs: { nodeId: ids[1], level: 2 }, content: [] },
      { type: "codeBlock", attrs: { nodeId: ids[2], language: "txt", filename: "empty.txt" }, content: [] }
    ]) {
      const explicitEmpty = { schemaVersion: HNN_SCHEMA_VERSION, data: { type: "doc", content: [block] } }
      expect(diagnostics(explicitEmpty).diagnostics).toContainEqual(
        expect.objectContaining({ path: "/data/content/0/content", code: "non-canonical" })
      )
    }

    const oversized = validHnn()
    ;((oversized["data"] as Record<string, unknown>)["content"] as unknown[])[0] = paragraph("x".repeat(HNN_LIMITS.maxShellBytes))
    expect(diagnostics(oversized).diagnostics.some((item) => item.code === "shell-too-large")).toBe(true)

    // 512 KiB 是 v1 当前契约，但保留原 256 KiB 回归，避免未来边界回退成旧值。
    const shellAtFormerLimit = shellAtBytes(256 * 1024)
    expect(() => decodeHnn(shellAtFormerLimit)).not.toThrow()

    const shellAtLimit = shellAtBytes(512 * 1024)
    expect(() => decodeHnn(shellAtLimit)).not.toThrow()
    expect(HNN_LIMITS.maxShellBytes).toBe(512 * 1024)
    const shellOneOver = shellAtBytes(512 * 1024 + 1)
    expect(diagnostics(shellOneOver).diagnostics.some((item) => item.code === "shell-too-large")).toBe(true)

    const input = validHnn()
    const bytes = JSON.stringify(input)
    ;(((input["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["attrs"] as Record<string, unknown>)["nodeId"] = "broken"
    const failedBytes = JSON.stringify(input)
    expect(() => decodeHnn(input)).toThrow(HnnCodecError)
    expect(JSON.stringify(input)).toBe(failedBytes)
    expect(bytes).not.toBe(failedBytes)
  })

  it("rejects a huge single string before raw JSON serialization or UTF-8 buffer allocation", () => {
    const huge = validHnn()
    const text = (((huge["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[])[0]
    text!["text"] = "x".repeat(HNN_LIMITS.maxShellBytes + 1)
    const stringify = vi.spyOn(JSON, "stringify")
    const encode = vi.spyOn(TextEncoder.prototype, "encode")

    try {
      const error = diagnostics(huge)
      expect(error.diagnostics).toContainEqual(
        expect.objectContaining({ code: "shell-too-large" })
      )
      expect(stringify).not.toHaveBeenCalled()
      expect(encode).not.toHaveBeenCalled()
      expect(text!["text"]).toHaveLength(HNN_LIMITS.maxShellBytes + 1)
    } finally {
      stringify.mockRestore()
      encode.mockRestore()
    }
  })

  it("在枚举 ownKeys 前以数组 length 下界拒绝超大 dense array", () => {
    const dense = Array.from({ length: HNN_LIMITS.maxNodes * 32 }, () => 0)
    const ownKeys = vi.spyOn(Reflect, "ownKeys")
    try {
      const error = diagnostics({ schemaVersion: 1, data: { type: "doc", content: dense } })
      expect(error.diagnostics).toContainEqual(expect.objectContaining({ code: "snapshot-work-limit", path: "/data/content" }))
      // root/data 的普通对象会被枚举；数组自身必须在枚举前被 length 预算拒绝。
      expect(ownKeys.mock.calls.some(([value]) => value === dense)).toBe(false)
    } finally {
      ownKeys.mockRestore()
    }
  })

  it("在调用 PM Node.toJSON 前有界拒绝远超节点上限的文档", () => {
    const children = Array.from(
      { length: HNN_LIMITS.maxNodes * 4 },
      (_, index) => hnnSchema.node("horizontalRule", { nodeId: generatedId(index) })
    )
    const document = hnnSchema.node("doc", null, children)
    const toJson = vi.spyOn(document, "toJSON")
    try {
      expect(() => encodeHnn(document)).toThrow(HnnCodecError)
      try {
        encodeHnn(document)
      } catch (error) {
        expect(error).toBeInstanceOf(HnnCodecError)
        expect((error as HnnCodecError).diagnostics).toContainEqual(expect.objectContaining({ code: "node-limit" }))
      }
      expect(toJson).not.toHaveBeenCalled()
    } finally {
      toJson.mockRestore()
    }
  })

  it("PM 入口精确接受 512 KiB canonical 外壳，并在超出一字节前拒绝", () => {
    const exact = decodeHnn(shellAtBytes(HNN_LIMITS.maxShellBytes))
    expect(() => encodeHnn(exact)).not.toThrow()

    // shellAtBytes 的最后一个段落为精确填充的短文本；直接多一个 ASCII 字符即得到
    // canonical shell 的 512 KiB + 1 PM Node，且整个构造过程不调用该实例 toJSON。
    const oneOverShell = shellAtBytes(HNN_LIMITS.maxShellBytes)
    const blocks = (oneOverShell["data"] as Record<string, unknown>)["content"] as Record<string, unknown>[]
    const finalText = ((blocks.at(-1)! ["content"] as Record<string, unknown>[])[0]! ["text"] as string)
    ;((blocks.at(-1)! ["content"] as Record<string, unknown>[])[0]!)["text"] = `${finalText}x`
    const oneOver = hnnSchema.nodeFromJSON(oneOverShell["data"])
    const toJson = vi.spyOn(oneOver, "toJSON")
    try {
      expect(() => encodeHnn(oneOver)).toThrow(HnnCodecError)
      try {
        encodeHnn(oneOver)
      } catch (error) {
        expect((error as HnnCodecError).diagnostics).toContainEqual(expect.objectContaining({ code: "shell-too-large" }))
      }
      expect(toJson).not.toHaveBeenCalled()
    } finally {
      toJson.mockRestore()
    }
  })

  it("PM 入口在超长 link href 与极宽树前拒绝，不调用根节点 toJSON", () => {
    const href = `https://example.test/${"x".repeat(HNN_LIMITS.maxAttrBytes)}`
    const link = hnnSchema.marks["link"]!.create({ href })
    const linked = hnnSchema.node("doc", null, [hnnSchema.node("paragraph", { nodeId: ids[0] }, [hnnSchema.text("x", [link])])])
    const linkedToJson = vi.spyOn(linked, "toJSON")
    try {
      expect(() => encodeHnn(linked)).toThrow(HnnCodecError)
      try {
        encodeHnn(linked)
      } catch (error) {
        expect((error as HnnCodecError).diagnostics).toContainEqual(expect.objectContaining({ code: "attr-too-large" }))
      }
      expect(linkedToJson).not.toHaveBeenCalled()
    } finally {
      linkedToJson.mockRestore()
    }

    const wide = hnnSchema.node("doc", null, Array.from(
      { length: HNN_LIMITS.maxNodes + 1 },
      (_, index) => hnnSchema.node("horizontalRule", { nodeId: generatedId(index) })
    ))
    const wideToJson = vi.spyOn(wide, "toJSON")
    const child = vi.spyOn(wide, "child")
    try {
      expect(() => encodeHnn(wide)).toThrow(HnnCodecError)
      expect(wideToJson).not.toHaveBeenCalled()
      // childCount 的预判应在展开任何宽树子节点或构建同宽 frame stack 前失败。
      expect(child).not.toHaveBeenCalled()
    } finally {
      child.mockRestore()
      wideToJson.mockRestore()
    }
  })
})
