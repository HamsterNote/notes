/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type RefObject, createRef, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import { SelectionPopover } from "./SelectionPopover"
import type { NoteBlock } from "./types"

// --- 待实现的 helper 模块 mock -----------
const inlineSelectionFormatting = vi.hoisted(() => ({
  applyInlineCode: vi.fn(),
  applyInlineFormula: vi.fn()
}))

vi.mock("./inlineSelectionFormatting", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./inlineSelectionFormatting")>()
  return {
    ...actual,
    applyInlineCode: inlineSelectionFormatting.applyInlineCode,
    applyInlineFormula: inlineSelectionFormatting.applyInlineFormula
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("渲染删除线 / 行内代码 / 行内公式 / 清除格式四个新按钮", async () => {
    await mountPopover()

    expect(findButton("删除线")).not.toBeNull()
    expect(findButton("行内代码")).not.toBeNull()
    expect(findButton("行内公式")).not.toBeNull()
    expect(findButton("清除格式")).not.toBeNull()
  })

  it("点击删除线按钮调用 document.execCommand('strikeThrough')", async () => {
    await mountPopover()
    documentCommands.execCommand.mockClear()

    fireEvent.click(findButton("删除线"))

    expect(documentCommands.execCommand).toHaveBeenCalledWith("strikeThrough")
  })

  it("点击清除格式按钮调用 document.execCommand('removeFormat')", async () => {
    await mountPopover()
    documentCommands.execCommand.mockClear()

    fireEvent.click(findButton("清除格式"))

    expect(documentCommands.execCommand).toHaveBeenCalledWith("removeFormat")
  })

  it("点击行内代码按钮调用 ./inlineSelectionFormatting.applyInlineCode", async () => {
    await mountPopover()

    fireEvent.click(findButton("行内代码"))

    expect(inlineSelectionFormatting.applyInlineCode).toHaveBeenCalled()
  })

  it("点击行内公式按钮调用 ./inlineSelectionFormatting.applyInlineFormula", async () => {
    await mountPopover()

    fireEvent.click(findButton("行内公式"))

    expect(inlineSelectionFormatting.applyInlineFormula).toHaveBeenCalled()
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

  it("点击清除格式后回调 onContentChange(blockId, innerHtml)", async () => {
    const { onContentChange } = await mountPopover()

    fireEvent.click(findButton("清除格式"))

    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })

  it("应用行内代码后回调 onContentChange(blockId, innerHtml)", async () => {
    const { onContentChange } = await mountPopover()

    fireEvent.click(findButton("行内代码"))

    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })

  it("应用行内公式后回调 onContentChange(blockId, innerHtml)", async () => {
    const { onContentChange } = await mountPopover()

    fireEvent.click(findButton("行内公式"))

    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })
})

// --- 跨块（cross-block）选区场景 -----------

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
