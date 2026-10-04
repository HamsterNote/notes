/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest"
import {
  abortableDelay,
  createDemoMarkdownExport,
  createDemoPictureUpload,
  createDemoReferenceCallbacks,
  formatDiagnostics
} from "./hostHandlers"
import { demoMentionCandidates, demoReferenceResolutions, demoResourceCandidates } from "./fixtures"

const imageFile = (name: string): File => new File(["fake-image-bytes"], name, { type: "image/png" })

const referenceData = {
  mentionCandidates: demoMentionCandidates,
  resourceCandidates: demoResourceCandidates,
  resolutions: demoReferenceResolutions
}

describe("demo 图片上传宿主回调", () => {
  it("返回持久 https 示例地址与文件名 alt，并记录“未发送文件”事件", async () => {
    const events: string[] = []
    const upload = createDemoPictureUpload({ delayMs: 1, onEvent: (message) => events.push(message) })
    const result = await upload(imageFile("白板照片.png"), {
      uploadId: "u-1",
      attempt: 1,
      signal: new AbortController().signal
    })
    expect(result.src).toMatch(/^https:\/\/picsum\.photos\/seed\//)
    expect(result.alt).toBe("白板照片.png")
    expect(events.some((message) => message.includes("未发送文件") && message.includes("白板照片.png"))).toBe(true)
  })

  it("同一 uploadId 的并发调用共享同一在途请求（幂等单飞）", async () => {
    const events: string[] = []
    const upload = createDemoPictureUpload({ delayMs: 20, onEvent: (message) => events.push(message) })
    const context = { uploadId: "u-dup", attempt: 1, signal: new AbortController().signal }
    const [first, second] = await Promise.all([
      upload(imageFile("a.png"), context),
      upload(imageFile("a.png"), context)
    ])
    // 同一 Promise 结果：引用相等证明只执行了一次上传逻辑。
    expect(second).toBe(first)
    expect(events.filter((message) => message.includes("复用"))).toHaveLength(1)
    expect(events.filter((message) => message.includes("未发送文件"))).toHaveLength(1)
  })

  it("一次性失败开关消费后，同 uploadId 重试（attempt+1）成功", async () => {
    const events: string[] = []
    let failArmed = true
    const upload = createDemoPictureUpload({
      delayMs: 1,
      shouldFailNext: () => {
        if (!failArmed) return false
        failArmed = false
        return true
      },
      onEvent: (message) => events.push(message)
    })
    await expect(
      upload(imageFile("b.png"), { uploadId: "u-fail", attempt: 1, signal: new AbortController().signal })
    ).rejects.toThrow(/模拟上传失败/)
    // 失败不缓存：重试重新执行并成功。
    const retry = await upload(imageFile("b.png"), {
      uploadId: "u-fail",
      attempt: 2,
      signal: new AbortController().signal
    })
    expect(retry.src).toMatch(/^https:\/\//)
    expect(events.some((message) => message.includes("第 1 次尝试"))).toBe(true)
  })

  it("signal 中止时以 AbortError 拒绝，且之后同 uploadId 可重新上传", async () => {
    const upload = createDemoPictureUpload({ delayMs: 50 })
    const controller = new AbortController()
    const pending = upload(imageFile("c.png"), { uploadId: "u-abort", attempt: 1, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    // 中止清理缓存，重试可成功。
    const retry = await upload(imageFile("c.png"), {
      uploadId: "u-abort",
      attempt: 2,
      signal: new AbortController().signal
    })
    expect(retry.alt).toBe("c.png")
  })

  it("abortableDelay 在已中止的 signal 上立即拒绝", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(abortableDelay(0, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("demo 宿主引用回调", () => {
  const create = (events: string[]) =>
    createDemoReferenceCallbacks(referenceData, { delayMs: 0, onEvent: (message) => events.push(message) })
  const signal = (): AbortSignal => new AbortController().signal

  it("mention 候选按 query 大小写不敏感过滤", async () => {
    const { candidates } = create([])
    expect(await candidates("mention", "林", { documentId: "demo-tour", signal: signal() })).toEqual([{ resourceId: "u-lin", name: "林晚" }])
    expect(await candidates("mention", "ADA", { documentId: "demo-tour", signal: signal() })).toEqual([{ resourceId: "u-ada", name: "Ada Wong" }])
    const all = await candidates("mention", "  ", { documentId: "demo-tour", signal: signal() })
    expect(all).toHaveLength(demoMentionCandidates.length)
  })

  it("resource 候选使用独立的文档目录", async () => {
    const { candidates } = create([])
    expect(await candidates("resource", "周报", { documentId: "demo-tour", signal: signal() })).toEqual([{ resourceId: "n-weekly", name: "周报模板" }])
    expect(await candidates("resource", "林", { documentId: "demo-tour", signal: signal() })).toEqual([])
  })

  it("resolve 命中返回 label/description，未命中返回 null（占位呈现）并记录事件", async () => {
    const events: string[] = []
    const { resolve } = create(events)
    expect(await resolve({ kind: "mention", resourceId: "u-lin" }, { documentId: "demo-tour", signal: signal() })).toEqual({
      label: "林晚",
      description: "产品设计师"
    })
    expect(await resolve({ kind: "mention", resourceId: "u-ghost" }, { documentId: "demo-tour", signal: signal() })).toBeNull()
    expect(events.some((message) => message.includes("u-ghost") && message.includes("占位"))).toBe(true)
  })

  it("activate 记录宿主事件（库不导航，动作归宿主）", () => {
    const events: string[] = []
    const { activate } = create(events)
    void activate({ kind: "resource", resourceId: "n-weekly", name: "周报模板" }, { documentId: "demo-tour", signal: signal() })
    expect(events).toHaveLength(1)
    expect(events[0]).toContain("resource")
    expect(events[0]).toContain("周报模板")
    expect(events[0]).toContain("demo-tour")
  })
})

describe("demo Markdown 导出写出", () => {
  const exportResult = {
    markdown: "# 标题\n\n正文",
    diagnostics: [{ code: "card-fallback", message: "卡片已降级", nodeId: "n1" }]
  }

  it("仅在回调被调用时写出（确认语义由 MarkdownExport 保证），文件名与内容正确", () => {
    const download = vi.fn()
    const events: string[] = []
    const handler = createDemoMarkdownExport({
      fileName: () => "周会纪要",
      download,
      onEvent: (message) => events.push(message)
    })
    void handler(exportResult, { signal: new AbortController().signal })
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith("周会纪要.md", exportResult.markdown)
    expect(events[0]).toContain("1 条经确认的降级诊断")
  })

  it("signal 已中止时丢弃写出（不下载、不记录）", () => {
    const download = vi.fn()
    const events: string[] = []
    const handler = createDemoMarkdownExport({ fileName: () => "x", download, onEvent: (m) => events.push(m) })
    const controller = new AbortController()
    controller.abort()
    void handler(exportResult, { signal: controller.signal })
    expect(download).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })
})

describe("formatDiagnostics", () => {
  it("按 path / line / 无位置三种形态格式化", () => {
    expect(
      formatDiagnostics([
        { code: "card-fallback", message: "卡片已降级", path: "/data/content/3" },
        { code: "unsupported", message: "语法不支持", line: 12 },
        { code: "plain", message: "无位置诊断" }
      ])
    ).toEqual([
      "[card-fallback] /data/content/3：卡片已降级",
      "[unsupported] 第 12 行：语法不支持",
      "[plain] 无位置诊断"
    ])
  })
})
