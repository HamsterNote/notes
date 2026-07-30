import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import useUndo from "use-undo"
import type {
  NoteBlock,
  NoteContentHandle,
  NoteContentUndoRedoController,
  NoteExternalItem,
  NoteLink,
  NoteTheme
} from "../lib"
import { NoteContent } from "../lib"
import { createExternalNoteBlock } from "../lib/externalNoteDrag"
import { createNoteId } from "../lib/noteId"
import { DemoNavigationControls } from "./DemoNavigationControls"
import { ExternalItemDragSource } from "./ExternalItemDragSource"
import type { DemoMarkdownDocument } from "./markdownDocument"
import { parseMarkdownDocument, serializeMarkdownDocument } from "./markdownDocument"
import { demoMarkdownDocument } from "./noteData"
import { useDemoPictureUpload } from "./useDemoPictureUpload"
import "katex/dist/katex.min.css"
import "./app.css"

// 预设主题色供侧边栏快速切换
const presetColors = [
  { name: "蓝色", value: "#3b82f6" }, { name: "紫色", value: "#8b5cf6" },
  { name: "绿色", value: "#16a34a" }, { name: "橙色", value: "#ea580c" },
  { name: "玫红", value: "#e11d48" }, { name: "青色", value: "#0891b2" }
]

// 解析一次 markdown 文档作为初始状态（避免每次渲染重新解析）
const initialDocument = parseMarkdownDocument(demoMarkdownDocument)
const initialTableBlockId =
  initialDocument.blocks.find((block) => block.kind === "table")?.id ?? ""
const demoLinks: readonly NoteLink[] = [
  { id: "product-roadmap", name: "Product roadmap" },
  { id: "release-notes", name: "Release notes" },
  { id: "editor-guide", name: "Editor guide" },
  { id: "team-handbook", name: "Team handbook" }
]

export const App = () => {
  // ===== 受控状态：由侧边栏面板驱动 NoteContent 的全部可调参数 =====
  const [themeColor, setThemeColor] = useState("#3b82f6")
  const [theme, setTheme] = useState<NoteTheme>("light")
  const [editable, setEditable] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [topPadding, setTopPadding] = useState(0)
  const [bottomPadding, setBottomPadding] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [documentHistory, documentActions] =
    useUndo<DemoMarkdownDocument>(initialDocument)
  const document = documentHistory.present
  const documentRef = useRef(document)
  documentRef.current = document
  const noteContentRef = useRef<NoteContentHandle>(null)
  const editorScopeRef = useRef<HTMLDivElement>(null)
  const editableRef = useRef(editable)
  const handlePictureUpload = useDemoPictureUpload()
  const markdownDocument = useMemo(
    () => serializeMarkdownDocument(document),
    [document]
  )
  // 魔法链接点击事件记录：展示在侧边栏，验证 onMagicLinkClick 回调链路
  const [magicLinkEvents, setMagicLinkEvents] = useState<string[]>([])
  const [lastExternalItemId, setLastExternalItemId] = useState<string | null>(null)
  const externalItemDemoEnabled = editable && !selectMode

  const updateDocument = useCallback(
    (update: (current: DemoMarkdownDocument) => DemoMarkdownDocument) => {
      const currentDocument = documentRef.current
      const nextDocument = update(currentDocument)
      if (
        serializeMarkdownDocument(nextDocument) ===
          serializeMarkdownDocument(currentDocument) &&
        nextDocument.blocks === currentDocument.blocks
      )
        return

      documentRef.current = nextDocument
      documentActions.set(nextDocument)
    },
    [documentActions]
  )

  const insertDemoExternalItem = useCallback(() => {
    updateDocument((current) => ({
      ...current,
      blocks: [
        ...current.blocks,
        createExternalNoteBlock(
          {
            id: "demo-linked-item",
            content: "Dragged reference\nClick to open",
            clickable: true
          },
          createNoteId()
        )
      ]
    }))
  }, [updateDocument])

  const demoUndoRedoController = useMemo<NoteContentUndoRedoController>(
    () => ({
      undo: () => {
        if (!documentActions.canUndo) return false; documentActions.undo(); return true
      },
      redo: () => {
        if (!documentActions.canRedo) return false; documentActions.redo(); return true
      },
      canUndo: () => documentActions.canUndo,
      canRedo: () => documentActions.canRedo,
      resetHistory: () => documentActions.reset(document)
    }),
    [document, documentActions]
  )

  useEffect(() => {
    editableRef.current = editable
  }, [editable])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!editableRef.current || event.isComposing) return

      const editorScope = editorScopeRef.current
      const activeElement = globalThis.document.activeElement
      if (!editorScope || !activeElement || !editorScope.contains(activeElement)) return

      if (!(activeElement instanceof HTMLElement)) return

      const isEditableInput =
        (activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement) &&
        !activeElement.readOnly &&
        !activeElement.disabled
      const isEditableField = activeElement.isContentEditable || isEditableInput
      if (!isEditableField) return

      const key = event.key.toLowerCase()
      const undoRequested =
        (event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey
      const redoRequested =
        ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "z") ||
        (event.ctrlKey && key === "y")

      if (!undoRequested && !redoRequested) return

      event.preventDefault()

      const flushingElement = activeElement
      flushingElement.blur()
      flushingElement.focus({ preventScroll: true })

      window.setTimeout(() => {
        if (undoRequested) {
          noteContentRef.current?.undo()
          flushingElement.focus({ preventScroll: true })
          return
        }

        noteContentRef.current?.redo()
        flushingElement.focus({ preventScroll: true })
      }, 0)
    }

    globalThis.document.addEventListener("keydown", handleKeyDown)
    return () => globalThis.document.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Demo: onMagicLinkConfigure 用 prompt 弹窗输入文字，返回 hnmagic:// 开头的 URL
  const handleMagicLinkConfigure = useCallback(async () => {
    const input = window.prompt("输入魔法链接内容（将作为 hnmagic:// URL 的后半部分）")
    await Promise.resolve()
    return `hnmagic://${input ?? ""}`
  }, [])

  // Demo: onMagicLinkClick 记录事件到侧边栏列表
  const handleMagicLinkClick = useCallback((url: string) => {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false })
    setMagicLinkEvents((prev) => [...prev, `${time}  ${url}`])
  }, [])

  const handleExternalItemClick = useCallback((item: NoteExternalItem) => {
    setLastExternalItemId(item.id)
  }, [])

  // 从 document 直接派生展示字段（不再使用独立 state，确保 UI 与文档始终一致）
  const title = document.title
  const summary = document.summary
  const tagLabel = document.tagLabel
  // document.blocks 是 readonly NoteBlock[]，展开为可变副本传给 NoteContent
  const blocks: NoteBlock[] = [...document.blocks]

  return (
    <div className="demo-layout">
      {/* ===== 左侧边栏：组件库设置面板 ===== */}
      <aside className="demo-sidebar">
        <div className="demo-sidebar-header">
          <h2>Settings</h2>
          <p>调整组件参数实时预览</p>
        </div>

        {/* 主题色 */}
        <section className="demo-control-group">
          <label className="demo-control-label" htmlFor="theme-color">
            Theme Color
          </label>
          <div className="demo-color-row">
            <input
              id="theme-color"
              type="color"
              className="demo-color-input"
              value={themeColor}
              onChange={(event) => setThemeColor(event.target.value)}
            />
            <span className="demo-color-value">{themeColor}</span>
          </div>
          <div className="demo-preset-colors">
            {presetColors.map((color) => (
              <button
                key={color.value}
                type="button"
                className={[
                  "demo-preset-swatch",
                  themeColor.toLowerCase() === color.value.toLowerCase()
                    ? "demo-preset-swatch--active"
                    : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ background: color.value }}
                title={color.name}
                aria-label={color.name}
                onClick={() => setThemeColor(color.value)}
              />
            ))}
          </div>
        </section>

        <section className="demo-control-group">
          <label className="demo-toggle-row">
            <span className="demo-control-label">Dark Theme</span>
            <button
              type="button"
              role="switch"
              aria-label="Dark theme"
              aria-checked={theme === "dark"}
              className={`demo-switch ${theme === "dark" ? "demo-switch--on" : ""}`}
              onClick={() =>
                setTheme((current) => (current === "light" ? "dark" : "light"))
              }
            >
              <span className="demo-switch-thumb" />
            </button>
          </label>
          <p className="demo-hint">通过 NoteContent 的 theme prop 切换</p>
        </section>

        {/* 可编辑开关 */}
        <section className="demo-control-group">
          <label className="demo-toggle-row">
            <span className="demo-control-label">Editable</span>
            <button
              type="button"
              role="switch"
              aria-checked={editable}
              className={`demo-switch ${editable ? "demo-switch--on" : ""}`}
              onClick={() => setEditable((prev) => !prev)}
            >
              <span className="demo-switch-thumb" />
            </button>
          </label>
          <p className="demo-hint">
            {editable
              ? <>
                   已开启：选中文字后显示格式工具栏，点击文本可
                   <span className="demo-nowrap">直接</span>编辑
                 </>
              : "关闭：只读展示模式"}
          </p>
        </section>

        <section className="demo-control-group">
          <label className="demo-toggle-row">
            <span className="demo-control-label">Select Mode</span>
            <button
              type="button"
              role="switch"
              aria-label="Select mode"
              aria-checked={selectMode}
              className={`demo-switch ${selectMode ? "demo-switch--on" : ""}`}
              onClick={() => setSelectMode((current) => !current)}
            >
              <span className="demo-switch-thumb" />
            </button>
          </label>
          <p className="demo-hint">
            开启后内容只读，点击任意 block <span className="demo-nowrap">可查看</span>{" "}
            onBlockSelect <span className="demo-nowrap">回调</span>结果
          </p>
          <output className="demo-select-result" aria-live="polite">
            {selectedBlockId ?? "尚未选择 block"}
          </output>
        </section>

        <DemoNavigationControls
          controller={demoUndoRedoController}
          initialBlockId={initialTableBlockId}
          noteContentRef={noteContentRef}
        />

        <ExternalItemDragSource
          className="demo-external-item--sidebar"
          disabled={!externalItemDemoEnabled}
          lastActivatedItemId={lastExternalItemId}
          noteContentRef={noteContentRef}
          onInsert={insertDemoExternalItem}
        />

        {/* 顶部 / 底部留白（px）—— 演示 topPadding / bottomPadding props */}
        <section className="demo-control-group">
          <label className="demo-control-label" htmlFor="top-padding">
            Top Padding
          </label>
          <div className="demo-range-row">
            <input
              id="top-padding"
              type="range"
              className="demo-range"
              min={0}
              max={120}
              step={1}
              value={topPadding}
              onChange={(event) => setTopPadding(Number(event.target.value))}
            />
            <span className="demo-range-value">{topPadding}px</span>
          </div>

          <label className="demo-control-label" htmlFor="bottom-padding">
            Bottom Padding
          </label>
          <div className="demo-range-row">
            <input
              id="bottom-padding"
              type="range"
              className="demo-range"
              min={0}
              max={120}
              step={1}
              value={bottomPadding}
              onChange={(event) => setBottomPadding(Number(event.target.value))}
            />
            <span className="demo-range-value">{bottomPadding}px</span>
          </div>
          <p className="demo-hint">
            体现 NoteContent 的 topPadding / bottomPadding props（单位 px）
          </p>
        </section>

        {/* 标题输入 */}
        <section className="demo-control-group">
          <label className="demo-control-label" htmlFor="title-input">
            Title
          </label>
          <input
            id="title-input"
            type="text"
            className="demo-text-input"
            value={title}
            onChange={(event) => {
              const nextTitle = event.target.value
              updateDocument((current) => ({ ...current, title: nextTitle }))
            }}
          />
        </section>

        {/* 标签输入 */}
        <section className="demo-control-group">
          <label className="demo-control-label" htmlFor="tag-input">
            Tag Label
          </label>
          <input
            id="tag-input"
            type="text"
            className="demo-text-input"
            value={tagLabel}
            onChange={(event) => {
              const nextTagLabel = event.target.value
              updateDocument((current) => ({
                ...current,
                tagLabel: nextTagLabel
              }))
            }}
          />
        </section>

        {/* 魔法链接点击事件记录：验证 onMagicLinkClick 回调链路 */}
        <section className="demo-control-group">
          <h3 className="demo-control-label">Magic Link Events</h3>
          {magicLinkEvents.length === 0 ? (
            <p className="demo-hint">
              选中文字 → 链接 → 魔法链接，然后点击生成的链接，事件会出现在这里
            </p>
          ) : (
            <ul className="demo-magic-link-events">
              {magicLinkEvents.map((event) => (
                <li key={event} className="demo-magic-link-event-item">
                  {event}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Markdown 文档数据：实时展示当前 JSON 元数据 + Markdown 正文源码 */}
        <section
          className="demo-control-group demo-markdown-panel"
          aria-label="Markdown document data"
        >
          <h3 className="demo-control-label">Markdown Document Data</h3>
          <pre className="demo-markdown-document">
            <code>{markdownDocument}</code>
          </pre>
        </section>
      </aside>

      {/* ===== 主内容区：展示 NoteContent 组件 ===== */}
      <main className="demo-main">
        <header className="demo-header">
          <p className="demo-kicker">Component library demo</p>
          <h1>@hamster-note/notes</h1>
          <p className="demo-desc">
            A React 19 note-content component built as a publishable library,
            with theme color, inline editing, and a tag-driven release workflow.
          </p>
        </header>

        <ExternalItemDragSource
          className="demo-external-item--compact"
          disabled={!externalItemDemoEnabled}
          lastActivatedItemId={lastExternalItemId}
          noteContentRef={noteContentRef}
          onInsert={insertDemoExternalItem}
        />

        <div ref={editorScopeRef} className={`demo-note-preview demo-note-preview--${theme}`}>
          <NoteContent
            ref={noteContentRef}
            blocks={blocks}
            links={demoLinks}
            summary={summary}
            tagLabel={tagLabel}
            title={title}
            updatedAt={document.updatedAt}
            theme={theme}
            themeColor={themeColor}
            editable={editable}
            selectMode={selectMode}
            topPadding={topPadding}
            bottomPadding={bottomPadding}
            onTitleChange={(nextTitle) =>
              updateDocument((current) => ({ ...current, title: nextTitle }))
            }
            onSummaryChange={(nextSummary) =>
              updateDocument((current) => ({ ...current, summary: nextSummary }))
            }
            onBlocksChange={(nextBlocks) =>
              updateDocument((current) => ({ ...current, blocks: nextBlocks }))
            }
            onNoteTransaction={({ snapshot }) =>
              updateDocument((current) => ({
                ...current,
                title: snapshot.title,
                summary: snapshot.summary ?? "",
                blocks: snapshot.blocks
              }))
            }
            onPictureUpload={handlePictureUpload}
            undoRedoController={demoUndoRedoController}
            onMagicLinkConfigure={handleMagicLinkConfigure}
            onMagicLinkClick={handleMagicLinkClick}
            onExternalItemClick={handleExternalItemClick}
            onBlockSelect={setSelectedBlockId}
          />
        </div>
      </main>
    </div>
  )
}
