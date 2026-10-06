// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { Editor } from "@tiptap/core"
import { decodeHnn, encodeHnn } from "./codec"
import { HNN_CARD_EMPTY_DATA, parseCardPayload, serializeCardPayload } from "./cardPayload"
import { HNN_DRAWING_EMPTY_DATA, parseDrawingPayload, serializeDrawingPayload } from "./drawingPayload"
import { createHnnEditorExtensions, createHnnExtensions, HNN_MARK_TYPES, HNN_NODE_TYPES, hnnRuntimeSchema, parseHnnClipboardNode } from "./extensions"
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
    expect(createHnnEditorExtensions).toHaveLength(0)
    expect([...HNN_NODE_TYPES].sort()).toEqual([
      "blockquote", "bulletList", "callout", "card", "codeBlock", "collapsible", "directory", "doc", "drawing", "externalItem", "formula", "hardBreak", "heading", "horizontalRule", "inlineFormula", "listItem", "mention", "orderedList", "paragraph", "picture", "resource", "table", "tableCell", "tableHeader", "tableRow", "taskItem", "taskList", "text"
    ])
    expect([...HNN_MARK_TYPES].sort()).toEqual(["bold", "code", "italic", "link", "strike"])
    expect(Object.keys(hnnRuntimeSchema.marks["link"]?.spec.attrs ?? {})).toEqual(["href"])
    expect([...HNN_NODE_ID_TYPES].sort()).toEqual([...HNN_NODE_TYPES].filter((name) => name !== "doc" && name !== "text").sort())
  })

  it("编辑会话仅通过封闭 StarterKit 启用 UndoRedo，codec schema 不携带 history", () => {
    const codecEditor = new Editor({ extensions: createHnnExtensions() })
    const sessionEditor = new Editor({ extensions: createHnnEditorExtensions() })
    try {
      expect(codecEditor.extensionManager.extensions.map((extension) => extension.name)).not.toContain("undoRedo")
      expect(sessionEditor.extensionManager.extensions.map((extension) => extension.name)).toContain("undoRedo")
      expect(sessionEditor.extensionManager.extensions.map((extension) => extension.name)).not.toContain("hnnHistory")
      expect(sessionEditor.extensionManager.extensions.map((extension) => extension.name)).not.toContain("hnnUndoRedoBeforeInput")
    } finally {
      codecEditor.destroy()
      sessionEditor.destroy()
    }
  })

  it("custom clipboard 声明拒绝未知 marker、tag/attrs 越权与非法 payload", () => {
    const parse = (html: string) => parseHnnClipboardNode(new DOMParser().parseFromString(html, "text/html").body.firstElementChild as HTMLElement)
    expect(parse('<div data-hnn-node="formula" latex="x^2"></div>')).toMatchObject({ name: "formula", attrs: { latex: "x^2" } })
    expect(parse('<div data-hnn-node="unknown"></div>')).toBeNull()
    expect(parse('<span data-hnn-node="formula" latex="x"></span>')).toBeNull()
    expect(parse('<div data-hnn-node="formula" latex="x" onclick="alert(1)"></div>')).toBeNull()
    expect(parse('<div data-hnn-node="callout" tone="danger" title="bad"></div>')).toBeNull()
    expect(parse('<div data-hnn-node="card" data="{}"></div>')).toBeNull()
    expect(parse('<div data-hnn-node="drawing" data="{}"></div>')).toBeNull()
    expect(parse('<figure data-hnn-node="picture" src="javascript:alert(1)" alt="unsafe"></figure>')).toBeNull()
  })

  it("marker-aware addAttributes 保留严格 validator 的字符串 attrs，外部 pre 忽略伪造 attrs", () => {
    const editor = new Editor({ extensions: createHnnExtensions() })
    try {
      editor.commands.setContent('<div data-hnn-node="formula" latex="0"></div>')
      expect(editor.state.doc.firstChild?.attrs["latex"]).toBe("0")

      editor.commands.setContent('<div data-hnn-node="callout" tone="info" title="0"><p>x</p></div>')
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ tone: "info", title: "0" })

      editor.commands.setContent('<div data-hnn-node="collapsible" title="0" collapsed="true"><p>x</p></div>')
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ title: "0", collapsed: true })

      editor.commands.setContent('<figure data-hnn-node="picture" src="https://example.test/p.png" alt="0"></figure>')
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ src: "https://example.test/p.png", alt: "0" })

      editor.commands.setContent('<div data-hnn-node="directory" config="true"></div>')
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ config: "true" })

      editor.commands.setContent('<pre language="true" filename="0"><code>  preserved\n  text</code></pre>')
      expect(editor.state.doc.firstChild).toMatchObject({ attrs: { language: "plaintext", filename: "untitled" } })
      expect(editor.state.doc.firstChild?.textContent).toBe("  preserved\n  text")

      editor.commands.setContent('<p><span data-hnn-node="mention" resourceid="0" name="true"></span></p>')
      expect(editor.state.doc.firstChild?.firstChild?.attrs).toMatchObject({ resourceId: "0", name: "true" })

      editor.commands.setContent('<div data-hnn-node="externalItem" resourceid="0" name="true"></div>')
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ resourceId: "0", name: "true" })
    } finally {
      editor.destroy()
    }
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

  it("新建 card/drawing attrs 使用 payload canonical 空 data，且可严格编码", () => {
    const card = hnnRuntimeSchema.nodes["card"]?.create()
    const drawing = hnnRuntimeSchema.nodes["drawing"]?.create()
    const cardData: unknown = card?.attrs["data"]
    const drawingData: unknown = drawing?.attrs["data"]
    expect(cardData).toBe(HNN_CARD_EMPTY_DATA)
    expect(drawingData).toBe(HNN_DRAWING_EMPTY_DATA)
    expect(parseCardPayload(HNN_CARD_EMPTY_DATA)).toMatchObject({ ok: true })
    expect(parseDrawingPayload(HNN_DRAWING_EMPTY_DATA)).toMatchObject({ ok: true })
    expect(serializeCardPayload(JSON.parse(HNN_CARD_EMPTY_DATA) as unknown)).toEqual({ ok: true, value: HNN_CARD_EMPTY_DATA })
    expect(serializeDrawingPayload(JSON.parse(HNN_DRAWING_EMPTY_DATA) as unknown)).toEqual({ ok: true, value: HNN_DRAWING_EMPTY_DATA })

    const data = {
      type: "doc",
      content: [
        { type: "card", attrs: { nodeId: ids[0], data: cardData } },
        { type: "drawing", attrs: { nodeId: ids[1], data: drawingData } }
      ]
    }
    expect(encodeHnn(decodeHnn({ schemaVersion: 1, data }))).toEqual({ schemaVersion: 1, data })
  })

  it("容器 renderText 递归子内容：纯文本含 callout/collapsible 标题与正文，并保留 atom 子序列化", () => {
    const editor = new Editor({
      extensions: createHnnExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "callout",
            attrs: { nodeId: ids[0], tone: "info", title: "提示标题" },
            content: [{
              type: "paragraph",
              attrs: { nodeId: ids[1] },
              content: [
                { type: "text", text: "正文内容" },
                { type: "inlineFormula", attrs: { nodeId: ids[2], latex: "x^2" } }
              ]
            }]
          },
          {
            type: "collapsible",
            attrs: { nodeId: ids[3], title: "折叠标题", collapsed: false },
            content: [{ type: "paragraph", attrs: { nodeId: ids[4] }, content: [{ type: "text", text: "折叠正文" }] }]
          },
          {
            type: "blockquote",
            attrs: { nodeId: ids[5], author: null },
            content: [{ type: "paragraph", attrs: { nodeId: ids[6] }, content: [{ type: "text", text: "引用全文" }] }]
          }
        ]
      }
    })
    try {
      const text = editor.getText()
      // 修复前容器 renderText 命中 textSerializer 后 return false，正文与 atom 子序列化会被吞掉。
      expect(text).toContain("提示标题")
      expect(text).toContain("正文内容")
      expect(text).toContain("x^2")
      expect(text).toContain("折叠标题")
      expect(text).toContain("折叠正文")
      expect(text).toContain("引用全文")
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
