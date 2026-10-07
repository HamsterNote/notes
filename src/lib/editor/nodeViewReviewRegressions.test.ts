// @vitest-environment jsdom
//
// PR11 review 回归：NodeView 容器纯文本复制、label attr 预检、控件提交的后序历史栅栏。
// 只经由真实 EditorSession（与生产同一条装配/复制/历史路径），不依赖组件层。

import { fireEvent } from "@testing-library/dom"
import { describe, expect, it } from "vitest"
import { encodeHnn, type HnnDocument } from "../hnn/codec"
import { HNN_LIMITS } from "../hnn/limits"
import { createEditorSession } from "./session"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003",
  "123e4567-e89b-42d3-a456-426614174004",
  "123e4567-e89b-42d3-a456-426614174005",
  "123e4567-e89b-42d3-a456-426614174006"
]

/** 单个 codeBlock 文档：filename 起始为 a.ts，正文 text 为 body。 */
function codeDocument(filename = "a.ts", text = "body"): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{ type: "codeBlock", attrs: { nodeId: ids[0], language: "typescript", filename }, content: [{ type: "text", text }] }]
    }
  }
}

/** blockquote 文档：署名起始为空，正文 text 为引用全文。 */
function quoteDocument(): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{
        type: "blockquote",
        attrs: { nodeId: ids[0], author: null },
        content: [{ type: "paragraph", attrs: { nodeId: ids[1] }, content: [{ type: "text", text: "引用全文" }] }]
      }]
    }
  }
}

/** 容器复制回归文档：callout/collapsible 带标题与正文，blockquote 带 atom 子节点。 */
function containerDocument(): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
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
          content: [{
            type: "paragraph",
            attrs: { nodeId: ids[6] },
            content: [
              { type: "text", text: "引用" },
              { type: "inlineFormula", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174007", latex: "y^2" } }
            ]
          }]
        }
      ]
    }
  }
}

type Session = ReturnType<typeof createEditorSession>

/** 走真实 clipboard text/plain 路径：调用 editor 装配的 clipboardTextSerializer（含选区）。 */
function clipboardPlainText(session: Session): string {
  const { editor } = session
  const text = editor.view.someProp("clipboardTextSerializer", (serializer) =>
    serializer(editor.state.selection.content(), editor.view)
  )
  return typeof text === "string" ? text : ""
}

/** 取第一个文本节点的位置，用于模拟“紧随提交之后的同 tick 输入”。 */
function firstTextPos(session: Session): number {
  let pos = -1
  session.editor.state.doc.descendants((node, nodePos) => {
    if (pos >= 0) return false
    if (node.isText) {
      pos = nodePos
      return false
    }
    return true
  })
  if (pos < 0) throw new Error("文档中没有文本节点")
  return pos
}

/** 取首个指定类型节点的 attrs。 */
function attrsOf(session: Session, type: string): Record<string, unknown> | undefined {
  let attrs: Record<string, unknown> | undefined
  session.editor.state.doc.descendants((node) => {
    if (attrs === undefined && node.type.name === type) attrs = node.attrs
    return attrs === undefined
  })
  return attrs
}

/** 直接读取 NodeView 内错误提示文本。 */
function errorText(session: Session, selector: string): string {
  return session.editor.view.dom.querySelector(selector)?.textContent ?? ""
}

describe("PR11 NodeView 回归", () => {
  describe("#6 容器 renderText 复制纯文本", () => {
    it("EditorSession clipboard text/plain 输出 callout/collapsible 标题 + 正文，且保留 atom 子序列化", () => {
      const session = createEditorSession({ documentId: "C6", loadKey: "c6", initialDocument: containerDocument() })
      try {
        expect(session.editor.commands.selectAll()).toBe(true)
        const text = clipboardPlainText(session)
        // 标题与正文都在：证明容器 renderText 不再 return false 吞掉子遍历。
        expect(text).toContain("提示标题")
        expect(text).toContain("正文内容")
        expect(text).toContain("折叠标题")
        expect(text).toContain("折叠正文")
        expect(text).toContain("引用")
        // atom 子节点的 toText（inlineFormula → latex）仍被复用，而不是退化成空 textContent。
        expect(text).toContain("x^2")
        expect(text).toContain("y^2")
        // editor.getText() 与剪贴板同源，必须一致。
        expect(session.editor.getText()).toBe(text)
      } finally {
        session.destroy()
      }
    })

    it("部分选区从容器内部开始时，未选中的标题不并入纯文本", () => {
      const session = createEditorSession({ documentId: "C6b", loadKey: "c6b", initialDocument: containerDocument() })
      try {
        // callout 起点 pos=0，正文第一个文本在 pos=2；从正文开头开始选到文档末尾。
        const doc = session.editor.state.doc
        const from = 2
        const to = doc.content.size
        expect(session.editor.commands.setTextSelection({ from, to })).toBe(true)
        const text = clipboardPlainText(session)
        expect(text).not.toContain("提示标题")
        expect(text).toContain("正文内容")
      } finally {
        session.destroy()
      }
    })
  })

  describe("#7 filename/author label 512 UTF-8 预检", () => {
    it("codeBlock filename 512 字节可提交，513 字节零事务并恢复输入与合法 PM 状态", () => {
      const session = createEditorSession({ documentId: "C7", loadKey: "c7", initialDocument: codeDocument() })
      try {
        const input = session.editor.view.dom.querySelector<HTMLInputElement>(".hn-editor-code-filename")
        if (!input) throw new Error("codeBlock filename 输入框未渲染")

        const okAscii = "a".repeat(HNN_LIMITS.maxLabelBytes)
        fireEvent.change(input, { target: { value: okAscii } })
        expect(attrsOf(session, "codeBlock")?.["filename"]).toBe(okAscii)
        expect(input.value).toBe(okAscii)
        expect(errorText(session, ".hn-editor-field-error")).toBe("")

        const tooLongAscii = "a".repeat(HNN_LIMITS.maxLabelBytes + 1)
        fireEvent.change(input, { target: { value: tooLongAscii } })
        // 零事务：持久 attr 保持上一次合法值，输入回滚，错误可访问呈现。
        expect(attrsOf(session, "codeBlock")?.["filename"]).toBe(okAscii)
        expect(input.value).toBe(okAscii)
        expect(errorText(session, ".hn-editor-field-error")).toContain("超出长度上限")
        // 文档仍可严格编码（未进入非法状态）。
        expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
      } finally {
        session.destroy()
      }
    })

    it("codeBlock filename 多字节边界：510+2 字节可提交，171 个中文字（513 字节）被拒", () => {
      const session = createEditorSession({ documentId: "C7b", loadKey: "c7b", initialDocument: codeDocument() })
      try {
        const input = session.editor.view.dom.querySelector<HTMLInputElement>(".hn-editor-code-filename")
        if (!input) throw new Error("codeBlock filename 输入框未渲染")

        const boundary = `${"中".repeat(170)}aa` // 3 * 170 + 2 = 512 字节
        fireEvent.change(input, { target: { value: boundary } })
        expect(attrsOf(session, "codeBlock")?.["filename"]).toBe(boundary)

        const overBoundary = "中".repeat(171) // 513 字节
        fireEvent.change(input, { target: { value: overBoundary } })
        expect(attrsOf(session, "codeBlock")?.["filename"]).toBe(boundary)
        expect(input.value).toBe(boundary)
        expect(errorText(session, ".hn-editor-field-error")).toContain("超出长度上限")
      } finally {
        session.destroy()
      }
    })

    it("blockquote author 512 字节可提交，513 字节零事务并恢复输入；空输入仍归一为 null", () => {
      const session = createEditorSession({ documentId: "C7c", loadKey: "c7c", initialDocument: quoteDocument() })
      try {
        const input = session.editor.view.dom.querySelector<HTMLInputElement>(".hn-editor-quote-author")
        if (!input) throw new Error("blockquote author 输入框未渲染")

        const ok = "作".repeat(170) + "aa" // 512 字节
        fireEvent.change(input, { target: { value: ok } })
        expect(attrsOf(session, "blockquote")?.["author"]).toBe(ok)

        const tooLong = "作".repeat(171) // 513 字节
        fireEvent.change(input, { target: { value: tooLong } })
        expect(attrsOf(session, "blockquote")?.["author"]).toBe(ok)
        expect(input.value).toBe(ok)
        expect(errorText(session, ".hn-editor-field-error")).toContain("超出长度上限")

        // 空输入是合法归一：author 变为 null，不产生错误。
        fireEvent.change(input, { target: { value: "   " } })
        expect(attrsOf(session, "blockquote")?.["author"]).toBeNull()
        expect(errorText(session, ".hn-editor-field-error")).toBe("")
      } finally {
        session.destroy()
      }
    })
  })

  describe("#8 commitNodeAttrs 后序历史栅栏", () => {
    it("filename a.ts→b.ts 后紧邻输入 X：一次 undo 只撤 X，再一次 undo 撤 filename", () => {
      const session = createEditorSession({ documentId: "C8", loadKey: "c8", initialDocument: codeDocument() })
      try {
        const input = session.editor.view.dom.querySelector<HTMLInputElement>(".hn-editor-code-filename")
        if (!input) throw new Error("codeBlock filename 输入框未渲染")

        fireEvent.change(input, { target: { value: "b.ts" } })
        expect(attrsOf(session, "codeBlock")?.["filename"]).toBe("b.ts")

        // 紧邻同 tick 输入：必须另起一个 undo step。
        const pos = firstTextPos(session)
        session.editor.view.dispatch(session.editor.state.tr.insertText("X", pos))
        expect(session.editor.state.doc.textContent).toContain("X")

        expect(session.undo()).toBe(true)
        // 第一步只撤正文输入，filename 保持 b.ts。
        expect(session.editor.state.doc.textContent).not.toContain("X")
        expect(attrsOf(session, "codeBlock")?.["filename"]).toBe("b.ts")

        expect(session.undo()).toBe(true)
        // 第二步才撤 filename 提交，回到 a.ts。
        expect(attrsOf(session, "codeBlock")?.["filename"]).toBe("a.ts")
      } finally {
        session.destroy()
      }
    })

    it("其他 NodeView attrs 同样隔离：callout 标题提交后紧邻输入，一次 undo 只撤正文", () => {
      const doc: HnnDocument = {
        schemaVersion: 1,
        data: {
          type: "doc",
          content: [{
            type: "callout",
            attrs: { nodeId: ids[0], tone: "info", title: "旧标题" },
            content: [{ type: "paragraph", attrs: { nodeId: ids[1] }, content: [{ type: "text", text: "正文" }] }]
          }]
        }
      }
      const session = createEditorSession({ documentId: "C8b", loadKey: "c8b", initialDocument: doc })
      try {
        const input = session.editor.view.dom.querySelector<HTMLInputElement>(".hn-editor-callout-title")
        if (!input) throw new Error("callout 标题输入框未渲染")

        fireEvent.change(input, { target: { value: "新标题" } })
        expect(attrsOf(session, "callout")?.["title"]).toBe("新标题")

        const pos = firstTextPos(session)
        session.editor.view.dispatch(session.editor.state.tr.insertText("X", pos))
        expect(session.editor.state.doc.textContent).toContain("X")

        expect(session.undo()).toBe(true)
        expect(session.editor.state.doc.textContent).not.toContain("X")
        expect(attrsOf(session, "callout")?.["title"]).toBe("新标题")

        expect(session.undo()).toBe(true)
        expect(attrsOf(session, "callout")?.["title"]).toBe("旧标题")
      } finally {
        session.destroy()
      }
    })
  })
})
