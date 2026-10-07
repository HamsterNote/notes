import { describe, expect, it, vi } from "vitest"
import { decodeHnn, encodeHnn } from "./codec"
import { HNN_LIMITS } from "./limits"
import { exportMarkdown, importMarkdown } from "./markdown"
import { hnnSchema } from "./schema"

function imported(markdown: string): {
  document: ReturnType<typeof encodeHnn>
  diagnostics: import("./markdown").MarkdownDiagnostic[]
} {
  const result = importMarkdown(markdown)
  if ("failure" in result)
    throw new Error(`expected imported document, received ${result.failure}`)
  return { document: result.document, diagnostics: result.diagnostics }
}

function content(
  result: ReturnType<typeof imported>
): Record<string, unknown>[] {
  return result.document.data["content"] as Record<string, unknown>[]
}

function ids() {
  let value = 0
  return () => `123e4567-e89b-42d3-a456-${String(value++).padStart(12, "0")}`
}

function paragraph(nextId: () => string, value: string) {
  return {
    type: "paragraph",
    attrs: { nodeId: nextId() },
    content: [{ type: "text", text: value }]
  }
}

function base64url(value: string): string {
  // JSON-b64 必须覆盖 UTF-8 正文，不能让测试 helper 只支持 Latin-1。
  const binary = Array.from(new TextEncoder().encode(value), (byte) =>
    String.fromCharCode(byte)
  ).join("")
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

function jsonFenceChunks(chunks: readonly string[]): string {
  return chunks
    .map((chunk, index) =>
      [
        "```hamster-note-json-b64 " + `${index + 1}/${chunks.length}`,
        chunk,
        "```"
      ].join("\n")
    )
    .join("\n\n")
}

/** 按导出器的单段预算包装 payload，避免测试把分段错误与内容校验混为一谈。 */
function jsonFenceForNode(node: Record<string, unknown>): string {
  const encoded = base64url(JSON.stringify(node))
  const chunkLimit = HNN_LIMITS.maxAttrBytes - 256
  return jsonFenceChunks(
    Array.from({ length: Math.ceil(encoded.length / chunkLimit) }, (_, index) =>
      encoded.slice(index * chunkLimit, (index + 1) * chunkLimit)
    )
  )
}

/** fallback 允许按 HNN 单 attr 上限拆为多段；拼接后必须仍是原围栏原文。 */
function fallbackText(document: ReturnType<typeof encodeHnn>): string {
  const blocks: Record<string, unknown>[] = []
  const visit = (node: Record<string, unknown>): void => {
    if (node["type"] === "codeBlock") blocks.push(node)
    const children = node["content"]
    if (Array.isArray(children))
      for (const child of children)
        if (child && typeof child === "object")
          visit(child as Record<string, unknown>)
  }
  visit(document.data)
  return blocks
    .map((item) =>
      ((item["content"] as Array<Record<string, unknown>> | undefined) ?? [])
        .map((child) =>
          typeof child["text"] === "string" ? child["text"] : ""
        )
        .join("")
    )
    .join("")
}

/** 生成接近完整 HNN 上限的合法文档，用于导出/导入预算协同回归。 */
function largeValidDocument(targetBytes: number) {
  const nextId = ids()
  const document = {
    type: "doc",
    content: Array.from({ length: 64 }, () => ({
      type: "card",
      attrs: { nodeId: nextId(), data: "" }
    }))
  }
  const shell = { schemaVersion: 1, data: document }
  let remaining =
    targetBytes - new TextEncoder().encode(JSON.stringify(shell)).byteLength
  for (const card of document.content) {
    const addition = Math.min(remaining, HNN_LIMITS.maxAttrBytes - 2)
    // 反引号迫使 card 走 JSON-b64 fallback，覆盖 base64 膨胀后的总预算。
    card.attrs.data = "`".repeat(addition)
    remaining -= addition
  }
  expect(remaining).toBe(0)
  expect(new TextEncoder().encode(JSON.stringify(shell)).byteLength).toBe(
    targetBytes
  )
  return encodeHnn(document)
}

/** 生成可被严格 codec 接受、且有足够多 JSON-b64 分片的大型节点。 */
function largeJsonFencePayload() {
  const nextId = ids()
  const value = {
    type: "blockquote",
    attrs: { nodeId: nextId(), author: null },
    content: Array.from({ length: 32 }, () =>
      paragraph(nextId, "x".repeat(8_000))
    )
  }
  expect(() => encodeHnn({ type: "doc", content: [value] })).not.toThrow()
  return base64url(JSON.stringify(value))
}

/** 导出回读会重建 nodeId；除该持久标识外，HNN JSON 必须逐字段保持一致。 */
function dataWithoutNodeIds(value: unknown): unknown {
  const cloned: unknown = JSON.parse(
    JSON.stringify(value, (key: string, current: unknown): unknown =>
      key === "nodeId" ? undefined : current
    )
  ) as unknown
  return cloned
}

describe("内部 Markdown codec", () => {
  it("不支持的脚注保留原 label、引用与多段正文，不退化为 AST 类型名", () => {
    const result = imported(
      [
        "前 **引用[^Mixed-Label]** 后",
        "",
        "[^Mixed-Label]: 脚注第一段 **粗体**",
        "",
        "    脚注第二段 [链接](https://example.test/note)",
        "",
        "末尾正文"
      ].join("\n")
    )
    const first = content(result)[0]!["content"] as Record<string, unknown>[]
    expect(first.map((node) => node["text"]).join("")).toBe(
      "前 引用[^Mixed-Label] 后"
    )
    expect(first[1]).toMatchObject({ marks: [{ type: "bold" }] })
    const preserved = fallbackText(result.document)
    expect(preserved).toContain("[^Mixed-Label]:")
    expect(preserved).toContain("脚注第一段 **粗体**")
    expect(preserved).toContain("脚注第二段")
    expect(preserved).toContain("https://example.test/note")
    expect(preserved).not.toContain("footnoteDefinition")
    expect(JSON.stringify(result.document.data)).not.toContain(
      "footnoteReference"
    )
    expect(JSON.stringify(result.document.data)).toContain("末尾正文")
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-inline", line: 1 }),
        expect.objectContaining({ code: "unsupported-block", line: 3 })
      ])
    )
    expect(() => encodeHnn(result.document.data)).not.toThrow()
  })

  it.each([" ", "\n", "\n\n", " \t\n "])(
    "带文件名 codeBlock 的纯空白正文 %j 经 JSON-b64 往返逐字保留",
    (value) => {
      const nextId = ids()
      const document = encodeHnn({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { nodeId: nextId(), language: "txt", filename: "a.txt" },
            content: [{ type: "text", text: value }]
          }
        ]
      })
      const exported = exportMarkdown(document)
      expect(exported.markdown).toContain("hamster-note-json-b64")
      const roundtrip = imported(exported.markdown)
      expect(roundtrip.diagnostics).toEqual([])
      expect(dataWithoutNodeIds(roundtrip.document.data)).toEqual(
        dataWithoutNodeIds(document.data)
      )
    }
  )

  it.each(["x".repeat(8_192), "\\".repeat(5_000), "图".repeat(2_730) + "xx"])(
    "text 按原始 UTF-8 而非 JSON attr 预算接受合法边界（case %#）",
    (value) => {
      const nextId = ids()
      const document = encodeHnn({
        type: "doc",
        content: [paragraph(nextId, value)]
      })
      // 显式 JSON-b64 与自动 Markdown 导出均需接受相同的合法 text。
      const payload = (
        document.data["content"] as Record<string, unknown>[]
      )[0]!
      for (const markdown of [
        jsonFenceForNode(payload),
        exportMarkdown(document).markdown
      ]) {
        const result = imported(markdown)
        expect(result.diagnostics).toEqual([])
        expect(dataWithoutNodeIds(result.document.data)).toEqual(
          dataWithoutNodeIds(document.data)
        )
      }
    }
  )

  it("普通 Markdown 的恰好 8192 字节 text 可导入，超过一字节仍受控拒绝", () => {
    const result = imported("x".repeat(8_192))
    expect(result.diagnostics).toEqual([])
    expect(
      (content(result)[0]!["content"] as Record<string, unknown>[])[0]!["text"]
    ).toBe("x".repeat(8_192))
    expect(importMarkdown("x".repeat(8_193))).toMatchObject({
      failure: "input-too-large"
    })
  })

  it("tab-heavy 普通 text 按原始字节导入并逐字保留，不以展开后的视觉列数拒绝", () => {
    const value = `x${"\t".repeat(2_049)}y`
    expect(new TextEncoder().encode(value).byteLength).toBe(2_051)
    const result = imported(value)
    expect(content(result)[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: value }]
    })
    expect(result.diagnostics).toEqual([])
    expect(() => encodeHnn(result.document.data)).not.toThrow()
  })

  it("tab-heavy text 恰好 8192 原始字节合法，多一字节在 UUID 前受控拒绝", () => {
    const value = `x${"\t".repeat(8_190)}y`
    expect(new TextEncoder().encode(value).byteLength).toBe(8_192)
    const result = imported(value)
    expect(content(result)[0]).toMatchObject({ content: [{ text: value }] })
    expect(result.diagnostics).toEqual([])
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const over = importMarkdown(`${value}z`)
      expect(over).toMatchObject({
        failure: "input-too-large",
        diagnostics: [
          expect.objectContaining({ code: "input-too-large", line: 1 })
        ]
      })
      expect("document" in over).toBe(false)
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("tab-heavy 多行 text 在 root、quote 与 list 容器中保留正文及软换行", () => {
    const first = `x${"\t".repeat(2_049)}y`
    const second = `a${"\t".repeat(2_049)}b`
    for (const source of [
      `${first}\n${second}`,
      `> ${first}\n> ${second}`,
      `- ${first}\n  ${second}`
    ]) {
      const result = imported(source)
      const decoded = decodeHnn(result.document)
      expect(decoded.textContent).toBe(`${first}\n${second}`)
      expect(result.diagnostics).toEqual([])
    }
  })

  it("tab-heavy 普通 fence 与缩进 code 保持原始正文，不把扫描展开文本交给转换器", () => {
    const body = `x${"\t".repeat(2_049)}y`
    for (const source of [
      `\`\`\`txt\n${body}\n\`\`\``,
      `\t${body}`,
      `-\t> \`\`\`txt\n\t> ${body}\n\t>  \t\`\`\``
    ]) {
      const result = imported(source)
      expect(fallbackText(result.document)).toBe(body)
      expect(result.diagnostics).toEqual([])
      expect(() => encodeHnn(result.document.data)).not.toThrow()
    }
  })

  it("tab-heavy code 正文超过 text 上限仍分片，命名 math 围栏则局部完整降级", () => {
    const body = `x${"\t".repeat(8_191)}y`
    const ordinary = imported(`\`\`\`txt\n${body}\n\`\`\``)
    expect(fallbackText(ordinary.document)).toBe(body)
    expect(ordinary.diagnostics).toContainEqual(
      expect.objectContaining({ code: "code-block-split", line: 1 })
    )
    const fence = `\`\`\`math\n${body}\n\`\`\``
    const named = imported(["前", "", fence, "", "后"].join("\n"))
    expect(fallbackText(named.document)).toBe(fence)
    expect(named.diagnostics).toContainEqual(
      expect.objectContaining({ code: "attr-too-large", line: 3 })
    )
    expect(content(named)[0]).toMatchObject({ content: [{ text: "前" }] })
    expect(content(named).at(-1)).toMatchObject({ content: [{ text: "后" }] })
    expect(named.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "conversion-failed" })
    )
  })

  it("tab-heavy 多行缩进 code 累计正文超限仍分片，单行原始超限仍硬拒绝", () => {
    const first = `x${"\t".repeat(4_095)}`
    const second = `y${"\t".repeat(4_095)}`
    const result = imported(`\t${first}\n\t${second}`)
    expect(fallbackText(result.document)).toBe(`${first}\n${second}`)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "code-block-split", line: 1 })
    )
    // 当前契约：非 fenced 单行仍受原始行上限约束；不能借缩进 code 绕过 preflight。
    expect(importMarkdown(`\tx${"\t".repeat(8_191)}y`)).toMatchObject({
      failure: "input-too-large"
    })
  })

  it("tab-heavy 成功正文不放宽 link 候选预算，超多原始候选仍在 UUID 前拒绝", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const source = Array.from({ length: 260 }, () => "[x](https://x)").join(
        "\t"
      )
      const result = importMarkdown(source)
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect(result.diagnostics[0]?.message).toContain("候选")
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("JSON-b64 的空 text 或超过 8192 原始 UTF-8 字节仅降级该围栏", () => {
    for (const value of ["", "x".repeat(8_193), "图".repeat(2_731)]) {
      const fence = jsonFenceForNode({
        type: "paragraph",
        attrs: {},
        content: [{ type: "text", text: value }]
      })
      const result = imported(["前", "", fence, "", "后"].join("\n"))
      expect(fallbackText(result.document)).toBe(fence)
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "invalid-hn-fence", line: 3 })
      ])
      expect(content(result).at(-1)).toMatchObject({
        type: "paragraph",
        content: [{ type: "text", text: "后" }]
      })
    }
  })

  it("text 放宽原始字节计数后，JSON 转义膨胀仍计入累计 shell 并在 UUID 前拒绝", () => {
    const fence = jsonFenceForNode({
      type: "codeBlock",
      attrs: { language: "txt", filename: "a.txt" },
      content: [{ type: "text", text: "\\".repeat(5_000) }]
    })
    const within = imported(
      Array.from({ length: 51 }, () => fence).join("\n\n")
    )
    expect(
      new TextEncoder().encode(JSON.stringify(within.document)).byteLength
    ).toBeLessThanOrEqual(HNN_LIMITS.maxShellBytes)
    expect(content(within)).toHaveLength(51)
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const over = importMarkdown(
        Array.from({ length: 52 }, () => fence).join("\n\n")
      )
      expect(over).toMatchObject({ failure: "input-too-large" })
      expect("document" in over).toBe(false)
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("GFM 缺格补空、多余格截断，补空格保持列对齐且导出回读等价", () => {
    const result = imported(
      "| A | B |\n| :--- | ---: |\n| short |\n| long | kept | discarded |"
    )
    const table = dataWithoutNodeIds(content(result)[0])
    expect(table).toMatchObject({
      type: "table",
      content: [
        { content: [{ type: "tableHeader" }, { type: "tableHeader" }] },
        {
          content: [
            {
              attrs: { align: "left" },
              content: [{ content: [{ text: "short" }] }]
            },
            { attrs: { align: "right" }, content: [{ type: "paragraph" }] }
          ]
        },
        {
          content: [
            { content: [{ content: [{ text: "long" }] }] },
            { content: [{ content: [{ text: "kept" }] }] }
          ]
        }
      ]
    })
    const rows = content(result)[0]!["content"] as Record<string, unknown>[]
    expect(rows.map((row) => (row["content"] as unknown[]).length)).toEqual([
      2, 2, 2
    ])
    expect(JSON.stringify(result.document.data)).not.toContain("discarded")
    expect(result.diagnostics).toEqual([])
    expect(
      dataWithoutNodeIds(
        imported(exportMarkdown(result.document).markdown).document.data
      )
    ).toEqual(dataWithoutNodeIds(result.document.data))
  })

  it("表格预算按补齐后的矩形计算，而被截断的额外列不进入 HNN 几何预算", () => {
    const header = `|${Array.from({ length: 64 }, () => "h").join("|")}|`
    const separator = `|${Array.from({ length: 64 }, () => "---").join("|")}|`
    const within = imported([header, separator, "| x |", "| x |"].join("\n"))
    expect(() => encodeHnn(within.document.data)).not.toThrow()
    const longRow = `|${Array.from({ length: 65 }, () => "x").join("|")}|`
    const truncated = imported(["| h |", "| --- |", longRow].join("\n"))
    expect(
      (content(truncated)[0]!["content"] as Record<string, unknown>[]).map(
        (row) => (row["content"] as unknown[]).length
      )
    ).toEqual([1, 1])
    expect(dataWithoutNodeIds(content(truncated)[0])).toMatchObject({
      content: [
        { content: [{ type: "tableHeader" }] },
        { content: [{ type: "tableCell" }] }
      ]
    })
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      // 缺失格同样产生 cell/paragraph，第四行会令实际输出超过 512 个节点。
      const over = importMarkdown(
        [header, separator, "| x |", "| x |", "| x |"].join("\n")
      )
      expect(over).toMatchObject({ failure: "input-too-large" })
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("JSON-b64 link 包装额外字段与显式 marks 空数组仅局部保留，不整体 conversion-failed", () => {
    for (const marks of [
      [],
      [{ type: "link", attrs: { href: "https://example.test" }, extra: true }],
      [{ type: "link", attrs: { href: "https://example.test" }, marks: [] }]
    ]) {
      const fence = jsonFenceForNode({
        type: "paragraph",
        attrs: {},
        content: [{ type: "text", text: "kept payload", marks }]
      })
      const result = imported(["前", "", fence, "", "后"].join("\n"))
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "invalid-hn-fence",
          line: 3,
          column: 1
        })
      ])
      expect(content(result).map((node) => node["type"])).toEqual([
        "paragraph",
        "codeBlock",
        "paragraph"
      ])
      expect(fallbackText(result.document)).toBe(fence)
      expect(() => encodeHnn(result.document.data)).not.toThrow()
    }
    // 严格的合法 link 不应被这次包装校验误拒绝。
    expect(
      imported(
        jsonFenceForNode({
          type: "paragraph",
          attrs: {},
          content: [
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://example.test" } }]
            }
          ]
        })
      ).diagnostics
    ).toEqual([])
  })

  it("math/card/drawing 的空白正文局部保留完整围栏与前后合法正文", () => {
    for (const language of [
      "math",
      "hamster-note-card",
      "hamster-note-drawing"
    ]) {
      for (const body of [" ", "\t", "\n", " \t\n "]) {
        const fence = ["```" + language, body, "```"].join("\n")
        const result = imported(["前", "", fence, "", "后"].join("\n"))
        expect(result.diagnostics).toEqual([
          expect.objectContaining({
            code: "invalid-hn-fence",
            line: 3,
            column: 1
          })
        ])
        expect(content(result).map((node) => node["type"])).toEqual([
          "paragraph",
          "codeBlock",
          "paragraph"
        ])
        expect(fallbackText(result.document)).toBe(fence)
        expect(content(result)[0]).toMatchObject({ content: [{ text: "前" }] })
        expect(content(result).at(-1)).toMatchObject({
          content: [{ text: "后" }]
        })
        expect(() => encodeHnn(result.document.data)).not.toThrow()
      }
    }
  })

  it("混合 ordered/task 拆组后按原始索引续接 start，第三项仍从 5 开始", () => {
    for (const source of [
      "3. first\n4. [x] checked\n5. third",
      "3. [ ] first task\n4. [x] checked\n5. third"
    ]) {
      const result = imported(source)
      expect(result.diagnostics).toEqual([])
      expect(content(result).at(-1)).toMatchObject({
        type: "orderedList",
        attrs: { start: 5 },
        content: [
          { type: "listItem", content: [{ content: [{ text: "third" }] }] }
        ]
      })
      expect(
        dataWithoutNodeIds(
          imported(exportMarkdown(result.document).markdown).document.data
        )
      ).toEqual(dataWithoutNodeIds(result.document.data))
    }
    const alternating = imported(
      "3. first\n4. [x] checked\n5. third\n6. [ ] task\n7. fifth"
    )
    expect(
      content(alternating)
        .filter((node) => node["type"] === "orderedList")
        .map((node) => (node["attrs"] as Record<string, unknown>)["start"])
    ).toEqual([3, 5, 7])
  })

  it("在无 metadata header 的单一文档中导入 GFM、嵌套列表、task list 与表格", () => {
    const result = imported(
      [
        "# 标题",
        "",
        "**粗体**、*斜体*、~~删除~~、`代码`、[安全](https://example.test)\\",
        "换行",
        "",
        "- 父项",
        "  - 子项",
        "",
        "- [x] 完成",
        "",
        "| A | B |",
        "| :- | -: |",
        "| 1 | 2 |"
      ].join("\n")
    )

    expect(result.document.data).not.toHaveProperty("title")
    expect(content(result).map((item) => item["type"])).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "taskList",
      "table"
    ])
    expect(result.diagnostics).toEqual([])
  })

  it("安全 link 变为 mark，危险 URL 仅保留文字并带位置诊断", () => {
    const result = imported(
      "[安全](mailto:ada@example.test) [危险](javascript:alert)"
    )
    expect(JSON.stringify(result.document.data)).not.toContain(
      '"href":"javascript:'
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsafe-url", line: 1, column: 31 })
    )
    expect(JSON.stringify(result.document.data)).toContain(
      "mailto:ada@example.test"
    )
  })

  it("双向处理独占 GFM image，混合 image 可读降级且不丢失", () => {
    const picture = imported("![封面](https://example.test/cover.png)")
    expect(content(picture)[0]!["type"]).toBe("picture")
    expect(exportMarkdown(picture.document).markdown).toContain(
      "![封面](https://example.test/cover.png)"
    )

    const mixed = imported("文字 ![封面](https://example.test/cover.png)")
    expect(content(mixed)[0]!["type"]).toBe("paragraph")
    expect(mixed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "inline-image-fallback" })
    )
  })

  it("解析既有 fence，并关闭 picture/mention/resource/external-item metadata schema", () => {
    const recognized = imported(
      [
        "```math",
        "x^2",
        "```",
        "",
        "```directory",
        "```",
        "",
        "```collapsible",
        '{"title":"更多","collapsed":true}',
        "",
        "## 内部",
        "```",
        "",
        "```hamster-note-card",
        '{"title":"卡片"}',
        "```",
        "",
        "```hamster-note-drawing",
        '{"version":1}',
        "```"
      ].join("\n")
    )
    expect(content(recognized).map((item) => item["type"])).toEqual([
      "formula",
      "directory",
      "collapsible",
      "card",
      "drawing"
    ])

    const invalid = imported(
      [
        "```picture",
        '{"src":"https://example.test/a.png","alt":"图","extra":true}',
        "正文",
        "```"
      ].join("\n")
    )
    expect(content(invalid)[0]!["type"]).toBe("codeBlock")
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence", line: 1 })
    )
  })

  it("默认 HNN 编解码保持直接路径，Markdown 仅由显式函数准备", () => {
    const result = imported("# 直接 HNN")
    expect(encodeHnn(decodeHnn(result.document))).toEqual(result.document)
    expect(exportMarkdown(result.document).markdown).toBe("# 直接 HNN\n")
  })

  it("用 remark-stringify 安全保留文本、HTML、code delimiter 与链接语法", () => {
    const nextId = ids()
    const literal = encodeHnn({
      type: "doc",
      content: [paragraph(nextId, "# literal")]
    })
    const literalMarkdown = exportMarkdown(literal).markdown
    expect(literalMarkdown).not.toMatch(/^# literal/mu)
    expect(content(imported(literalMarkdown))[0]!["type"]).toBe("paragraph")

    const source = imported(
      [
        "<script>不执行</script>",
        "",
        "`a``b`",
        "",
        "[稳定](https://example.test/a%20b)"
      ].join("\n")
    )
    const exported = exportMarkdown(source.document)
    expect(exported.markdown).toContain("```html")
    expect(exported.markdown).not.toContain("\n\n<script>")
    const back = imported(exported.markdown)
    expect(JSON.stringify(back.document.data)).toContain("a``b")
    expect(JSON.stringify(back.document.data)).toContain(
      "https://example.test/a%20b"
    )
  })

  it("对复杂表格按完整节点分块降级，合法大节点 export 后仍可 import", () => {
    const nextId = ids()
    const large = "x".repeat(7_500)
    const document = encodeHnn({
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { nodeId: nextId() },
          content: [
            {
              type: "tableRow",
              attrs: { nodeId: nextId() },
              content: [
                {
                  type: "tableHeader",
                  attrs: {
                    nodeId: nextId(),
                    colspan: 2,
                    rowspan: 1,
                    colwidth: [120, 120],
                    align: null
                  },
                  content: [paragraph(nextId, large)]
                }
              ]
            }
          ]
        }
      ]
    })
    const exported = exportMarkdown(document)
    const roundtrip = imported(exported.markdown)
    expect(
      exported.diagnostics.some(
        (item) =>
          item.code === "node-fallback" && typeof item.nodeId === "string"
      )
    ).toBe(true)
    expect(content(roundtrip)[0]!["type"]).toBe("table")
    expect(JSON.stringify(roundtrip.document.data)).toContain(large)
  })

  it("在 remark parse 前拒绝超预算输入，并对 8193 字符输入不抛", () => {
    expect(() => importMarkdown("x".repeat(8_193))).not.toThrow()
    expect(importMarkdown("x".repeat(8_193))).toMatchObject({
      failure: "input-too-large"
    })
    const oversized = importMarkdown(
      "x".repeat(HNN_LIMITS.maxShellBytes + HNN_LIMITS.maxNodes * 64 + 1)
    )
    expect(oversized).toMatchObject({
      failure: "input-too-large",
      diagnostics: [expect.objectContaining({ code: "input-too-large" })]
    })
    expect("document" in oversized).toBe(false)
  })

  it("空输入返回诊断而不是静默生成空文档", () => {
    const empty = imported("")
    expect(empty.diagnostics).toContainEqual(
      expect.objectContaining({ code: "empty-input" })
    )
  })

  it("mention/resource/external-item 围栏拒绝正文与额外 metadata", () => {
    for (const language of ["mention", "resource", "external-item"]) {
      const result = imported(
        [
          `\`\`\`${language}`,
          '{"resourceId":"r","name":"资源","extra":true}',
          "正文",
          "```"
        ].join("\n")
      )
      expect(content(result)[0]!["type"]).toBe("codeBlock")
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid-hn-fence", line: 1 })
      )
    }
  })

  it("base64url JSON fallback 不受反引号 payload 影响，30 个大节点可导出再导入", () => {
    const nextId = ids()
    const tickData = "`".repeat(7_000)
    const document = encodeHnn({
      type: "doc",
      content: Array.from({ length: 30 }, () => ({
        type: "card",
        attrs: { nodeId: nextId(), data: tickData }
      }))
    })
    const exported = exportMarkdown(document)
    expect(exported.markdown).toContain("hamster-note-json-b64")
    expect(exported.markdown).not.toContain(tickData)
    const roundtrip = imported(exported.markdown)
    expect(content(roundtrip)).toHaveLength(30)
    expect(JSON.stringify(roundtrip.document.data)).toContain(tickData)
  })

  it("接近 512 KiB 的合法 HNN JSON fallback 可 export/import，不回退到旧 256 KiB 预算", () => {
    const document = largeValidDocument(HNN_LIMITS.maxShellBytes)
    const exported = exportMarkdown(document)
    const result = importMarkdown(exported.markdown)
    expect("failure" in result).toBe(false)
    if ("failure" in result) throw new Error("expected imported document")
    expect(dataWithoutNodeIds(result.document.data)).toEqual(
      dataWithoutNodeIds(document.data)
    )
  }, 15_000)

  it("在 Remark/UUID 创建前拒绝五万短段落", () => {
    const result = importMarkdown(
      Array.from({ length: 50_000 }, () => "x").join("\n\n")
    )
    expect(result).toMatchObject({
      failure: "input-too-large",
      diagnostics: [expect.objectContaining({ code: "input-too-large" })]
    })
  })

  it("所有命名 HN fence 拒绝 meta，未知围栏完整保留 lang/meta/body", () => {
    const meta = imported(["```math unexpected", "x", "```"].join("\n"))
    expect(meta.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence" })
    )
    const unknown = imported(
      ["```hamster-note-future keep-this", "body", "```"].join("\n")
    )
    expect(unknown.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unknown-hn-fence" })
    )
    expect(JSON.stringify(unknown.document.data)).toContain(
      "hamster-note-future keep-this"
    )
    expect(JSON.stringify(unknown.document.data)).toContain("body")
  })

  it("保留 HN dialect 名称的普通 codeBlock 走 JSON fallback", () => {
    const nextId = ids()
    const document = encodeHnn({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { nodeId: nextId(), language: "math", filename: "untitled" },
          content: [{ type: "text", text: "不是公式" }]
        }
      ]
    })
    const exported = exportMarkdown(document)
    expect(exported.markdown).toContain("hamster-note-json-b64")
    expect(exported.diagnostics).toContainEqual(
      expect.objectContaining({ code: "node-fallback" })
    )
    expect(content(imported(exported.markdown))[0]!["type"]).toBe("codeBlock")
  })

  it("不同容器的 closing 不会闭合 HN fence", () => {
    const result = imported(["> ```math", "```", "> x^2"].join("\n"))
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 1 })
    )
  })

  it("空 paragraph 与不忠实 table 形态逐节点 JSON fallback", () => {
    const nextId = ids()
    const document = encodeHnn({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: nextId() } },
        { type: "paragraph", attrs: { nodeId: nextId() } },
        {
          type: "table",
          attrs: { nodeId: nextId() },
          content: [
            {
              type: "tableRow",
              attrs: { nodeId: nextId() },
              content: [
                {
                  type: "tableHeader",
                  attrs: {
                    nodeId: nextId(),
                    colspan: 1,
                    rowspan: 1,
                    colwidth: null,
                    align: "left"
                  },
                  content: [paragraph(nextId, "A")]
                }
              ]
            },
            {
              type: "tableRow",
              attrs: { nodeId: nextId() },
              content: [
                {
                  type: "tableCell",
                  attrs: {
                    nodeId: nextId(),
                    colspan: 1,
                    rowspan: 1,
                    colwidth: null,
                    align: "right"
                  },
                  content: [paragraph(nextId, "B")]
                }
              ]
            }
          ]
        }
      ]
    })
    const exported = exportMarkdown(document)
    expect(
      exported.diagnostics.filter((item) => item.code === "node-fallback")
    ).toHaveLength(3)
    expect(content(imported(exported.markdown))).toHaveLength(3)
  })

  it("link/image title 与 definition title 均诊断并保留可读原意", () => {
    const links = imported(
      [
        '[链接](https://example.test "标题")',
        "",
        '![图片](https://example.test/a.png "图片标题")',
        "",
        '[ref]: https://example.test "定义标题"'
      ].join("\n")
    )
    expect(links.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "link-title-fallback",
        "image-title-fallback",
        "definition-fallback"
      ])
    )
    expect(JSON.stringify(links.document.data)).toContain("标题")
    expect(JSON.stringify(links.document.data)).toContain("图片标题")
    expect(JSON.stringify(links.document.data)).toContain("定义标题")
  })

  it("导出结果复用 import preflight：3000 行 code 与 8000 下划线段落均可再导入", () => {
    const nextId = ids()
    const code = encodeHnn({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { nodeId: nextId(), language: "txt", filename: "untitled" },
          content: [
            {
              type: "text",
              text: Array.from({ length: 3_000 }, () => "x").join("\n")
            }
          ]
        }
      ]
    })
    const underlines = encodeHnn({
      type: "doc",
      content: [paragraph(nextId, "_".repeat(8_000))]
    })
    for (const document of [code, underlines]) {
      const exported = exportMarkdown(document)
      expect("failure" in importMarkdown(exported.markdown)).toBe(false)
    }
  })

  it("2049 行软换行仍是一个段落，不按行数伪造内容块限制", () => {
    const result = imported(Array.from({ length: 2_049 }, () => "x").join("\n"))
    expect(content(result)).toHaveLength(1)
    expect(content(result)[0]!["type"]).toBe("paragraph")
  })

  it("高碎片 GFM 在 AST/UUID 创建前受控失败", () => {
    const table = [
      "|" + Array.from({ length: 150 }, () => "x").join("|") + "|",
      "|" + Array.from({ length: 150 }, () => "---").join("|") + "|",
      ...Array.from(
        { length: 150 },
        () => "|" + Array.from({ length: 150 }, () => "x").join("|") + "|"
      )
    ].join("\n")
    const links = Array.from(
      { length: 20_000 },
      (_, index) => `[${index}](https://example.test/${index})`
    ).join(" ")
    expect(importMarkdown(table)).toMatchObject({ failure: "input-too-large" })
    expect(importMarkdown(links)).toMatchObject({ failure: "input-too-large" })
  })

  it("fence 状态机支持 list continuation，忽略普通 fence 内伪 HN opening", () => {
    const list = imported(["- ```math", "  x^2", "  ```"].join("\n"))
    expect(list.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence" })
    )
    const ordinary = imported(
      ["~~~~text", "```math", "x", "~~~~", "", "```math", "x"].join("\n")
    )
    expect(ordinary.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 6 })
    )
  })

  it("超长普通 code language 以安全 language 保留完整 fence，前后内容仍导入", () => {
    const language = "x".repeat(HNN_LIMITS.maxIdentifierBytes + 1)
    const result = imported(
      ["前", "", `\`\`\`${language} meta`, "body", "```", "", "后"].join("\n")
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "code-language-fallback", line: 3 })
    )
    expect(JSON.stringify(result.document.data)).toContain(
      `\`\`\`${language} meta`
    )
    expect(content(result).map((item) => item["type"])).toContain("paragraph")
  })

  it("unsafe title link、title image 与 reference nodes 都保留可读 URL/label 并诊断", () => {
    const result = imported(
      [
        '[危险](javascript:alert "标题")',
        "",
        '![图](https://example.test/a.png "图片标题")',
        "",
        '[原标签]: https://example.test/r "定义标题"',
        "",
        "[引用][原标签] ![替代][原标签]"
      ].join("\n")
    )
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "unsafe-url",
        "image-title-fallback",
        "definition-fallback",
        "reference-link-fallback",
        "reference-image-fallback"
      ])
    )
    const serialized = JSON.stringify(result.document.data)
    expect(serialized).toContain("javascript:alert")
    expect(serialized).toContain("https://example.test/a.png")
    expect(serialized).toContain("原标签")
  })

  it("复杂 mark text runs 的标准输出经完整 import 验证后仍可 roundtrip", () => {
    const nextId = ids()
    const markTypes = ["bold", "italic", "strike"]
    const document = encodeHnn({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: nextId() },
          content: Array.from({ length: 180 }, (_, index) => ({
            type: "text",
            text: `run-${index}`,
            marks: [{ type: markTypes[index % markTypes.length]! }]
          }))
        }
      ]
    })
    const exported = exportMarkdown(document)
    expect("failure" in importMarkdown(exported.markdown)).toBe(false)
  })

  it("fenced code 正文不计词法工作：具 filename 的 10 块高 marker 数据可 export/import", () => {
    const nextId = ids()
    const document = encodeHnn({
      type: "doc",
      content: Array.from({ length: 10 }, (_, index) => ({
        type: "codeBlock",
        attrs: {
          nodeId: nextId(),
          language: "txt",
          filename: `f-${index}.txt`
        },
        content: [{ type: "text", text: "\uffff".repeat(2_300) }]
      }))
    })
    const exported = exportMarkdown(document)
    const result = importMarkdown(exported.markdown)
    expect("failure" in result).toBe(false)
  })

  it("分行显式 link 与 autolink 在 Remark 前共享 HNN 预算失败", () => {
    const explicit = Array.from({ length: 40 }, () =>
      Array.from(
        { length: 250 },
        (_, index) => `[${index}](https://example.test/${index})`
      ).join(" ")
    ).join("\n")
    const autolinks = Array.from({ length: 40 }, () =>
      Array.from(
        { length: 250 },
        (_, index) => `https://example.test/${index}`
      ).join(" ")
    ).join("\n")
    expect(importMarkdown(explicit)).toMatchObject({
      failure: "input-too-large"
    })
    expect(importMarkdown(autolinks)).toMatchObject({
      failure: "input-too-large"
    })
  })

  it("callout/collapsible 的超预算 nested body 回滚并局部保留完整围栏", () => {
    const links = Array.from({ length: 40 }, () =>
      Array.from(
        { length: 250 },
        (_, index) => `[${index}](https://example.test/${index})`
      ).join(" ")
    ).join("\n")
    for (const [language, metadata] of [
      ["callout", '{"tone":"info","title":"提示"}'],
      ["collapsible", '{"title":"详情","collapsed":false}']
    ] as const) {
      const result = importMarkdown(
        ["`".repeat(3) + language, metadata, "", links, "```"].join("\n")
      )
      expect("failure" in result).toBe(false)
      if ("failure" in result)
        throw new Error(JSON.stringify(result.diagnostics))
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "nested-content-fallback",
          line: 1,
          column: 1
        })
      )
      expect(fallbackText(result.document)).toContain(`\`\`\`${language}`)
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "conversion-failed" })
      )
    }
  })

  it("29 层 quote 在 callout/collapsible 包装后超深时回滚为同源完整围栏", () => {
    const nestedQuote = `${"> ".repeat(29)}正文`
    for (const [language, metadata] of [
      ["callout", '{"tone":"info","title":"提示"}'],
      ["collapsible", '{"title":"详情","collapsed":false}']
    ] as const) {
      const fence = ["```" + language, metadata, "", nestedQuote, "```"].join(
        "\n"
      )
      const result = importMarkdown(["前", "", fence, "", "后"].join("\n"))
      if ("failure" in result)
        throw new Error(JSON.stringify(result.diagnostics))

      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "nested-content-fallback",
          line: 3,
          column: 1
        })
      )
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "conversion-failed" })
      )
      expect(
        content({
          document: result.document,
          diagnostics: result.diagnostics
        }).map((node) => node["type"])
      ).toEqual(["paragraph", "codeBlock", "paragraph"])
      expect(fallbackText(result.document)).toContain(fence)
      expect(JSON.stringify(result.document.data)).not.toContain(
        `"type":"${language}"`
      )
      expect(() => encodeHnn(result.document.data)).not.toThrow()
    }
  })

  it("外层 quote/list 将合法 callout/collapsible 推至超深时，仅围栏局部降级", () => {
    for (const [language, metadata] of [
      ["callout", '{"tone":"info","title":"提示"}'],
      ["collapsible", '{"title":"详情","collapsed":false}']
    ] as const) {
      const quoteFence = [
        `> \`\`\`${language}`,
        `> ${metadata}`,
        ">",
        `> ${"> ".repeat(28)}正文`,
        "> ```"
      ].join("\n")
      const listFence = [
        `- \`\`\`${language}`,
        `  ${metadata}`,
        "  ",
        `  ${"> ".repeat(28)}正文`,
        "  ```"
      ].join("\n")

      for (const [markdown, opening] of [
        [quoteFence, { line: 1, column: 3 }],
        [listFence, { line: 1, column: 3 }]
      ] as const) {
        const result = importMarkdown(markdown)
        if ("failure" in result)
          throw new Error(JSON.stringify(result.diagnostics))

        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "nested-content-fallback",
            ...opening
          })
        )
        expect(JSON.stringify(result.document.data)).not.toContain(
          `"type":"${language}"`
        )
        expect(fallbackText(result.document)).toContain(`\`\`\`${language}`)
        expect(() => encodeHnn(result.document.data)).not.toThrow()
      }
    }
  })

  it("nested body 成功诊断映射到外层 opening，失败回滚不移除合法 sibling 诊断", () => {
    const safeSibling = [
      "```callout",
      '{"tone":"info","title":"保留"}',
      "",
      "[危险](javascript:alert)",
      "```"
    ]
    const overflowingSibling = [
      "```callout",
      '{"tone":"info","title":"回退"}',
      "",
      `${"> ".repeat(29)}正文`,
      "```"
    ]
    const result = importMarkdown(
      [
        "前",
        "",
        safeSibling.join("\n"),
        "",
        overflowingSibling.join("\n")
      ].join("\n")
    )
    if ("failure" in result) throw new Error(JSON.stringify(result.diagnostics))

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsafe-url", line: 3, column: 1 })
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "nested-content-fallback",
        line: 9,
        column: 1
      })
    )
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "unsafe-url"
      )
    ).toHaveLength(1)
    expect(
      content({
        document: result.document,
        diagnostics: result.diagnostics
      }).map((node) => node["type"])
    ).toEqual(["paragraph", "callout", "codeBlock"])
    expect(() => encodeHnn(result.document.data)).not.toThrow()
  })

  it("同一 nested body 的 sibling 在局部回滚后仍提交成功 sibling 的预算与诊断", () => {
    const markdown = [
      "~~~~callout",
      '{"tone":"info","title":"外层"}',
      "",
      "```callout",
      '{"tone":"info","title":"保留"}',
      "",
      "[危险](javascript:alert)",
      "```",
      "",
      "```callout",
      '{"tone":"info","title":"回退"}',
      "",
      `${"> ".repeat(29)}正文`,
      "```",
      "~~~~"
    ].join("\n")
    const result = importMarkdown(markdown)
    if ("failure" in result) throw new Error(JSON.stringify(result.diagnostics))

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsafe-url", line: 1, column: 1 })
    )
    // 内层围栏的 fallback 保持其在外层 body 中的本地 source；成功 sibling 的 unsafe
    // URL 诊断则由外层围栏重映射到全局 opening，且不能被这次回滚一并移除。
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "nested-content-fallback",
        line: 7,
        column: 1
      })
    )
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "unsafe-url"
      )
    ).toHaveLength(1)
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "nested-content-fallback"
      )
    ).toHaveLength(1)
    expect(fallbackText(result.document)).toContain("```callout")
    expect(() => encodeHnn(result.document.data)).not.toThrow()
  })

  it("29 层 quote/list 中链式 nested rollback 不泄漏已失效的内层诊断", () => {
    const safeSibling = [
      "```callout",
      '{"tone":"info","title":"保留"}',
      "",
      "[危险](javascript:alert)",
      "```"
    ]
    const containers = [
      {
        type: "blockquote",
        opening: "> ".repeat(29),
        continuation: "> ".repeat(29)
      },
      // list 与 listItem 占两层，另加 27 层 quote，共同构成 29 层外部容器。
      {
        type: "bulletList",
        opening: `- ${"> ".repeat(27)}`,
        continuation: `  ${"> ".repeat(27)}`
      }
    ] as const

    for (const [language, metadata] of [
      ["callout", '{"tone":"info","title":"外层"}'],
      ["collapsible", '{"title":"外层","collapsed":false}']
    ] as const) {
      const innerFence = [
        "```callout",
        '{"tone":"info","title":"内层"}',
        "",
        "正文",
        "```"
      ]
      const outerFallback = [
        "```" + language,
        metadata,
        "",
        ...innerFence,
        "```"
      ].join("\n")
      const outerInput = [
        "~~~~" + language,
        metadata,
        "",
        ...innerFence,
        "~~~~"
      ]

      for (const container of containers) {
        const markdown = [
          ...safeSibling,
          "",
          `${container.opening}${outerInput[0]}`,
          ...outerInput
            .slice(1)
            .map((line) => `${container.continuation}${line}`)
        ].join("\n")
        const result = importMarkdown(markdown)
        if ("failure" in result)
          throw new Error(JSON.stringify(result.diagnostics))

        // 内层先回滚后，其 codeBlock 仍让外层包装超过深度；最终只保留外层完整围栏。
        expect(
          content({
            document: result.document,
            diagnostics: result.diagnostics
          })[1]!["type"]
        ).toBe(container.type)
        expect(fallbackText(result.document)).toBe(outerFallback)
        expect(
          JSON.stringify(result.document.data).match(/"type":"codeBlock"/g)
        ).toHaveLength(1)
        expect(
          result.diagnostics.filter(
            (diagnostic) => diagnostic.code === "nested-content-fallback"
          )
        ).toEqual([
          expect.objectContaining({
            line: 7,
            column: container.opening.length + 1
          })
        ])
        // 成功的外部 sibling 不属于 outer plan，链式回滚不能移除它的诊断。
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ code: "unsafe-url", line: 1, column: 1 })
        )
        expect(() => encodeHnn(result.document.data)).not.toThrow()
      }
    }
  })

  it("连续 callout 的危险链接共享嵌套候选/AST 预算，超限围栏逐个局部回滚", () => {
    const links = Array.from(
      { length: 100 },
      () => "[x](javascript:alert)"
    ).join(" ")
    const fences = Array.from({ length: 16 }, () =>
      ["```callout", '{"tone":"info","title":"提示"}', "", links, "```"].join(
        "\n"
      )
    )
    const result = importMarkdown(fences.join("\n\n"))
    if ("failure" in result) throw new Error(JSON.stringify(result.diagnostics))

    const fallbacks = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "nested-content-fallback"
    )
    // 预检同时记录显式 link 和其中的 bare URL，100 个危险链接消耗 200 个候选；因此
    // 第一个围栏成功，后续 15 个都必须复用主分支预算并局部回滚。
    expect(fallbacks).toHaveLength(15)
    expect(
      fallbacks.map((diagnostic) => ({
        line: diagnostic.line,
        column: diagnostic.column
      }))
    ).toEqual(
      Array.from({ length: 15 }, (_, index) => ({
        line: 7 + index * 6,
        column: 1
      }))
    )
    // 回滚的嵌套分支不得遗留其危险 URL 诊断；仅第一个实际成功的 callout 产生 100 条。
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "unsafe-url"
      )
    ).toHaveLength(100)
    expect(
      content({
        document: result.document,
        diagnostics: result.diagnostics
      }).filter((node) => node["type"] === "callout")
    ).toHaveLength(1)
    expect(
      content({
        document: result.document,
        diagnostics: result.diagnostics
      }).filter((node) => node["type"] === "codeBlock")
    ).toHaveLength(15)
    expect(fallbackText(result.document)).toContain(fences[1])
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "conversion-failed" })
    )
    expect(() => encodeHnn(result.document.data)).not.toThrow()
  })

  it("超预算 hamster-note-json-b64 payload 在重建 ID 前局部保留", () => {
    const payload = JSON.stringify({
      type: "doc",
      content: Array.from({ length: 7_000 }, () => ({ type: "paragraph" }))
    })
    const encoded = btoa(payload)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")
    const chunkLimit = HNN_LIMITS.maxAttrBytes - 256
    const total = Math.ceil(encoded.length / chunkLimit)
    const chunks = Array.from({ length: total }, (_, index) =>
      [
        "```hamster-note-json-b64 " + `${index + 1}/${total}`,
        encoded.slice(index * chunkLimit, (index + 1) * chunkLimit),
        "```"
      ].join("\n")
    )
    const result = importMarkdown(chunks.join("\n\n"))
    expect("failure" in result).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence", line: 1, column: 1 })
    )
    if (!result.document) throw new Error("expected locally preserved document")
    expect(JSON.stringify(result.document.data)).toContain(
      "```hamster-note-json-b64 1/"
    )
    expect(() => encodeHnn(result.document.data)).not.toThrow()
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "conversion-failed" })
    )
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "input-too-large" })
    )
  })

  it("fence scanner 保留多位 ordered、blockquote ordered 与嵌套 list 中的 literal marker", () => {
    const source = [
      "100. ```math",
      "     x^2",
      "     - literal",
      "     1. literal",
      "     ```",
      "",
      "> 10. ```math",
      ">     x^2",
      ">     - literal",
      ">     1. literal",
      ">     ```",
      "",
      "- parent",
      "  - ```math",
      "    x^2",
      "    - literal",
      "    1. literal",
      "    ```"
    ].join("\n")
    const result = imported(source)
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence" })
    )
    expect(JSON.stringify(result.document.data)).toContain("x^2")
  })

  it("复合容器 fence 自然结束后重新处理 root 行的未闭合 HN fence", () => {
    const listMath = imported(["> - ```math", ">   x^2", ">   ```"].join("\n"))
    expect(listMath.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence" })
    )
    const ordinaryThenRoot = imported(
      ["- ~~~~text", "  ```math", "- item", "", "```math", "x"].join("\n")
    )
    expect(ordinaryThenRoot.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 5 })
    )
    const hnnThenRoot = imported(
      ["- ```math", "  x", "- item", "", "```math", "x"].join("\n")
    )
    expect(hnnThenRoot.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 1 })
    )
    expect(hnnThenRoot.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 5 })
    )
  })

  it("普通 escaped reference 外观文本原样保留且没有 fallback 诊断", () => {
    const result = imported("\\[Visible text][target]")
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "reference-link-fallback" })
    )
    const serialized = JSON.stringify(result.document.data)
    expect(serialized).toContain("Visible text")
    expect(serialized).toContain("target")
  })

  it("复杂 list item 不逃离列表：以整节点围栏可读降级并可再导入", () => {
    const nextId = ids()
    const document = encodeHnn({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { nodeId: nextId() },
          content: [
            {
              type: "listItem",
              attrs: { nodeId: nextId() },
              content: [
                paragraph(nextId, "第一段"),
                paragraph(nextId, "第二段"),
                { type: "formula", attrs: { nodeId: nextId(), latex: "x^2" } }
              ]
            }
          ]
        }
      ]
    })
    const exported = exportMarkdown(document)
    const roundtrip = imported(exported.markdown)
    expect(exported.diagnostics).toContainEqual(
      expect.objectContaining({ code: "node-fallback" })
    )
    expect(content(roundtrip)[0]!["type"]).toBe("bulletList")
    expect(JSON.stringify(roundtrip.document.data)).toContain("第二段")
  })

  it("含不可表达子内容的引用整体降级，不把围栏逃逸到引用外", () => {
    const nextId = ids()
    const document = encodeHnn({
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: { nodeId: nextId(), author: null },
          content: [
            { type: "formula", attrs: { nodeId: nextId(), latex: "x^2" } }
          ]
        }
      ]
    })
    const exported = exportMarkdown(document)
    const roundtrip = imported(exported.markdown)
    expect(exported.diagnostics).toContainEqual(
      expect.objectContaining({ code: "node-fallback" })
    )
    expect(content(roundtrip)[0]!["type"]).toBe("blockquote")
  })

  it("不可表达 attrs 按节点降级：author、ordered type、filename", () => {
    const nextId = ids()
    const document = encodeHnn({
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: { nodeId: nextId(), author: "Ada" },
          content: [paragraph(nextId, "引用")]
        },
        {
          type: "orderedList",
          attrs: { nodeId: nextId(), start: 1, type: "1" },
          content: [
            {
              type: "listItem",
              attrs: { nodeId: nextId() },
              content: [paragraph(nextId, "项目")]
            }
          ]
        },
        {
          type: "codeBlock",
          attrs: { nodeId: nextId(), language: "ts", filename: "note name.ts" },
          content: [{ type: "text", text: "const x = 1" }]
        }
      ]
    })
    const exported = exportMarkdown(document)
    expect(
      exported.diagnostics.filter((item) => item.code === "node-fallback")
    ).toHaveLength(3)
    expect(JSON.stringify(imported(exported.markdown).document.data)).toContain(
      "note name.ts"
    )
  })

  it("保留既定 math/directory/card/drawing fences，并逐节点返回降级诊断", () => {
    const nextId = ids()
    const document = encodeHnn({
      type: "doc",
      content: [
        {
          type: "formula",
          attrs: {
            nodeId: nextId(),
            latex: "\\begin{matrix}a\\\\b\\end{matrix}"
          }
        },
        { type: "directory", attrs: { nodeId: nextId(), config: "headings" } },
        { type: "card", attrs: { nodeId: nextId(), data: '{"title":"卡片"}' } },
        { type: "drawing", attrs: { nodeId: nextId(), data: '{"version":1}' } }
      ]
    })
    const exported = exportMarkdown(document)
    expect(exported.markdown).toContain("```math")
    expect(exported.markdown).toContain("```directory")
    expect(exported.markdown).toContain("```hamster-note-card")
    expect(exported.markdown).toContain("```hamster-note-drawing")
    expect(exported.diagnostics.map((item) => item.code)).toEqual([
      "complex-formula-fallback",
      "directory-fallback",
      "card-fallback",
      "drawing-fallback"
    ])
  })

  it("覆盖 list/blockquote 内未闭合 fence，且 callout/collapsible nested 诊断映射回外层位置", () => {
    const unclosed = imported(["> ```math", "> x^2"].join("\n"))
    expect(unclosed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 1 })
    )

    const nested = imported(
      [
        "```callout",
        '{"tone":"info","title":"提示"}',
        "",
        "<script>不执行</script>",
        "```"
      ].join("\n")
    )
    expect(nested.diagnostics).toContainEqual(
      expect.objectContaining({ code: "html-fallback", line: 1, column: 1 })
    )
    const collapsible = imported(
      [
        "```collapsible",
        '{"title":"详情","collapsed":false}',
        "",
        "<script>不执行</script>",
        "```"
      ].join("\n")
    )
    expect(collapsible.diagnostics).toContainEqual(
      expect.objectContaining({ code: "html-fallback", line: 1, column: 1 })
    )
  })

  it("导出 PM Node 也走 encodeHnn，非法 URL 不会绕过严格 codec", () => {
    const nextId = ids()
    const invalid = hnnSchema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: nextId() },
          content: [
            {
              type: "text",
              text: "危险",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }]
            }
          ]
        }
      ]
    })
    expect(() => exportMarkdown(invalid)).toThrow(/URL/u)
  })

  it("标准 Markdown 候选均须回读为忽略 nodeId 后等价的 HNN", () => {
    const nextId = ids()
    const documents = [
      encodeHnn({
        type: "doc",
        content: [
          {
            type: "taskList",
            attrs: { nodeId: nextId() },
            content: [
              {
                type: "taskItem",
                attrs: { nodeId: nextId(), checked: true },
                content: [{ type: "paragraph", attrs: { nodeId: nextId() } }]
              }
            ]
          }
        ]
      }),
      encodeHnn({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { nodeId: nextId(), start: 1_000_000_000, type: null },
            content: [
              {
                type: "listItem",
                attrs: { nodeId: nextId() },
                content: [paragraph(nextId, "项目")]
              }
            ]
          }
        ]
      }),
      encodeHnn({ type: "doc", content: [paragraph(nextId, "a\n\nb")] })
    ]
    for (const document of documents) {
      const exported = exportMarkdown(document)
      const roundtrip = imported(exported.markdown)
      expect(dataWithoutNodeIds(roundtrip.document.data)).toEqual(
        dataWithoutNodeIds(document.data)
      )
    }
  })

  it("图片与 HN 围栏 attr 超限仅局部降级，保留前后可识别内容与位置", () => {
    const imageAlt = "图".repeat(171) // 513 UTF-8 bytes
    const image = imported(
      ["前", "", `![${imageAlt}](https://example.test/a.png)`, "", "后"].join(
        "\n"
      )
    )
    expect(image.diagnostics).toContainEqual(
      expect.objectContaining({ code: "attr-too-large", line: 3, column: 1 })
    )
    expect(image.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "input-too-large" })
    )
    expect(JSON.stringify(image.document.data)).toContain(imageAlt)
    expect(content(image).map((item) => item["type"])).toEqual(
      expect.arrayContaining(["paragraph", "codeBlock"])
    )

    for (const [language, metadata, payload] of [
      ["callout", `{"tone":"info","title":"${"图".repeat(171)}"}`, ""],
      ["collapsible", `{"title":"${"图".repeat(171)}","collapsed":false}`, ""],
      ["resource", `{"resourceId":"${"r".repeat(257)}","name":"资源"}`, ""],
      ["math", "", "x".repeat(HNN_LIMITS.maxAttrBytes + 1)],
      ["hamster-note-card", "", "x".repeat(HNN_LIMITS.maxAttrBytes + 1)],
      ["hamster-note-drawing", "", "x".repeat(HNN_LIMITS.maxAttrBytes + 1)]
    ] as const) {
      const fence =
        metadata.length > 0
          ? ["```" + language, metadata, payload, "```"]
          : ["```" + language, payload, "```"]
      const result = imported(["前", "", ...fence, "", "后"].join("\n"))
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "attr-too-large", line: 3, column: 1 })
      )
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "input-too-large" })
      )
      const serialized = JSON.stringify(result.document.data)
      expect(serialized).toContain("前")
      expect(serialized).toContain("后")
      expect(content(result).map((item) => item["type"])).toContain("codeBlock")
    }
  })

  it("独占 GFM 图片的超长 src 绕过单行预检后按 attr 分片局部降级", () => {
    const src = `https://example.test/${"x".repeat(HNN_LIMITS.maxAttrBytes + 1)}`
    const result = imported(["前", "", `![封面](${src})`, "", "后"].join("\n"))
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "attr-too-large", line: 3, column: 1 })
    )
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "input-too-large" })
    )
    expect(content(result).map((item) => item["type"])).toEqual([
      "paragraph",
      "codeBlock",
      "codeBlock",
      "paragraph"
    ])
    const serialized = JSON.stringify(result.document.data)
    expect(serialized).toContain("前")
    expect(serialized).toContain("后")
    expect(serialized).toContain("https://example.test/")
  })

  it("未被分组消费的 hamster-note-json-b64 fence 作为无效围栏局部保留", () => {
    const result = imported(
      [
        "前",
        "",
        "```hamster-note-json-b64",
        '{"resourceId":"r","name":"n"}',
        "```",
        "",
        "后"
      ].join("\n")
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence", line: 3, column: 1 })
    )
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "conversion-failed" })
    )
    expect(content(result).map((item) => item["type"])).toEqual([
      "paragraph",
      "codeBlock",
      "paragraph"
    ])
    const serialized = JSON.stringify(result.document.data)
    expect(serialized).toContain("前")
    expect(serialized).toContain("后")
    expect(serialized).toContain("hamster-note-json-b64")
    const codeText = (
      content(result)[1]!["content"] as Array<Record<string, unknown>>
    )[0]!["text"]
    expect(codeText).toContain('{"resourceId":"r","name":"n"}')
  })

  it("超长 hamster-note-json-b64 单段局部保留整组，不消费后续内容", () => {
    const chunkLimit = HNN_LIMITS.maxAttrBytes - 256
    const nodeId = ids()()
    // 无 padding 的单段 base64url 总长度不可能为 4n + 1；将合法 payload 分成两段，
    // 使第一段精确为上限 + 1，第二段补足完整、仍可解码的 card JSON。
    let payload = ""
    for (
      let dataLength = 0;
      payload.length <= chunkLimit + 1;
      dataLength += 1
    ) {
      const raw = JSON.stringify({
        type: "card",
        attrs: { nodeId, data: "x".repeat(dataLength) }
      })
      payload = btoa(raw)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "")
    }
    const firstChunk = payload.slice(0, chunkLimit + 1)
    const secondChunk = payload.slice(chunkLimit + 1)
    expect(firstChunk).toHaveLength(chunkLimit + 1)
    expect(secondChunk.length).toBeGreaterThan(0)

    const source = [
      "前",
      "",
      "```hamster-note-json-b64 1/2",
      firstChunk,
      "```",
      "",
      "```hamster-note-json-b64 2/2",
      secondChunk,
      "```",
      "",
      "后"
    ].join("\n")
    const result = imported(source)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence", line: 3, column: 1 })
    )
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "input-too-large" })
    )
    expect(content(result).map((item) => item["type"])).toEqual([
      "paragraph",
      "codeBlock",
      "paragraph"
    ])
    const serialized = JSON.stringify(result.document.data)
    expect(serialized).toContain("前")
    expect(serialized).toContain("后")
    expect(serialized).toContain("```hamster-note-json-b64 1/2")
    expect(serialized).toContain("```hamster-note-json-b64 2/2")
    expect(serialized).toContain(firstChunk)
    expect(serialized).toContain(secondChunk)
    expect(() => encodeHnn(result.document.data)).not.toThrow()
  })

  it("先验证 JSON-b64 完整组结构：插入普通内容或错误成员不会被消费，也不会产生 undefined", () => {
    const payload = base64url(
      JSON.stringify({ type: "card", attrs: { nodeId: ids()(), data: "ok" } })
    )
    const split = Math.floor(payload.length / 2)
    const first = payload.slice(0, split)
    const second = payload.slice(split)
    for (const source of [
      [
        "前",
        "",
        "```hamster-note-json-b64 1/2",
        first,
        "```",
        "",
        "插入的普通段落",
        "",
        "```hamster-note-json-b64 2/2",
        second,
        "```",
        "",
        "后"
      ].join("\n"),
      [
        "前",
        "",
        "```hamster-note-json-b64 1/2",
        first,
        "```",
        "",
        "```hamster-note-json-b64 3/2",
        second,
        "```",
        "",
        "后"
      ].join("\n")
    ]) {
      const attempt = importMarkdown(source)
      if ("failure" in attempt)
        throw new Error(JSON.stringify(attempt.diagnostics))
      const result = {
        document: attempt.document,
        diagnostics: attempt.diagnostics
      }
      const serialized = JSON.stringify(result.document.data)
      expect(
        result.diagnostics.filter(
          (item) => item.code === "invalid-hn-fence" && item.line === 3
        )
      ).toHaveLength(1)
      expect(serialized).toContain(first)
      expect(serialized).toContain(second)
      expect(serialized).toContain("前")
      expect(serialized).toContain("后")
      expect(serialized).not.toContain("undefined")
      expect(() => encodeHnn(result.document.data)).not.toThrow()
    }
  })

  it("首、中、尾超限 JSON-b64 分片均整组保留，包含前后内容且严格可编码", () => {
    const payload = largeJsonFencePayload()
    const chunkLimit = HNN_LIMITS.maxAttrBytes - 256
    const canonical = Array.from(
      { length: Math.ceil(payload.length / chunkLimit) },
      (_, index) => payload.slice(index * chunkLimit, (index + 1) * chunkLimit)
    )
    expect(canonical.length).toBeGreaterThan(3)
    const variants: string[][] = []

    // 首、中段从下一段借一个字符；尾段合并最后两段，组仍完整但某段非规范超限。
    for (const index of [0, Math.floor(canonical.length / 2)]) {
      const chunks = [...canonical]
      chunks[index] = `${chunks[index]}${chunks[index + 1]![0]}`
      chunks[index + 1] = chunks[index + 1]!.slice(1)
      variants.push(chunks)
    }
    const tail = [
      ...canonical.slice(0, -2),
      `${canonical.at(-2)}${canonical.at(-1)}`
    ]
    variants.push(tail)

    for (const chunks of variants) {
      const source = ["前", "", jsonFenceChunks(chunks), "", "后"].join("\n")
      const attempt = importMarkdown(source)
      if ("failure" in attempt)
        throw new Error(JSON.stringify(attempt.diagnostics))
      const result = {
        document: attempt.document,
        diagnostics: attempt.diagnostics
      }
      const serialized = JSON.stringify(result.document.data)
      expect(
        result.diagnostics.filter(
          (item) => item.code === "invalid-hn-fence" && item.line === 3
        )
      ).toHaveLength(1)
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "input-too-large" })
      )
      expect(serialized).toContain("前")
      expect(serialized).toContain("后")
      expect(fallbackText(result.document)).toContain(jsonFenceChunks(chunks))
      expect(serialized).not.toContain("undefined")
      expect(() => encodeHnn(result.document.data)).not.toThrow()
    }
  })

  it("大尺寸坏 base64 与严格 payload 失败在容量内完整局部保留", () => {
    const chunkLimit = HNN_LIMITS.maxAttrBytes - 256
    const invalidBase64 = `${"A".repeat(150_000)}!${"A".repeat(149_999)}`
    const strictPayload = largeJsonFencePayload()
    const strictChunks = Array.from(
      { length: Math.ceil(strictPayload.length / chunkLimit) },
      (_, index) =>
        strictPayload.slice(index * chunkLimit, (index + 1) * chunkLimit)
    )
    // base64 保持可解码，payload 则因未知 blockquote attr 被严格 codec 拒绝。
    const invalidNode = JSON.stringify({
      type: "blockquote",
      attrs: { nodeId: ids()(), author: null, unexpected: "x".repeat(200_000) },
      content: [paragraph(ids(), "body")]
    })
    const invalidStrictChunks = Array.from(
      { length: Math.ceil(base64url(invalidNode).length / chunkLimit) },
      (_, index) =>
        base64url(invalidNode).slice(
          index * chunkLimit,
          (index + 1) * chunkLimit
        )
    )
    for (const chunks of [
      Array.from(
        { length: Math.ceil(invalidBase64.length / chunkLimit) },
        (_, index) =>
          invalidBase64.slice(index * chunkLimit, (index + 1) * chunkLimit)
      ),
      strictChunks.map((chunk, index) =>
        index === 0 ? `${chunk.slice(0, -1)}!` : chunk
      ),
      invalidStrictChunks
    ]) {
      const attempt = importMarkdown(
        ["前", "", jsonFenceChunks(chunks), "", "后"].join("\n")
      )
      if ("failure" in attempt)
        throw new Error(JSON.stringify(attempt.diagnostics))
      const result = {
        document: attempt.document,
        diagnostics: attempt.diagnostics
      }
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid-hn-fence", line: 3 })
      )
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "input-too-large" })
      )
      expect(JSON.stringify(result.document.data)).toContain("前")
      expect(JSON.stringify(result.document.data)).toContain("后")
      expect(() => encodeHnn(result.document.data)).not.toThrow()
    }
  })

  it("以归一化后的普通内容计算 fallback 预算，避免相邻 text nodes 误判容量外", () => {
    // 每个危险链接在转换时产生可见文字、URL fallback 与分隔文本；未归一化时恰好会使
    // 文档节点数与后续坏 JSON-b64 fallback 叠加后超限，但其规范 HNN 仅有一个 text run。
    const links = Array.from(
      { length: 170 },
      () => "[x](javascript:alert)"
    ).join(" ")
    const result = importMarkdown(
      [links, "", "```hamster-note-json-b64 1/1", "!", "```"].join("\n")
    )
    expect("failure" in result).toBe(false)
    if ("failure" in result) throw new Error(JSON.stringify(result.diagnostics))
    expect(result.document).toBeDefined()
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence", line: 3, column: 1 })
    )
    expect(() => encodeHnn(result.document.data)).not.toThrow()
  })

  it("归一化危险链接文本时不变异 entries，普通段落精确且坏完整 JSON-b64 围栏完整保留", () => {
    // 170 个危险链接会令 Remark 产生大量相邻 text run；若 normalizeTextRuns 原地
    // 改写末项，entries 中的原片段会在最终 import 再次参与合并而重复正文。
    const links = Array.from(
      { length: 170 },
      () => "[x](javascript:alert)"
    ).join(" ")
    const fence = ["```hamster-note-json-b64 1/1", "!", "```"].join("\n")
    const result = imported([links, "", fence].join("\n"))
    const first = content(result)[0]!
    const expected = Array.from(
      { length: 170 },
      () => "x (javascript:alert)"
    ).join(" ")

    expect(first["type"]).toBe("paragraph")
    expect(
      (first["content"] as Array<Record<string, unknown>>)[0]!["text"]
    ).toBe(expected)
    expect(fallbackText(result.document)).toContain(fence)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence", line: 3, column: 1 })
    )
    expect(() => encodeHnn(result.document.data)).not.toThrow()
  })

  it("无法在 512 KiB HNN 完整保留的无效 JSON-b64 分片受控失败，不构建 fallback 文档", () => {
    const chunkLimit = HNN_LIMITS.maxAttrBytes - 256
    const oversized = `${"A".repeat(300_000)}!${"A".repeat(299_999)}`
    const chunks = Array.from(
      { length: Math.ceil(oversized.length / chunkLimit) },
      (_, index) =>
        oversized.slice(index * chunkLimit, (index + 1) * chunkLimit)
    )
    const source = ["前", "", jsonFenceChunks(chunks), "", "后"].join("\n")
    const originalSource = source
    const result = importMarkdown(source)
    if (!("failure" in result))
      throw new Error("expected controlled capacity failure")
    expect(result.failure).toBe("input-too-large")
    expect("document" in result).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence", line: 3 })
    )
    expect(
      result.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === "input-too-large" && diagnostic.line === 3
      )?.message
    ).toContain("完整保留")
    expect(source).toBe(originalSource)
  })

  it("超大 ASCII Markdown 在 TextEncoder 分配前由长度下界拒绝，同时仍精确计算 Unicode", () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode")
    try {
      const result = importMarkdown("x".repeat(50 * 1024 * 1024))
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect(encode).not.toHaveBeenCalled()
    } finally {
      encode.mockRestore()
    }
    const maxMarkdownBytes =
      Math.ceil(HNN_LIMITS.maxShellBytes / 3) * 4 + HNN_LIMITS.maxNodes * 128
    expect(
      importMarkdown("图".repeat(Math.floor(maxMarkdownBytes / 2) + 1))
    ).toMatchObject({ failure: "input-too-large" })
  })

  it("按有序 list/quote 前缀匹配混合容器中的 HN fence closing", () => {
    const fences = [
      ["- > ```math", "  > x^2", "  > ```"],
      ["12. > ```math", "    > x^2", "    > ```"],
      ["> - ```math", ">   x^2", ">   ```"],
      [
        "- > ```callout",
        '  > {"tone":"info","title":"提示"}',
        "  >",
        "  > 正文",
        "  > ```"
      ],
      [
        "> - ```collapsible",
        '>   {"title":"详情","collapsed":false}',
        ">",
        ">   正文",
        ">   ```"
      ]
    ]
    for (const source of fences) {
      const result = imported(source.join("\n"))
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "unterminated-hn-fence" })
      )
    }
  })

  it("无 info 的 fenced code 在预检中跳过正文词法扫描，并按普通代码转换", () => {
    const body = "_[]!`~|".repeat(1_300)
    const result = imported(["```", body, "```"].join("\n"))
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "input-too-large" })
    )
    expect(content(result)[0]!["type"]).toBe("codeBlock")
    expect(fallbackText(result.document)).toBe(body)
  })

  it("超长普通 fenced code 分片时保留全部内容并报告 code-block-split", () => {
    const body = ["a".repeat(5_000), "b".repeat(5_000)].join("\n")
    const result = imported(["```txt", body, "```"].join("\n"))
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "code-block-split", line: 1 })
    )
    expect(fallbackText(result.document)).toBe(body)
    expect(
      content(result).filter((item) => item["type"] === "codeBlock")
    ).toHaveLength(2)
  })

  it("非 JSON-b64 HN fence 的容量外局部 fallback 保留原因与同位置容量诊断", () => {
    const body = Array.from({ length: 66 }, () => "x".repeat(8_000)).join("\n")
    for (const source of [
      ["```hamster-note-future", body, "```"],
      ["```math", body, "```"],
      ["```callout", "not-json", body, "```"],
      ["```math", body]
    ]) {
      const result = importMarkdown(source.join("\n"))
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect("document" in result).toBe(false)
      expect(
        result.diagnostics.some(
          (diagnostic) =>
            [
              "unknown-hn-fence",
              "attr-too-large",
              "invalid-hn-fence",
              "unterminated-hn-fence"
            ].includes(diagnostic.code) && diagnostic.line === 1
        )
      ).toBe(true)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "input-too-large", line: 1 })
      )
    }
  }, 15_000)

  it("在生成 table nodeId 前拒绝超行、超列、超网格与超节点表格", () => {
    const markdownTable = (rows: number, columns: number) =>
      [
        `|${Array.from({ length: columns }, () => "h").join("|")}|`,
        `|${Array.from({ length: columns }, () => "---").join("|")}|`,
        ...Array.from(
          { length: rows - 1 },
          () => `|${Array.from({ length: columns }, () => "x").join("|")}|`
        )
      ].join("\n")
    for (const source of [
      markdownTable(65, 1),
      markdownTable(2, 65),
      markdownTable(16, 16)
    ]) {
      const result = importMarkdown(source)
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect("document" in result).toBe(false)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "input-too-large" })
      )
    }
  })

  it("多层 list continuation 中的 quote HN fence 未闭合时诊断，合法 closing 不误报", () => {
    const prefix = ["- outer", "  - inner", "    > ```math", "    > x"]
    const unclosed = imported(prefix.join("\n"))
    expect(unclosed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unterminated-hn-fence",
        line: 3,
        column: 7
      })
    )
    expect(JSON.stringify(unclosed.document.data)).not.toContain(
      '"type":"formula"'
    )

    const closed = imported([...prefix, "    > ```"].join("\n"))
    expect(closed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence" })
    )
    expect(JSON.stringify(closed.document.data)).toContain('"type":"formula"')
  })

  it("GFM table 的全局 HNN 输出节点预算在 UUID 前以首个超限 link 位置拒绝", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const cell = '[x](https://x "t")'.repeat(254)
      const result = importMarkdown(`|${cell}|\n|---|`)
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect("document" in result).toBe(false)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "input-too-large",
          line: 1,
          column: 4_556
        })
      )
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("普通 code 与未知 HN fence 的累计 fallback 超出 512 KiB 时保留原因并定位第二个围栏", () => {
    const body = "x".repeat(260 * 1024)
    const result = importMarkdown(
      ["```txt", body, "```", "", "```hamster-note-future", body, "```"].join(
        "\n"
      )
    )
    expect(result).toMatchObject({ failure: "input-too-large" })
    expect("document" in result).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unknown-hn-fence", line: 5, column: 1 })
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "input-too-large", line: 5, column: 1 })
    )
  })

  it("多层 list continuation 退出内层后仍以最长外层前缀追踪未闭合 quote fence", () => {
    const source = [
      "100. outer",
      "     - inner",
      "       > ```math",
      "       > x",
      "       > ```",
      "     > ```math",
      "     > y"
    ].join("\n")
    const result = imported(source)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unterminated-hn-fence",
        line: 6,
        column: 8
      })
    )

    const closed = imported([source, "     > ```"].join("\n"))
    expect(closed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 6 })
    )
  })

  it("转换计划以首个超限表格 inline 位置拒绝降级膨胀，且不生成 UUID", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const cell = "[**x**](javascript:alert)".repeat(254)
      const result = importMarkdown(`|${cell}|\n|---|`)
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "input-too-large",
          line: 1,
          column: 6_327
        })
      )
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("全局计划将成功卡片、普通代码与未知 HN fallback 一并计入 shell 预算", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const cards = Array.from({ length: 31 }, () =>
        ["```hamster-note-card", "x".repeat(8_000), "```"].join("\n")
      )
      const source = [
        ...cards,
        "```txt",
        "x".repeat(140_000),
        "```",
        "```hamster-note-future",
        "x".repeat(140_000),
        "```"
      ].join("\n\n")
      const result = importMarkdown(source)
      expect(result).toMatchObject({ failure: "input-too-large" })
      const unknownLine = cards.length * 4 + 7
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "unknown-hn-fence",
          line: unknownLine,
          column: 1
        })
      )
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "input-too-large",
          line: unknownLine,
          column: 1
        })
      )
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("容量失败保留 math 的 attr-too-large 原因与同源位置", () => {
    const body = "x".repeat(260 * 1024)
    const result = importMarkdown(
      ["```txt", body, "```", "", "```math", body, "```"].join("\n")
    )
    expect(result).toMatchObject({ failure: "input-too-large" })
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "attr-too-large", line: 5, column: 1 })
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "input-too-large", line: 5, column: 1 })
    )
  })

  it("active fence 在内层 list 退出后只保留最长外层前缀，并重新诊断外层 HN fence", () => {
    const source = [
      "100. outer",
      "     1. inner",
      "        > ```math",
      "        > x",
      "     > ```math",
      "     > y"
    ].join("\n")
    const unclosed = imported(source)
    expect(unclosed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unterminated-hn-fence",
        line: 5,
        column: 8
      })
    )

    const closed = imported([source, "     > ```"].join("\n"))
    expect(closed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unterminated-hn-fence",
        line: 3,
        column: 11
      })
    )
    expect(closed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 5 })
    )
  })

  it("嵌套 math fallback 容量失败同时保留 attr 原因、实际 source 位置且不生成 UUID", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const body = Array.from({ length: 68 }, () => `    ${"x".repeat(8_000)}`)
      const result = importMarkdown(
        ["- outer", "  - inner", "    ```math", ...body, "    ```"].join("\n")
      )
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "attr-too-large", line: 3, column: 5 })
      )
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "input-too-large", line: 3, column: 5 })
      )
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("JSON-b64 在全局账本拒绝前不调用 ProseMirror codec", () => {
    const nodeFromJSON = vi.spyOn(hnnSchema, "nodeFromJSON")
    try {
      const nextId = ids()
      const payload = {
        type: "blockquote",
        attrs: { nodeId: nextId(), author: null },
        content: Array.from({ length: 63 }, () => ({
          type: "card",
          attrs: { nodeId: nextId(), data: "x".repeat(8_000) }
        }))
      }
      const source = [
        jsonFenceChunks([base64url(JSON.stringify(payload))]),
        "",
        "```txt",
        "x".repeat(20_000),
        "```"
      ].join("\n")
      const result = importMarkdown(source)
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect(nodeFromJSON).not.toHaveBeenCalled()
    } finally {
      nodeFromJSON.mockRestore()
    }
  }, 15_000)

  it("嵌套 strong/link marks 使用独立计划 attrs，并可严格编码", () => {
    for (const markdown of [
      "**a *b* c**",
      "[a **b** c](https://example.test)"
    ]) {
      const result = imported(markdown)
      expect(() => encodeHnn(result.document.data)).not.toThrow()
    }
  })

  it("按 CommonMark visual columns 追踪 tab/list/quote 内的 HN fence", () => {
    const closed = imported(["-\t> ```math", "\t> x", "\t> ````"].join("\n"))
    expect(closed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence" })
    )

    const unclosed = imported([">\t- ```math", ">\t  x"].join("\n"))
    expect(unclosed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 1 })
    )
  })

  it("tab 的 fence closing 始终使用原始行绝对 visual column", () => {
    const closed = imported(["-\t> ```math", "\t> x", "\t>  \t```"].join("\n"))
    expect(closed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence" })
    )

    const unclosed = imported([">\t- ```math", ">\t  x"].join("\n"))
    expect(unclosed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unterminated-hn-fence", line: 1 })
    )
  })

  it("所有嵌套 block 序列均可重组 JSON-b64，并为重复旧 ID 分配不同的新 ID", () => {
    const oldId = ids()()
    const card = base64url(
      JSON.stringify({ type: "card", attrs: { nodeId: oldId, data: "inside" } })
    )
    const fence = ["```hamster-note-json-b64 1/1", card, "```"]
    const nestedCandidate = importMarkdown(
      ["- 项目", "", ...fence.map((line) => `  ${line}`)].join("\n")
    )
    if ("failure" in nestedCandidate)
      throw new Error(JSON.stringify(nestedCandidate.diagnostics))
    const nested = {
      document: nestedCandidate.document,
      diagnostics: nestedCandidate.diagnostics
    }
    const listItem = (
      content(nested)[0]!["content"] as Array<Record<string, unknown>>
    )[0]!["content"] as Array<Record<string, unknown>>
    expect(listItem.some((node) => node["type"] === "card")).toBe(true)

    const repeatedCandidate = importMarkdown(
      [...fence, "", ...fence].join("\n")
    )
    if ("failure" in repeatedCandidate)
      throw new Error(JSON.stringify(repeatedCandidate.diagnostics))
    const repeated = {
      document: repeatedCandidate.document,
      diagnostics: repeatedCandidate.diagnostics
    }
    const nodeIds = content(repeated).map(
      (node) => (node["attrs"] as Record<string, unknown>)["nodeId"]
    )
    expect(nodeIds).toHaveLength(2)
    expect(nodeIds[0]).not.toBe(oldId)
    expect(nodeIds[0]).not.toBe(nodeIds[1])
  })

  it("无效 JSON-b64 listItem 根只局部降级，不把计划错误延迟为 conversion failure", () => {
    const payload = base64url(
      JSON.stringify({
        type: "listItem",
        attrs: { nodeId: ids()() },
        content: [paragraph(ids(), "x")]
      })
    )
    const result = imported(
      ["前", "", "```hamster-note-json-b64 1/1", payload, "```", "", "后"].join(
        "\n"
      )
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-hn-fence", line: 3 })
    )
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "conversion-failed" })
    )
    expect(fallbackText(result.document)).toContain("hamster-note-json-b64")
  })

  it("mark accumulator 去重、按 rank 编码，code/link 排斥时保留可读 URL", () => {
    const emphatic = imported("****x****")
    expect(() => encodeHnn(emphatic.document.data)).not.toThrow()

    const excluded = imported("[`x`](https://example.test)")
    expect(excluded.diagnostics).toContainEqual(
      expect.objectContaining({ code: "excluded-mark-fallback" })
    )
    const serialized = JSON.stringify(excluded.document.data)
    expect(serialized).toContain("https://example.test")
    expect(serialized).toContain('"type":"code"')
    expect(() => encodeHnn(excluded.document.data)).not.toThrow()
  })

  it("5000 行软换行和 15 层 list 都在 UUID 前被统一计划拒绝", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const softLines = importMarkdown(
        Array.from({ length: 5_000 }, () => "x").join("\n")
      )
      expect(softLines).toMatchObject({ failure: "input-too-large" })

      const nestedList = Array.from(
        { length: 15 },
        (_, index) => `${"  ".repeat(index)}- level ${index}`
      ).join("\n")
      const deep = importMarkdown(nestedList)
      expect(deep).toMatchObject({ failure: "input-too-large" })
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("65 个 card 的首次累计外壳越界指向第 261 行的实际节点", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      // 每张卡片加上分隔空行占 4 行；预留空白使第 65 个 opening 恰好在第 261 行。
      const cards = Array.from({ length: 65 }, () =>
        ["```hamster-note-card", "x".repeat(8_000), "```"].join("\n")
      )
      const result = importMarkdown(["前", "", ...cards].join("\n\n"))
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "input-too-large",
          line: 261,
          column: 1
        })
      )
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("blockquote 中容量失败优先定位首次跨限 card，保留后续 unknown fence 诊断且不创建 UUID", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      const cards = Array.from({ length: 66 }, () =>
        ["> ```hamster-note-card", `> ${"x".repeat(8_000)}`, "> ```"].join("\n")
      )
      const result = importMarkdown(
        // quote 内空行令所有围栏成为同一个 blockquote 的 sibling，后续 unknown
        // 诊断才能与第 65 张 card 的账本跨限事件在同一 entry 中竞争位置。
        [...cards, "> ```hamster-note-future", "> unknown", "> ```"].join(
          "\n>\n"
        )
      )
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect("document" in result).toBe(false)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "input-too-large",
          line: 257,
          column: 3
        })
      )
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "unknown-hn-fence",
          line: 265,
          column: 3
        })
      )
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })

  it("表格中首次跨限的 link 定位内容行而不是表格根", () => {
    const randomValues = vi.spyOn(globalThis.crypto, "getRandomValues")
    try {
      // 每个危险链接展开为 bold 文本、italic 文本及可读 URL 三个不同 text run；第
      // 169 个正好令 table 输出节点越过 512，且来源必须是第 3 行而非表格根。
      const links = Array.from(
        { length: 169 },
        () => "[**x** *y*](javascript:alert)"
      ).join("")
      const result = importMarkdown(
        ["| h |", "| --- |", `| ${links} |`].join("\n")
      )
      expect(result).toMatchObject({ failure: "input-too-large" })
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "input-too-large", line: 3 })
      )
      expect(randomValues).not.toHaveBeenCalled()
    } finally {
      randomValues.mockRestore()
    }
  })
})
