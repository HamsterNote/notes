/**
 * SelectionPopover —— 加新增按钮 / 行为（删除线、行内代码、行内公式、清除格式）
 *
 * 该测试文件遵循 TDD 红灯先行：覆盖尚未实现的行为，因此当前应失败于
 * "缺少新按钮 / 缺少新行为"，而非 setup/import 错误。
 *
 * 覆盖维度：
 * 1) 新按钮（删除线、行内代码、行内公式、清除格式）以正确的 aria-label 渲染
 * 2) 删除线按钮调用 document.execCommand("strikeThrough")
 * 3) 清除格式按钮调用 document.execCommand("removeFormat")
 * 4) 行内代码 / 行内公式按钮调用 ./inlineSelectionFormatting 的对应 helper
 * 5) 切换类按钮的 aria-pressed 反映 document.queryCommandState
 * 6) selectionchange 事件触发后 active 状态随选区更新
 * 7) 任何会改写 contentEditable DOM 的格式化行为都回调 onContentChange(blockId, innerHtml)
 */
/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SelectionPopover } from "./SelectionPopover"
import type { RefObject } from "react"

// --- 待实现的 helper 模块（被 SelectionPopover 未来版本 import） -----------
// 使用 vi.hoisted 创建稳定引用，并在 vi.mock 中导出，
// 这样测试文件本身 import 这些符号时拿到的是 mock 实现，就算
// ./inlineSelectionFormatting.ts 文件尚未存在也不会触发 import 错误。
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

// --- document.execCommand / queryCommandState：jsdom 未实现，必须先占位 -------
// vi.spyOn 在 v4 要求属性已存在；否则报 "property not defined" 导致 setup 错误，
// 让红灯被错误原因盖过。这里用 vi.hoisted 持有稳定 vi.fn 引用，mountPopover
// 时通过 Object.defineProperty 挂回 document，测试用同一引用做断言。
const documentCommands = vi.hoisted(() => ({
  execCommand: vi.fn(),
  queryCommandState: vi.fn()
}))

// --- Dom 模拟装置 --------------------------------------------------------
// 由于 jsdom 的 Selection / Range 在 contentEditable 上能力有限，
// 我们构造一个最小可用 fake selection + fake range 来满足
// SelectionPopover 的同步条件（isRangeInSingleEditableRoot / computePosition）。

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

  // 先渲染用户 JSX：外层 ref 容器 + 一个 contentEditable 段落块。
  // ref 回调在 commit 期同步设置 containerRef.current，render() 返回后即可读到。
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

  // 将占位 mock 挂回 document（jsdom 默认未定义这两个 API）。
  // 每次重置调用记录 + 设定当前 commandState 映射，避免上轮测试污染。
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

  // 取 React 实际渲染出来的 editable，作为 fake Range 的端点，
  // 这样 container.contains(...) 能命中 container 树内的真实节点。
  const editable = containerRef.current?.querySelector<HTMLElement>(
    '[data-editable-block-id="block-1"]'
  )
  if (!editable) {
    throw new Error("mountPopover: editable 块未渲染")
  }

  // fake Range：start/end 指向真实 editable 节点，便于
  // isRangeInSingleEditableRoot 通过 & computePosition 取到矩形
  const fakeRange: FakeRange = {
    startContainer: editable,
    endContainer: editable,
    commonAncestorContainer: editable,
    getBoundingClientRect: () => RECT_ABOVE_FLIP_THRESHOLD,
    cloneRange: () => ({ ...fakeRange })
  }

  // window.getSelection 替换为 fake selection
  const selection = buildFakeSelection(fakeRange)
  vi.spyOn(window, "getSelection").mockImplementation(() =>
    selection as unknown as Selection
  )

  // 触发 selectionchange 让 SelectionPopover 监听器同步出 popover
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
    // Given: 一个有选区的可编辑块
    await mountPopover()

    // Then: 新增按钮以正确 aria-label 出现
    expect(findButton("删除线")).not.toBeNull()
    expect(findButton("行内代码")).not.toBeNull()
    expect(findButton("行内公式")).not.toBeNull()
    expect(findButton("清除格式")).not.toBeNull()
  })

  it("点击删除线按钮调用 document.execCommand('strikeThrough')", async () => {
    // Given: popover 已展开
    await mountPopover()
    documentCommands.execCommand.mockClear()

    // When: 点击删除线按钮
    fireEvent.click(findButton("删除线"))

    // Then: 应以 strikeThrough 调用 execCommand
    expect(documentCommands.execCommand).toHaveBeenCalledWith("strikeThrough")
  })

  it("点击清除格式按钮调用 document.execCommand('removeFormat')", async () => {
    // Given: popover 已展开
    await mountPopover()
    documentCommands.execCommand.mockClear()

    // When: 点击清除格式按钮
    fireEvent.click(findButton("清除格式"))

    // Then: 应以 removeFormat 调用 execCommand
    expect(documentCommands.execCommand).toHaveBeenCalledWith("removeFormat")
  })

  it("点击行内代码按钮调用 ./inlineSelectionFormatting.applyInlineCode", async () => {
    // Given: popover 已展开
    await mountPopover()

    // When: 点击行内代码按钮
    fireEvent.click(findButton("行内代码"))

    // Then: 应用 helper 被调用（至少一次）
    expect(inlineSelectionFormatting.applyInlineCode).toHaveBeenCalled()
  })

  it("点击行内公式按钮调用 ./inlineSelectionFormatting.applyInlineFormula", async () => {
    // Given: popover 已展开
    await mountPopover()

    // When: 点击行内公式按钮
    fireEvent.click(findButton("行内公式"))

    // Then: 公式 helper 被调用（至少一次）
    expect(inlineSelectionFormatting.applyInlineFormula).toHaveBeenCalled()
  })

  it("粗体 / 斜体 / 下划线按钮的 aria-pressed 反映 queryCommandState", async () => {
    // Given: 当前选区对 bold / italic / underline 均为 active 态
    await mountPopover({
      commandState: { bold: true, italic: true, underline: true }
    })

    // Then: 对应按钮 aria-pressed=true
    expect(findButton("粗体").getAttribute("aria-pressed")).toBe("true")
    expect(findButton("斜体").getAttribute("aria-pressed")).toBe("true")
    expect(findButton("下划线").getAttribute("aria-pressed")).toBe("true")
  })

  it("queryCommandState 返回 false 时 aria-pressed 为 false", async () => {
    // Given: 三个格式状态都为 false（默认）
    await mountPopover({ commandState: {} })

    // Then: aria-pressed=false
    expect(findButton("粗体").getAttribute("aria-pressed")).toBe("false")
    expect(findButton("斜体").getAttribute("aria-pressed")).toBe("false")
    expect(findButton("下划线").getAttribute("aria-pressed")).toBe("false")
  })

  it("删除线按钮的 aria-pressed 反映 queryCommandState('strikeThrough')", async () => {
    // Given: strikeThrough active
    await mountPopover({ commandState: { strikeThrough: true } })

    // Then: 删除线按钮 aria-pressed=true
    expect(findButton("删除线").getAttribute("aria-pressed")).toBe("true")
  })

  it("行内代码 / 行内公式按钮的 aria-pressed 反映 queryCommandState", async () => {
    // Given: 行内代码 / 行内公式 active
    await mountPopover({
      commandState: {
        insertCode: true,
        insertFormula: true
      }
    })

    // Then: 两个新按钮 aria-pressed=true
    expect(findButton("行内代码").getAttribute("aria-pressed")).toBe("true")
    expect(findButton("行内公式").getAttribute("aria-pressed")).toBe("true")
  })

  it("selectionchange 事件触发后 active 状态随选区更新", async () => {
    // Given: 初始态 bold=false -> aria-pressed=false
    await mountPopover({ commandState: { bold: false } })
    expect(findButton("粗体").getAttribute("aria-pressed")).toBe("false")

    // When: queryCommandState 改为返回 true 后触发 selectionchange
    documentCommands.queryCommandState.mockImplementation(() => true)
    document.dispatchEvent(new Event("selectionchange"))

    // Then: 粗体按钮 aria-pressed 更新为 true
    await waitFor(() => {
      expect(findButton("粗体").getAttribute("aria-pressed")).toBe("true")
    })
  })

  it("点击删除线后回调 onContentChange(blockId, innerHtml)", async () => {
    // Given: popover 已展开
    const { onContentChange } = await mountPopover()

    // When: 点击删除线按钮
    fireEvent.click(findButton("删除线"))

    // Then: onContentChange 以当前可编辑块 id 与最新 innerHTML 被调用
    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })

  it("点击清除格式后回调 onContentChange(blockId, innerHtml)", async () => {
    // Given: popover 已展开
    const { onContentChange } = await mountPopover()

    // When: 点击清除格式按钮
    fireEvent.click(findButton("清除格式"))

    // Then: 回调被调用以同步 DOM 变更
    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })

  it("应用行内代码后回调 onContentChange(blockId, innerHtml)", async () => {
    // Given: popover 已展开
    const { onContentChange } = await mountPopover()

    // When: 点击行内代码按钮
    fireEvent.click(findButton("行内代码"))

    // Then: 回调被调用
    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })

  it("应用行内公式后回调 onContentChange(blockId, innerHtml)", async () => {
    // Given: popover 已展开
    const { onContentChange } = await mountPopover()

    // When: 点击行内公式按钮
    fireEvent.click(findButton("行内公式"))

    // Then: 回调被调用
    expect(onContentChange).toHaveBeenCalledWith("block-1", expect.any(String))
  })
})

// ============================================================
// 跨块（cross-block）选区场景
// ------------------------------------------------------------
// Phase 3：选区跨多个 contenteditable=true 根时，行内公式与链接按钮应 disabled，
// 其余格式化按钮仍可用（走 crossBlock* helpers）。
// ============================================================

const mountCrossBlockPopover = async (): Promise<MountResult> => {
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

  // 跨块 fakeRange：start 在 block1，end 在 block2
  // isRangeCrossMultipleEditableRoots 会通过 closest('[contenteditable]') 检测到不同根
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

  return { containerRef, onContentChange }
}

describe("SelectionPopover 跨块选区", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("跨块选区时行内公式按钮 disabled", async () => {
    // Given: 选区跨 block-1 与 block-2
    await mountCrossBlockPopover()

    // Then: 行内公式按钮被禁用
    expect(findButton("行内公式").disabled).toBe(true)
  })

  it("跨块选区时链接按钮 disabled", async () => {
    // Given: 选区跨 block-1 与 block-2
    await mountCrossBlockPopover()

    // Then: 链接按钮被禁用
    expect(findButton("为选中文字添加链接").disabled).toBe(true)
  })

  it("跨块选区时粗体按钮仍可用", async () => {
    // Given: 选区跨 block-1 与 block-2
    await mountCrossBlockPopover()

    // Then: 粗体按钮未禁用（走 crossBlock 格式化路径）
    expect(findButton("粗体").disabled).toBe(false)
  })
})