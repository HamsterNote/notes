import { describe, expect, it, vi } from "vitest"
import { EditorState, TextSelection } from "@tiptap/pm/state"
import { Slice } from "@tiptap/pm/model"
import { hnnRuntimeSchema } from "./extensions"
import { createHnnNodeId, createHnnNodeIdPlugin, rewritePastedHnnNodeIds } from "./nodeId"

const originalId = "123e4567-e89b-42d3-a456-426614174000"

function paragraph(nodeId: string | null) {
  return hnnRuntimeSchema.nodes["paragraph"]!.create({ nodeId }, hnnRuntimeSchema.text("text"))
}

function documentWith(...nodes: ReturnType<typeof paragraph>[]) {
  return hnnRuntimeSchema.nodes["doc"]!.create(null, nodes)
}

function persistentIds(document: ReturnType<typeof documentWith>): string[] {
  const ids: string[] = []
  document.descendants((node) => {
    if (typeof node.attrs["nodeId"] === "string") ids.push(node.attrs["nodeId"])
  })
  return ids
}

describe("HNN nodeId", () => {
  it("生成小写 UUID v4，且 appendTransaction 一次性修复缺失、非法和重复值，不进入历史", () => {
    expect(createHnnNodeId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

    const state = EditorState.create({
      schema: hnnRuntimeSchema,
      doc: documentWith(paragraph(null), paragraph("invalid"), paragraph(originalId), paragraph(originalId)),
      plugins: [createHnnNodeIdPlugin()]
    })
    const repair = state.applyTransaction(state.tr)
    const ids = persistentIds(repair.state.doc)

    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    expect(ids.every((nodeId) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nodeId))).toBe(true)
    expect(repair.transactions).toHaveLength(2)
    expect(repair.transactions[1]?.getMeta("addToHistory")).toBe(false)
  })

  it("为粘贴 slice 的每个持久节点重建不同的 UUID，且不会与目标文档冲突", () => {
    const source = documentWith(paragraph(originalId), paragraph(originalId))
    const slice = source.slice(0, source.content.size)
    const rewritten = rewritePastedHnnNodeIds(slice)
    const ids: string[] = []
    rewritten.content.descendants((node) => {
      if (typeof node.attrs["nodeId"] === "string") ids.push(node.attrs["nodeId"])
    })

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain(originalId)

    const state = EditorState.create({
      schema: hnnRuntimeSchema,
      doc: documentWith(paragraph(originalId)),
      plugins: [createHnnNodeIdPlugin()]
    })
    const result = state.applyTransaction(state.tr.setSelection(TextSelection.atEnd(state.doc)).replaceSelection(rewritten))
    const documentIds = persistentIds(result.state.doc)
    expect(new Set(documentIds).size).toBe(documentIds.length)
    expect(documentIds).toContain(originalId)
  })

  it("粘贴时清理 inline atom marks，但保留 text marks", () => {
    const bold = hnnRuntimeSchema.marks["bold"]!.create()
    const hardBreak = hnnRuntimeSchema.nodes["hardBreak"]!.create({ nodeId: originalId }, null, [bold])
    const inlineFormula = hnnRuntimeSchema.nodes["inlineFormula"]!.create({ nodeId: originalId, latex: "x" }, null, [bold])
    const mention = hnnRuntimeSchema.nodes["mention"]!.create({ nodeId: originalId, resourceId: "ada", name: "Ada" }, null, [bold])
    const markedText = hnnRuntimeSchema.text("bold", [bold])
    const source = documentWith(hnnRuntimeSchema.nodes["paragraph"]!.create({ nodeId: originalId }, [hardBreak, inlineFormula, mention, markedText]))
    const rewritten = rewritePastedHnnNodeIds(new Slice(source.content, 0, 0))
    const paragraphNode = rewritten.content.firstChild!

    expect([0, 1, 2].map((index) => paragraphNode.child(index).marks)).toEqual([[], [], []])
    expect(paragraphNode.lastChild?.marks.map((mark) => mark.type.name)).toEqual(["bold"])
  })

  it("显式 existingIds 避开目标文档 UUID 碰撞，且不会改写旧 document identity", () => {
    const source = documentWith(paragraph(originalId)).slice(0, documentWith(paragraph(originalId)).content.size)
    const collision = Uint8Array.from([0x12, 0x3e, 0x45, 0x67, 0xe8, 0x9b, 0x42, 0xd3, 0xa4, 0x56, 0x42, 0x66, 0x14, 0x17, 0x40, 0x00])
    const fresh = Uint8Array.from([0x22, 0x3e, 0x45, 0x67, 0xe8, 0x9b, 0x42, 0xd3, 0xa4, 0x56, 0x42, 0x66, 0x14, 0x17, 0x40, 0x01])
    let calls = 0
    const random = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(calls++ === 0 ? collision : fresh)
      return array
    })
    try {
      const rewritten = rewritePastedHnnNodeIds(source, new Set([originalId]))
      const pasted: unknown = rewritten.content.firstChild?.attrs["nodeId"]
      expect(pasted).toBe("223e4567-e89b-42d3-a456-426614174001")
      expect(pasted).not.toBe(originalId)
    } finally {
      random.mockRestore()
    }
  })

  it("带 marks 的 text 不被 repair 误判为 inline atom（本 PM 版本 text 亦为叶子/isAtom）", () => {
    const bold = hnnRuntimeSchema.marks["bold"]!.create()
    const italic = hnnRuntimeSchema.marks["italic"]!.create()
    const styled = hnnRuntimeSchema.text("styled", [bold, italic])
    const paragraphNode = hnnRuntimeSchema.nodes["paragraph"]!.create({ nodeId: originalId }, [styled])
    const doc = documentWith(paragraphNode)

    // 修复不应因 marked text 抛 "can't construct text nodes"，也不应产生额外修复事务或改 marks。
    const state = EditorState.create({ schema: hnnRuntimeSchema, doc, plugins: [createHnnNodeIdPlugin()] })
    const result = state.applyTransaction(state.tr)
    expect(result.transactions).toHaveLength(1)
    const text = result.state.doc.firstChild!.firstChild!
    expect(text.text).toBe("styled")
    expect(text.marks.map((mark) => mark.type.name)).toEqual(["bold", "italic"])
  })

  it("非 text 的 inline atom marks 仍被 repair 清理且不进历史", () => {
    const bold = hnnRuntimeSchema.marks["bold"]!.create()
    const hardBreak = hnnRuntimeSchema.nodes["hardBreak"]!.create({ nodeId: originalId }, null, [bold])
    const paragraphNode = hnnRuntimeSchema.nodes["paragraph"]!.create({ nodeId: originalId }, [hardBreak])
    const state = EditorState.create({ schema: hnnRuntimeSchema, doc: documentWith(paragraphNode), plugins: [createHnnNodeIdPlugin()] })

    const result = state.applyTransaction(state.tr)
    // 初始 init 修复：hardBreak 的 bold mark 被清理。
    const breakNode = result.state.doc.firstChild!.firstChild!
    expect(breakNode.type.name).toBe("hardBreak")
    expect(breakNode.marks).toHaveLength(0)
  })
})
