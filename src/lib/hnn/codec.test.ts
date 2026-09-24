import { describe, expect, it, vi } from "vitest"
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
        { type: "orderedList", attrs: { nodeId: nodeId(), start: 2 }, content: [{ type: "listItem", attrs: { nodeId: nodeId() }, content: [blockParagraph("ordered")] }] },
        { type: "taskList", attrs: { nodeId: nodeId() }, content: [{ type: "taskItem", attrs: { nodeId: nodeId(), checked: true }, content: [blockParagraph("task")] }] },
        { type: "blockquote", attrs: { nodeId: nodeId() }, content: [blockParagraph("quote")] },
        { type: "codeBlock", attrs: { nodeId: nodeId(), language: "ts", filename: "note.ts" }, content: [{ type: "text", text: "const note = 1" }] },
        { type: "horizontalRule", attrs: { nodeId: nodeId() } },
        { type: "table", attrs: { nodeId: nodeId() }, content: [{ type: "tableRow", attrs: { nodeId: nodeId() }, content: [{ type: "tableHeader", attrs: { nodeId: nodeId() }, content: [blockParagraph("head")] }, { type: "tableCell", attrs: { nodeId: nodeId() }, content: [blockParagraph("cell")] }] }] },
        { type: "callout", attrs: { nodeId: nodeId(), tone: "info", title: "Note" }, content: [blockParagraph("callout")] },
        { type: "collapsible", attrs: { nodeId: nodeId(), title: "More", collapsed: false }, content: [blockParagraph("details")] },
        { type: "formula", attrs: { nodeId: nodeId(), latex: "E=mc^2" } },
        { type: "picture", attrs: { nodeId: nodeId(), src: "https://example.test/image.png", alt: "Image" } },
        { type: "card", attrs: { nodeId: nodeId(), data: "{\"title\":\"Card\"}" } },
        { type: "drawing", attrs: { nodeId: nodeId(), data: "{\"version\":1}" } },
        { type: "directory", attrs: { nodeId: nodeId(), config: "headings" } },
        { type: "resource", attrs: { nodeId: nodeId(), resourceId: "resource-1", name: "Resource" } },
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

    const shellAtLimit = shellAtBytes(HNN_LIMITS.maxShellBytes)
    expect(() => decodeHnn(shellAtLimit)).not.toThrow()
    const shellOneOver = shellAtBytes(HNN_LIMITS.maxShellBytes + 1)
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
})
