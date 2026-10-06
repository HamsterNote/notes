import type { NoteEditorProps } from "../lib"
import type { DemoReferenceCandidate, DemoReferenceResolution } from "./fixtures"

/**
 * 7.4 demo 宿主回调工厂：图片上传、引用候选/激活/解析、Markdown 导出写出。
 * 全部回调类型经 NoteEditorProps 索引访问派生，保证与公开 props 契约严格一致；
 * 不接触任何库内部 schema / Editor / installer。
 */

export type DemoSaveHandler = NonNullable<NoteEditorProps["onSave"]>
export type DemoUploadHandler = NonNullable<NoteEditorProps["onPictureUpload"]>
export type DemoExportHandler = NonNullable<NoteEditorProps["onExportMarkdown"]>
export type DemoCandidatesHandler = NonNullable<NoteEditorProps["onReferenceCandidates"]>
export type DemoActivateHandler = NonNullable<NoteEditorProps["onReferenceActivate"]>
export type DemoResolveHandler = NonNullable<NoteEditorProps["onReferenceResolve"]>

/** 可中止的模拟 IO 延时；signal 触发时以 AbortError 拒绝（与真实 fetch 语义一致）。 */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("操作已中止", "AbortError"))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException("操作已中止", "AbortError"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

/* ===== 图片上传 ===== */

export interface DemoUploadOptions {
  /** 模拟网络耗时（毫秒），测试可传 0。 */
  readonly delayMs?: number
  /** 返回 true 时下一次上传以失败拒绝（消费一次性开关），演示失败/重试链路。 */
  readonly shouldFailNext?: () => boolean
  readonly onEvent?: (message: string) => void
}

interface UploadResult {
  readonly src: string
  readonly alt: string
}

/**
 * 演示上传：不发送任何文件，按 uploadId 幂等返回持久的 https 示例地址
 * （codec 仅允许 http/https src，data/blob 无法通过校验）。同一 uploadId 的
 * 并发/重复调用共享同一个 Promise（单飞幂等）；失败不缓存，重试（同 uploadId、
 * attempt+1）会重新执行；signal 中止时以 AbortError 拒绝。
 */
export function createDemoPictureUpload(options: DemoUploadOptions = {}): DemoUploadHandler {
  const delayMs = options.delayMs ?? 600
  const inflight = new Map<string, Promise<UploadResult>>()
  return (file, { uploadId, attempt, signal }) => {
    const existing = inflight.get(uploadId)
    if (existing) {
      options.onEvent?.(`上传 ${file.name}：复用同 uploadId 的在途/已完成请求（幂等）`)
      return existing
    }
    const task = (async (): Promise<UploadResult> => {
      await abortableDelay(delayMs, signal)
      if (options.shouldFailNext?.()) {
        options.onEvent?.(`上传 ${file.name}：演示模拟失败（第 ${attempt} 次尝试），可点击重试`)
        throw new Error("演示：模拟上传失败，请点击重试")
      }
      const result: UploadResult = {
        src: `https://picsum.photos/seed/${encodeURIComponent(uploadId)}/960/540`,
        alt: file.name
      }
      options.onEvent?.(`演示上传未发送文件，返回示例地址：${file.name} → ${result.src}`)
      return result
    })()
    inflight.set(uploadId, task)
    // 失败/中止不缓存：同 uploadId 的重试重新执行（shouldFailNext 已被消费时即可成功）。
    task.catch(() => {
      if (inflight.get(uploadId) === task) inflight.delete(uploadId)
    })
    return task
  }
}

/* ===== 宿主引用：候选 / 激活 / 解析 ===== */

export interface DemoReferenceData {
  readonly mentionCandidates: readonly DemoReferenceCandidate[]
  readonly resourceCandidates: readonly DemoReferenceCandidate[]
  /** key 为 `${kind}:${resourceId}`；查不到返回 null，编辑器以失效占位呈现。 */
  readonly resolutions: Readonly<Record<string, DemoReferenceResolution>>
}

export interface DemoReferenceCallbacks {
  readonly candidates: DemoCandidatesHandler
  readonly activate: DemoActivateHandler
  readonly resolve: DemoResolveHandler
}

export interface DemoReferenceOptions {
  readonly delayMs?: number
  readonly onEvent?: (message: string) => void
}

export function createDemoReferenceCallbacks(
  data: DemoReferenceData,
  options: DemoReferenceOptions = {}
): DemoReferenceCallbacks {
  const delayMs = options.delayMs ?? 150
  const candidates: DemoCandidatesHandler = async (kind, query, { signal }) => {
    await abortableDelay(delayMs, signal)
    const source = kind === "mention" ? data.mentionCandidates : data.resourceCandidates
    const needle = query.trim().toLowerCase()
    return source
      .filter((item) => needle === "" || item.name.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((item) => ({ resourceId: item.resourceId, name: item.name }))
  }
  const activate: DemoActivateHandler = (reference, { documentId }) => {
    // 魔法链接只提供原始 href，不转换或伪造 resourceId/name。
    if (reference.kind === "hnmagic") {
      options.onEvent?.(
        `激活魔法链接「${reference.href}」（文档 ${documentId}）——库不自行导航，动作由宿主决定`
      )
      return
    }
    options.onEvent?.(
      `激活引用 [${reference.kind}]「${reference.name}」（${reference.resourceId}，文档 ${documentId}）——库不自行导航，动作由宿主决定`
    )
  }
  const resolve: DemoResolveHandler = async ({ kind, resourceId }, { signal }) => {
    await abortableDelay(delayMs, signal)
    const hit = data.resolutions[`${kind}:${resourceId}`]
    if (!hit) {
      options.onEvent?.(`解析失败（占位呈现）：[${kind}] ${resourceId} 不在宿主解析表中`)
      return null
    }
    return { label: hit.label, ...(hit.description === undefined ? {} : { description: hit.description }) }
  }
  return { candidates, activate, resolve }
}

/* ===== Markdown 导出写出 ===== */

/** 触发浏览器下载（宿主侧显式写出；仅在导出界面确认后由回调调用）。 */
export function downloadTextFile(fileName: string, content: string): void {
  // jsdom 等环境没有 createObjectURL：静默跳过下载（事件仍会记录），真实浏览器正常落盘。
  if (typeof URL.createObjectURL !== "function") return
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.rel = "noopener"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export interface DemoExportOptions {
  /** 导出文件名（不含扩展名），通常取当前文档标题。 */
  readonly fileName: () => string
  /** 写出实现可注入（测试注入 spy）；默认浏览器下载。 */
  readonly download?: (fileName: string, content: string) => void
  readonly onEvent?: (message: string) => void
}

/**
 * 宿主写出回调：MarkdownExport 保证仅在无诊断或用户显式确认后才调用这里，
 * 宿主绝不提前绕开确认落盘；signal 已中止时丢弃本次写出。
 */
export function createDemoMarkdownExport(options: DemoExportOptions): DemoExportHandler {
  const download = options.download ?? downloadTextFile
  return (result, { signal }) => {
    if (signal.aborted) return
    download(`${options.fileName()}.md`, result.markdown)
    options.onEvent?.(
      `已写出 Markdown（${result.markdown.length} 字符${
        result.diagnostics.length > 0 ? `，含 ${result.diagnostics.length} 条经确认的降级诊断` : "，无降级诊断"
      }）`
    )
  }
}

/* ===== 诊断格式化（结构化入参，避免依赖内部类型名） ===== */

export interface DemoDiagnosticLike {
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly line?: number
  readonly nodeId?: string
}

/** 把 codec/Markdown 诊断格式化为中文可读行，供侧边栏面板展示。 */
export function formatDiagnostics(diagnostics: readonly DemoDiagnosticLike[]): string[] {
  return diagnostics.map((diagnostic) => {
    const where = diagnostic.path ?? (diagnostic.line !== undefined ? `第 ${diagnostic.line} 行` : (diagnostic.nodeId ?? ""))
    return where === "" ? `[${diagnostic.code}] ${diagnostic.message}` : `[${diagnostic.code}] ${where}：${diagnostic.message}`
  })
}
