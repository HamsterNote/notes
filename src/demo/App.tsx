import { useState } from "react"

import { NoteContent } from "../lib"
import type { NoteBlock } from "../lib"

import { demoBlocks } from "./noteData"
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

export const App = () => {
  // ===== 受控状态：由侧边栏面板驱动 NoteContent 的全部可调参数 =====
  const [themeColor, setThemeColor] = useState("#3b82f6")
  const [editable, setEditable] = useState(false)
  const [title, setTitle] = useState("Launch Notes for the first public package")
  const [summary, setSummary] = useState(
    "An editorial note surface for changelogs, meeting recaps, or product knowledge cards."
  )
  const [tagLabel, setTagLabel] = useState("Release candidate")
  // demoBlocks 是 readonly，展开为可变副本以支持编辑
  const [blocks, setBlocks] = useState<NoteBlock[]>([...demoBlocks])

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
            {editable ? "已开启：点击文本可直接编辑，点击圆圈切换勾选" : "关闭：只读展示模式"}
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
            onChange={(event) => setTitle(event.target.value)}
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
            onChange={(event) => setTagLabel(event.target.value)}
          />
        </section>
      </aside>

      {/* ===== 主内容区：展示 NoteContent 组件 ===== */}
      <main className="demo-main">
        <header className="demo-header">
          <p className="demo-kicker">Component library demo</p>
          <h1>@hamster-note/notes</h1>
          <p className="demo-desc">
            A React 19 note-content component built as a publishable library, with theme color,
            inline editing, and a tag-driven release workflow.
          </p>
        </header>

        <NoteContent
          blocks={blocks}
          summary={summary}
          tagLabel={tagLabel}
          title={title}
          updatedAt="2026-07-11"
          themeColor={themeColor}
          editable={editable}
          onTitleChange={setTitle}
          onSummaryChange={setSummary}
          onBlocksChange={setBlocks}
        />
      </main>
    </div>
  )
}
