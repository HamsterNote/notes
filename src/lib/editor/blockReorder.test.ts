// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { undoDepth } from "@tiptap/pm/history"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { encodeHnn, type HnnDocument } from "../hnn/codec"
import {
  computeInsertionBoundary,
  HNN_BLOCK_REORDER_MIME,
  HNN_REORDER_HOLD_MS,
  reorderTopLevelBlock
} from "./blockReorder"
import { createEditorSession, type EditorSession } from "./session"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003",
  "123e4567-e89b-42d3-a456-426614174004",
  "123e4567-e89b-42d3-a456-426614174005",
  "123e4567-e89b-42d3-a456-426614174006",
  "123e4567-e89b-42d3-a456-426614174007"
]

function paragraphsDocument(...texts: string[]): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: texts.map((text, index) => ({
        type: "paragraph",
        attrs: { nodeId: ids[index] },
        content: [{ type: "text", text }]
      }))
    }
  }
}

function nestedDocument(): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: ids[0] }, content: [{ type: "text", text: "intro" }] },
        {
          type: "bulletList",
          attrs: { nodeId: ids[1] },
          content: [{
            type: "listItem",
            attrs: { nodeId: ids[2] },
            content: [
              { type: "paragraph", attrs: { nodeId: ids[3] }, content: [{ type: "text", text: "item" }] },
              {
                type: "bulletList",
                attrs: { nodeId: ids[4] },
                content: [{
                  type: "listItem",
                  attrs: { nodeId: ids[5] },
                  content: [{ type: "paragraph", attrs: { nodeId: ids[6] }, content: [{ type: "text", text: "nested" }] }]
                }]
              }
            ]
          }]
        }
      ]
    }
  }
}

function tableDocument(): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: ids[0] }, content: [{ type: "text", text: "before" }] },
        {
          type: "table",
          attrs: { nodeId: ids[1] },
          content: [{
            type: "tableRow",
            attrs: { nodeId: ids[2] },
            content: [{
              type: "tableCell",
              attrs: { nodeId: ids[3], colspan: 1, rowspan: 1, colwidth: null, align: null },
              content: [{ type: "paragraph", attrs: { nodeId: ids[4] }, content: [{ type: "text", text: "cell" }] }]
            }]
          }]
        }
      ]
    }
  }
}

/**
 * 事件真实性的关键：未挂载的编辑器事件不会传播到 document，而生产环境 NoteEditor
 * 总是挂载在文档内。测试统一把 TipTap 创建的编辑壳挂进 document.body，使
 * document 级 capture/bubble 监听（桌面 drag、移动端 pointer）与真机一致。
 */
const mountedShells: HTMLElement[] = []

function mountShell(session: EditorSession): void {
  const shell = session.editor.view.dom.parentElement
  if (shell instanceof HTMLElement && !shell.isConnected) {
    document.body.appendChild(shell)
    mountedShells.push(shell)
  }
}

function sessionFor(initialDocument: HnnDocument): EditorSession {
  const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument })
  mountShell(session)
  return session
}

function topLevelTexts(session: EditorSession): string[] {
  const texts: string[] = []
  session.editor.state.doc.forEach((child) => {
    texts.push(child.textContent)
  })
  return texts
}

function topLevelNodeIds(session: EditorSession): unknown[] {
  const nodeIds: unknown[] = []
  session.editor.state.doc.forEach((child) => {
    nodeIds.push(child.attrs["nodeId"])
  })
  return nodeIds
}

function handles(session: EditorSession): HTMLElement[] {
  return Array.from(session.editor.view.dom.querySelectorAll<HTMLElement>("[data-drag-handle]"))
}

function blockDoms(session: EditorSession): HTMLElement[] {
  return Array.from(session.editor.view.dom.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && !element.hasAttribute("data-drag-handle")
  )
}

/** jsdom 没有 DragEvent/PointerEvent：以结构性字段构造（与本库事件读取方式一致）。 */
function dragEvent(type: string, init: { clientX?: number; clientY?: number; dataTransfer?: unknown } = {}): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX: 0, clientY: 0, dataTransfer: null, ...init })
  return event
}

function pointerEvent(type: string, init: { pointerId?: number; pointerType?: string; clientX?: number; clientY?: number } = {}): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, pointerType: "touch", clientX: 0, clientY: 0, ...init })
  return event
}

function dataTransferStub() {
  const data = new Map<string, string>()
  return {
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value)
    }),
    getData: (type: string) => data.get(type) ?? "",
    // 与现代浏览器一致：types 反映当前已写入的 MIME 列表。
    get types(): string[] {
      return Array.from(data.keys())
    },
    effectAllowed: "",
    dropEffect: "",
    setDragImage: vi.fn()
  }
}

/** 给每个顶层块铺设 100px 高的垂直跨度：块 i 占 [i*100, i*100+100)，中点 i*100+50。 */
function layoutBlocks(session: EditorSession): void {
  blockDoms(session).forEach((block, index) => {
    rects.set(block, { top: index * 100, bottom: index * 100 + 100 })
  })
}

let rects: Map<Element, { top: number; bottom: number }>

beforeEach(() => {
  rects = new Map()
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const entry = rects.get(this)
    const top = entry?.top ?? 0
    const bottom = entry?.bottom ?? 0
    return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  mountedShells.splice(0).forEach((shell) => shell.remove())
})

describe("computeInsertionBoundary（垂直中点规则，两端共用）", () => {
  const spans = [
    { top: 0, bottom: 100 },
    { top: 100, bottom: 200 },
    { top: 200, bottom: 300 }
  ]

  it("按越过中点的块数返回 0..N 的插入边界", () => {
    expect(computeInsertionBoundary(spans, -10)).toBe(0)
    expect(computeInsertionBoundary(spans, 50)).toBe(0)
    expect(computeInsertionBoundary(spans, 51)).toBe(1)
    expect(computeInsertionBoundary(spans, 149)).toBe(1)
    expect(computeInsertionBoundary(spans, 151)).toBe(2)
    expect(computeInsertionBoundary(spans, 250)).toBe(2)
    expect(computeInsertionBoundary(spans, 999)).toBe(3)
  })

  it("空文档只有边界 0", () => {
    expect(computeInsertionBoundary([], 100)).toBe(0)
  })
})

describe("重排手柄挂载", () => {
  it("每个顶层块恰好一个 data-drag-handle 手柄，位于所属块之前且不可编辑", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      const blocks = blockDoms(session)
      const all = handles(session)
      expect(all).toHaveLength(3)
      expect(blocks).toHaveLength(3)
      all.forEach((handle, index) => {
        expect(handle.nextElementSibling).toBe(blocks[index])
        expect(handle.getAttribute("contenteditable")).toBe("false")
        expect(handle.getAttribute("draggable")).toBe("true")
      })
    } finally {
      session.destroy()
    }
  })

  it("嵌套列表项与表格内部节点没有手柄，结构上不可独立重排", () => {
    const nested = sessionFor(nestedDocument())
    const table = sessionFor(tableDocument())
    try {
      expect(handles(nested)).toHaveLength(2)
      expect(nested.editor.view.dom.querySelector("[data-drag-handle]")).not.toBeNull()
      expect(nested.editor.view.dom.querySelectorAll("li [data-drag-handle]")).toHaveLength(0)

      expect(handles(table)).toHaveLength(2)
      expect(table.editor.view.dom.querySelectorAll("td [data-drag-handle], th [data-drag-handle]")).toHaveLength(0)
    } finally {
      nested.destroy()
      table.destroy()
    }
  })

  it("文档变化后手柄仍与顶层块一一对应", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      const { state, view } = session.editor
      const paragraph = state.schema.nodes["paragraph"]!.create({ nodeId: ids[5] }, state.schema.text("new"))
      view.dispatch(state.tr.insert(0, paragraph))
      expect(handles(session)).toHaveLength(3)
      expect(handles(session)[0]?.nextElementSibling?.textContent).toBe("new")
    } finally {
      session.destroy()
    }
  })

  it("手柄按下不交给 ProseMirror，上下文菜单被抑制（移动端长按）", () => {
    const session = sessionFor(paragraphsDocument("a"))
    const mousedownProbe = vi.fn()
    session.editor.view.dom.addEventListener("mousedown", mousedownProbe)
    try {
      handles(session)[0]!.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }))
      expect(mousedownProbe).not.toHaveBeenCalled()

      const contextmenu = new window.Event("contextmenu", { bubbles: true, cancelable: true })
      handles(session)[0]!.dispatchEvent(contextmenu)
      expect(contextmenu.defaultPrevented).toBe(true)
    } finally {
      session.destroy()
    }
  })
})

describe("reorderTopLevelBlock 提交", () => {
  it("移动首块到末尾：顺序改变、nodeId 保留、恰好一个 transaction 由一次撤销还原", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      expect(reorderTopLevelBlock(session.editor.view, 0, 3)).toBe(true)
      expect(topLevelTexts(session)).toEqual(["b", "c", "a"])
      expect(topLevelNodeIds(session)).toEqual([ids[1], ids[2], ids[0]])
      expect(session.state.dirty).toBe(true)

      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
      expect(session.redo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["b", "c", "a"])
    } finally {
      session.destroy()
    }
  })

  it("移动末块到最前与中间块换位", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      expect(reorderTopLevelBlock(session.editor.view, 2, 0)).toBe(true)
      expect(topLevelTexts(session)).toEqual(["c", "a", "b"])
      expect(session.undo()).toBe(true)

      expect(reorderTopLevelBlock(session.editor.view, 0, 2)).toBe(true)
      expect(topLevelTexts(session)).toEqual(["b", "a", "c"])
      expect(session.undo()).toBe(true)

      expect(reorderTopLevelBlock(session.editor.view, 1, 3)).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "c", "b"])
    } finally {
      session.destroy()
    }
  })

  it("移动后整块处于 NodeSelection，标出落点", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      reorderTopLevelBlock(session.editor.view, 0, 2)
      const selection = session.editor.state.selection
      expect(selection).toBeInstanceOf(NodeSelection)
      expect((selection as NodeSelection).node.textContent).toBe("a")
    } finally {
      session.destroy()
    }
  })

  it.each([
    ["fromIndex 越界", -1, 2],
    ["fromIndex 超出块数", 9, 0],
    ["boundary 为负", 0, -1],
    ["boundary 超出块数", 0, 9],
    ["原地放置（boundary === fromIndex）", 1, 1],
    ["原地放置（boundary === fromIndex + 1）", 1, 2],
    ["fromIndex 为 NaN", Number.NaN, 2],
    ["fromIndex 为小数", 0.5, 2],
    ["fromIndex 为 -Infinity", Number.NEGATIVE_INFINITY, 0],
    ["boundary 为 NaN", 0, Number.NaN],
    ["boundary 为小数", 0, 1.5],
    ["boundary 为 Infinity", 0, Number.POSITIVE_INFINITY]
  ])("非法或原地重排是 no-op：%s", (_label, fromIndex, boundary) => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      expect(reorderTopLevelBlock(session.editor.view, fromIndex, boundary)).toBe(false)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
      expect(session.undo()).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("closeHistory 令重排与紧邻正文输入切分为独立 undo step", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      // 先做一次正文编辑，再重排；第一步撤销只还原重排，正文编辑保留。
      session.editor.view.dispatch(session.editor.state.tr.insertText("!", 2))
      reorderTopLevelBlock(session.editor.view, 0, 2)
      expect(topLevelTexts(session)).toEqual(["b", "a!"])

      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a!", "b"])
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b"])
    } finally {
      session.destroy()
    }
  })

  it("重排后紧随的相邻输入另起 undo 组：第一步撤销只回退输入，顺序保持重排态", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      reorderTopLevelBlock(session.editor.view, 0, 2)
      expect(topLevelTexts(session)).toEqual(["b", "a"])
      // 重排后同一 tick 内在被移动的块内继续输入（与插入区间相邻、间隔 0ms）：
      // PM 默认分组会把它并入重排事件；历史栅栏必须将其切分为独立 undo step。
      session.editor.view.dispatch(session.editor.state.tr.insertText("!", 5))
      expect(topLevelTexts(session)).toEqual(["b", "a!"])

      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["b", "a"])
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b"])
    } finally {
      session.destroy()
    }
  })

  it("表格等 atom 顶层块同样可整体移动，文档保持合法", () => {
    const session = sessionFor(tableDocument())
    try {
      expect(reorderTopLevelBlock(session.editor.view, 1, 0)).toBe(true)
      expect(topLevelTexts(session)).toEqual(["cell", "before"])
      expect(() => encodeHnn(session.editor.state.doc)).not.toThrow()
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["before", "cell"])
    } finally {
      session.destroy()
    }
  })
})

describe("只读模式（view.editable = false）", () => {
  it("程序化重排被拒绝：不 throw、零事务；恢复可编辑后可用", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      session.editor.setEditable(false)
      expect(reorderTopLevelBlock(session.editor.view, 0, 2)).toBe(false)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
      expect(session.undo()).toBe(false)

      session.editor.setEditable(true)
      expect(reorderTopLevelBlock(session.editor.view, 0, 2)).toBe(true)
      expect(topLevelTexts(session)).toEqual(["b", "a", "c"])
    } finally {
      session.destroy()
    }
  })

  it("手柄不启动手势、不劫持指针事件，selection 不受影响", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      // 先落一个文本选区，再切只读。
      session.editor.view.dispatch(
        session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, 2))
      )
      const selectionBefore = session.editor.state.selection
      session.editor.setEditable(false)
      // CSS 隐藏规则的前提：PM 以 attribute 形式写 contenteditable="false"。
      expect(session.editor.view.dom.getAttribute("contenteditable")).toBe("false")

      const handle = handles(session)[0]!
      // 原生 dragstart 被 preventDefault，不进入拖拽态。
      const start = dragEvent("dragstart", { dataTransfer: dataTransferStub() })
      handle.dispatchEvent(start)
      expect(start.defaultPrevented).toBe(true)
      expect(handle.classList.contains("hn-editor-block-handle--dragging")).toBe(false)

      // mousedown 不交给 PM：selection 保持原样，不被假手柄劫持。
      handle.dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }))
      expect(session.editor.state.selection.eq(selectionBefore)).toBe(true)

      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("触摸长按不挂起：500ms 后无激活、无事务", () => {
    vi.useFakeTimers()
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      session.editor.setEditable(false)
      const handle = handles(session)[0]!
      handle.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch" }))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS + 100)
      expect(handle.classList.contains("hn-editor-block-handle--dragging")).toBe(false)
      expect(session.editor.view.dom.querySelector(".hn-editor-block-dragging")).toBeNull()
      document.dispatchEvent(pointerEvent("pointerup"))
      expect(session.state.dirty).toBe(false)
      expect(session.undo()).toBe(false)
    } finally {
      session.destroy()
    }
  })
})

describe("桌面原生拖拽（draggable + data-drag-handle）", () => {
  it("dragstart → dragover 预览 → drop 提交，恰好一个 transaction，PM 原生 drop 被抑制", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    const pmDropProbe = vi.fn()
    // PM 的 drop 监听器在视图构造时注册（先于本探针）；stopImmediatePropagation 后探针不得触发。
    session.editor.view.dom.addEventListener("drop", pmDropProbe)
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const dataTransfer = dataTransferStub()

      const start = dragEvent("dragstart", { dataTransfer, clientX: 5, clientY: 5 })
      handles(session)[0]!.dispatchEvent(start)
      expect(start.defaultPrevented).toBe(false)
      expect(dataTransfer.setData).toHaveBeenCalledWith(HNN_BLOCK_REORDER_MIME, "0")
      expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "")
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(true)

      const over = dragEvent("dragover", { dataTransfer, clientY: 260 })
      blocks[2]!.dispatchEvent(over)
      expect(over.defaultPrevented).toBe(true)
      expect(dataTransfer.dropEffect).toBe("move")
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      const drop = dragEvent("drop", { dataTransfer, clientY: 260 })
      blocks[2]!.dispatchEvent(drop)
      expect(drop.defaultPrevented).toBe(true)
      expect(pmDropProbe).not.toHaveBeenCalled()
      expect(topLevelTexts(session)).toEqual(["b", "c", "a"])
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(false)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(false)

      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })

  it("dragend 取消（未 drop）不产生事务并清理瞬态", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const dataTransfer = dataTransferStub()
      handles(session)[0]!.dispatchEvent(dragEvent("dragstart", { dataTransfer }))
      blocks[1]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 160 }))
      // clientY 160 越过块1中点(150)：边界 2，指示线落在块2上沿。
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(true)

      handles(session)[0]!.dispatchEvent(dragEvent("dragend", { dataTransfer }))
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(false)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("拖出编辑区时清除预览，外部 drop 不提交", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const dataTransfer = dataTransferStub()
      handles(session)[0]!.dispatchEvent(dragEvent("dragstart", { dataTransfer }))
      blocks[1]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 160 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(true)

      // 离开编辑区：预览清除；drop 落在编辑区外不做任何事。
      document.body.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 160 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(false)
      document.body.dispatchEvent(dragEvent("drop", { dataTransfer, clientY: 160 }))
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      handles(session)[0]!.dispatchEvent(dragEvent("dragend", { dataTransfer }))
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("无激活手势的滞留重排 MIME drop 被吞掉：文档、选区、历史均不动", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const docBefore = session.editor.state.doc
      const selectionBefore = session.editor.state.selection
      // 模拟手势已结束（dragend 竞态）但事件仍携带重排 MIME 的滞留 drop。
      const dataTransfer = dataTransferStub()
      dataTransfer.setData(HNN_BLOCK_REORDER_MIME, "0")
      dataTransfer.setData("text/plain", "")
      const drop = dragEvent("drop", { dataTransfer, clientY: 260 })
      blockDoms(session)[2]!.dispatchEvent(drop)

      // 插件 handleDOMEvents.drop 认领（preventDefault + return true），PM 内建 drop 不执行。
      expect(drop.defaultPrevented).toBe(true)
      expect(session.editor.state.doc).toBe(docBefore)
      expect(session.editor.state.selection.eq(selectionBefore)).toBe(true)
      expect(session.state.dirty).toBe(false)
      expect(session.undo()).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("不携带重排 MIME 的外部 drop（如未来图片拖入）不归重排认领，完整交还 PM", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const dataTransfer = dataTransferStub()
      dataTransfer.setData("text/plain", "dropped-image.png")
      const drop = dragEvent("drop", { dataTransfer, clientY: 260 })

      // 直接调插件 prop 断言认领结果。注意 PM 的 someProp 以真值判断（返回 false 视为
      // 未处理、继续迭代），所以这里断言 falsy 即可——关键是 handler 返回 false 且未
      // preventDefault，PM 内建 editHandlers.drop 会照常执行。
      const handled = session.editor.view.someProp("handleDOMEvents", (handlers) => {
        const handler = handlers["drop"]
        // PM 类型要求 DragEvent；jsdom 没有该类，测试事件是结构等价的 Event。
        return handler ? handler(session.editor.view, drop as unknown as DragEvent) : undefined
      })
      expect(handled).toBeFalsy()
      expect(drop.defaultPrevented).toBe(false)

      // 真实派发：未被 stopImmediatePropagation，view.dom 上的后续监听器照常收到。
      // jsdom 未实现 document.elementFromPoint：补一个返回 null 的桩，让 PM 原生 drop
      // 走到 posAtCoords 后按“落点不在编辑区内”平静退出，而不是抛 TypeError。
      const probe = vi.fn()
      session.editor.view.dom.addEventListener("drop", probe)
      const docPoint = document as unknown as Record<"elementFromPoint", () => Element | null>
      docPoint["elementFromPoint"] = () => null
      try {
        blockDoms(session)[2]!.dispatchEvent(drop)
      } finally {
        Reflect.deleteProperty(document, "elementFromPoint")
      }
      expect(probe).toHaveBeenCalled()
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })

  it("dragover 越过中点切换到相邻边界", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const dataTransfer = dataTransferStub()
      handles(session)[0]!.dispatchEvent(dragEvent("dragstart", { dataTransfer }))

      blocks[1]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 140 }))
      expect(blocks[1]!.classList.contains("hn-editor-block-drop-before")).toBe(true)
      blocks[1]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 160 }))
      expect(blocks[1]!.classList.contains("hn-editor-block-drop-before")).toBe(false)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(true)

      blocks[1]!.dispatchEvent(dragEvent("drop", { dataTransfer, clientY: 160 }))
      expect(topLevelTexts(session)).toEqual(["b", "a", "c"])
    } finally {
      session.destroy()
    }
  })

  it("末块 before/after 指示在同一 DOM 上正确切换（same-dom 早退回归）", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const dataTransfer = dataTransferStub()
      handles(session)[0]!.dispatchEvent(dragEvent("dragstart", { dataTransfer }))

      // clientY 240 → 边界 2 → 末块 before；clientY 260 → 边界 3 → 末块 after。
      // 两种边界的指示线挂在同一个 DOM（末块）上，早退判断必须同时比对 class。
      blocks[2]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 240 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(true)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(false)

      blocks[2]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 260 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(false)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      // 反向同样成立：after → before。
      blocks[2]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 240 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(true)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(false)

      handles(session)[0]!.dispatchEvent(dragEvent("dragend", { dataTransfer }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-before")).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("drop 以自身 clientY 刷新落点，不沿用最后一次 dragover 的边界", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const dataTransfer = dataTransferStub()
      handles(session)[0]!.dispatchEvent(dragEvent("dragstart", { dataTransfer }))

      // 最后一次 dragover 在末尾（边界 3），但 drop 落在 clientY 160（边界 2）：
      // 浏览器不保证 drop 前还有同位置 dragover，落点必须以 drop 坐标为准。
      blocks[2]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 260 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      blocks[1]!.dispatchEvent(dragEvent("drop", { dataTransfer, clientY: 160 }))
      expect(topLevelTexts(session)).toEqual(["b", "a", "c"])
    } finally {
      session.destroy()
    }
  })

  it("active 拖拽期间前序块被外部删除：手势取消，drop 不提交错块", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const dataTransfer = dataTransferStub()
      // 拖块 b（fromIndex 1），预览落在块 c 上沿（边界 2）。
      handles(session)[1]!.dispatchEvent(dragEvent("dragstart", { dataTransfer }))
      blocks[2]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 240 }))
      expect(blocks[1]!.classList.contains("hn-editor-block-dragging")).toBe(true)

      // 手势期间外部删除前序块 a：fromIndex 1 此刻已指向块 c，提交即错块。
      // 保守策略要求 docChanged 即取消手势，本次 drop 不提交任何重排。
      const firstSize = session.editor.state.doc.firstChild!.nodeSize
      session.editor.view.dispatch(session.editor.state.tr.delete(0, firstSize))
      // 瞬态清理以 live DOM 为准：装饰由 PM 持有，docChanged 后 PM 可能重建块
      // DOM（手势期捕获的 blocks[] 引用已脱离文档，其上的类不再代表可见状态）。
      expect(session.editor.view.dom.querySelector(".hn-editor-block-dragging")).toBeNull()
      expect(session.editor.view.dom.querySelector(".hn-editor-block-drop-before, .hn-editor-block-drop-after")).toBeNull()

      session.editor.view.dom.dispatchEvent(dragEvent("drop", { dataTransfer, clientY: 140 }))
      expect(topLevelTexts(session)).toEqual(["b", "c"])
      // 历史中只有外部删除一个事件：一次撤销即还原初始文档。
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })
})

describe("移动端 Pointer Events 手柄长按 500ms", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("长按激活后拖动提交；激活后禁止原生滚动与文本选择", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const handle = handles(session)[0]!

      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 10 }))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS - 1)
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(false)

      vi.advanceTimersByTime(1)
      expect(handle.classList.contains("hn-editor-block-handle--dragging")).toBe(true)
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(true)

      // 激活后：selectstart / touchmove 被抑制（非 passive preventDefault）
      const selectstart = new window.Event("selectstart", { bubbles: true, cancelable: true })
      document.dispatchEvent(selectstart)
      expect(selectstart.defaultPrevented).toBe(true)
      const touchmove = new window.Event("touchmove", { bubbles: true, cancelable: true })
      session.editor.view.dom.dispatchEvent(touchmove)
      expect(touchmove.defaultPrevented).toBe(true)

      document.dispatchEvent(pointerEvent("pointermove", { clientY: 260 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      document.dispatchEvent(pointerEvent("pointerup"))
      expect(topLevelTexts(session)).toEqual(["b", "c", "a"])
      expect(handle.classList.contains("hn-editor-block-handle--dragging")).toBe(false)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(false)

      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })

  it("500ms 前抬起取消挂起，文档与历史不受影响", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      handles(session)[0]!.dispatchEvent(pointerEvent("pointerdown"))
      document.dispatchEvent(pointerEvent("pointerup"))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS + 100)
      expect(blockDoms(session)[0]!.classList.contains("hn-editor-block-dragging")).toBe(false)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("激活前位移超过 slop 即取消，保留原生滚动手势", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      handles(session)[0]!.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 10 }))
      document.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 26 }))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS + 100)
      expect(blockDoms(session)[0]!.classList.contains("hn-editor-block-dragging")).toBe(false)

      // 取消后整个手势是 no-op：再移动/抬起都不产生预览与事务。
      document.dispatchEvent(pointerEvent("pointermove", { clientY: 260 }))
      expect(session.editor.view.dom.querySelector(".hn-editor-block-drop-before, .hn-editor-block-drop-after")).toBeNull()
      document.dispatchEvent(pointerEvent("pointerup"))
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("pointercancel（浏览器接管滚动）取消挂起；其他 pointerId 不干扰", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      handles(session)[0]!.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1 }))
      // 另一根手指的事件不取消当前挂起。
      document.dispatchEvent(pointerEvent("pointermove", { pointerId: 2, clientX: 0, clientY: 200 }))
      document.dispatchEvent(pointerEvent("pointercancel", { pointerId: 1 }))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS + 100)
      expect(blockDoms(session)[0]!.classList.contains("hn-editor-block-dragging")).toBe(false)
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("激活后 pointercancel 只清理瞬态，绝不提交", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      handles(session)[0]!.dispatchEvent(pointerEvent("pointerdown"))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS)
      document.dispatchEvent(pointerEvent("pointermove", { clientY: 260 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      document.dispatchEvent(pointerEvent("pointercancel"))
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(false)
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("鼠标 pointerdown 不进入长按路径（桌面走原生拖拽）", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      handles(session)[0]!.dispatchEvent(pointerEvent("pointerdown", { pointerType: "mouse" }))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS + 100)
      expect(blockDoms(session)[0]!.classList.contains("hn-editor-block-dragging")).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("挂起中销毁会话：计时器与 document 监听全部清理", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    handles(session)[0]!.dispatchEvent(pointerEvent("pointerdown"))
    session.destroy()
    expect(() => {
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS + 100)
      document.dispatchEvent(pointerEvent("pointerup"))
    }).not.toThrow()
  })

  it("pending 长按期间前序块被外部插入：不再激活，释放不提交", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      const handle = handles(session)[0]!
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 10 }))

      // 500ms 窗口内文档发生外部变更（顶部插入一段）：捕获的 fromIndex 已不可靠，
      // 保守策略直接取消挂起，计时器不再激活手势。
      const paragraph = session.editor.schema.nodes["paragraph"]!
      session.editor.view.dispatch(
        session.editor.state.tr.insert(0, paragraph.create({ nodeId: ids[7] }, session.editor.schema.text("x")))
      )

      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS + 100)
      expect(handle.classList.contains("hn-editor-block-handle--dragging")).toBe(false)
      expect(session.editor.view.dom.querySelector(".hn-editor-block-dragging")).toBeNull()

      // 后续移动/抬起整个手势都是 no-op：不产生预览与事务，文档只剩外部插入的结果。
      document.dispatchEvent(pointerEvent("pointermove", { clientY: 260 }))
      expect(session.editor.view.dom.querySelector(".hn-editor-block-drop-before, .hn-editor-block-drop-after")).toBeNull()
      document.dispatchEvent(pointerEvent("pointerup"))
      expect(topLevelTexts(session)).toEqual(["x", "a", "b", "c"])
      // 历史中只有外部插入一个事件。
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })

  it("active 指针拖拽期间源块被外部删除：释放不提交且瞬态清理", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const handle = handles(session)[0]!
      handle.dispatchEvent(pointerEvent("pointerdown"))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS)
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(true)

      // 激活后源块 a 被外部删除：fromIndex 0 此刻指向块 b，提交即错块。
      const firstSize = session.editor.state.doc.firstChild!.nodeSize
      session.editor.view.dispatch(session.editor.state.tr.delete(0, firstSize))
      // 瞬态清理以 live DOM 为准（docChanged 后 PM 可能重建块 DOM，stale 引用
      // 上残留的类不在文档中，不代表可见状态）。
      expect(session.editor.view.dom.querySelector(".hn-editor-block-dragging")).toBeNull()

      document.dispatchEvent(pointerEvent("pointermove", { clientY: 60 }))
      document.dispatchEvent(pointerEvent("pointerup"))
      expect(topLevelTexts(session)).toEqual(["b", "c"])
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })

  it("拖拽中销毁会话：不提交、不抛错", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    handles(session)[0]!.dispatchEvent(pointerEvent("pointerdown"))
    vi.advanceTimersByTime(HNN_REORDER_HOLD_MS)
    session.destroy()
    expect(() => document.dispatchEvent(pointerEvent("pointerup"))).not.toThrow()
  })
})

describe("拖拽视觉：PM 装饰持续性与事务零扰动（bug-7.5-2 回归）", () => {
  it("桌面拖拽：真实停留 250ms 后预览与源高亮仍在；无关 transaction 不再抹除；doc/selection/history 零扰动", async () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const dataTransfer = dataTransferStub()
      const docBefore = session.editor.state.doc
      const selectionBefore = session.editor.state.selection
      const undoDepthBefore = undoDepth(session.editor.state) as number // 上游 d.ts 返回 any，此处收敛为 number

      handles(session)[0]!.dispatchEvent(dragEvent("dragstart", { dataTransfer }))
      blocks[2]!.dispatchEvent(dragEvent("dragover", { dataTransfer, clientY: 260 }))
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(true)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      // 用户拖拽停留的真实可见窗口（真实计时器）：装饰由 PM 持有，
      // 不存在任何“定时重挂 class”的作弊路径（真实浏览器墙钟验收见 qa S1.15）。
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(true)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      // 拖拽期间的无关 transaction（自动保存栅栏、远端状态等）触发 PM 重绘，
      // 旧实现直写内容 DOM 的 class 即在此处被抹掉；装饰类由 PM 重建，必须仍在。
      session.editor.view.dispatch(session.editor.state.tr.setMeta("unrelatedProbe", 1))
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(true)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      // 手势期的全部视觉 transaction 都是 meta-only：doc/selection/history 零扰动。
      expect(session.editor.state.doc).toBe(docBefore)
      expect(session.editor.state.selection.eq(selectionBefore)).toBe(true)
      expect(undoDepth(session.editor.state)).toBe(undoDepthBefore)
      expect(session.state.dirty).toBe(false)

      // drop 提交仍是单历史步：一次 undo 精确还原。
      blocks[2]!.dispatchEvent(dragEvent("drop", { dataTransfer, clientY: 260 }))
      expect(topLevelTexts(session)).toEqual(["b", "c", "a"])
      expect(undoDepth(session.editor.state)).toBe(undoDepthBefore + 1)
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })

  it("移动端指针拖拽：激活后停留 250ms 预览仍在，pointerup 提交单历史步", () => {
    vi.useFakeTimers()
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      layoutBlocks(session)
      const blocks = blockDoms(session)
      const handle = handles(session)[0]!
      const undoDepthBefore = undoDepth(session.editor.state) as number // 上游 d.ts 返回 any，此处收敛为 number

      handle.dispatchEvent(pointerEvent("pointerdown"))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS)
      document.dispatchEvent(pointerEvent("pointermove", { clientY: 260 }))
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)

      // 停留 250ms（用户可感知窗口）：无任何定时器重挂，装饰持续存在。
      vi.advanceTimersByTime(250)
      expect(blocks[0]!.classList.contains("hn-editor-block-dragging")).toBe(true)
      expect(blocks[2]!.classList.contains("hn-editor-block-drop-after")).toBe(true)
      expect(undoDepth(session.editor.state)).toBe(undoDepthBefore)

      document.dispatchEvent(pointerEvent("pointerup"))
      expect(topLevelTexts(session)).toEqual(["b", "c", "a"])
      expect(undoDepth(session.editor.state)).toBe(undoDepthBefore + 1)
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })
})

describe("重排持久化", () => {
  it("重排后的顺序与 nodeId 写入 HNN，重载后顺序保留", () => {
    const first = sessionFor(paragraphsDocument("a", "b", "c"))
    let snapshot: HnnDocument
    try {
      reorderTopLevelBlock(first.editor.view, 0, 3)
      snapshot = encodeHnn(first.editor.state.doc)
    } finally {
      first.destroy()
    }

    const reloaded = sessionFor(snapshot!)
    try {
      expect(topLevelTexts(reloaded)).toEqual(["b", "c", "a"])
      expect(topLevelNodeIds(reloaded)).toEqual([ids[1], ids[2], ids[0]])
      // 新会话历史重置：顺序保留但不携带上一次的重排 undo。
      expect(reloaded.undo()).toBe(false)
    } finally {
      reloaded.destroy()
    }
  })

  it("重排触发 onChange 快照，宿主可据此保存", () => {
    const changed: HnnDocument[] = []
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: paragraphsDocument("a", "b"),
      onChange: (snapshot) => changed.push(snapshot)
    })
    mountShell(session)
    try {
      reorderTopLevelBlock(session.editor.view, 1, 0)
      expect(changed).toHaveLength(1)
      expect(changed[0]!.data).toEqual(encodeHnn(session.editor.state.doc).data)
    } finally {
      session.destroy()
    }
  })

  it("重排产生的 NodeSelection 不属于持久内容", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      reorderTopLevelBlock(session.editor.view, 0, 2)
      expect(session.editor.state.selection).toBeInstanceOf(NodeSelection)
      // selection 可正常回到文本，文档不携带任何选择残留。
      const doc = session.editor.state.doc
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(doc, 1)))
      expect(session.editor.state.selection).toBeInstanceOf(TextSelection)
    } finally {
      session.destroy()
    }
  })
})
