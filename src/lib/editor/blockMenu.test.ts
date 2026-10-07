// @vitest-environment jsdom

/**
 * 块操作菜单（DESIGN.md §9，任务 7.5/D9）行为测试。
 *
 * 链路：session 接线 installBlockReorder 注入 openMenu → 手柄点击/键盘激活
 * 打开 openBlockMenu（菜单语义与关闭路径由 menuPopover 承担，其通用行为见
 * menuPopover.test.ts，这里只测块菜单自身的条目语义、undo 边界与只读守卫）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { HnnDocument } from "../hnn/codec"
import { HNN_REORDER_HOLD_MS } from "./blockReorder"
import { openBlockMenu } from "./blockMenu"
import { createEditorSession, type EditorSession } from "./session"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
  "123e4567-e89b-42d3-a456-426614174003",
  "123e4567-e89b-42d3-a456-426614174004"
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

/** 与 blockReorder.test.ts 同一范式：挂进 document，document 级监听与真机一致。 */
const mountedShells: HTMLElement[] = []

function sessionFor(initialDocument: HnnDocument): EditorSession {
  const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument })
  const shell = session.editor.view.dom.parentElement
  if (shell instanceof HTMLElement && !shell.isConnected) {
    document.body.appendChild(shell)
    mountedShells.push(shell)
  }
  return session
}

function handles(session: EditorSession): HTMLElement[] {
  return Array.from(session.editor.view.dom.querySelectorAll<HTMLElement>("[data-drag-handle]"))
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".hn-editor-menu")
}

function items(): HTMLButtonElement[] {
  const element = menu()
  expect(element).not.toBeNull()
  return Array.from(element!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
}

/** 按可见文案取菜单条目（两步确认会改文案，调用方需在确认前取）。 */
function item(label: string): HTMLButtonElement {
  const found = items().find((button) => button.textContent === label)
  expect(found, `菜单条目：${label}`).toBeDefined()
  return found!
}

function topLevelTexts(session: EditorSession): string[] {
  const texts: string[] = []
  session.editor.state.doc.forEach((child) => {
    texts.push(child.textContent)
  })
  return texts
}

function topLevelTypes(session: EditorSession): string[] {
  const types: string[] = []
  session.editor.state.doc.forEach((child) => {
    types.push(child.type.name)
  })
  return types
}

function clickHandle(session: EditorSession, index: number): HTMLElement {
  const handle = handles(session)[index]!
  handle.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
  return handle
}

function keydown(target: EventTarget, key: string): void {
  target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
}

/** jsdom 没有 PointerEvent：与 blockReorder.test.ts 相同的结构性事件构造。 */
function pointerEvent(type: string, init: { pointerId?: number; pointerType?: string; clientX?: number; clientY?: number } = {}): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, pointerType: "touch", clientX: 0, clientY: 0, ...init })
  return event
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
  // 兜底清理：失败用例可能留下未关闭的菜单与 file input。
  document.querySelectorAll(".hn-editor-menu, input[type='file']").forEach((element) => element.remove())
})

describe("打开/关闭与手柄激活态（DESIGN.md §9）", () => {
  it("点击手柄打开 role=menu 菜单：可访问名称、手柄 aria-expanded 与 menu-open 激活态", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      const handle = clickHandle(session, 0)
      expect(menu()).not.toBeNull()
      expect(menu()!.getAttribute("role")).toBe("menu")
      expect(menu()!.getAttribute("aria-label")).toBe("块操作菜单")
      expect(handle.getAttribute("aria-expanded")).toBe("true")
      expect(handle.classList.contains("hn-editor-block-handle--menu-open")).toBe(true)
      // 打开即聚焦首个可用条目：首块的"上移"禁用被跳过，焦点落在"下移"
      expect(document.activeElement).toBe(item("下移"))
    } finally {
      session.destroy()
    }
  })

  it("再次点击同一手柄 toggle 关闭：焦点归还手柄、激活态与 aria-expanded 复位", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      const handle = clickHandle(session, 1)
      expect(menu()).not.toBeNull()
      handle.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(handle)
      expect(handle.getAttribute("aria-expanded")).toBe("false")
      expect(handle.classList.contains("hn-editor-block-handle--menu-open")).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it.each(["Enter", " ", "ArrowDown"])("键盘 %s 打开菜单", (key) => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      keydown(handles(session)[0]!, key)
      expect(menu()).not.toBeNull()
    } finally {
      session.destroy()
    }
  })

  it("Escape 关闭菜单并把焦点归还手柄，激活态复位", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      const handle = clickHandle(session, 0)
      keydown(menu()!, "Escape")
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(handle)
      expect(handle.getAttribute("aria-expanded")).toBe("false")
    } finally {
      session.destroy()
    }
  })

  it("激活另一手柄：旧菜单关闭、新菜单打开（同一时间至多一个菜单）", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      const first = clickHandle(session, 0)
      const second = clickHandle(session, 2)
      expect(document.querySelectorAll(".hn-editor-menu")).toHaveLength(1)
      expect(first.getAttribute("aria-expanded")).toBe("false")
      expect(second.getAttribute("aria-expanded")).toBe("true")
    } finally {
      session.destroy()
    }
  })

  it("只读会话：点击与键盘激活都不打开菜单", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      session.editor.setEditable(false)
      const handle = handles(session)[0]!
      handle.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
      expect(menu()).toBeNull()
      keydown(handle, "Enter")
      expect(menu()).toBeNull()
    } finally {
      session.destroy()
    }
  })

  it("拖拽手势结束后的残余 click 被抑制，不误开菜单；下一次真实点击正常打开", () => {
    vi.useFakeTimers()
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      // 给每个顶层块铺 100px 跨度：块 i 占 [i*100, i*100+100)。
      const blocks = Array.from(session.editor.view.dom.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement && !element.hasAttribute("data-drag-handle")
      )
      blocks.forEach((block, index) => rects.set(block, { top: index * 100, bottom: index * 100 + 100 }))

      const handle = handles(session)[0]!
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 10 }))
      vi.advanceTimersByTime(HNN_REORDER_HOLD_MS)
      document.dispatchEvent(pointerEvent("pointermove", { clientY: 260 }))
      document.dispatchEvent(pointerEvent("pointerup"))
      expect(topLevelTexts(session)).toEqual(["b", "c", "a"])

      // 重排提交后装饰集重建：重新查询被移动块（"a" 现居 index 2）的手柄。
      // 浏览器在 pointer drop 后补发的 click：必须被吃掉。
      const movedHandle = handles(session)[2]!
      movedHandle.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
      expect(menu()).toBeNull()
      // 抑制是一次性的：下一次真实点击正常打开。
      movedHandle.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
      expect(menu()).not.toBeNull()
    } finally {
      session.destroy()
    }
  })
})

describe("上移/下移：键盘可用的重排通道（D9）", () => {
  it("首块禁用上移、末块禁用下移，均注明原因", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      clickHandle(session, 0)
      expect(item("上移").disabled).toBe(true)
      expect(item("上移").title).toBe("已是首个块")
      expect(item("下移").disabled).toBe(false)
      keydown(menu()!, "Escape")

      clickHandle(session, 2)
      expect(item("下移").disabled).toBe(true)
      expect(item("下移").title).toBe("已是末个块")
      expect(item("上移").disabled).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("下移与拖拽共享同一提交入口：顺序变化、nodeId 保留、一次撤销还原", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      clickHandle(session, 0)
      item("下移").click()
      expect(topLevelTexts(session)).toEqual(["b", "a", "c"])
      // 条目执行完成后菜单关闭、激活态复位。
      expect(menu()).toBeNull()
      expect(handles(session)[1]!.getAttribute("aria-expanded")).toBe("false")

      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("上移末块到中间：一次撤销还原", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      clickHandle(session, 2)
      item("上移").click()
      expect(topLevelTexts(session)).toEqual(["a", "c", "b"])
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["a", "b", "c"])
    } finally {
      session.destroy()
    }
  })

  it("菜单打开期间文档被外部修改：条目激活瞬间重新解析，仍作用于原块", () => {
    const session = sessionFor(paragraphsDocument("a", "b", "c"))
    try {
      clickHandle(session, 1) // 块 "b" 的菜单
      // 菜单保持打开，外部在顶部插入一段："b" 此刻已在 index 2。
      const paragraph = session.editor.schema.nodes["paragraph"]!
      session.editor.view.dispatch(
        session.editor.state.tr.insert(0, paragraph.create({ nodeId: ids[3] }, session.editor.schema.text("x")))
      )
      expect(menu()).not.toBeNull()
      item("下移").click()
      // 落点按激活瞬间的实时位置计算：移动的仍是 "b"，不是错位的邻居块。
      expect(topLevelTexts(session)).toEqual(["x", "a", "c", "b"])
      expect(session.undo()).toBe(true)
      expect(topLevelTexts(session)).toEqual(["x", "a", "b", "c"])
    } finally {
      session.destroy()
    }
  })
})

describe("安全转换（不可丢复合内容，不适用禁用）", () => {
  it("段落转换为标题 2：类型与 level 变化、nodeId 保留、一次撤销还原", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      clickHandle(session, 0)
      item("转换为标题 2").click()
      const first = session.editor.state.doc.firstChild!
      expect(first.type.name).toBe("heading")
      expect(first.attrs["level"]).toBe(2)
      expect(first.attrs["nodeId"]).toBe(ids[0])
      expect(menu()).toBeNull()

      expect(session.undo()).toBe(true)
      expect(session.editor.state.doc.firstChild!.type.name).toBe("paragraph")
    } finally {
      session.destroy()
    }
  })

  it("当前类型项禁用并注明“当前已是该类型”", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      clickHandle(session, 0)
      expect(item("转换为正文").disabled).toBe(true)
      expect(item("转换为正文").title).toBe("当前已是该类型")
      expect(item("转换为代码块").disabled).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("表格等复合块：全部转换项禁用并注明会丢内容，绝不静默 flatten；插入项仍可用", () => {
    const session = sessionFor(tableDocument())
    try {
      clickHandle(session, 1) // 表格块的菜单
      for (const label of ["转换为正文", "转换为标题 1", "转换为标题 2", "转换为标题 3", "转换为代码块"]) {
        expect(item(label).disabled).toBe(true)
        expect(item(label).title).toBe("该块包含复合结构，转换会丢失内容")
      }
      expect(item("插入表格").disabled).toBe(false)
      expect(topLevelTypes(session)).toEqual(["paragraph", "table"])
    } finally {
      session.destroy()
    }
  })
})

describe("转换无损与预算（oracle 7.5 回归）", () => {
  function inlineDoc(children: unknown[]): HnnDocument {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { nodeId: ids[0] }, content: children },
          { type: "paragraph", attrs: { nodeId: ids[1] }, content: [{ type: "text", text: "tail" }] }
        ]
      }
    }
  }

  it("代码块目标拒收 marks/内联 atom：link/bold/inlineFormula/mention/resource/hardBreak 均禁用并注明；纯文本可用", () => {
    const atomId = "123e4567-e89b-42d3-a456-426614174099"
    const cases: Array<{ label: string; children: unknown[] }> = [
      { label: "link", children: [{ type: "text", text: "a", marks: [{ type: "link", attrs: { href: "https://x.example" } }] }] },
      { label: "bold", children: [{ type: "text", text: "a", marks: [{ type: "bold" }] }] },
      { label: "inlineFormula", children: [{ type: "inlineFormula", attrs: { nodeId: atomId, latex: "x" } }] },
      { label: "mention", children: [{ type: "mention", attrs: { nodeId: atomId, resourceId: "r", name: "R" } }] },
      { label: "resource", children: [{ type: "resource", attrs: { nodeId: atomId, resourceId: "r", name: "R" } }] },
      { label: "hardBreak", children: [{ type: "text", text: "a" }, { type: "hardBreak", attrs: { nodeId: atomId } }] }
    ]
    for (const { label, children } of cases) {
      const session = sessionFor(inlineDoc(children))
      try {
        clickHandle(session, 0)
        expect(item("转换为代码块").disabled, label).toBe(true)
        expect(item("转换为代码块").title, label).toBe("该块包含标记或内联元素，转换会丢失内容")
        // marks/内联 atom 不影响 paragraph/heading 的无损性。
        expect(item("转换为标题 1").disabled, label).toBe(false)
        expect(session.editor.state.doc.firstChild!.type.name).toBe("paragraph")
      } finally {
        session.destroy()
      }
    }
    // 纯文本段落：代码块目标可用且转换不丢失文本。
    const plain = sessionFor(inlineDoc([{ type: "text", text: "plain" }]))
    try {
      clickHandle(plain, 0)
      expect(item("转换为代码块").disabled).toBe(false)
      item("转换为代码块").click()
      expect(plain.editor.state.doc.firstChild!.type.name).toBe("codeBlock")
      expect(plain.editor.state.doc.firstChild!.textContent).toBe("plain")
    } finally {
      plain.destroy()
    }
  })

  it("菜单打开后外部把段落改为含内联 atom：转换为代码块激活实时复核拒绝，零 doc/selection/history/dirty", () => {
    const session = sessionFor(inlineDoc([{ type: "text", text: "a" }]))
    try {
      clickHandle(session, 0)
      expect(item("转换为代码块").disabled).toBe(false)
      const formulaType = session.editor.schema.nodes["inlineFormula"]!
      const external = session.editor.state.tr
        .insert(1, formulaType.create({ nodeId: "123e4567-e89b-42d3-a456-426614174098", latex: "x" }))
        .setMeta("addToHistory", false)
      session.editor.view.dispatch(external)

      const before = session.editor.state.doc
      const beforeSelection = session.editor.state.selection.from
      item("转换为代码块").click()
      expect(session.editor.state.doc.eq(before)).toBe(true)
      expect(session.editor.state.doc.firstChild!.type.name).toBe("paragraph")
      expect(session.editor.state.selection.from).toBe(beforeSelection)
      expect(session.undo()).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("codeBlock 257 行转正文：最终候选展开超 512 节点，激活预算拒绝且零变更", () => {
    const codeText = Array.from({ length: 257 }, (_value, index) => `L${index}`).join("\n")
    const session = sessionFor({
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "codeBlock",
          attrs: { nodeId: ids[0], language: "plaintext", filename: "untitled" },
          content: [{ type: "text", text: codeText }]
        }]
      }
    })
    try {
      clickHandle(session, 0)
      expect(item("转换为正文").disabled).toBe(false)
      const before = session.editor.state.doc
      const beforeSelection = session.editor.state.selection.from
      item("转换为正文").click()
      expect(session.editor.state.doc.eq(before)).toBe(true)
      expect(session.editor.state.doc.firstChild!.type.name).toBe("codeBlock")
      expect(session.editor.state.selection.from).toBe(beforeSelection)
      expect(session.undo()).toBe(false)
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("接近节点预算（512）时插入表格/公式预检拒绝：零变更、无历史", () => {
    const nodeId = (index: number) => `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`
    const content: unknown[] = []
    for (let index = 0; index < 250; index += 1) {
      const children: unknown[] = [{ type: "text", text: `p${index}` }]
      if (index < 11) children.push({ type: "hardBreak", attrs: { nodeId: nodeId(1000 + index) } })
      content.push({ type: "paragraph", attrs: { nodeId: nodeId(index) }, content: children })
    }
    const session = sessionFor({ schemaVersion: 1, data: { type: "doc", content } })
    try {
      const before = session.editor.state.doc
      clickHandle(session, 0)
      // 插入表格 +15 节点、公式 +1 节点都越过 512 上限。
      item("插入表格").click()
      expect(session.editor.state.doc.eq(before)).toBe(true)
      expect(topLevelTypes(session).every((type) => type === "paragraph")).toBe(true)
      expect(session.undo()).toBe(false)
      clickHandle(session, 0)
      item("插入公式").click()
      expect(session.editor.state.doc.eq(before)).toBe(true)
      expect(session.undo()).toBe(false)
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("转换后同 tick 立即输入独立 undo：一次撤销只撤输入，再撤销才还原转换", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      session.editor.commands.setTextSelection(1)
      clickHandle(session, 0)
      item("转换为标题 2").click()
      expect(session.editor.state.doc.firstChild!.type.name).toBe("heading")
      // 与转换同一 tick（未等待历史分组窗口）立即输入。
      session.editor.commands.insertContent("X")
      expect(session.editor.state.doc.firstChild!.textContent).toContain("X")
      expect(session.undo()).toBe(true)
      expect(session.editor.state.doc.firstChild!.type.name).toBe("heading")
      expect(session.editor.state.doc.firstChild!.textContent).not.toContain("X")
      expect(session.undo()).toBe(true)
      expect(session.editor.state.doc.firstChild!.type.name).toBe("paragraph")
    } finally {
      session.destroy()
    }
  })
})

describe("适用插入", () => {
  it("插入表格：落在当前块之后，一次撤销还原", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      clickHandle(session, 0)
      item("插入表格").click()
      expect(topLevelTypes(session)).toEqual(["paragraph", "table", "paragraph"])
      expect(session.undo()).toBe(true)
      expect(topLevelTypes(session)).toEqual(["paragraph", "paragraph"])
    } finally {
      session.destroy()
    }
  })

  it("插入公式：落在当前块之后，一次撤销还原", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      clickHandle(session, 1)
      item("插入公式").click()
      expect(topLevelTypes(session)).toEqual(["paragraph", "paragraph", "formula"])
      expect(session.undo()).toBe(true)
      expect(topLevelTypes(session)).toEqual(["paragraph", "paragraph"])
    } finally {
      session.destroy()
    }
  })

  it("宿主未提供上传能力：插入图片禁用并注明原因", () => {
    const session = sessionFor(paragraphsDocument("a"))
    try {
      clickHandle(session, 0)
      expect(item("插入图片").disabled).toBe(true)
      expect(item("插入图片").title).toBe("宿主未提供图片上传能力")
    } finally {
      session.destroy()
    }
  })

  it("宿主提供上传能力：激活走与 picker 相同的 hidden input → enqueue 通道", async () => {
    let resolveUpload: (result: { src: string }) => void = () => {}
    const upload = vi.fn(
      (file: File) => new Promise<{ src: string }>((resolve) => {
        void file
        resolveUpload = resolve
      })
    )
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: paragraphsDocument("a", "b"),
      onPictureUpload: upload
    })
    const shell = session.editor.view.dom.parentElement
    if (shell instanceof HTMLElement && !shell.isConnected) {
      document.body.appendChild(shell)
      mountedShells.push(shell)
    }
    // 捕获菜单创建的 hidden file input（jsdom 不弹系统选择器）。
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {})
    try {
      clickHandle(session, 0)
      expect(item("插入图片").disabled).toBe(false)
      item("插入图片").click()
      const input = document.body.querySelector<HTMLInputElement>("input[type='file']")
      expect(input).not.toBeNull()
      expect(input!.accept).toBe("image/*")
      expect(clickSpy).toHaveBeenCalledTimes(1)

      const file = new File(["png"], "photo.png", { type: "image/png" })
      Object.defineProperty(input, "files", { value: [file], configurable: true })
      input!.dispatchEvent(new window.Event("change"))
      // 与 picker/paste/drop 同一入队通道：上传回调立即被调用，占位以 widget 呈现。
      expect(upload).toHaveBeenCalledTimes(1)
      expect(upload.mock.calls[0]![0]).toBe(file)
      // 上传成功后 picture 块落在原块之后（激活瞬间捕获的插入点）。
      resolveUpload({ src: "https://cdn.example.com/photo.png" })
      await vi.waitFor(() => {
        expect(topLevelTypes(session)).toEqual(["paragraph", "picture", "paragraph"])
      })
      const picture = session.editor.state.doc.child(1)
      expect(picture.attrs["src"]).toBe("https://cdn.example.com/photo.png")
    } finally {
      session.destroy()
    }
  })
})

describe("只读守卫（double-guard）", () => {
  it("只读会话直接调用 openBlockMenu 返回 null，不产生任何菜单", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      session.editor.setEditable(false)
      const onClosed = vi.fn()
      const handle = openBlockMenu({
        editor: session.editor,
        anchor: handles(session)[0]!,
        getPos: () => 0,
        capabilities: {
          canUploadPicture: () => false,
          enqueuePictures: () => []
        },
        onClosed
      })
      expect(handle).toBeNull()
      expect(menu()).toBeNull()
      expect(onClosed).not.toHaveBeenCalled()
    } finally {
      session.destroy()
    }
  })

  it("块已失效（getPos 无解析）时返回 null，不打开菜单", () => {
    const session = sessionFor(paragraphsDocument("a", "b"))
    try {
      const handle = openBlockMenu({
        editor: session.editor,
        anchor: handles(session)[0]!,
        getPos: () => undefined,
        capabilities: {
          canUploadPicture: () => false,
          enqueuePictures: () => []
        },
        onClosed: () => {}
      })
      expect(handle).toBeNull()
      expect(menu()).toBeNull()
    } finally {
      session.destroy()
    }
  })
})
