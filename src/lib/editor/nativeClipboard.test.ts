// @vitest-environment jsdom

import { CellSelection } from "@tiptap/pm/tables"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { describe, expect, it } from "vitest"
import { collectHnnNodeIds } from "../hnn/nodeId"
import { parseHnnClipboardNode } from "../hnn/extensions"
import { installHnnClipboardHistoryBoundary } from "./nativeClipboard"
import { createEditorSession } from "./session"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003"
]

type ClipboardStore = Map<string, string>

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

function dispatchClipboard(session: ReturnType<typeof createEditorSession>, type: "copy" | "cut" | "paste", values = new Map<string, string>()): ClipboardStore {
  session.editor.view.dom.dispatchEvent(clipboardEvent(type, values))
  return values
}

function pasteWithoutClipboardData(session: ReturnType<typeof createEditorSession>): ClipboardEvent {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent
  session.editor.view.dom.dispatchEvent(event)
  return event
}

function textSession(text = "hello") {
  return createEditorSession({
    documentId: "A",
    loadKey: 1,
    initialDocument: documentWith([{ type: "paragraph", attrs: { nodeId: ids[0] }, content: [{ type: "text", text }] }])
  })
}

describe("原生 PM clipboard", () => {
  it("copy 只写 text/html 与 text/plain，且零 transaction", () => {
    const session = textSession()
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 1, 6)))
      let transactions = 0
      const onTransaction = () => { transactions += 1 }
      session.editor.on("transaction", onTransaction)
      const clipboard = dispatchClipboard(session, "copy")
      session.editor.off("transaction", onTransaction)

      expect([...clipboard.keys()].sort()).toEqual(["text/html", "text/plain"])
      expect(clipboard.get("text/plain")).toBe("hello")
      expect(clipboard.get("text/html")).toContain("hello")
      expect(transactions).toBe(0)
    } finally {
      session.destroy()
    }
  })

  it("custom atom copy→paste 保留结构并重建 nodeId", () => {
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith([
        { type: "formula", attrs: { nodeId: ids[0], latex: "x^2" } },
        { type: "paragraph", attrs: { nodeId: ids[1] }, content: [{ type: "text", text: "tail" }] }
      ])
    })
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(NodeSelection.create(session.editor.state.doc, 0)))
      const clipboard = dispatchClipboard(session, "copy")
      expect(clipboard.get("text/html")).toContain('data-hnn-node="formula"')
      expect(clipboard.get("text/html")).toMatch(/latex="x\^2"/u)
      expect(clipboard.get("text/html")).not.toContain("hn-editor-formula-preview")
      expect(clipboard.get("text/html")).not.toContain("<button")
      expect(clipboard.get("text/plain")).toBe("x^2")
      const parsed = new DOMParser().parseFromString(clipboard.get("text/html") ?? "", "text/html").body.firstElementChild
      expect(parsed).toBeInstanceOf(HTMLElement)
      expect(parseHnnClipboardNode(parsed as HTMLElement)).toMatchObject({ name: "formula" })

      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 3)))
      const paste = clipboardEvent("paste", clipboard)
      session.editor.view.dom.dispatchEvent(paste)
      const formulas: Array<{ nodeId: string; latex: string }> = []
      session.editor.state.doc.descendants((node) => {
        if (node.type.name === "formula") formulas.push({ nodeId: node.attrs["nodeId"] as string, latex: node.attrs["latex"] as string })
      })
      expect(formulas).toHaveLength(2)
      expect(formulas[1]).toMatchObject({ latex: "x^2" })
      expect(formulas[1]?.nodeId).not.toBe(formulas[0]?.nodeId)
      const allIds = collectHnnNodeIds(session.editor.state.doc)
      expect(allIds.size).toBe(4)
      expect(allIds.has(formulas[0]?.nodeId ?? "")).toBe(true)
      expect(allIds.has(formulas[1]?.nodeId ?? "")).toBe(true)
      // 粘贴是 PM 默认的一个 replace transaction；一次 undo 应整体移除该 atom。
      expect(session.undo()).toBe(true)
      let formulaCount = 0
      session.editor.state.doc.descendants((node) => {
        if (node.type.name === "formula") formulaCount += 1
      })
      expect(formulaCount).toBe(1)
    } finally {
      session.destroy()
    }
  })

  it("标准 HTML 与 plain text 按 PM 原生语义粘贴", () => {
    const session = textSession("start")
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, session.editor.state.doc.content.size)))
      dispatchClipboard(session, "paste", new Map([
        ["text/html", "<h2>Heading</h2><p>body</p>"],
        ["text/plain", "Heading\nbody"]
      ]))
      expect(session.editor.state.doc.content.childCount).toBeGreaterThan(1)
      expect(session.editor.state.doc.content.content.some((node) => node.type.name === "heading")).toBe(true)

      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, session.editor.state.doc.content.size)))
      dispatchClipboard(session, "paste", new Map([["text/plain", "plain only"]]))
      expect(session.editor.getText()).toContain("plain only")
    } finally {
      session.destroy()
    }
  })

  it("旧 MIME 不会恢复内容，危险 HTML 在 dispatch 前被严格拒绝", () => {
    const session = textSession("safe")
    try {
      const before = session.editor.state.doc
      dispatchClipboard(session, "paste", new Map([["application/x-hamsternote-fragment+json", '{"legacy":true}']]))
      expect(session.editor.state.doc.eq(before)).toBe(true)

      dispatchClipboard(session, "paste", new Map([
        ["text/html", '<figure data-hnn-node="picture" src="javascript:alert(1)" alt="unsafe"></figure>'],
        ["text/plain", "unsafe"]
      ]))
      expect(session.editor.state.doc.eq(before)).toBe(true)
    } finally {
      session.destroy()
    }
  })

  it("闭合 custom marker 拒绝未知类型、tag/attrs/payload 越权，且不改变 selection/history", () => {
    const session = textSession("safe")
    try {
      const selection = TextSelection.create(session.editor.state.doc, 2)
      session.editor.view.dispatch(session.editor.state.tr.setSelection(selection))
      const before = session.editor.state.doc
      const invalidHtml = [
        '<div data-hnn-node="unknown"></div>',
        '<span data-hnn-node="formula" latex="x"></span>',
        '<div data-hnn-node="formula" latex="x" onclick="alert(1)"></div>',
        '<div data-hnn-node="callout" tone="danger" title="bad"><p>x</p></div>',
        '<div data-hnn-node="card" data="{}"></div>',
        '<div data-hnn-node="drawing" data="{}"></div>'
      ]
      for (const html of invalidHtml) {
        dispatchClipboard(session, "paste", new Map([["text/html", html], ["text/plain", "ignored"]]))
        expect(session.editor.state.doc.eq(before)).toBe(true)
        expect(session.editor.state.selection.eq(selection)).toBe(true)
        expect(session.undo()).toBe(false)
      }
    } finally {
      session.destroy()
    }
  })

  it("HNN blockquote 往返 author/nodeId，普通外部 blockquote 安全导入 author=null", () => {
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith([{
        type: "blockquote",
        attrs: { nodeId: ids[0], author: "Ada" },
        content: [{ type: "paragraph", attrs: { nodeId: ids[1] }, content: [{ type: "text", text: "quote" }] }]
      }, { type: "paragraph", attrs: { nodeId: ids[2] }, content: [{ type: "text", text: "tail" }] }])
    })
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(NodeSelection.create(session.editor.state.doc, 0)))
      const clipboard = dispatchClipboard(session, "copy")
      expect(clipboard.get("text/html")).toContain('data-hnn-node="blockquote"')
      expect(clipboard.get("text/html")).toContain('author="Ada"')
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, session.editor.state.doc.content.size - 1)))
      const paste = clipboardEvent("paste", clipboard)
      session.editor.view.dom.dispatchEvent(paste)
      const quotes: Array<{ nodeId: string; author: string | null }> = []
      session.editor.state.doc.descendants((node) => {
        if (node.type.name === "blockquote") quotes.push({ nodeId: node.attrs["nodeId"] as string, author: node.attrs["author"] as string | null })
      })
      expect(quotes).toHaveLength(2)
      expect(quotes[1]).toMatchObject({ author: "Ada" })
      expect(quotes[1]?.nodeId).not.toBe(quotes[0]?.nodeId)

    } finally {
      session.destroy()
    }

    const external = textSession("tail")
    try {
      external.editor.view.dispatch(external.editor.state.tr.setSelection(NodeSelection.create(external.editor.state.doc, 0)))
      dispatchClipboard(external, "paste", new Map([["text/html", "<blockquote author=\"ignored\" nodeid=\"forged\" class=\"external\" cite=\"https://example.test\" style=\"color:red\"><p>external</p></blockquote>"], ["text/plain", "external"]]))
      const externalQuote: import("@tiptap/pm/model").Node[] = []
      external.editor.state.doc.descendants((node) => {
        if (node.type.name === "blockquote" && node.textContent.includes("external")) externalQuote.push(node)
      })
      expect(external.editor.getText()).toContain("external")
      expect(externalQuote).toHaveLength(1)
      expect(externalQuote[0]?.attrs["author"]).toBeNull()
    } finally {
      external.destroy()
    }
  })

  it("外部标准 pre/code 以安全默认 attrs 导入，内部 HNN codeBlock 往返保留 attrs", () => {
    const external = textSession("tail")
    try {
      external.editor.view.dispatch(external.editor.state.tr.setSelection(NodeSelection.create(external.editor.state.doc, 0)))
      dispatchClipboard(external, "paste", new Map([["text/html", "<pre language=\"true\" filename=\"0\"><code>  keep\n  whitespace</code></pre>"], ["text/plain", "  keep\n  whitespace"]]))
      const code = external.editor.state.doc.firstChild
      expect(code?.type.name).toBe("codeBlock")
      expect(code?.attrs).toMatchObject({ language: "plaintext", filename: "untitled" })
      expect(code?.textContent).toBe("  keep\n  whitespace")
    } finally {
      external.destroy()
    }

    const internal = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith([{ type: "codeBlock", attrs: { nodeId: ids[0], language: "typescript", filename: "main.ts" }, content: [{ type: "text", text: "const x = 1" }] }])
    })
    try {
      internal.editor.view.dispatch(internal.editor.state.tr.setSelection(NodeSelection.create(internal.editor.state.doc, 0)))
      const clipboard = dispatchClipboard(internal, "copy")
      expect(clipboard.get("text/html")).toContain('data-hnn-node="codeBlock"')
      const target = textSession("target")
      try {
        target.editor.view.dispatch(target.editor.state.tr.setSelection(NodeSelection.create(target.editor.state.doc, 0)))
        dispatchClipboard(target, "paste", clipboard)
        expect(target.editor.state.doc.firstChild).toMatchObject({ attrs: { language: "typescript", filename: "main.ts" } })
      } finally {
        target.destroy()
      }
    } finally {
      internal.destroy()
    }
  })

  it("composition 中 paste 被 capture 拒绝，不让浏览器 DOM mutation 或 PM transaction 污染状态", () => {
    const session = textSession("safe")
    try {
      const before = session.editor.state.doc
      const selection = session.editor.state.selection
      session.editor.view.dom.dispatchEvent(new Event("compositionstart", { bubbles: true }))
      const paste = clipboardEvent("paste", new Map([["text/plain", "composing"]]))
      session.editor.view.dom.dispatchEvent(paste)
      session.editor.view.dom.dispatchEvent(new Event("compositionend", { bubbles: true }))
      expect(paste.defaultPrevented).toBe(true)
      expect(session.editor.state.doc.eq(before)).toBe(true)
      expect(session.editor.state.selection.eq(selection)).toBe(true)
      expect(session.undo()).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("CellSelection 与 ordered-list 分支的非法 custom paste 在 dispatch 前拒绝", () => {
    const table = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith([{
        type: "table", attrs: { nodeId: ids[0] }, content: [{ type: "tableRow", attrs: { nodeId: ids[1] }, content: [{ type: "tableCell", attrs: { nodeId: ids[2], colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [{ type: "paragraph", attrs: { nodeId: ids[3] }, content: [{ type: "text", text: "cell" }] }] }] }]
      }])
    })
    try {
      table.editor.view.dispatch(table.editor.state.tr.setSelection(CellSelection.create(table.editor.state.doc, 2)))
      const before = table.editor.state.doc
      const selection = table.editor.state.selection
      dispatchClipboard(table, "paste", new Map([["text/html", '<div data-hnn-node="card" data="{}"></div>'], ["text/plain", "bad"]]))
      expect(table.editor.state.doc.eq(before)).toBe(true)
      expect(table.editor.state.selection.eq(selection)).toBe(true)
      expect(table.undo()).toBe(false)
    } finally {
      table.destroy()
    }

    const list = createEditorSession({
      documentId: "A",
      loadKey: 2,
      initialDocument: documentWith([{ type: "orderedList", attrs: { nodeId: ids[0], start: 1, type: null }, content: [{ type: "listItem", attrs: { nodeId: ids[1] }, content: [{ type: "paragraph", attrs: { nodeId: ids[2] }, content: [{ type: "text", text: "item" }] }] }] }])
    })
    try {
      list.editor.view.dispatch(list.editor.state.tr.setSelection(TextSelection.create(list.editor.state.doc, 3)))
      const before = list.editor.state.doc
      dispatchClipboard(list, "paste", new Map([["text/html", '<div data-hnn-node="formula" latex=""></div>'], ["text/plain", "bad"]]))
      expect(list.editor.state.doc.eq(before)).toBe(true)
    } finally {
      list.destroy()
    }
  })

  it("ragged 标准 table 在最终 appendTransaction repair 后通过，oversized table 在真实 dispatch 前拒绝", () => {
    const session = textSession("table target")
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(NodeSelection.create(session.editor.state.doc, 0)))
      dispatchClipboard(session, "paste", new Map([["text/html", "<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>"], ["text/plain", "a\tb\nc"]]))
      const repaired = session.editor.state.doc.firstChild
      expect(repaired?.type.name).toBe("table")
      expect(repaired?.childCount).toBe(2)

      const before = session.editor.state.doc
      const oversizedCells = Array.from({ length: 65 }, () => "<td>x</td>").join("")
      dispatchClipboard(session, "paste", new Map([["text/html", `<table><tbody><tr>${oversizedCells}</tr></tbody></table>`], ["text/plain", "oversized"]]))
      expect(session.editor.state.doc.eq(before)).toBe(true)
    } finally {
      session.destroy()
    }
  })

  it("标准 table span 在 capture 前有界拒绝，TextSelection 与 CellSelection 均不污染状态", () => {
    const text = textSession("safe")
    try {
      const selection = TextSelection.create(text.editor.state.doc, 2)
      text.editor.view.dispatch(text.editor.state.tr.setSelection(selection))
      const before = text.editor.state.doc
      for (const span of ["65", "1000000000", "-1"]) {
        const event = clipboardEvent("paste", new Map([["text/html", `<table><tbody><tr><td colspan="${span}">x</td></tr></tbody></table>`], ["text/plain", "x"]]))
        text.editor.view.dom.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(text.editor.state.doc.eq(before)).toBe(true)
        expect(text.editor.state.selection.eq(selection)).toBe(true)
        expect(text.undo()).toBe(false)
      }
    } finally {
      text.destroy()
    }

    const cell = createEditorSession({
      documentId: "A",
      loadKey: 3,
      initialDocument: documentWith([{ type: "table", attrs: { nodeId: ids[0] }, content: [{ type: "tableRow", attrs: { nodeId: ids[1] }, content: [{ type: "tableCell", attrs: { nodeId: ids[2], colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [{ type: "paragraph", attrs: { nodeId: ids[3] }, content: [{ type: "text", text: "cell" }] }] }] }] }])
    })
    try {
      cell.editor.view.dispatch(cell.editor.state.tr.setSelection(CellSelection.create(cell.editor.state.doc, 2)))
      const before = cell.editor.state.doc
      const selection = cell.editor.state.selection
      for (const attribute of ["rowspan=\"1000000000\"", "colspan=\"65\""]) {
        const event = clipboardEvent("paste", new Map([["text/html", `<table><tbody><tr><td ${attribute}>x</td></tr></tbody></table>`], ["text/plain", "x"]]))
        cell.editor.view.dom.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(cell.editor.state.doc.eq(before)).toBe(true)
        expect(cell.editor.state.selection.eq(selection)).toBe(true)
        expect(cell.undo()).toBe(false)
      }
    } finally {
      cell.destroy()
    }
  })

  it("缺失 clipboardData 的 paste 在 capture 拒绝，copy/cut 正常保持 PM 原生路径", () => {
    const session = textSession("safe")
    try {
      const before = session.editor.state.doc
      const selection = session.editor.state.selection
      const paste = pasteWithoutClipboardData(session)
      expect(paste.defaultPrevented).toBe(true)
      expect(session.editor.state.doc.eq(before)).toBe(true)
      expect(session.editor.state.selection.eq(selection)).toBe(true)
      expect(session.undo()).toBe(false)

      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 1, 2)))
      const copy = dispatchClipboard(session, "copy")
      expect([...copy.keys()].sort()).toEqual(["text/html", "text/plain"])
      const cut = dispatchClipboard(session, "cut")
      expect([...cut.keys()].sort()).toEqual(["text/html", "text/plain"])
    } finally {
      session.destroy()
    }
  })

  it("history wrapper cleanup 只恢复自己安装的 dispatch，不覆盖后安装 wrapper", () => {
    const session = textSession()
    try {
      const removeFirst = installHnnClipboardHistoryBoundary(session.editor)
      const secondDispatch = session.editor.view.dispatch
      const removeSecond = installHnnClipboardHistoryBoundary(session.editor)
      const newestDispatch = session.editor.view.dispatch
      removeFirst()
      expect(session.editor.view.dispatch).toBe(newestDispatch)
      removeSecond()
      expect(session.editor.view.dispatch).toBe(secondDispatch)
    } finally {
      session.destroy()
    }
  })

  it("cut 仅删除一次并可一次 undo，table 使用原生 CellSelection", () => {
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith([{
        type: "table",
        attrs: { nodeId: ids[0] },
        content: [{
          type: "tableRow",
          attrs: { nodeId: ids[1] },
          content: [{
            type: "tableCell",
            attrs: { nodeId: ids[2], colspan: 1, rowspan: 1, colwidth: null, align: null },
            content: [{ type: "paragraph", attrs: { nodeId: ids[3] }, content: [{ type: "text", text: "cell" }] }]
          }]
        }]
      }])
    })
    try {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(CellSelection.create(session.editor.state.doc, 2)))
      expect(session.editor.state.selection).toBeInstanceOf(CellSelection)
      const clipboard = dispatchClipboard(session, "cut")
      expect([...clipboard.keys()].sort()).toEqual(["text/html", "text/plain"])
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toContain("cell")
    } finally {
      session.destroy()
    }
  })

  it("paste/cut 与相邻输入、连续 clipboard 操作各自形成独立 undo step", () => {
    const session = textSession("base")
    try {
      const appendText = (text: string) => {
        const position = session.editor.state.doc.content.size - 1
        session.editor.view.dispatch(session.editor.state.tr.insertText(text, position))
      }
      appendText(" typed")
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
      dispatchClipboard(session, "paste", new Map([["text/plain", "one"]]))
      const afterPaste = session.editor.getText()
      appendText(" after-paste")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe(afterPaste)
      dispatchClipboard(session, "paste", new Map([["text/plain", "two"]]))
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).not.toContain("two")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).not.toContain("one")
      expect(session.editor.getText()).toContain("typed")

      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 1, 2)))
      dispatchClipboard(session, "cut")
      appendText(" after-cut")
      expect(session.undo()).toBe(true)
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 1, 2)))
      dispatchClipboard(session, "cut")
      expect(session.undo()).toBe(true)
      expect(session.undo()).toBe(true)
    } finally {
      session.destroy()
    }
  })

  it("粘贴紧邻的前后快速输入各自独立成 undo 步：closeHistory 隔离前序，后序相邻输入合并为一段", async () => {
    const session = textSession("base")
    try {
      const appendText = (text: string) => {
        const position = session.editor.state.doc.content.size - 1
        session.editor.view.dispatch(session.editor.state.tr.insertText(text, position))
      }
      appendText(" pre")
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2)))
      dispatchClipboard(session, "paste", new Map([["text/plain", "PASTED"]]))
      const afterPaste = session.editor.getText()
      // 让 armPaste 的 queueMicrotask 清理 activeClipboard（模拟真实事件循环；同一 tick 的后续
      // dispatch 会仍被当作 clipboard transaction，不能代表粘贴后的普通输入）。
      await Promise.resolve()
      // 同一 tick 连续两次后序输入：closeFollowingInput 只对第一条 closeHistory，第二条正常并入，
      // 因此二者同属粘贴之后的一段历史，而不会污染粘贴步或 pre 步。
      appendText(" post1")
      appendText(" post2")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe(afterPaste)
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).not.toContain("PASTED")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).not.toContain("pre")
      expect(session.editor.getText()).toContain("base")
    } finally {
      session.destroy()
    }
  })

  it("cut 与紧邻前后快速输入各自独立成 undo 步", async () => {
    const session = textSession("cutme")
    try {
      const appendText = (text: string) => {
        const position = session.editor.state.doc.content.size - 1
        session.editor.view.dispatch(session.editor.state.tr.insertText(text, position))
      }
      appendText(" pre")
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 1, 2)))
      dispatchClipboard(session, "cut")
      const afterCut = session.editor.getText()
      await Promise.resolve()
      appendText(" post1")
      appendText(" post2")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe(afterCut)
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toContain("cutme")
      expect(session.editor.getText()).toContain("pre")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("cutme")
    } finally {
      session.destroy()
    }
  })
})
