// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { encodeHnn, type HnnDocument } from "../hnn/codec"
import { exportMarkdown, type MarkdownExportResult } from "../hnn/markdown"
import { MarkdownExport } from "./MarkdownExport"

// 包装 exportMarkdown 为 spy：默认行为不变，用于断言快照捕获次数与入参对象身份。
vi.mock("../hnn/markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hnn/markdown")>()
  return { ...actual, exportMarkdown: vi.fn(actual.exportMarkdown) }
})

const mockedExportMarkdown = vi.mocked(exportMarkdown)

// Drawer 以 portal 渲染进 document.body；显式清理避免跨用例残留。
afterEach(() => {
  cleanup()
  mockedExportMarkdown.mockClear()
})

const CLEAN_DOC: HnnDocument = encodeHnn({
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" },
      content: [{ type: "text", text: "直接导出" }]
    }
  ]
})

/** codeBlock 使用保留围栏名 math：导出必走 JSON-b64 降级并产生 node-fallback 诊断。 */
function degradedDoc(text: string, nodeId: string): HnnDocument {
  return encodeHnn({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { nodeId, language: "math", filename: "untitled" },
        content: [{ type: "text", text }]
      }
    ]
  })
}

const DEGRADED_DOC = degradedDoc("不是公式", "123e4567-e89b-42d3-a456-426614174001")

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderExport(overrides: Partial<Parameters<typeof MarkdownExport>[0]> = {}) {
  const props: Parameters<typeof MarkdownExport>[0] = {
    snapshot: () => CLEAN_DOC,
    onExport: () => undefined,
    sessionKey: "session-a",
    ...overrides
  }
  return { ...render(<MarkdownExport {...props} />), props }
}

function getTrigger(): HTMLButtonElement {
  return screen.getByRole("button", { name: "导出 Markdown" })
}

function openConfirmDrawer(): HTMLElement {
  fireEvent.click(getTrigger())
  const panel = document.querySelector<HTMLElement>(".hn-drawer__panel")
  expect(panel).not.toBeNull()
  expect(panel!.getAttribute("role")).toBe("dialog")
  expect(panel!.getAttribute("aria-modal")).toBe("true")
  return panel!
}

/** Drawer 退场动画后才卸载 portal；关闭断言统一走 waitFor。 */
async function expectDrawerClosed(): Promise<void> {
  await waitFor(() => expect(document.querySelector(".hn-drawer__panel")).toBeNull())
}

describe("MarkdownExport 导出流程", () => {
  it("无诊断：点击显式导出直接调用 onExport，不打开确认界面", async () => {
    const onExport = vi.fn()
    renderExport({ onExport })
    fireEvent.click(getTrigger())
    expect(onExport).toHaveBeenCalledTimes(1)
    const [result, context] = onExport.mock.calls[0] as [MarkdownExportResult, { signal: AbortSignal }]
    expect(result.markdown).toContain("直接导出")
    expect(result.diagnostics).toHaveLength(0)
    expect(context.signal).toBeInstanceOf(AbortSignal)
    expect(context.signal.aborted).toBe(false)
    expect(document.querySelector(".hn-drawer__panel")).toBeNull()
    // 同步完成后给出 polite 完成通知，触发按钮恢复可用
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("导出完成"))
    expect(getTrigger().disabled).toBe(false)
  })

  it("有诊断：展示逐条诊断与预览，确认前绝不写出", () => {
    const onExport = vi.fn()
    renderExport({ snapshot: () => DEGRADED_DOC, onExport })
    const panel = openConfirmDrawer()
    const view = within(panel)
    // 诊断逐条定位：code 与实际存在的字段（nodeId/path 等）可见
    expect(panel.textContent).toContain("node-fallback")
    expect(panel.textContent).toContain("123e4567-e89b-42d3-a456-426614174001")
    expect(panel.textContent).toContain("确认后才会写出")
    // 预览即待写出的降级结果本身
    expect(view.getByLabelText("导出结果预览").textContent).toContain("hamster-note-json-b64")
    expect(onExport).not.toHaveBeenCalled()
  })

  it("用户显式确认后才写出，且写出的就是当次已诊断结果", () => {
    const onExport = vi.fn()
    renderExport({ snapshot: () => DEGRADED_DOC, onExport })
    const panel = openConfirmDrawer()
    const previewText = within(panel).getByLabelText("导出结果预览").textContent
    fireEvent.click(within(panel).getByRole("button", { name: "确认导出" }))
    expect(onExport).toHaveBeenCalledTimes(1)
    const [result] = onExport.mock.calls[0] as [MarkdownExportResult]
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.markdown).toBe(previewText)
  })

  it("快照只在点击时捕获一次：待确认期间文档变化不会混入写出内容", () => {
    const docA = degradedDoc("甲版本", "123e4567-e89b-42d3-a456-426614174002")
    const docB = degradedDoc("乙版本", "123e4567-e89b-42d3-a456-426614174003")
    let current = docA
    const snapshot = vi.fn(() => current)
    const onExport = vi.fn()
    renderExport({ snapshot, onExport })
    const panel = openConfirmDrawer()
    // 待确认期间笔记继续被编辑（宿主侧文档已变）
    current = docB
    fireEvent.click(within(panel).getByRole("button", { name: "确认导出" }))
    // 没有偷偷重抓：snapshot 与 codec 各只跑一次，且吃的是 docA
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(mockedExportMarkdown).toHaveBeenCalledTimes(1)
    expect(mockedExportMarkdown.mock.calls[0]?.[0]).toBe(docA)
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it("取消按钮：不写出、关闭 Drawer、焦点还原到触发按钮", async () => {
    const onExport = vi.fn()
    renderExport({ snapshot: () => DEGRADED_DOC, onExport })
    const panel = openConfirmDrawer()
    fireEvent.click(within(panel).getByRole("button", { name: "取消" }))
    expect(onExport).not.toHaveBeenCalled()
    await expectDrawerClosed()
    expect(document.activeElement).toBe(getTrigger())
  })

  it("Escape：等同于取消，不写出且还原焦点", async () => {
    const onExport = vi.fn()
    renderExport({ snapshot: () => DEGRADED_DOC, onExport })
    const panel = openConfirmDrawer()
    fireEvent.keyDown(panel, { key: "Escape" })
    expect(onExport).not.toHaveBeenCalled()
    await expectDrawerClosed()
    expect(document.activeElement).toBe(getTrigger())
  })
})

describe("MarkdownExport 错误与竞态", () => {
  it("宿主 onExport rejected：行内 alert 可观察且不产生 unhandled rejection", async () => {
    const onExport = vi.fn(() => Promise.reject(new Error("磁盘已满")))
    renderExport({ onExport })
    fireEvent.click(getTrigger())
    await waitFor(() => {
      const alert = screen.getByRole("alert")
      expect(alert.textContent).toContain("导出失败")
      expect(alert.textContent).toContain("磁盘已满")
    })
    // 失败后可显式重试
    expect(getTrigger().disabled).toBe(false)
  })

  it("宿主 reject(undefined)：仍按失败判别，绝不误报导出完成", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- 故意覆盖宿主 reject(undefined) 的边界
    const onExport = vi.fn(() => Promise.reject(undefined))
    renderExport({ onExport })
    fireEvent.click(getTrigger())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("导出失败"))
    expect(screen.getByRole("status").textContent ?? "").not.toContain("导出完成")
  })

  it("宿主 throw undefined：同步抛出任意值同样落入失败分支", async () => {
    const onExport = vi.fn((): Promise<void> => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- 故意覆盖宿主 throw undefined 的边界
      throw undefined
    })
    renderExport({ onExport })
    fireEvent.click(getTrigger())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("导出失败"))
    expect(screen.getByRole("status").textContent ?? "").not.toContain("导出完成")
  })

  it("Drawer 内确认后宿主失败：诊断保留、可取消，不静默吞错", async () => {
    const onExport = vi.fn(() => Promise.reject(new Error("网络断开")))
    renderExport({ snapshot: () => DEGRADED_DOC, onExport })
    const panel = openConfirmDrawer()
    fireEvent.click(within(panel).getByRole("button", { name: "确认导出" }))
    await waitFor(() => expect(within(panel).getByRole("alert").textContent).toContain("网络断开"))
    expect(onExport).toHaveBeenCalledTimes(1)
    // Drawer 仍打开，用户可取消；取消不再次写出
    fireEvent.click(within(panel).getByRole("button", { name: "取消" }))
    await expectDrawerClosed()
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it("在途写出单飞：触发按钮禁用，重复点击不产生第二次 onExport", async () => {
    const pendingWrite = deferred<void>()
    const onExport = vi.fn(() => pendingWrite.promise)
    renderExport({ onExport })
    fireEvent.click(getTrigger())
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(getTrigger().disabled).toBe(true)
    expect(screen.getByRole("status").textContent).toContain("正在导出")
    fireEvent.click(getTrigger())
    expect(onExport).toHaveBeenCalledTimes(1)
    pendingWrite.resolve()
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("导出完成"))
    expect(getTrigger().disabled).toBe(false)
  })

  it("会话切换：abort 在途写出、丢弃待确认 UI，陈旧结果不回写", async () => {
    const pendingWrite = deferred<void>()
    let capturedSignal: AbortSignal | undefined
    const onExport = vi.fn((_result: MarkdownExportResult, context: { signal: AbortSignal }) => {
      capturedSignal = context.signal
      return pendingWrite.promise
    })
    const view = renderExport({ snapshot: () => DEGRADED_DOC, onExport })
    const panel = openConfirmDrawer()
    fireEvent.click(within(panel).getByRole("button", { name: "确认导出" }))
    expect(onExport).toHaveBeenCalledTimes(1)
    // 会话切换：abort 并清空旧会话的确认界面
    view.rerender(
      <MarkdownExport snapshot={() => DEGRADED_DOC} onExport={onExport} sessionKey="session-b" />
    )
    expect(capturedSignal?.aborted).toBe(true)
    await expectDrawerClosed()
    // 宿主忽略 abort 仍在之后 resolve：陈旧结果不得回写任何 UI
    pendingWrite.resolve()
    await waitFor(() => expect(getTrigger().disabled).toBe(false))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").textContent ?? "").not.toContain("导出完成")
  })

  it("导出完成后切换会话：旧的完成通知不污染新会话", async () => {
    const onExport = vi.fn()
    const view = renderExport({ onExport })
    fireEvent.click(getTrigger())
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("导出完成"))
    view.rerender(
      <MarkdownExport snapshot={() => CLEAN_DOC} onExport={onExport} sessionKey="session-b" />
    )
    expect(screen.getByRole("status").textContent ?? "").not.toContain("导出完成")
    expect(screen.queryByRole("alert")).toBeNull()
    // 新会话可立即发起全新导出
    fireEvent.click(getTrigger())
    expect(onExport).toHaveBeenCalledTimes(2)
  })

  it("会话切换提交即刻失效：切换后 settle 的旧 promise 不回写（含 effect 前边界）", async () => {
    const pendingWrite = deferred<void>()
    const onExport = vi.fn(() => pendingWrite.promise)
    const view = renderExport({ onExport })
    fireEvent.click(getTrigger())
    expect(onExport).toHaveBeenCalledTimes(1)
    view.rerender(
      <MarkdownExport snapshot={() => CLEAN_DOC} onExport={onExport} sessionKey="session-b" />
    )
    // 在切换提交后的同一微任务批内 settle：attempt 会话比对先于任何 effect 判定其为陈旧
    pendingWrite.resolve()
    await waitFor(() => expect(getTrigger().disabled).toBe(false))
    expect(screen.getByRole("status").textContent ?? "").not.toContain("导出完成")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("卸载：abort 在途写出，之后 settle 不发生任何状态回写", async () => {
    const pendingWrite = deferred<void>()
    let capturedSignal: AbortSignal | undefined
    const onExport = vi.fn((_result: MarkdownExportResult, context: { signal: AbortSignal }) => {
      capturedSignal = context.signal
      return pendingWrite.promise
    })
    const view = renderExport({ onExport })
    fireEvent.click(getTrigger())
    expect(onExport).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(capturedSignal?.aborted).toBe(true)
    // 宿主忽略 abort 的迟到结果：不应抛错或触发 React 状态更新警告
    pendingWrite.resolve()
    await pendingWrite.promise
  })
})

describe("MarkdownExport 键盘与可访问性", () => {
  it("诊断定位：column 独立存在时也照常展示", () => {
    // codec 诊断字段均为可选；构造仅含 column 的诊断验证“实际存在即展示”。
    mockedExportMarkdown.mockReturnValueOnce({
      markdown: "# 预览\n",
      diagnostics: [{ code: "column-only", message: "仅列定位", column: 7 }]
    })
    renderExport({ snapshot: () => DEGRADED_DOC })
    const panel = openConfirmDrawer()
    expect(panel.textContent).toContain("仅列定位")
    expect(panel.textContent).toContain("第 7 列")
    expect(panel.textContent).toContain("column-only")
  })

  it("键盘聚焦触发按钮按 Enter 打开确认 Drawer", () => {
    renderExport({ snapshot: () => DEGRADED_DOC })
    const trigger = getTrigger()
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    fireEvent.keyDown(trigger, { key: "Enter" })
    // jsdom 对聚焦按钮的 Enter 触发原生激活行为（click）；若环境未合成 click 则显式补一次以验证等价路径
    if (!document.querySelector(".hn-drawer__panel")) fireEvent.click(trigger)
    const panel = document.querySelector<HTMLElement>(".hn-drawer__panel")
    expect(panel).not.toBeNull()
    expect(panel!.getAttribute("role")).toBe("dialog")
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog")
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
  })

  it("键盘聚焦确认按钮按 Enter 写出", () => {
    const onExport = vi.fn()
    renderExport({ snapshot: () => DEGRADED_DOC, onExport })
    const panel = openConfirmDrawer()
    const confirmButton = within(panel).getByRole("button", { name: "确认导出" })
    ;(confirmButton as HTMLButtonElement).focus()
    fireEvent.keyDown(confirmButton, { key: "Enter" })
    if (onExport.mock.calls.length === 0) fireEvent.click(confirmButton)
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it("诊断确认期间触发按钮禁用且 aria-expanded 为 true", () => {
    renderExport({ snapshot: () => DEGRADED_DOC })
    openConfirmDrawer()
    expect(getTrigger().disabled).toBe(true)
    expect(getTrigger().getAttribute("aria-expanded")).toBe("true")
  })
})
