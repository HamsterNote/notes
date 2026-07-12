import { useCallback, useState } from "react"
import type { NoteBlock } from "../lib"
import { NoteContent } from "../lib"
import type { DemoMarkdownDocument } from "./markdownDocument"
import {
  parseMarkdownDocument,
  serializeMarkdownDocument
} from "./markdownDocument"
import { demoMarkdownDocument } from "./noteData"
import "./app.css"

// 预设主题色供侧边栏快速切换
const presetColors = [
  { name: "蓝色", value: "#3b82f6" },
  { name: "紫色", value: "#8b5cf6" },
  { name: "绿色", value: "#16a34a" },
  { name: "橙色", value: "#ea580c" },
  { name: "玫红", value: "#e11d48" },
  { name: "青色", value: "#0891b2" }
]

// 解析一次 markdown 文档作为初始状态（避免每次渲染重新解析）
const initialDocument = parseMarkdownDocument(demoMarkdownDocument)

export const App = () => {
  // ===== 受控状态：由侧边栏面板驱动 NoteContent 的全部可调参数 =====
  const [themeColor, setThemeColor] = useState("#3b82f6")
  const [editable, setEditable] = useState(false)
  // 结构化文档状态（包含 title/summary/tagLabel/updatedAt/blocks）
  const [document, setDocument] =
    useState<DemoMarkdownDocument>(initialDocument)
  // markdown 源文字符串状态（编辑时通过 serializeMarkdownDocument 实时重新生成）
  // markdownDocument 值在侧栏底部面板渲染展示
  const [markdownDocument, setMarkdownDocument] = useState(demoMarkdownDocument)

  // 统一文档更新函数：对 document 应用变更后立即序列化同步 markdownDocument。
  // 在 setDocument 回调内部调用 setMarkdownDocument，确保两者基于同一份 next 值，
  // 避免分别更新带来的过期闭包与竞态问题。
  const updateDocument = useCallback(
    (update: (current: DemoMarkdownDocument) => DemoMarkdownDocument) => {
      setDocument((current) => {
        const next = update(current)
        setMarkdownDocument(serializeMarkdownDocument(next))
        return next
      })
    },
    []
  )

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
              ? "已开启：点击文本可直接编辑，点击圆圈切换勾选"
              : "关闭：只读展示模式"}
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

        <NoteContent
          blocks={blocks}
          summary={summary}
          tagLabel={tagLabel}
          title={title}
          updatedAt={document.updatedAt}
          themeColor={themeColor}
          editable={editable}
          onTitleChange={(nextTitle) =>
            updateDocument((current) => ({ ...current, title: nextTitle }))
          }
          onSummaryChange={(nextSummary) =>
            updateDocument((current) => ({ ...current, summary: nextSummary }))
          }
          onBlocksChange={(nextBlocks) =>
            updateDocument((current) => ({ ...current, blocks: nextBlocks }))
          }
        />
      </main>
    </div>
  )
}
