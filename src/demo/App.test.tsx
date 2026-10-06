/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import { createInMemoryExclusiveLock, createLocalStorageNoteStore, type DemoNoteStore } from "./hostStore"

/**
 * 7.4 演示宿主集成测试：仅用根入口公开 API 完成装载、编辑观测、真实 CAS 保存、
 * 冲突重载、显式导出（诊断确认）与图片上传链路。编辑动作经 PM 原生 paste 事件
 * 驱动（jsdom 无 ClipboardEvent 构造器，结构性夹具与库内测试一致），不接触任何
 * 库内部 Editor / session 测试接口。
 */

let storeCounter = 0

afterEach(() => {
  cleanup()
})

interface RenderedDemo {
  readonly container: HTMLElement
  readonly store: DemoNoteStore
  readonly download: ReturnType<typeof vi.fn>
}

function renderApp(): RenderedDemo {
  // 每个用例独立的 key 前缀：localStorage 全局共享，避免跨用例污染。
  // jsdom 无 Web Locks，注入进程内真实排他锁（与生产同锁语义，仅不跨标签页）。
  const store = createLocalStorageNoteStore(
    localStorage,
    `hamster-note-demo-test-${++storeCounter}:`,
    createInMemoryExclusiveLock()
  )
  const download = vi.fn()
  const view = render(<App store={store} download={download} />)
  return { container: view.container, store, download }
}

async function editableDom(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.querySelector(".demo-note-preview .tiptap")).not.toBeNull()
  })
  const dom = document.querySelector<HTMLElement>(".demo-note-preview .tiptap")
  if (dom === null) throw new Error("编辑器 DOM 缺失")
  return dom
}

/** 经 PM 原生 paste 在默认选区（文档起点）插入文本，使会话变脏。 */
function pasteText(editable: HTMLElement, text: string): void {
  const values = new Map([["text/plain", text]])
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (name: string, value: string) => values.set(name, value),
      getData: (name: string) => values.get(name) ?? "",
      clearData: () => values.clear(),
      files: [],
      items: [],
      types: [...values.keys()]
    }
  })
  fireEvent(editable, event)
}

function previewRegion(): HTMLElement {
  const preview = document.querySelector(".demo-note-preview")
  expect(preview).not.toBeNull()
  return preview as HTMLElement
}

async function pasteAndWaitDirty(text: string): Promise<void> {
  pasteText(await editableDom(), text)
  await screen.findByText("有未保存的修改")
}

describe("演示宿主 — 装载与 fixture 合法性", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("默认装载功能巡览 fixture：全节点类型经严格 codec 校验成功渲染", async () => {
    renderApp()
    const preview = previewRegion()
    await within(preview).findByRole("heading", { name: "编辑器功能巡览" })
    // 表格 / callout（标题在 NodeView textbox）/ 折叠块（同）/ 卡片与画板预览按钮均真实
    // 渲染（fixture 不合法会触发初始加载错误）。
    expect(within(preview).getByText("HNN 保存")).toBeTruthy()
    expect(within(preview).getByDisplayValue("演示说明")).toBeTruthy()
    expect(within(preview).getByDisplayValue("折叠块：实现细节")).toBeTruthy()
    expect(within(preview).getByRole("button", { name: "编辑卡片" })).toBeTruthy()
    expect(within(preview).getByRole("button", { name: "编辑画板" })).toBeTruthy()
    expect(screen.queryByText("初始加载错误")).toBeNull()
    // 从未保存过：侧边栏如实呈现。
    expect(screen.getByText("「功能巡览」尚未保存")).toBeTruthy()
  })

  it("引用 fixture：可解析引用与失效占位同时呈现", async () => {
    renderApp()
    fireEvent.change(screen.getByLabelText("选择文档"), { target: { value: "demo-references" } })
    const preview = previewRegion()
    await within(preview).findByRole("heading", { name: "引用与外部条目" })
    expect(within(preview).getByText("已失效的外部条目")).toBeTruthy()
    expect(screen.queryByText("初始加载错误")).toBeNull()
  })
})

describe("演示宿主 — 保存与真实 CAS", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("编辑 → 脏 → 保存：CAS 写出 r1，事件与侧边栏可观察", async () => {
    renderApp()
    await pasteAndWaitDirty("宿主集成测试插入。")
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await screen.findByText(/已保存「功能巡览」（CAS 通过，新 revision r1）/)
    expect(screen.getByText("已存 revision：r1")).toBeTruthy()
    expect(screen.getByText("已保存")).toBeTruthy()
  })

  it("外部修改后保存判冲突（不自动合并/覆盖），重新载入采用对方版本", async () => {
    renderApp()
    await pasteAndWaitDirty("第一段编辑。")
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await screen.findByText(/已保存「功能巡览」（CAS 通过，新 revision r1）/)

    // 另一客户端写入 r2。
    fireEvent.click(screen.getByRole("button", { name: "模拟另一客户端修改" }))
    await screen.findByText(/已模拟另一客户端修改「功能巡览」（外部 revision r2）/)
    expect(screen.getByText("已存 revision：r2")).toBeTruthy()

    // 编辑器仍基于 r1：保存被 CAS 拒绝，冲突呈现为冲突而非错误/已保存。
    await pasteAndWaitDirty("冲突编辑。")
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await screen.findByText("检测到保存冲突：这份笔记在其他地方已有更新。")
    await screen.findByText(/保存冲突：「功能巡览」已被外部修改，CAS 拒绝覆盖/)
    expect(screen.getByText("已存 revision：r2")).toBeTruthy()

    // 重新载入（loadKey 递增）采用外部版本，冲突界面随新会话消失。
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }))
    await screen.findByText(/已重载「功能巡览」（载入已存 revision r2/)
    await within(previewRegion()).findByText(/另一客户端的外部修改/)
    await waitFor(() => {
      expect(screen.queryByText("检测到保存冲突：这份笔记在其他地方已有更新。")).toBeNull()
    })
  })

  it("保存成功后切走再切回：以刚保存的快照与 revision 重建会话，不回落旧 fixture、不误冲突", async () => {
    renderApp()
    await pasteAndWaitDirty("已保存的第一版内容。")
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await screen.findByText(/已保存「功能巡览」（CAS 通过，新 revision r1）/)

    // 切到另一个文档，再切回「功能巡览」。
    fireEvent.change(screen.getByLabelText("选择文档"), { target: { value: "demo-references" } })
    await within(previewRegion()).findByRole("heading", { name: "引用与外部条目" })
    fireEvent.change(screen.getByLabelText("选择文档"), { target: { value: "demo-tour" } })

    // 切回后内容来自刚保存的快照（而非旧 fixture），侧边栏显示 r1。
    await waitFor(() => {
      expect(previewRegion().textContent).toContain("已保存的第一版内容")
    })
    expect(screen.getByText("已存 revision：r1")).toBeTruthy()

    // 基线正确同步：继续编辑再保存应成功为 r2，而不是与旧 revision 冲突。
    await pasteAndWaitDirty("第二版追加。")
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await screen.findByText(/已保存「功能巡览」（CAS 通过，新 revision r2）/)
    expect(screen.queryByText("检测到保存冲突：这份笔记在其他地方已有更新。")).toBeNull()
  })

  it("新建空文档（手写 HNN 空文档）可编辑并完成首次保存", async () => {
    renderApp()
    fireEvent.click(screen.getByRole("button", { name: "新建空文档" }))
    await screen.findByText(/已新建空文档「未命名文档 1」/)
    await pasteAndWaitDirty("空文档的第一行。")
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await screen.findByText(/已保存「未命名文档 1」（CAS 通过，新 revision r1）/)
  })
})

describe("演示宿主 — Markdown 导出与文件打开", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("导出含降级诊断：先弹确认界面，确认前宿主绝不落盘，确认后才下载", async () => {
    const { download } = renderApp()
    fireEvent.change(screen.getByLabelText("选择文档"), { target: { value: "demo-export" } })
    await within(previewRegion()).findByRole("heading", { name: /周会纪要/ })

    fireEvent.click(screen.getByRole("button", { name: "导出 Markdown" }))
    // 诊断确认界面（卡片无法无损表达）；此时宿主写出回调尚未被调用。
    await screen.findByText(/处内容无法无损表达，导出结果中已以可读形式降级/)
    expect(download).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "确认导出" }))
    await waitFor(() => {
      expect(download).toHaveBeenCalledTimes(1)
    })
    const [fileName, content] = download.mock.calls[0] as [string, string]
    expect(fileName).toBe("周会纪要（导出演示）.md")
    expect(content).toContain("周会纪要")
    await screen.findByText(/已写出 Markdown（/)
    // 诊断明细进入侧边栏面板。
    await screen.findByText("最近导出")
    expect(screen.getByText(/card-fallback/)).toBeTruthy()
  })

  it("打开 .md 文件：经根入口 importMarkdown 导入为新文档并显示诊断面板", async () => {
    renderApp()
    const input = document.querySelector('input[accept*=".md"]')
    expect(input).not.toBeNull()
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["# 导入标题\n\n正文段落"], "会议记录.md", { type: "text/markdown" })] }
    })
    await within(previewRegion()).findByRole("heading", { name: "导入标题" })
    await screen.findByText(/已导入 Markdown 文件 会议记录\.md/)
    expect(screen.getByText("最近导入")).toBeTruthy()
    // 新文档出现在切换器中并被选中。
    const select = screen.getByLabelText("选择文档")
    if (!(select instanceof HTMLSelectElement)) throw new Error("文档切换 select 缺失")
    expect(select.value).toMatch(/^opened-/)
  })

  it("打开非法 JSON 的 .hnn 文件：报告解析失败且不切换文档", async () => {
    renderApp()
    await within(previewRegion()).findByRole("heading", { name: "编辑器功能巡览" })
    const input = document.querySelector('input[accept*=".hnn"]')
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["not json at all"], "broken.hnn")] }
    })
    await screen.findByText(/无法打开 broken\.hnn：不是合法 JSON/)
    const select = screen.getByLabelText("选择文档")
    if (!(select instanceof HTMLSelectElement)) throw new Error("文档切换 select 缺失")
    expect(select.value).toBe("demo-tour")
  })

  it("打开合法 JSON 但非法 HNN：预校验拒绝，不加入/不切换文档，旧会话与标题不受影响", async () => {
    renderApp()
    await within(previewRegion()).findByRole("heading", { name: "编辑器功能巡览" })
    const input = document.querySelector('input[accept*=".hnn"]')
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File([JSON.stringify({ foo: 1 })], "invalid.hnn")] }
    })
    await screen.findByText(/无法打开 invalid\.hnn：HNN 校验失败/)
    // 不切换文档：select 仍是 demo-tour，且没有新选项混入。
    const select = screen.getByLabelText("选择文档")
    if (!(select instanceof HTMLSelectElement)) throw new Error("文档切换 select 缺失")
    expect(select.value).toBe("demo-tour")
    expect(within(select).queryByRole("option", { name: /invalid/ })).toBeNull()
    // 旧编辑会话仍在运行，标题仍是旧文档。
    await within(previewRegion()).findByRole("heading", { name: "编辑器功能巡览" })
    expect(screen.getByRole("heading", { name: "编辑器功能巡览" })).toBeTruthy()
    // 该非法候选不再进入「初始加载错误」面板（它在入列前就被拒绝）。
    expect(screen.queryByText("初始加载错误")).toBeNull()
  })
})

describe("演示宿主 — 图片上传", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  async function pickImage(name = "白板.png"): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: "插入图片" }))
    const input = document.querySelector(".hn-editor-uploads__input")
    expect(input).not.toBeNull()
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["fake-image"], name, { type: "image/png" })] }
    })
  }

  it("上传成功：演示回调返回持久 https 示例地址并插入图片，事件说明未发送文件", async () => {
    renderApp()
    await editableDom()
    await pickImage()
    await screen.findByText(/演示上传未发送文件，返回示例地址：白板\.png → https:\/\/picsum\.photos\//, undefined, {
      timeout: 4000
    })
    // fixture 自带一张 picsum 配图 + 新插入一张。
    await waitFor(
      () => {
        expect(document.querySelectorAll('.demo-note-preview img[src^="https://picsum.photos/"]').length).toBeGreaterThanOrEqual(2)
      },
      { timeout: 4000 }
    )
  })

  it("“下次上传失败一次”：失败后经列表重试成功（同 uploadId 幂等）", async () => {
    renderApp()
    await editableDom()
    fireEvent.click(screen.getByRole("switch", { name: /下次上传失败一次/ }))
    await pickImage("重试照片.png")
    await screen.findByText(/上传 重试照片\.png：演示模拟失败/, undefined, { timeout: 4000 })
    fireEvent.click(await screen.findByRole("button", { name: /重试上传 重试照片\.png/ }))
    await screen.findByText(/演示上传未发送文件，返回示例地址：重试照片\.png/, undefined, { timeout: 4000 })
  })
})
