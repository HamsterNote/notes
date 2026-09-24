import { describe, expect, it, vi } from "vitest"
import { Editor } from "@tiptap/core"
import { decodeHnn, encodeHnn } from "./codec"
import { createHnnExtensions, HNN_MARK_TYPES, HNN_NODE_TYPES, hnnRuntimeSchema } from "./extensions"
import { HNN_NODE_ID_TYPES } from "./nodeId"
import { isSafeHnnUrl } from "./urlPolicy"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003",
  "123e4567-e89b-42d3-a456-426614174004",
  "123e4567-e89b-42d3-a456-426614174005",
  "123e4567-e89b-42d3-a456-426614174006"
]

describe("封闭 HNN extensions", () => {
  it("只从无宿主输入的 extension 集合构造唯一 runtime schema", () => {
    expect(createHnnExtensions).toHaveLength(0)
    expect([...HNN_NODE_TYPES].sort()).toEqual([
      "blockquote", "bulletList", "callout", "card", "codeBlock", "collapsible", "directory", "doc", "drawing", "externalItem", "formula", "hardBreak", "heading", "horizontalRule", "inlineFormula", "listItem", "mention", "orderedList", "paragraph", "picture", "resource", "table", "tableCell", "tableHeader", "tableRow", "taskItem", "taskList", "text"
    ])
    expect([...HNN_MARK_TYPES].sort()).toEqual(["bold", "code", "italic", "link", "strike"])
    expect(Object.keys(hnnRuntimeSchema.marks["link"]?.spec.attrs ?? {})).toEqual(["href"])
    expect([...HNN_NODE_ID_TYPES].sort()).toEqual([...HNN_NODE_TYPES].filter((name) => name !== "doc" && name !== "text").sort())
  })

  it("将标准复杂 attrs 与 custom attrs 以 runtime schema 的规范 JSON 往返", () => {
    const data = {
      type: "doc",
      content: [
        { type: "heading", attrs: { nodeId: ids[0], level: 6 }, content: [{ type: "text", text: "Heading", marks: [{ type: "bold" }, { type: "italic" }, { type: "strike" }] }] },
        { type: "paragraph", attrs: { nodeId: ids[1] }, content: [{ type: "text", text: "Link", marks: [{ type: "link", attrs: { href: "hnmagic://note/42" } }] }, { type: "hardBreak", attrs: { nodeId: ids[2] } }, { type: "inlineFormula", attrs: { nodeId: ids[3], latex: "x^2" } }] },
        { type: "orderedList", attrs: { nodeId: ids[4], start: 3, type: "I" }, content: [{ type: "listItem", attrs: { nodeId: ids[5] }, content: [{ type: "paragraph", attrs: { nodeId: ids[6] }, content: [{ type: "text", text: "third" }] }] }] }
      ]
    }

    expect(encodeHnn(decodeHnn({ schemaVersion: 1, data }))).toEqual({ schemaVersion: 1, data })
  })

  it("保持表格单元格的 colspan、rowspan、colwidth 和 align", () => {
    const table = hnnRuntimeSchema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "table",
        attrs: { nodeId: ids[0] },
        content: [{
          type: "tableRow",
          attrs: { nodeId: ids[1] },
          content: [{
            type: "tableCell",
            attrs: { nodeId: ids[2], colspan: 2, rowspan: 3, colwidth: [80, 90], align: "right" },
            content: [{ type: "paragraph", attrs: { nodeId: ids[3] }, content: [{ type: "text", text: "wide" }] }]
          }]
        }]
      }]
    })

    expect(table.toJSON()).toMatchObject({
      content: [{ content: [{ content: [{ attrs: { colspan: 2, rowspan: 3, colwidth: [80, 90], align: "right" } }] }] }]
    })
  })

  it("将 URL 安全策略同时用于 codec 与 Link extension", () => {
    expect(isSafeHnnUrl("https://example.test/path")).toBe(true)
    expect(isSafeHnnUrl("mailto:notes@example.test")).toBe(true)
    expect(isSafeHnnUrl("hnmagic://note/42")).toBe(true)
    for (const unsafe of [" javascript:alert(1)", "data:text/html,x", "https://example.test/\u200bx", "https://example.test/\ud800", "https://example.test/x "]) {
      expect(isSafeHnnUrl(unsafe), unsafe).toBe(false)
    }

    const unsafe = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: ids[0] }, content: [{ type: "text", text: "unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }]
    }
    expect(() => encodeHnn(unsafe)).toThrow(/URL/u)

    const editor = new Editor({
      extensions: createHnnExtensions(),
      content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: ids[0] }, content: [{ type: "text", text: "text" }] }] }
    })
    try {
      expect(editor.commands.setLink({ href: "javascript:alert(1)" })).toBe(false)
    } finally {
      editor.destroy()
    }
  })

  it("初始 Editor 文档立即获得 nodeId，且标记 inline atom 会被清理后可编码", () => {
    const editor = new Editor({
      extensions: createHnnExtensions(),
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "inlineFormula", attrs: { latex: "x" }, marks: [{ type: "bold" }] }] }] }
    })
    try {
      let atom: import("@tiptap/pm/model").Node | undefined
      editor.state.doc.descendants((node) => {
        if (node.type.name === "inlineFormula") atom = node
      })
      expect(atom?.attrs["nodeId"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(atom?.marks).toHaveLength(0)
      expect(() => encodeHnn(editor.state.doc)).not.toThrow()
    } finally {
      editor.destroy()
    }
  })

  it("接收 decodeHnn 返回的同实例 PM Node，保留内容且不产生初始化历史", () => {
    const hnn = {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "blockquote",
          attrs: { nodeId: ids[0], author: "Ada" },
          content: [{ type: "paragraph", attrs: { nodeId: ids[1] }, content: [{ type: "text", text: "decoded content" }] }]
        }]
      }
    }
    // Tiptap 类型只声明 JSONContent，但运行时也支持同实例的 ProseMirror Node。
    const onTransaction = vi.fn()
    const editor = new Editor({
      extensions: createHnnExtensions(),
      content: decodeHnn(hnn) as unknown as Record<string, unknown>,
      onTransaction
    })
    try {
      expect(editor.getText()).toContain("decoded content")
      expect(editor.getJSON()).toEqual(hnn.data)
      expect(() => encodeHnn(editor.state.doc)).not.toThrow()
      expect(onTransaction).not.toHaveBeenCalled()
    } finally {
      editor.destroy()
    }
  })
})
