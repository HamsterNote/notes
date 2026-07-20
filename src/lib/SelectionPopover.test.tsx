/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createRef, type RefObject, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import { SelectionPopover } from "./SelectionPopover"
import type { NoteBlock } from "./types"

// --- 待实现的 helper 模块 mock -----------
const inlineSelectionFormatting = vi.hoisted(() => ({
  applyInlineCode: vi.fn(),
  applyInlineFormula: vi.fn(),
  wrapSelectionWithInlineFormula: vi.fn()
}))

vi.mock("./inlineSelectionFormatting", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./inlineSelectionFormatting")>()
  return {
    ...actual,
    applyInlineCode: inlineSelectionFormatting.applyInlineCode,
    applyInlineFormula: inlineSelectionFormatting.applyInlineFormula,
    wrapSelectionWithInlineFormula:
      inlineSelectionFormatting.wrapSelectionWithInlineFormula
  }
})

const documentCommands = vi.hoisted(() => ({
  execCommand: vi.fn(),
  queryCommandState: vi.fn()
}))

const dispatchSelectionChange = () => {
  document.dispatchEvent(new Event("selectionchange"))
}

// --- HEAD: TextHarness 用 NoteContent 集成测试 -----------
const TextHarness = ({ initialBlock }: { initialBlock: NoteBlock }) => {
  const [blocks, setBlocks] = useState<readonly NoteBlock[]>([initialBlock])
  const containerRef = createRef<HTMLDivElement>()

  return (
    <div ref={containerRef}>
      <NoteContent
        blocks={blocks}
        title="Popover color"
        editable
        onBlocksChange={setBlocks}
      />
    </div>
  )
}

describe("SelectionPopover text color", () => {
  beforeEach(() => {
    if (!("execCommand" in document)) {
      Object.defineProperty(document, "execCommand", {
        value: vi.fn(),
        configurable: true,
        writable: true
      })
    }

    if (!("getBoundingClientRect" in Range.prototype)) {
      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        value: () => ({
          top: 100,
          bottom: 120,
          left: 50,
          width: 100,
          height: 20
        }),
        configurable: true,
        writable: true
      })
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("applies foreColor and syncs the owning block HTML when a color swatch is clicked", async () => {
    const block = { id: "p1", kind: "paragraph", text: "Hello world" } as const
    const view = render(<TextHarness initialBlock={block} />)
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="p1"]'
    )
    if (!editable) throw new Error("Expected editable paragraph.")

    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockReturnValue(true)

    editable.focus()
    const range = document.createRange()
    range.setStart(editable.firstChild ?? editable, 0)
    range.setEnd(editable.firstChild ?? editable, 5)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    dispatchSelectionChange()

    await waitFor(() => {
      expect(
        document.body.querySelector('[aria-label="文字颜色：红色"]')
      ).not.toBeNull()
    })

    const redButton = document.body.querySelector<HTMLElement>(
      '[aria-label="文字颜色：红色"]'
    )
    if (!redButton) throw new Error("Expected red color button.")
    fireEvent.click(redButton)

    await waitFor(() => {
      expect(execCommandSpy).toHaveBeenCalledWith("foreColor", false, "#ef4444")
    })
  })

  it("still applies bold formatting from the popover", async () => {
    const block = { id: "p2", kind: "paragraph", text: "Bold me" } as const
    const view = render(<TextHarness initialBlock={block} />)
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="p2"]'
    )
    if (!editable) throw new Error("Expected editable paragraph.")

    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockReturnValue(true)

    editable.focus()
    const range = document.createRange()
    range.setStart(editable.firstChild ?? editable, 0)
    range.setEnd(editable.firstChild ?? editable, 4)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    dispatchSelectionChange()

    await waitFor(() => {
      expect(document.body.querySelector('[aria-label="粗体"]')).not.toBeNull()
    })

    const boldButton = document.body.querySelector<HTMLElement>(
      '[aria-label="粗体"]'
    )
    if (!boldButton) throw new Error("Expected bold button.")
    fireEvent.click(boldButton)

    await waitFor(() => {
      expect(execCommandSpy).toHaveBeenCalledWith("bold")
    })
  })

  it("highlights the bold button when queryCommandState reports bold active and clears styles via removeFormat", async () => {
    const block = { id: "p3", kind: "paragraph", text: "Already bold" } as const
    const view = render(<TextHarness initialBlock={block} />)
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="p3"]'
    )
    if (!editable) throw new Error("Expected editable paragraph.")

    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockReturnValue(true)

    if (typeof document.queryCommandState !== "function") {
      Object.defineProperty(document, "queryCommandState", {
        value: vi.fn(),
        configurable: true,
        writable: true
      })
    }
    vi
      .spyOn(document, "queryCommandState")
      .mockImplementation((command: string) => command === "bold")

    editable.focus()
    const range = document.createRange()
    range.setStart(editable.firstChild ?? editable, 0)
    range.setEnd(editable.firstChild ?? editable, 5)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    dispatchSelectionChange()

    await waitFor(() => {
      const boldBtn = document.body.querySelector<HTMLElement>(
        '[aria-label="粗体"]'
      )
      expect(boldBtn).not.toBeNull()
      expect(boldBtn?.classList.contains("hn-note-popover-btn--active")).toBe(
        true
      )
      expect(boldBtn?.getAttribute("aria-pressed")).toBe("true")
    })

    const clearButton = document.body.querySelector<HTMLElement>(
      '[aria-label="清除样式"]'
    )
    if (!clearButton) throw new Error("Expected clear styles button.")
    fireEvent.click(clearButton)

    await waitFor(() => {
      expect(execCommandSpy).toHaveBeenCalledWith("removeFormat")
    })
  })
})

// --- origin/main: Fake Range / Selection 装置 -----------

interface FakeRange {
  startContainer: Node
  endContainer: Node
  commonAncestorContainer: Node
  getBoundingClientRect: () => DOMRect
  cloneRange: () => FakeRange
}

const RECT_ABOVE_FLIP_THRESHOLD = {
  top: 200,
  bottom: 220,
  left: 100,
  width: 50,
  height: 20,
  right: 150,
  x: 100,
  y: 200,
  toJSON: () => ({})
} as unknown as DOMRect

const buildFakeSelection = (range: FakeRange) => ({
  rangeCount: 1,
  isCollapsed: false,
  toString: () => "selected",
  getRangeAt: () => range,
  removeAllRanges: () => {},
  addRange: () => {}
})

interface MountResult {
  containerRef: RefObject<HTMLElement | null>
  onContentChange: ReturnType<typeof vi.fn>
}

const mountPopover = (overrides?: {
  commandState?: Record<string, boolean>
}): Promise<MountResult> => {
  const commandState = overrides?.commandState ?? {}

  const containerRef: RefObject<HTMLElement | null> = { current: null }
  const onContentChange = vi.fn()

  render(
    <div
      ref={(el) => {
        containerRef.current = el
      }}
    >
      <div contentEditable="true" data-editable-block-id="block-1">
        hello world
      </div>
      <SelectionPopover
        containerRef={containerRef}
        onContentChange={onContentChange}
      />
    </div>
  )

  documentCommands.execCommand.mockClear()
  documentCommands.queryCommandState.mockClear()
  documentCommands.execCommand.mockImplementation(() => true)
  documentCommands.queryCommandState.mockImplementation((command: string) =>
    Boolean(commandState[command])
  )
  Object.defineProperty(document, "execCommand", {
    value: documentCommands.execCommand,
    writable: true,
    configurable: true
  })
  Object.defineProperty(document, "queryCommandState", {
    value: documentCommands.queryCommandState,
    writable: true,
    configurable: true
  })

  const editable = containerRef.current?.querySelector<HTMLElement>(
    '[data-editable-block-id="block-1"]'
  )
  if (!editable) {
    throw new Error("mountPopover: editable 块未渲染")
  }

  const fakeRange: FakeRange = {
    startContainer: editable,
    endContainer: editable,
    commonAncestorContainer: editable,
    getBoundingClientRect: () => RECT_ABOVE_FLIP_THRESHOLD,
    cloneRange: () => ({ ...fakeRange })
  }

  const selection = buildFakeSelection(fakeRange)
  vi.spyOn(window, "getSelection").mockImplementation(() =>
    selection as unknown as Selection
  )

  document.dispatchEvent(new Event("selectionchange"))

  return Promise.resolve({
    containerRef,
    onContentChange
  })
}

const findButton = (name: string): HTMLButtonElement =>
  screen.getByRole("button", { name })

describe("SelectionPopover 新增格式化按钮与行为", () => {
  beforeEach(() => {
    inlineSelectionFormatting.applyInlineCode.mockClear()
    inlineSelectionFormatting.applyInlineFormula.mockClear()
    inlineSelectionFormatting.wrapSelectionWithInlineFormula.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("渲染删除线 / 行内代码 / 行内公式按钮，且无左侧清除格式按钮、保留右侧清除样式按钮", async () => {
    await mountPopover()

    expect(findButton("删除线")).not.toBeNull()
    expect(findButton("行内代码")).not.toBeNull()
    expect(findButton("行内公式")).not.toBeNull()
    // R2: 左侧“清除格式”按钮已移除，仅保留右侧“清除样式”
    expect(screen.queryByRole("button", { name: "清除格式" })).toBeNull()
    expect(findButton("清除样式")).not.toBeNull()
  })

  it("点击删除线按钮调用 document.execCommand('strikeThrough')", async () => {
    await mountPopover()
    documentCommands.execCommand.mockClear()

    fireEvent.click(findButton("删除线"))

    expect(documentCommands.execCommand).toHaveBeenCalledWith("strikeThrough")
  })

  it("点击清除样式按钮调用 document.execCommand('removeFormat')", async () => {
    await mountPopover()
    documentCommands.execCommand.mockClear()

    fireEvent.click(findButton("清除样式"))

    expect(documentCommands.execCommand).toHaveBeenCalledWith("removeFormat")
  })

  it("浮动 popover 按 Escape 后关闭", async () => {
    // Given: 非 docked 模式下，文字选区已打开浮动 popover。
    await mountPopover()
    expect(findButton("粗体")).not.toBeNull()

    // When: 用户按下 Escape。
    fireEvent.keyDown(document, { key: "Escape" })

    // Then: popover 从页面移除。
    expect(screen.queryByRole("toolbar", { name: "文字操作" })).toBeNull()
  })

  it("清除样式同时移除行内代码和行内公式", async () => {
    // Given: 单个 editable root 内的完整选区包含自定义 code 与公式节点。
    const containerRef: RefObject<HTMLElement | null> = { current: null }
    const onContentChange = vi.fn()
    render(
      <div
        ref={(element) => {
          containerRef.current = element
        }}
      >
        <div
          contentEditable="true"
          data-editable-block-id="block-custom"
          ref={(element) => {
            if (element && element.childNodes.length === 0) {
              element.innerHTML =
                '<code class="hn-note-inline-code">foo</code> <span data-hn-inline-formula="x^2" contenteditable="false">x^2</span> bar'
            }
          }}
        />
        <SelectionPopover
          containerRef={containerRef}
          onContentChange={onContentChange}
        />
      </div>
    )
    const editable = containerRef.current?.querySelector<HTMLElement>(
      '[data-editable-block-id="block-custom"]'
    )
    if (!editable) throw new Error("Expected custom-format editable root.")
    const range = document.createRange()
    range.selectNodeContents(editable)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    dispatchSelectionChange()
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "清除样式" })).not.toBeNull()
    })

    documentCommands.execCommand.mockImplementation((command) => {
      if (command !== "removeFormat") return true
      const formula = editable.querySelector("[data-hn-inline-formula]")
      if (!formula) return true
      const narrowedRange = document.createRange()
      narrowedRange.selectNodeContents(formula)
      selection?.removeAllRanges()
      selection?.addRange(narrowedRange)
      return true
    })

    // When: 用户点击唯一保留的清除样式按钮。
    fireEvent.click(findButton("清除样式"))

    // Then: 自定义 code 被解包，公式原子节点被移除，并同步最新 HTML。
    expect(editable.querySelector("code")).toBeNull()
    expect(editable.querySelector("[data-hn-inline-formula]")).toBeNull()
    expect(onContentChange).toHaveBeenCalledWith(
      "block-custom",
      expect.not.stringContaining("data-hn-inline-formula")
    )
  })

  it("点击行内代码按钮调用 ./inlineSelectionFormatting.applyInlineCode", async () => {
    await mountPopover()

    fireEvent.click(findButton("行内代码"))

    expect(inlineSelectionFormatting.applyInlineCode).toHaveBeenCalled()
  })

  it("点击行内公式按钮打开公式输入框并预填选中文本（R1）", async () => {
    await mountPopover()

    fireEvent.click(findButton("行内公式"))

    // 点击 fx 不直接包裹，而是打开输入 popover（fake 选区文本为 "selected"）
    expect(
      inlineSelectionFormatting.wrapSelectionWithInlineFormula
    ).not.toHaveBeenCalled()
    const input = screen.getByRole("textbox", { name: "公式（LaTeX）" })
    expect((input as HTMLInputElement).value).toBe("selected")
  })

  it("确认公式输入后把保存的选区包裹为行内公式并同步（R1）", async () => {
    const { onContentChange } = await mountPopover()

    fireEvent.click(findButton("行内公式"))
    const input = screen.getByRole("textbox", { name: "公式（LaTeX）" })
    fireEvent.change(input, { target: { value: "E = mc^2" } })
    fireEvent.click(findButton("确认"))

    expect(
      inlineSelectionFormatting.wrapSelectionWithInlineFormula
    ).toHaveBeenCalledWith("E = mc^2")
    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })

  it("粗体 / 斜体 / 下划线按钮的 aria-pressed 反映 queryCommandState", async () => {
    await mountPopover({
      commandState: { bold: true, italic: true, underline: true }
    })

    expect(findButton("粗体").getAttribute("aria-pressed")).toBe("true")
    expect(findButton("斜体").getAttribute("aria-pressed")).toBe("true")
    expect(findButton("下划线").getAttribute("aria-pressed")).toBe("true")
  })

  it("queryCommandState 返回 false 时 aria-pressed 为 false", async () => {
    await mountPopover({ commandState: {} })

    expect(findButton("粗体").getAttribute("aria-pressed")).toBe("false")
    expect(findButton("斜体").getAttribute("aria-pressed")).toBe("false")
    expect(findButton("下划线").getAttribute("aria-pressed")).toBe("false")
  })

  it("删除线按钮的 aria-pressed 反映 queryCommandState('strikeThrough')", async () => {
    await mountPopover({ commandState: { strikeThrough: true } })

    expect(findButton("删除线").getAttribute("aria-pressed")).toBe("true")
  })

  it("行内代码 / 行内公式按钮的 aria-pressed 反映 queryCommandState", async () => {
    await mountPopover({
      commandState: {
        insertCode: true,
        insertFormula: true
      }
    })

    expect(findButton("行内代码").getAttribute("aria-pressed")).toBe("true")
    expect(findButton("行内公式").getAttribute("aria-pressed")).toBe("true")
  })

  it("selectionchange 事件触发后 active 状态随选区更新", async () => {
    await mountPopover({ commandState: { bold: false } })
    expect(findButton("粗体").getAttribute("aria-pressed")).toBe("false")

    documentCommands.queryCommandState.mockImplementation(() => true)
    document.dispatchEvent(new Event("selectionchange"))

    await waitFor(() => {
      expect(findButton("粗体").getAttribute("aria-pressed")).toBe("true")
    })
  })

  it("点击删除线后回调 onContentChange(blockId, innerHtml)", async () => {
    const { onContentChange } = await mountPopover()

    fireEvent.click(findButton("删除线"))

    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })

  it("点击清除样式后回调 onContentChange(blockId, innerHtml)", async () => {
    const { onContentChange } = await mountPopover()

    fireEvent.click(findButton("清除样式"))

    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })

  it("点击行内代码后回调 onContentChange(blockId, innerHtml)", async () => {
    const { onContentChange } = await mountPopover()

    fireEvent.click(findButton("行内代码"))

    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })
})

// --- R4: popover 水平 clamp 在组件容器内 -----------

const CLAMP_SHELL_RECT = {
  left: 100,
  right: 500,
  top: 0,
  bottom: 800,
  width: 400,
  height: 800
}
const CLAMP_POPOVER_WIDTH = 240
// clamp 常量与实现保持一致：容器内边距 8px
const CLAMP_MARGIN = 8

// jsdom 的 getBoundingClientRect 默认全零，这里按元素角色返回固定矩形：
// popover 宽 240；容器（test-shell）为 [100, 500]；其余元素为零矩形。
const mockClampRects = () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const base = { x: 0, y: 0, toJSON: () => ({}) }
      if (this.classList.contains("hn-note-popover")) {
        return {
          ...base,
          left: 0,
          right: CLAMP_POPOVER_WIDTH,
          top: 0,
          bottom: 40,
          width: CLAMP_POPOVER_WIDTH,
          height: 40
        }
      }
      if (this.classList.contains("test-shell")) {
        return { ...base, ...CLAMP_SHELL_RECT }
      }
      return {
        ...base,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: 0,
        height: 0
      }
    }
  )
}

const mountClampPopover = (selectionCenterLeft: number) => {
  const containerRef: RefObject<HTMLElement | null> = { current: null }
  const onContentChange = vi.fn()

  render(
    <div
      className="test-shell"
      ref={(el) => {
        containerRef.current = el
      }}
    >
      <div contentEditable="true" data-editable-block-id="block-1">
        hello world
      </div>
      <SelectionPopover
        containerRef={containerRef}
        onContentChange={onContentChange}
      />
    </div>
  )

  const editable = containerRef.current?.querySelector<HTMLElement>(
    '[data-editable-block-id="block-1"]'
  )
  if (!editable) throw new Error("mountClampPopover: editable 块未渲染")

  // 选区矩形：top 高于 FLIP_THRESHOLD 避免翻转，left 由参数控制中心点
  const fakeRange: FakeRange = {
    startContainer: editable,
    endContainer: editable,
    commonAncestorContainer: editable,
    getBoundingClientRect: () =>
      ({
        top: 200,
        bottom: 220,
        left: selectionCenterLeft,
        width: 0,
        height: 20,
        right: selectionCenterLeft,
        x: selectionCenterLeft,
        y: 200,
        toJSON: () => ({})
      }),
    cloneRange: () => ({ ...fakeRange })
  }

  const selection = buildFakeSelection(fakeRange)
  vi.spyOn(window, "getSelection").mockImplementation(() =>
    selection as unknown as Selection
  )

  document.dispatchEvent(new Event("selectionchange"))
}

const getPopover = (): HTMLElement => {
  const popover = document.body.querySelector<HTMLElement>(".hn-note-popover")
  if (!popover) throw new Error("popover 未渲染")
  return popover
}

describe("SelectionPopover 水平 clamp（R4）", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("选区中心靠近容器左缘时，popover 被 clamp 在容器内", async () => {
    mockClampRects()
    // 选区中心 100（= 容器左缘），未 clamp 时 popover 左半会溢出
    mountClampPopover(100)

    await waitFor(() => {
      const minCenter = CLAMP_SHELL_RECT.left + CLAMP_MARGIN + CLAMP_POPOVER_WIDTH / 2
      expect(getPopover().style.left).toBe(`${minCenter}px`)
    })
  })

  it("选区中心靠近容器右缘时，popover 被 clamp 在容器内", async () => {
    mockClampRects()
    mountClampPopover(600)

    await waitFor(() => {
      const maxCenter = CLAMP_SHELL_RECT.right - CLAMP_MARGIN - CLAMP_POPOVER_WIDTH / 2
      expect(getPopover().style.left).toBe(`${maxCenter}px`)
    })
  })

  it("选区中心在容器中部时不做 clamp", async () => {
    mockClampRects()
    mountClampPopover(300)

    await waitFor(() => {
      expect(getPopover().style.left).toBe("300px")
    })
  })
})

const mountCrossBlockPopover = (): Promise<MountResult> => {
  const containerRef: RefObject<HTMLElement | null> = { current: null }
  const onContentChange = vi.fn()

  render(
    <div
      ref={(el) => {
        containerRef.current = el
      }}
    >
      <div contentEditable="true" data-editable-block-id="block-1">
        hello
      </div>
      <div contentEditable="true" data-editable-block-id="block-2">
        world
      </div>
      <SelectionPopover
        containerRef={containerRef}
        onContentChange={onContentChange}
      />
    </div>
  )

  documentCommands.execCommand.mockClear()
  documentCommands.queryCommandState.mockClear()
  documentCommands.execCommand.mockImplementation(() => true)
  documentCommands.queryCommandState.mockImplementation(() => false)
  Object.defineProperty(document, "execCommand", {
    value: documentCommands.execCommand,
    writable: true,
    configurable: true
  })
  Object.defineProperty(document, "queryCommandState", {
    value: documentCommands.queryCommandState,
    writable: true,
    configurable: true
  })

  const block1 = containerRef.current?.querySelector<HTMLElement>(
    '[data-editable-block-id="block-1"]'
  )
  const block2 = containerRef.current?.querySelector<HTMLElement>(
    '[data-editable-block-id="block-2"]'
  )
  if (!block1 || !block2) {
    throw new Error("mountCrossBlockPopover: 两个 editable 块未渲染")
  }

  const fakeRange: FakeRange = {
    startContainer: block1,
    endContainer: block2,
    commonAncestorContainer: containerRef.current as HTMLElement,
    getBoundingClientRect: () => RECT_ABOVE_FLIP_THRESHOLD,
    cloneRange: () => ({ ...fakeRange })
  }

  const selection = buildFakeSelection(fakeRange)
  vi.spyOn(window, "getSelection").mockImplementation(() =>
    selection as unknown as Selection
  )

  document.dispatchEvent(new Event("selectionchange"))

  return Promise.resolve({ containerRef, onContentChange })
}

describe("SelectionPopover 跨块选区", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("跨块选区时行内公式按钮 disabled", async () => {
    await mountCrossBlockPopover()

    expect(findButton("行内公式").disabled).toBe(true)
  })

  it("跨块选区时链接按钮 disabled", async () => {
    await mountCrossBlockPopover()

    expect(findButton("为选中文字添加链接").disabled).toBe(true)
  })

  it("跨块选区时粗体按钮仍可用", async () => {
    await mountCrossBlockPopover()

    expect(findButton("粗体").disabled).toBe(false)
  })
})

// --- R1: 点击已有行内公式 span 打开编辑 popover -----------

const mountFormulaSpanPopover = () => {
  const containerRef: RefObject<HTMLElement | null> = { current: null }
  const onContentChange = vi.fn()

  render(
    <div
      ref={(el) => {
        containerRef.current = el
      }}
    >
      <div
        contentEditable="true"
        data-editable-block-id="block-1"
        ref={(el) => {
          // 命令式注入富文本，避开 dangerouslySetInnerHTML lint 限制；
          // 与 inlineFormulaRendering.test.tsx 的挂载惯例一致
          if (el && el.childNodes.length === 0) {
            el.innerHTML =
              'foo <span class="hn-note-inline-formula" data-hn-inline-formula="x^2" contenteditable="false">x^2</span> bar'
          }
        }}
      />
      <SelectionPopover
        containerRef={containerRef}
        onContentChange={onContentChange}
      />
    </div>
  )

  const span = containerRef.current?.querySelector<HTMLElement>(
    "[data-hn-inline-formula]"
  )
  if (!span) throw new Error("mountFormulaSpanPopover: 公式 span 未渲染")
  return { span, onContentChange }
}

describe("SelectionPopover 行内公式编辑（R1）", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("点击已有行内公式 span 打开公式输入框并预填现有公式", () => {
    const { span } = mountFormulaSpanPopover()

    fireEvent.click(span)

    const input = screen.getByRole("textbox", { name: "公式（LaTeX）" })
    expect((input as HTMLInputElement).value).toBe("x^2")
  })

  it("R6: 公式输入框打开时点击 popover 外部任意位置即隐藏输入框", () => {
    const { span } = mountFormulaSpanPopover()

    fireEvent.click(span)
    expect(
      screen.queryByRole("textbox", { name: "公式（LaTeX）" })
    ).not.toBeNull()

    // 模拟鼠标点击编辑区其它位置（popover  portal 在 body 上，容器在其外部）；
    // 原生 dispatchEvent 不经 React 合成事件系统，需 act 刷新状态更新。
    act(() => {
      span.parentElement?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true })
      )
    })

    expect(
      screen.queryByRole("textbox", { name: "公式（LaTeX）" })
    ).toBeNull()
  })

  it("R6: 点击 popover 内部（输入框 / 按钮）不关闭", () => {
    const { span } = mountFormulaSpanPopover()

    fireEvent.click(span)
    const input = screen.getByRole("textbox", { name: "公式（LaTeX）" })

    input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))

    expect(
      screen.queryByRole("textbox", { name: "公式（LaTeX）" })
    ).not.toBeNull()
  })

  it("编辑已有公式时确认后原地更新 span 并同步所在块", () => {
    const { span, onContentChange } = mountFormulaSpanPopover()

    fireEvent.click(span)
    const input = screen.getByRole("textbox", { name: "公式（LaTeX）" })
    fireEvent.change(input, { target: { value: "y^2" } })
    fireEvent.click(findButton("确认"))

    // 原地更新而不是插入新 span
    expect(span.getAttribute("data-hn-inline-formula")).toBe("y^2")
    expect(span.textContent).toBe("y^2")
    expect(
      document.querySelectorAll("[data-hn-inline-formula]")
    ).toHaveLength(1)
    expect(onContentChange).toHaveBeenCalledWith(
      "block-1",
      expect.stringContaining("y^2")
    )
  })
})
