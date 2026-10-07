// @vitest-environment jsdom

/**
 * budgetedTransaction（内部助手）回归：
 * - 未注入严格编码器时 fail-closed：任何正常候选也返回 null、零 dispatch；
 * - 注入真实 encodeHnn 后：补齐合法唯一 nodeId、原合法 ID 保留；合法候选通过；
 *   非法 attrs / 非首子分支深度 / 表格布局 / 节点数 / 512KiB 外壳均被 encodeHnn 拒绝；
 * - captureChainTransaction：命令链 run() 返回 false（即使 tr 已被部分写入）一律 null，
 *   零 dispatch；commit 对 no-op/超预算候选零 dispatch。
 *
 * 本文件不使用任何伪弱编码器：严格行为全部由真实 encodeHnn 驱动。
 */

import { Editor } from "@tiptap/core"
import { EditorState } from "@tiptap/pm/state"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  captureChainTransaction,
  commitBudgetedTransaction,
  installHnnBudgetEncoder,
  normalizeBudgetedCandidate
} from "./budgetedTransaction"
import { encodeHnn } from "./codec"
import { createHnnEditorExtensions } from "./extensions"
import { HNN_LIMITS, UUID_V4_PATTERN } from "./limits"
import { hnnSchema } from "./schema"

const knownId = "123e4567-e89b-42d3-a456-426614174000"

const editors: Editor[] = []

function editorFor(data: Record<string, unknown>): Editor {
  const editor = new Editor({ extensions: createHnnEditorExtensions(), content: data })
  editors.push(editor)
  return editor
}

function trFor(document: Record<string, unknown>) {
  const doc = hnnSchema.nodeFromJSON(document)
  return EditorState.create({ doc, schema: hnnSchema }).tr
}

function paragraphDocument(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", attrs: { nodeId: knownId }, content: [{ type: "text", text }] }]
  }
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

// 未注入编码器的 describe 必须最先声明（vitest 按声明顺序执行），早于下方 beforeAll 注入。
describe("未注入 encoder：fail-closed", () => {
  it("normalizeBudgetedCandidate 对正常合法候选也返回 null", () => {
    const tr = trFor(paragraphDocument("hi"))
    expect(normalizeBudgetedCandidate(hnnSchema, tr)).toBeNull()
  })

  it("commitBudgetedTransaction 对正常合法候选返回 false 且零 dispatch、doc 不变", () => {
    const editor = editorFor(paragraphDocument("a"))
    const dispatch = vi.spyOn(editor.view, "dispatch")
    const tr = editor.state.tr.insertText("X", 1)
    expect(commitBudgetedTransaction(editor, tr)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    expect(editor.state.doc.textContent).toBe("a")
  })
})

describe("注入严格 encodeHnn 后", () => {
  beforeAll(() => {
    installHnnBudgetEncoder(encodeHnn)
  })

  it("为缺失 nodeId 的新节点补齐合法唯一 ID，原合法 ID 原样保留，合法候选通过", () => {
    const tr = trFor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: knownId }, content: [{ type: "text", text: "keep" }] },
        { type: "paragraph", content: [{ type: "text", text: "new" }] },
        { type: "formula", attrs: { latex: "x" } }
      ]
    })
    const result = normalizeBudgetedCandidate(hnnSchema, tr)
    expect(result).not.toBeNull()
    const ids: string[] = []
    result!.doc.forEach((child) => {
      const nodeId = child.attrs["nodeId"] as string
      ids.push(nodeId)
      expect(UUID_V4_PATTERN.test(nodeId)).toBe(true)
    })
    expect(ids[0]).toBe(knownId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("非法 attrs（card data 超 maxAttrBytes）被 encodeHnn 拒绝", () => {
    const tr = trFor({
      type: "doc",
      content: [{ type: "card", attrs: { data: "x".repeat(HNN_LIMITS.maxAttrBytes + 1) } }]
    })
    expect(normalizeBudgetedCandidate(hnnSchema, tr)).toBeNull()
  })

  it("深度超限且位于非首子分支的文档被 encodeHnn 拒绝", () => {
    let deep: Record<string, unknown> = {
      type: "paragraph",
      attrs: { nodeId: knownId },
      content: [{ type: "text", text: "deep" }]
    }
    // 40 层 blockquote 嵌套挂在第二个顶层子节点（首子链只有 doc→paragraph）。
    for (let index = 0; index < 40; index += 1) {
      deep = { type: "blockquote", attrs: { author: null, nodeId: knownId }, content: [deep] }
    }
    const tr = trFor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: knownId }, content: [{ type: "text", text: "shallow" }] },
        deep
      ]
    })
    expect(normalizeBudgetedCandidate(hnnSchema, tr)).toBeNull()
  })

  it("表格布局超列（65 列 > maxColumns）被 encodeHnn 拒绝", () => {
    const cells = Array.from({ length: 65 }, () => ({
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
      content: [{ type: "paragraph" }]
    }))
    const tr = trFor({
      type: "doc",
      content: [{ type: "table", content: [{ type: "tableRow", content: cells }] }]
    })
    expect(normalizeBudgetedCandidate(hnnSchema, tr)).toBeNull()
  })

  it("最终候选超过节点总数上限时返回 null", () => {
    const content = Array.from({ length: 513 }, () => ({
      type: "paragraph",
      content: [{ type: "text", text: "x" }]
    }))
    expect(normalizeBudgetedCandidate(hnnSchema, trFor({ type: "doc", content }))).toBeNull()
  })

  it("最终候选超过 512 KiB 外壳上限时返回 null", () => {
    // 单文本节点受 maxAttrBytes(8192) 限制，因此用多个大文本段落累积越过 512 KiB。
    const content = Array.from({ length: 66 }, () => ({
      type: "paragraph",
      content: [{ type: "text", text: "x".repeat(8000) }]
    }))
    expect(normalizeBudgetedCandidate(hnnSchema, trFor({ type: "doc", content }))).toBeNull()
  })

  it("captureChainTransaction：run() 返回 false 时即使 tr 已被部分写入也返回 null、零 dispatch", () => {
    const editor = editorFor(paragraphDocument("a"))
    const dispatch = vi.spyOn(editor.view, "dispatch")
    const captured = captureChainTransaction(editor, (chain) =>
      chain.command(({ tr }) => {
        // 部分写入后失败：绝不能因这段写入恰好可编码就提交。
        tr.insertText("X", 1)
        return false
      })
    )
    expect(captured).toBeNull()
    expect(dispatch).not.toHaveBeenCalled()
    expect(editor.state.doc.textContent).toBe("a")
  })

  it("commitBudgetedTransaction：no-op 候选零 dispatch，doc/历史不变", () => {
    const editor = editorFor(paragraphDocument("a"))
    const dispatch = vi.spyOn(editor.view, "dispatch")
    expect(commitBudgetedTransaction(editor, editor.state.tr)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("commitBudgetedTransaction：超预算候选零 dispatch、回 false、doc 不变", () => {
    const editor = editorFor(paragraphDocument("a"))
    const dispatch = vi.spyOn(editor.view, "dispatch")
    const tr = editor.state.tr.insertText("x".repeat(HNN_LIMITS.maxAttrBytes + 16), 1)
    expect(commitBudgetedTransaction(editor, tr)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    expect(editor.state.doc.textContent).toBe("a")
  })
})
