import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react"
import { HnnCodecError, importMarkdown, NoteEditor, type NoteEditorProps } from "../lib"
import {
  demoFixtures,
  demoMentionCandidates,
  demoReferenceResolutions,
  demoResourceCandidates,
  emptyDocument
} from "./fixtures"
import { createLocalStorageNoteStore, type DemoNoteStore } from "./hostStore"
import {
  abortableDelay,
  createDemoMarkdownExport,
  createDemoPictureUpload,
  createDemoReferenceCallbacks,
  downloadTextFile,
  formatDiagnostics,
  type DemoSaveHandler
} from "./hostHandlers"
import "katex/dist/katex.min.css"
import "./app.css"

/**
 * 7.4 演示宿主：仅用库根入口的公开导出完成装载、编辑、CAS 保存与显式导出。
 * - 文档只经 initialDocument/initialRevision/loadKey 进入编辑器，onChange 仅观测、
 *   绝不受控回灌；宿主不持有第二份 undo/selection 事实；
 * - 保存走 localStorage 真实 CAS（hostStore），冲突不自动合并、不静默覆盖；
 * - 打开 .hnn/.md 文件、下载已存 HNN 是宿主专属界面（库不提供）；
 * - 多文档 + loadKey 重载便于真实浏览器走查会话隔离。
 */

interface DemoEvent {
  readonly id: number
  readonly time: string
  readonly text: string
}

interface DemoDocumentEntry {
  readonly documentId: string
  readonly title: string
  readonly origin: "fixture" | "opened" | "blank"
  /** 首次载入内容（fixture/打开的文件/空文档），从未保存过时重载回退到它。 */
  readonly pristine: unknown
  /** 当前 loadKey 对应的初始内容；重载时从宿主存储（或 pristine）刷新。 */
  readonly initialDocument: unknown
  readonly initialRevision?: string
  readonly loadKey: number
}

interface InitialLoadErrorRecord {
  readonly id: number
  readonly time: string
  readonly documentId: string
  readonly loadKey: string
  readonly lines: readonly string[]
}

export interface AppProps {
  /** 导出/下载写出实现（测试注入 spy）；默认浏览器下载。 */
  readonly download?: (fileName: string, content: string) => void
  /** 宿主存储实现（测试可注入隔离 Storage）；默认 localStorage。 */
  readonly store?: DemoNoteStore
}

const timeNow = (): string => new Date().toLocaleTimeString("zh-CN", { hour12: false })

/** 模拟外部修改：向文档末尾追加一段（store 已 structuredClone，可直接改）。 */
function appendExternalParagraph(document: unknown): unknown {
  if (typeof document !== "object" || document === null) return document
  const data = (document as Record<string, unknown>)["data"]
  if (typeof data !== "object" || data === null) return document
  const content = (data as Record<string, unknown>)["content"]
  if (!Array.isArray(content)) return document
  content.push({
    type: "paragraph",
    attrs: { nodeId: crypto.randomUUID() },
    content: [{ type: "text", text: "（另一客户端的外部修改）" }]
  })
  return document
}

export function App(props: AppProps = {}) {
  const store = useMemo<DemoNoteStore>(() => props.store ?? createLocalStorageNoteStore(), [props.store])

  /* ===== 事件日志（侧边栏可观察的宿主回调链路） ===== */
  const eventIdRef = useRef(0)
  const [events, setEvents] = useState<readonly DemoEvent[]>([])
  const pushEvent = useCallback((text: string) => {
    setEvents((current) => [...current.slice(-59), { id: ++eventIdRef.current, time: timeNow(), text }])
  }, [])

  /* ===== 文档列表：fixture + 打开的文件 + 新建空文档；已存版本优先于 fixture ===== */
  const [documents, setDocuments] = useState<readonly DemoDocumentEntry[]>(() =>
    demoFixtures.map((fixture): DemoDocumentEntry => {
      const stored = store.load(fixture.documentId)
      return {
        documentId: fixture.documentId,
        title: fixture.title,
        origin: "fixture",
        pristine: fixture.document,
        initialDocument: stored?.document ?? fixture.document,
        ...(stored === null ? {} : { initialRevision: stored.revision }),
        loadKey: 0
      }
    })
  )
  const [activeId, setActiveId] = useState<string>(() => demoFixtures[0]?.documentId ?? "")
  const active = documents.find((entry) => entry.documentId === activeId) ?? documents[0]

  // 回调内经 ref 读最新文档列表，保持 props 回调身份稳定（同 key 能力同步零打扰）。
  const documentsRef = useRef(documents)
  documentsRef.current = documents
  const activeRef = useRef(active)
  activeRef.current = active

  const [theme, setTheme] = useState<"light" | "dark">("light")
  const [storageTick, setStorageTick] = useState(0)
  const [changeNote, setChangeNote] = useState<string>("尚无编辑观测")
  const [importNotes, setImportNotes] = useState<readonly string[] | null>(null)
  const [exportNotes, setExportNotes] = useState<readonly string[] | null>(null)
  const [initialErrors, setInitialErrors] = useState<readonly InitialLoadErrorRecord[]>([])
  const initialErrorIdRef = useRef(0)
  const blankCountRef = useRef(0)
  const openedCountRef = useRef(0)
  const [failNextUpload, setFailNextUpload] = useState(false)
  const failNextUploadRef = useRef(false)

  const titleOf = useCallback((documentId: string): string => {
    return documentsRef.current.find((entry) => entry.documentId === documentId)?.title ?? documentId
  }, [])

  /* ===== 保存：真实 CAS，绝不无条件 saved ===== */
  const handleSave = useCallback<DemoSaveHandler>(
    async (snapshot, { documentId, baseRevision, signal }) => {
      await abortableDelay(120, signal) // 模拟宿主 IO；中止只隔离本次请求
      const result = store.saveWithCas(documentId, snapshot, baseRevision)
      if (result.kind === "saved") {
        pushEvent(`已保存「${titleOf(documentId)}」（CAS 通过，新 revision ${result.revision}）`)
        setStorageTick((tick) => tick + 1)
      } else {
        pushEvent(`保存冲突：「${titleOf(documentId)}」已被外部修改，CAS 拒绝覆盖`)
      }
      return result
    },
    [store, pushEvent, titleOf]
  )

  /* ===== onChange：仅观测（时间与快照体积），不受控回灌 ===== */
  const handleChange = useCallback<NonNullable<NoteEditorProps["onChange"]>>(
    (snapshot) => {
      const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
      setChangeNote(`${timeNow()} · 快照约 ${bytes} 字节（仅观测，不回灌编辑器）`)
    },
    []
  )

  /* ===== 初始加载失败：诊断入面板，旧会话保持运行 ===== */
  const handleInitialLoadError = useCallback<NonNullable<NoteEditorProps["onInitialLoadError"]>>(
    (error, { documentId, loadKey }) => {
      const lines = error instanceof HnnCodecError
        ? error.diagnostics.map((diagnostic) => `${diagnostic.path}：${diagnostic.message}`)
        : [error instanceof Error ? error.message : String(error)]
      setInitialErrors((current) => [
        ...current.slice(-9),
        { id: ++initialErrorIdRef.current, time: timeNow(), documentId, loadKey: String(loadKey), lines }
      ])
      pushEvent(`初始加载失败：「${titleOf(documentId)}」（${lines.length} 条诊断，仍在运行的旧会话不受影响）`)
    },
    [pushEvent, titleOf]
  )

  /* ===== 图片上传 / 引用 / 导出回调（身份稳定） ===== */
  const uploadHandler = useMemo(
    () =>
      createDemoPictureUpload({
        shouldFailNext: () => {
          if (!failNextUploadRef.current) return false
          failNextUploadRef.current = false
          setFailNextUpload(false)
          return true
        },
        onEvent: pushEvent
      }),
    [pushEvent]
  )

  const referenceCallbacks = useMemo(
    () =>
      createDemoReferenceCallbacks(
        {
          mentionCandidates: demoMentionCandidates,
          resourceCandidates: demoResourceCandidates,
          resolutions: demoReferenceResolutions
        },
        { onEvent: pushEvent }
      ),
    [pushEvent]
  )

  const exportHandler = useMemo(
    () =>
      createDemoMarkdownExport({
        fileName: () => activeRef.current?.title ?? "note",
        ...(props.download === undefined ? {} : { download: props.download }),
        onEvent: (message) => {
          pushEvent(message)
        }
      }),
    [props.download, pushEvent]
  )

  // 导出诊断面板：包一层回调以记录诊断明细（写出语义不变，仍在确认后才调用）。
  const handleExport = useMemo<NonNullable<NoteEditorProps["onExportMarkdown"]>>(
    () => (result, context) => {
      setExportNotes(
        result.diagnostics.length > 0
          ? formatDiagnostics(result.diagnostics)
          : ["本次导出无降级诊断（内容可由 GFM 方言无损表达）"]
      )
      return exportHandler(result, context)
    },
    [exportHandler]
  )

  /* ===== 文档操作 ===== */
  const reloadActive = useCallback(() => {
    const entry = activeRef.current
    if (!entry) return
    const stored = store.load(entry.documentId)
    // 单次映射重建条目：从未保存过时 initialRevision 需随条目一并移除（初次载入语义）。
    setDocuments((current) =>
      current.map((item): DemoDocumentEntry => {
        if (item.documentId !== entry.documentId) return item
        const base = {
          documentId: item.documentId,
          title: item.title,
          origin: item.origin,
          pristine: item.pristine,
          initialDocument: stored?.document ?? item.pristine,
          loadKey: item.loadKey + 1
        }
        return stored === null ? base : { ...base, initialRevision: stored.revision }
      })
    )
    setStorageTick((tick) => tick + 1)
    pushEvent(
      stored === null
        ? `已重载「${entry.title}」（从未保存，回到初始内容；loadKey 已递增）`
        : `已重载「${entry.title}」（载入已存 revision ${stored.revision}；loadKey 已递增）`
    )
  }, [store, pushEvent])

  const createBlankDocument = useCallback(() => {
    blankCountRef.current += 1
    const documentId = `blank-${crypto.randomUUID().slice(0, 8)}`
    const title = `未命名文档 ${blankCountRef.current}`
    const pristine = emptyDocument(crypto.randomUUID())
    setDocuments((current) => [...current, { documentId, title, origin: "blank", pristine, initialDocument: pristine, loadKey: 0 }])
    setActiveId(documentId)
    pushEvent(`已新建空文档「${title}」（手写 HNN 空文档，保存后进入 localStorage）`)
  }, [pushEvent])

  const addOpenedDocument = useCallback(
    (title: string, document: unknown) => {
      openedCountRef.current += 1
      const documentId = `opened-${openedCountRef.current}-${crypto.randomUUID().slice(0, 8)}`
      setDocuments((current) => [...current, { documentId, title, origin: "opened", pristine: document, initialDocument: document, loadKey: 0 }])
      setActiveId(documentId)
    },
    []
  )

  /* ===== 打开文件（宿主专属界面；库不提供文件选择） ===== */
  const openHnnFile = useCallback(
    async (file: File) => {
      const text = await file.text()
      try {
        const parsed: unknown = JSON.parse(text)
        addOpenedDocument(file.name.replace(/\.(hnn|json)$/iu, ""), parsed)
        pushEvent(`已打开 HNN 文件 ${file.name}；若未通过严格校验，诊断见「初始加载错误」面板`)
      } catch {
        pushEvent(`无法打开 ${file.name}：不是合法 JSON`)
      }
    },
    [addOpenedDocument, pushEvent]
  )

  const openMarkdownFile = useCallback(
    async (file: File) => {
      const markdown = await file.text()
      const result = importMarkdown(markdown)
      if ("failure" in result) {
        setImportNotes([`导入失败（${result.failure}）：`, ...formatDiagnostics(result.diagnostics)])
        pushEvent(`Markdown 导入失败：${file.name}（${result.failure}）`)
        return
      }
      setImportNotes(
        result.diagnostics.length > 0
          ? formatDiagnostics(result.diagnostics)
          : ["导入无降级诊断（Markdown 可完整映射为 HNN）"]
      )
      addOpenedDocument(file.name.replace(/\.(md|markdown)$/iu, ""), result.document)
      pushEvent(`已导入 Markdown 文件 ${file.name}（诊断见「导入 / 导出诊断」面板）`)
    },
    [addOpenedDocument, pushEvent]
  )

  const hnnInputRef = useRef<HTMLInputElement | null>(null)
  const markdownInputRef = useRef<HTMLInputElement | null>(null)
  const handleFileChange = useCallback(
    (kind: "hnn" | "markdown") => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ""
      if (!file) return
      void (kind === "hnn" ? openHnnFile(file) : openMarkdownFile(file))
    },
    [openHnnFile, openMarkdownFile]
  )

  /* ===== 冲突演示与已存 HNN ===== */
  const simulateExternalEdit = useCallback(() => {
    const entry = activeRef.current
    if (!entry) return
    const stored = store.overwriteExternal(entry.documentId, appendExternalParagraph)
    if (stored === null) {
      pushEvent(`「${entry.title}」尚未保存过，无法模拟外部修改（请先保存一次）`)
      return
    }
    setStorageTick((tick) => tick + 1)
    pushEvent(`已模拟另一客户端修改「${entry.title}」（外部 revision ${stored.revision}）；编辑器下次保存将 CAS 冲突`)
  }, [store, pushEvent])

  const downloadStoredHnn = useCallback(() => {
    const entry = activeRef.current
    if (!entry) return
    const stored = store.load(entry.documentId)
    if (stored === null) return
    ;(props.download ?? downloadTextFile)(`${entry.title}.hnn.json`, JSON.stringify(stored.document, null, 2))
    pushEvent(`已写出「${entry.title}」的已存 HNN（revision ${stored.revision}，JSON 下载）`)
  }, [store, props.download, pushEvent])

  // 已存版本展示随 storageTick 重读（保存/外部修改/重载后刷新）。
  const storedActive = useMemo(() => {
    void storageTick
    return active ? store.load(active.documentId) : null
  }, [store, active, storageTick])

  const storedHnnPreview = useMemo(() => {
    if (storedActive === null) return null
    const text = JSON.stringify(storedActive.document, null, 2)
    return text.length > 4000 ? `${text.slice(0, 4000)}\n…（已截断，完整内容请下载）` : text
  }, [storedActive])

  if (!active) return null

  return (
    <div className={theme === "dark" ? "demo-layout demo-layout--dark" : "demo-layout"}>
      <aside className="demo-sidebar">
        <div className="demo-sidebar-header">
          <h2>演示宿主</h2>
          <p>HNN 默认保存 · 真实 CAS · 显式 Markdown 导出</p>
        </div>

        {/* ===== 文档切换与载入 ===== */}
        <section className="demo-control-group" aria-labelledby="demo-docs-label">
          <span className="demo-control-label" id="demo-docs-label">文档</span>
          <label className="demo-field-label" htmlFor="demo-doc-select">选择文档</label>
          <select
            id="demo-doc-select"
            className="demo-text-input"
            value={active.documentId}
            onChange={(event) => setActiveId(event.target.value)}
          >
            {documents.map((entry) => (
              <option key={entry.documentId} value={entry.documentId}>
                {entry.title}{entry.origin === "opened" ? "（打开的文件）" : entry.origin === "blank" ? "（新建）" : ""}
              </option>
            ))}
          </select>
          <div className="demo-button-row">
            <button type="button" className="demo-button" onClick={reloadActive}>重新载入</button>
            <button type="button" className="demo-button" onClick={createBlankDocument}>新建空文档</button>
          </div>
          <div className="demo-button-row">
            <button type="button" className="demo-button" onClick={() => hnnInputRef.current?.click()}>打开 .hnn 文件</button>
            <button type="button" className="demo-button" onClick={() => markdownInputRef.current?.click()}>打开 .md 文件</button>
          </div>
          <input ref={hnnInputRef} type="file" accept=".hnn,.json,application/json" hidden tabIndex={-1} aria-hidden="true" onChange={handleFileChange("hnn")} />
          <input ref={markdownInputRef} type="file" accept=".md,.markdown,text/markdown" hidden tabIndex={-1} aria-hidden="true" onChange={handleFileChange("markdown")} />
          <p className="demo-hint">重新载入按 loadKey 重建会话并采用宿主最新存储；打开文件是宿主专属界面。</p>
        </section>

        {/* ===== 外观 ===== */}
        <section className="demo-control-group">
          <label className="demo-toggle-row">
            <span className="demo-control-label">深色主题</span>
            <button
              type="button"
              role="switch"
              aria-checked={theme === "dark"}
              className={`demo-switch ${theme === "dark" ? "demo-switch--on" : ""}`}
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            >
              <span className="demo-switch-thumb" />
            </button>
          </label>
          <p className="demo-hint">经 NoteEditor 的 theme prop 切换 hn-* token。</p>
        </section>

        {/* ===== 保存与存储 ===== */}
        <section className="demo-control-group" aria-labelledby="demo-storage-label">
          <span className="demo-control-label" id="demo-storage-label">保存与存储</span>
          <output className="demo-output" aria-live="polite">
            {storedActive === null ? `「${active.title}」尚未保存` : `已存 revision：${storedActive.revision}`}
          </output>
          <output className="demo-output demo-output--muted">{changeNote}</output>
          <div className="demo-button-row">
            <button type="button" className="demo-button" disabled={storedActive === null} onClick={simulateExternalEdit}>模拟另一客户端修改</button>
            <button type="button" className="demo-button" disabled={storedActive === null} onClick={downloadStoredHnn}>下载已存 HNN</button>
          </div>
          <p className="demo-hint">保存经真实 CAS 比较；外部修改后再次保存会冲突，可重试或重新载入采用对方版本。</p>
        </section>

        {/* ===== 图片上传 ===== */}
        <section className="demo-control-group">
          <span className="demo-control-label">图片上传</span>
          <label className="demo-toggle-row">
            <span className="demo-hint">下次上传失败一次</span>
            <button
              type="button"
              role="switch"
              aria-checked={failNextUpload}
              className={`demo-switch ${failNextUpload ? "demo-switch--on" : ""}`}
              onClick={() => {
                failNextUploadRef.current = !failNextUpload
                setFailNextUpload(!failNextUpload)
              }}
            >
              <span className="demo-switch-thumb" />
            </button>
          </label>
          <p className="demo-hint">演示上传不发送文件，返回持久 https 示例地址（codec 仅允许 http/https）。</p>
        </section>

        {/* ===== 导入 / 导出诊断 ===== */}
        {(importNotes !== null || exportNotes !== null) && (
          <section className="demo-control-group" aria-labelledby="demo-diag-label">
            <span className="demo-control-label" id="demo-diag-label">导入 / 导出诊断</span>
            {importNotes !== null && (
              <div>
                <h3 className="demo-sub-label">最近导入</h3>
                <ul className="demo-note-list">
                  {importNotes.map((note) => <li key={`i:${note}`}>{note}</li>)}
                </ul>
              </div>
            )}
            {exportNotes !== null && (
              <div>
                <h3 className="demo-sub-label">最近导出</h3>
                <ul className="demo-note-list">
                  {exportNotes.map((note) => <li key={`e:${note}`}>{note}</li>)}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ===== 初始加载错误 ===== */}
        {initialErrors.length > 0 && (
          <section className="demo-control-group" aria-labelledby="demo-init-errors-label">
            <span className="demo-control-label" id="demo-init-errors-label">初始加载错误</span>
            <ul className="demo-note-list">
              {initialErrors.map((record) => (
                <li key={record.id}>
                  {record.time} · {record.documentId}（loadKey {record.loadKey}）
                  <ul>
                    {record.lines.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ===== 宿主事件 ===== */}
        <section className="demo-control-group" aria-labelledby="demo-events-label">
          <div className="demo-events-header">
            <span className="demo-control-label" id="demo-events-label">宿主事件</span>
            <button type="button" className="demo-button demo-button--small" onClick={() => setEvents([])}>清空</button>
          </div>
          {events.length === 0 ? (
            <p className="demo-hint">保存 / 冲突 / 上传 / 引用激活 / 导出等回调事件会出现在这里。</p>
          ) : (
            <ul className="demo-event-log" aria-live="polite">
              {events.map((event) => (
                <li key={event.id} className="demo-event-item">{event.time} · {event.text}</li>
              ))}
            </ul>
          )}
        </section>

        {/* ===== 已存 HNN 查看 ===== */}
        {storedHnnPreview !== null && (
          <details className="demo-hnn-panel">
            <summary>查看已存 HNN</summary>
            <pre className="demo-hnn-document"><code>{storedHnnPreview}</code></pre>
          </details>
        )}
      </aside>

      <main className="demo-main">
        <header className="demo-header">
          <p className="demo-kicker">Hamster Note · 新编辑器演示</p>
          <h1>{active.title}</h1>
          <p className="demo-desc">
            编辑器仅经 initialDocument / loadKey 载入，保存走宿主 CAS 真实比较；Markdown 仅显式导出，
            存在降级诊断时经确认才写出。
          </p>
        </header>

        <div className={`demo-note-preview demo-note-preview--${theme}`}>
          <NoteEditor
            documentId={active.documentId}
            loadKey={active.loadKey}
            initialDocument={active.initialDocument}
            {...(active.initialRevision === undefined ? {} : { initialRevision: active.initialRevision })}
            onSave={handleSave}
            onChange={handleChange}
            onInitialLoadError={handleInitialLoadError}
            onPictureUpload={uploadHandler}
            onExportMarkdown={handleExport}
            onReferenceCandidates={referenceCallbacks.candidates}
            onReferenceActivate={referenceCallbacks.activate}
            onReferenceResolve={referenceCallbacks.resolve}
            theme={theme}
          />
        </div>
      </main>
    </div>
  )
}
