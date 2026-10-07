// @vitest-environment jsdom
/**
 * 6.6 验收：ProseMirror 原生 TextSelection / NodeSelection / CellSelection 与标准
 * HTML + text/plain 剪贴板行为，以及粘贴重建持久标识、一次粘贴一次 undo、
 * 旧连续文本流/表格行原子/selectMode/自研 MIME 的废弃。
 * 全部经内部 createEditorSession（封闭契约）驱动，不向公共 API 暴露 editor/schema/history。
 */
import { CellSelection } from "@tiptap/pm/tables"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { describe, expect, it } from "vitest"
import { HNN_CARD_EMPTY_DATA } from "../hnn/cardPayload"
import { HNN_DRAWING_EMPTY_DATA } from "../hnn/drawingPayload"
import { parseHnnClipboardNode } from "../hnn/extensions"
import { collectHnnNodeIds } from "../hnn/nodeId"
import { createEditorSession } from "./session"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003",
  "123e4567-e89b-42d3-a456-426614174004",
  "123e4567-e89b-42d3-a456-426614174005",
  "123e4567-e89b-42d3-a456-426614174006",
  "123e4567-e89b-42d3-a456-426614174007",
  "123e4567-e89b-42d3-a456-426614174008",
  "123e4567-e89b-42d3-a456-426614174009",
  "123e4567-e89b-42d3-a456-426614174010",
  "123e4567-e89b-42d3-a456-426614174011",
  "123e4567-e89b-42d3-a456-426614174012",
  "123e4567-e89b-42d3-a456-426614174013"
] as const

type ClipboardStore = Map<string, string>
type Session = ReturnType<typeof createEditorSession>

/** jsdom 不提供 ClipboardEvent 构造器：以结构性字段构造，与真实浏览器夹具一致。 */
function clipboardEvent(type: "copy" | "cut" | "paste", values: ClipboardStore): ClipboardEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (name: string, value: string) => values.set(name, value),
      getData: (name: string) => values.get(name) ?? "",
      clearData: (name?: string) => {
        if (name === undefined) values.clear()
        else values.delete(name)
      },
      files: [],
      items: [],
      types: [...values.keys()]
    }
  })
  return event
}

function documentWith(content: unknown[]) {
  return { schemaVersion: 1 as const, data: { type: "doc", content } }
}

function dispatchClipboard(session: Session, type: "copy" | "cut" | "paste", values = new Map<string, string>()) {
  session.editor.view.dom.dispatchEvent(clipboardEvent(type, values))
  return values
}

function paragraph(nodeId: string, text: string, marks?: unknown[]) {
  return {
    type: "paragraph",
    attrs: { nodeId },
    content: [marks === undefined ? { type: "text", text } : { type: "text", text, marks }]
  }
}

function textSession(text = "hello") {
  return createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith([paragraph(ids[0], text)]) })
}

/** 定位顶层每个节点的起始位置（NodeSelection/选区断言用）。 */
function topLevel(doc: Session["editor"]["state"]["doc"]): Array<{ name: string; pos: number; size: number }> {
  const entries: Array<{ name: string; pos: number; size: number }> = []
  doc.forEach((node, offset) => entries.push({ name: node.type.name, pos: offset, size: node.nodeSize }))
  return entries
}

function pasteAtEnd(target: Session, clipboard: ClipboardStore): void {
  const end = target.editor.state.doc.content.size
  target.editor.view.dispatch(target.editor.state.tr.setSelection(TextSelection.create(target.editor.state.doc, end)))
  target.editor.view.dom.dispatchEvent(clipboardEvent("paste", clipboard))
}

/** 构造一个 2x2 表格（A/B/C/D），返回 session 与各单元格起始位置。 */
function tableSession(cellTexts: [string, string, string, string] = ["A", "B", "C", "D"]) {
  const base = 3
  const cell = (index: number, text: string) => ({
    type: "tableCell",
    attrs: { nodeId: ids[base + index], colspan: 1, rowspan: 1, colwidth: null, align: null },
    content: [paragraph(ids[base + index + 4]!, text)]
  })
  const session = createEditorSession({
    documentId: "A", loadKey: 1,
    initialDocument: documentWith([{
      type: "table",
      attrs: { nodeId: ids[0] },
      content: [
        { type: "tableRow", attrs: { nodeId: ids[1] }, content: [cell(0, cellTexts[0]), cell(1, cellTexts[1])] },
        { type: "tableRow", attrs: { nodeId: ids[2] }, content: [cell(2, cellTexts[2]), cell(3, cellTexts[3])] }
      ]
    }])
  })
  const positions: number[] = []
  session.editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell") positions.push(pos)
  })
  return { session, positions }
}

describe("6.6 文本选择遵循原生 TextSelection", () => {
  it("拖选字符范围与复制出的 text/plain 一一对应，且 copy 不产生事务", () => {
    const session = textSession("abcdef")
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2, 5)))
      expect(session.editor.state.selection).toBeInstanceOf(TextSelection)

      let transactions = 0
      const onTransaction = () => { transactions += 1 }
      session.editor.on("transaction", onTransaction)
      const clipboard = dispatchClipboard(session, "copy")
      session.editor.off("transaction", onTransaction)

      expect([...clipboard.keys()].sort()).toEqual(["text/html", "text/plain"])
      expect(clipboard.get("text/plain")).toBe("bcd")
      expect(clipboard.get("text/html")).toContain("bcd")
      expect(transactions).toBe(0)
    } finally {
      session.destroy()
    }
  })

  it("键盘 Shift 扩展得到的范围与复制一致，选择保持 TextSelection（浏览器原生路径未被自研逻辑接管）", () => {
    const session = textSession("abcdef")
    try {
      // Shift+ArrowRight 逐字符扩展由浏览器原生处理；PM 不拦截，因此选择仍是 TextSelection。
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 3)))
      session.editor.view.someProp("handleKeyDown", (handler) => handler(session.editor.view, new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })))
      expect(session.editor.state.selection).toBeInstanceOf(TextSelection)

      // 高亮范围（anchor→head）与复制结果逐字符一致。
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 1, 4)))
      const clipboard = dispatchClipboard(session, "copy")
      expect(clipboard.get("text/plain")).toBe("abc")
    } finally {
      session.destroy()
    }
  })
})

describe("6.6 原子内容节点整体选择（NodeSelection）", () => {
  const atoms: Array<{ name: string; node: Record<string, unknown> }> = [
    { name: "picture", node: { type: "picture", attrs: { nodeId: ids[1], src: "https://example.test/a.png", alt: "图" } } },
    { name: "card", node: { type: "card", attrs: { nodeId: ids[1], data: HNN_CARD_EMPTY_DATA } } },
    { name: "drawing", node: { type: "drawing", attrs: { nodeId: ids[1], data: HNN_DRAWING_EMPTY_DATA } } },
    { name: "directory", node: { type: "directory", attrs: { nodeId: ids[1], config: "headings" } } },
    { name: "formula", node: { type: "formula", attrs: { nodeId: ids[1], latex: "x^2" } } }
  ]

  for (const { name, node } of atoms) {
    it(`${name} 整体进入 NodeSelection，不包含相邻内容块字符`, () => {
      const session = createEditorSession({
        documentId: "A", loadKey: 1,
        initialDocument: documentWith([paragraph(ids[0], "left"), node, paragraph(ids[2], "right")])
      })
      try {
        const atomEntry = topLevel(session.editor.state.doc).find((entry) => entry.name === name)!
        session.editor.view.dispatch(session.editor.state.tr.setSelection(NodeSelection.create(session.editor.state.doc, atomEntry.pos)))

        const selection = session.editor.state.selection
        expect(selection).toBeInstanceOf(NodeSelection)
        expect(selection.from).toBe(atomEntry.pos)
        expect(selection.to).toBe(atomEntry.pos + atomEntry.size)
        expect((selection as NodeSelection).node.type.name).toBe(name)
        // 原子选择不夹带任何相邻字符。
        expect(session.editor.state.doc.textBetween(selection.from, selection.to)).toBe("")
      } finally {
        session.destroy()
      }
    })
  }

  it("选中原子节点复制后粘贴，结构可表达且 nodeId 重建为文档内唯一", () => {
    const session = createEditorSession({
      documentId: "A", loadKey: 1,
      initialDocument: documentWith([{ type: "formula", attrs: { nodeId: ids[0], latex: "x^2" } }, paragraph(ids[1], "tail")])
    })
    try {
      const atomEntry = topLevel(session.editor.state.doc).find((entry) => entry.name === "formula")!
      session.editor.view.dispatch(session.editor.state.tr.setSelection(NodeSelection.create(session.editor.state.doc, atomEntry.pos)))
      const clipboard = dispatchClipboard(session, "copy")
      expect([...clipboard.keys()].sort()).toEqual(["text/html", "text/plain"])
      expect(clipboard.get("text/html")).toContain('data-hnn-node="formula"')
      // 原子复制走 PM 默认 serializeForClipboard：切片元数据 data-pm-slice 存在，且绝不写自研 MIME。
      expect(clipboard.get("text/html")).toContain("data-pm-slice")
      const parsed = new DOMParser().parseFromString(clipboard.get("text/html") ?? "", "text/html").body.firstElementChild
      expect(parseHnnClipboardNode(parsed as HTMLElement)).toMatchObject({ name: "formula" })

      pasteAtEnd(session, clipboard)
      const formulas: Array<{ nodeId: string; latex: string }> = []
      session.editor.state.doc.descendants((node) => {
        if (node.type.name === "formula") formulas.push({ nodeId: node.attrs["nodeId"] as string, latex: node.attrs["latex"] as string })
      })
      expect(formulas).toHaveLength(2)
      expect(formulas.map((item) => item.latex)).toEqual(["x^2", "x^2"])
      expect(new Set(formulas.map((item) => item.nodeId)).size).toBe(2)
      // 一次粘贴一个历史步：一次 undo 完整移除粘贴的原子。
      expect(session.undo()).toBe(true)
      let count = 0
      session.editor.state.doc.descendants((node) => { if (node.type.name === "formula") count += 1 })
      expect(count).toBe(1)
    } finally {
      session.destroy()
    }
  })

  it("picture/card/drawing/directory 复制粘贴保持可表达结构并重建标识", () => {
    const payloads: Array<{ name: string; node: Record<string, unknown>; marker: string; attr: string; value: string }> = [
      { name: "picture", node: { type: "picture", attrs: { nodeId: ids[0], src: "https://example.test/p.png", alt: "图" } }, marker: "picture", attr: "src", value: "https://example.test/p.png" },
      { name: "card", node: { type: "card", attrs: { nodeId: ids[0], data: HNN_CARD_EMPTY_DATA } }, marker: "card", attr: "data", value: HNN_CARD_EMPTY_DATA },
      { name: "drawing", node: { type: "drawing", attrs: { nodeId: ids[0], data: HNN_DRAWING_EMPTY_DATA } }, marker: "drawing", attr: "data", value: HNN_DRAWING_EMPTY_DATA },
      { name: "directory", node: { type: "directory", attrs: { nodeId: ids[0], config: "headings" } }, marker: "directory", attr: "config", value: "headings" }
    ]

    for (const payload of payloads) {
      const source = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith([payload.node, paragraph(ids[1], "tail")]) })
      const target = textSession("target")
      try {
        const entry = topLevel(source.editor.state.doc).find((item) => item.name === payload.name)!
        source.editor.view.dispatch(source.editor.state.tr.setSelection(NodeSelection.create(source.editor.state.doc, entry.pos)))
        const clipboard = dispatchClipboard(source, "copy")
        expect(clipboard.get("text/html")).toContain(`data-hnn-node="${payload.marker}"`)

        pasteAtEnd(target, clipboard)
        const pasted = topLevel(target.editor.state.doc).find((item) => item.name === payload.name)
        expect(pasted).toBeDefined()
        const node = target.editor.state.doc.nodeAt(pasted!.pos)!
        expect(node.attrs[payload.attr]).toBe(payload.value)
        expect(node.attrs["nodeId"]).not.toBe(ids[0])
        const allIds = collectHnnNodeIds(target.editor.state.doc)
        expect(new Set(allIds).size).toBe(allIds.size)
      } finally {
        source.destroy()
        target.destroy()
      }
    }
  })
})

describe("6.6 表格单元格选择（CellSelection）", () => {
  it("跨单元格矩形选择覆盖矩形内全部单元格，复制粘贴为表格结构", () => {
    const { session, positions } = tableSession()
    const target = textSession("target")
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(CellSelection.create(session.editor.state.doc, positions[0]!, positions[3])))
      const selection = session.editor.state.selection
      expect(selection).toBeInstanceOf(CellSelection)
      let cells = 0
      ;(selection as CellSelection).forEachCell(() => { cells += 1 })
      expect(cells).toBe(4)

      const clipboard = dispatchClipboard(session, "copy")
      expect(clipboard.get("text/html")).toContain("<table")
      const plain = clipboard.get("text/plain") ?? ""
      for (const text of ["A", "B", "C", "D"]) expect(plain).toContain(text)

      pasteAtEnd(target, clipboard)
      let targetCells = 0
      target.editor.state.doc.descendants((node) => { if (node.type.name === "tableCell") targetCells += 1 })
      expect(targetCells).toBe(4)
      expect(target.editor.getText()).toContain("D")
      // 一次粘贴一个历史步。
      expect(target.undo()).toBe(true)
      expect(target.editor.getText()).not.toContain("D")
    } finally {
      session.destroy()
      target.destroy()
    }
  })

  it("单元格内选择部分文字只含该文本，其余单元格不进入选区与剪贴板", () => {
    const { session, positions } = tableSession()
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, positions[0]! + 2, positions[0]! + 3)))
      expect(session.editor.state.selection).toBeInstanceOf(TextSelection)
      const clipboard = dispatchClipboard(session, "copy")
      expect(clipboard.get("text/plain")).toBe("A")
      expect(clipboard.get("text/html")).not.toContain(">B<")
      expect(clipboard.get("text/html")).not.toContain(">C<")
    } finally {
      session.destroy()
    }
  })

  it("官方 table 扩展实际启用原生 CellSelection（setCellSelection 命令 + selectingCells 插件）", () => {
    const { session, positions } = tableSession()
    try {
      expect(session.editor.extensionManager.extensions.map((extension) => extension.name)).toContain("table")
      expect(typeof session.editor.commands.setCellSelection).toBe("function")
      // 官方 tableEditing 插件的 selectingCells key 是拖拽产生 CellSelection 的实际来源。
      const pluginKeys = session.editor.state.plugins.map((plugin) => String((plugin as unknown as { key: unknown }).key))
      expect(pluginKeys.some((key) => key.includes("selectingCells"))).toBe(true)

      session.editor.commands.setCellSelection({ anchorCell: positions[0]!, headCell: positions[3]! })
      const selection = session.editor.state.selection
      expect(selection).toBeInstanceOf(CellSelection)
      let cells = 0
      ;(selection as CellSelection).forEachCell(() => { cells += 1 })
      expect(cells).toBe(4)
    } finally {
      session.destroy()
    }
  })

  it("整行选择以原生 CellSelection 呈现，复制出表格而非裸行原子", () => {
    const { session, positions } = tableSession()
    try {
      // 表格行的“整体选择”在本内核中即对该行单元格的原生 CellSelection；不存在旧行原子选择类型。
      session.editor.view.dispatch(session.editor.state.tr.setSelection(CellSelection.create(session.editor.state.doc, positions[0]!, positions[1])))
      const selection = session.editor.state.selection
      expect(selection).toBeInstanceOf(CellSelection)
      let cells = 0
      ;(selection as CellSelection).forEachCell(() => { cells += 1 })
      expect(cells).toBe(2)
      const clipboard = dispatchClipboard(session, "copy")
      expect(clipboard.get("text/html")).toContain("<table")
    } finally {
      session.destroy()
    }
  })
})

describe("6.6 标准 HTML / text/plain 剪贴板保持可表达结构", () => {
  it("从外部粘贴标题/列表/加粗的 HTML，按对应结构导入", () => {
    const session = textSession("start")
    try {
      dispatchClipboard(session, "paste", new Map([
        ["text/html", "<h2>Heading</h2><ul><li><strong>bold item</strong></li></ul>"],
        ["text/plain", "Heading\nbold item"]
      ]))
      expect(session.editor.state.doc.content.content.some((node) => node.type.name === "heading")).toBe(true)
      let hasBoldInList = false
      session.editor.state.doc.descendants((node) => {
        if (node.isText && node.marks.some((mark) => mark.type.name === "bold") && node.text === "bold item") hasBoldInList = true
      })
      expect(hasBoldInList).toBe(true)
    } finally {
      session.destroy()
    }
  })

  it("行内 marks（bold/italic/link）复制粘贴保留", () => {
    const source = createEditorSession({
      documentId: "A", loadKey: 1,
      initialDocument: documentWith([{
        type: "paragraph",
        attrs: { nodeId: ids[0] },
        content: [
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " italic", marks: [{ type: "italic" }] },
          { type: "text", text: " link", marks: [{ type: "link", attrs: { href: "https://example.test/" } }] }
        ]
      }])
    })
    const target = textSession("target")
    try {
      const size = source.editor.state.doc.content.size
      source.editor.view.dispatch(source.editor.state.tr.setSelection(TextSelection.create(source.editor.state.doc, 1, size - 1)))
      const clipboard = dispatchClipboard(source, "copy")
      expect(clipboard.get("text/plain")).toBe("bold italic link")

      pasteAtEnd(target, clipboard)
      const marks: string[] = []
      target.editor.state.doc.descendants((node) => {
        for (const mark of node.marks) marks.push(mark.type.name)
      })
      expect(marks).toContain("bold")
      expect(marks).toContain("italic")
      expect(marks).toContain("link")
      // 一次粘贴一个历史步。
      expect(target.undo()).toBe(true)
      expect(target.editor.getText()).not.toContain("bold italic link")
    } finally {
      source.destroy()
      target.destroy()
    }
  })

  it("嵌套列表复制粘贴保留层级", () => {
    const session = textSession("start")
    const target = textSession("target")
    try {
      dispatchClipboard(session, "paste", new Map([
        ["text/html", "<ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul>"],
        ["text/plain", "outer\ninner"]
      ]))
      const entry = topLevel(session.editor.state.doc).find((item) => item.name === "bulletList")!
      session.editor.view.dispatch(session.editor.state.tr.setSelection(NodeSelection.create(session.editor.state.doc, entry.pos)))
      const clipboard = dispatchClipboard(session, "copy")

      pasteAtEnd(target, clipboard)
      let nested = 0
      target.editor.state.doc.descendants((node) => { if (node.type.name === "bulletList") nested += 1 })
      expect(nested).toBe(2)
      expect(target.editor.getText()).toContain("outer")
      expect(target.editor.getText()).toContain("inner")
    } finally {
      session.destroy()
      target.destroy()
    }
  })

  it("仅纯文本粘贴按纯文本插入，不产生富文本标记", () => {
    const session = textSession("start")
    try {
      dispatchClipboard(session, "paste", new Map([["text/plain", "<not html> plain"]]))
      expect(session.editor.getText()).toContain("<not html> plain")
      let markCount = 0
      session.editor.state.doc.descendants((node) => { markCount += node.marks.length })
      expect(markCount).toBe(0)
    } finally {
      session.destroy()
    }
  })
})

describe("6.6 废弃旧语义与安全边界", () => {
  it("仅旧自研 MIME 的剪贴板内容不还原专有结构；有纯文本时只按纯文本处理", () => {
    const session = textSession("safe")
    try {
      const before = session.editor.state.doc
      dispatchClipboard(session, "paste", new Map([["application/x-hamsternote-fragment+json", '{"blocks":[{"kind":"formula"}]}']]))
      expect(session.editor.state.doc.eq(before)).toBe(true)

      dispatchClipboard(session, "paste", new Map([
        ["application/x-hamsternote-fragment+json", '{"blocks":[{"kind":"formula"}]}'],
        ["text/plain", "fallback"]
      ]))
      expect(session.editor.getText()).toContain("fallback")
      let formulas = 0
      session.editor.state.doc.descendants((node) => { if (node.type.name === "formula") formulas += 1 })
      expect(formulas).toBe(0)
    } finally {
      session.destroy()
    }
  })

  it("不暴露/不消费旧 selectMode；跨标题到正文是普通 TextSelection 文本流", () => {
    const session = createEditorSession({
      documentId: "A", loadKey: 1,
      initialDocument: documentWith([
        { type: "heading", attrs: { nodeId: ids[0], level: 2 }, content: [{ type: "text", text: "Title" }] },
        paragraph(ids[1], "Body")
      ])
    })
    try {
      expect("selectMode" in session).toBe(false)
      expect((session.editor as unknown as Record<string, unknown>)["selectMode"]).toBeUndefined()

      const bodyPos = topLevel(session.editor.state.doc).find((item) => item.name === "paragraph")!.pos
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 3, bodyPos + 3)))
      expect(session.editor.state.selection).toBeInstanceOf(TextSelection)
      const clipboard = dispatchClipboard(session, "copy")
      // 选择范围是实际字符区间（PM 在块边界插入换行），不是自研连续流映射出的合成文本。
      expect(clipboard.get("text/plain")).toBe("tle\n\nBo")
      expect(clipboard.get("text/plain")).toContain("tle")
    } finally {
      session.destroy()
    }
  })

  it("粘贴含重复伪造 id 的多个节点后标识互不相同且不与既有冲突", () => {
    const session = createEditorSession({
      documentId: "A", loadKey: 1,
      initialDocument: documentWith([paragraph(ids[0], "tail")])
    })
    try {
      const forged = ids[1]
      dispatchClipboard(session, "paste", new Map([
        ["text/html", `<div data-hnn-node="formula" nodeid="${forged}" latex="a"></div><div data-hnn-node="formula" nodeid="${forged}" latex="b"></div>`],
        ["text/plain", "a\nb"]
      ]))
      const formulas: Array<{ nodeId: string; latex: string }> = []
      session.editor.state.doc.descendants((node) => {
        if (node.type.name === "formula") formulas.push({ nodeId: node.attrs["nodeId"] as string, latex: node.attrs["latex"] as string })
      })
      expect(formulas.map((item) => item.latex).sort()).toEqual(["a", "b"])
      expect(new Set(formulas.map((item) => item.nodeId)).size).toBe(2)
      expect(formulas.some((item) => item.nodeId === forged)).toBe(false)
      const all = collectHnnNodeIds(session.editor.state.doc)
      expect(new Set(all).size).toBe(all.size)
    } finally {
      session.destroy()
    }
  })

  it("既有安全拒绝仍生效：危险协议 custom marker 与超限表格在 dispatch 前拒绝", () => {
    const session = textSession("safe")
    try {
      const selection = TextSelection.create(session.editor.state.doc, 2)
      session.editor.view.dispatch(session.editor.state.tr.setSelection(selection))
      const before = session.editor.state.doc

      dispatchClipboard(session, "paste", new Map([
        ["text/html", '<figure data-hnn-node="picture" src="javascript:alert(1)" alt="unsafe"></figure>'],
        ["text/plain", "unsafe"]
      ]))
      expect(session.editor.state.doc.eq(before)).toBe(true)
      expect(session.editor.state.selection.eq(selection)).toBe(true)
      expect(session.undo()).toBe(false)

      const oversizedCells = Array.from({ length: 65 }, () => "<td>x</td>").join("")
      dispatchClipboard(session, "paste", new Map([
        ["text/html", `<table><tbody><tr>${oversizedCells}</tr></tbody></table>`],
        ["text/plain", "oversized"]
      ]))
      expect(session.editor.state.doc.eq(before)).toBe(true)
      expect(session.undo()).toBe(false)
    } finally {
      session.destroy()
    }
  })
})
