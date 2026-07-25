/// <reference types="node" />

import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("editable text styles", () => {
  it("preserves the documented body-copy line height", () => {
    // Given: DESIGN.md defines the note body rhythm as 1.85.
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    // Then: the shared text primitive keeps that established rhythm.
    expect(styles).toMatch(
      /\.hn-note-text\s*\{[^}]*line-height:\s*1\.85;[^}]*\}/
    )
  })

  it("lets every editable line fill the available row width", () => {
    // Given: the stylesheet used by every contentEditable text surface.
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    // When: the shared editable layout rule is inspected.
    // Then: non-empty and empty lines both create an unconstrained block/flex item.
    expect(styles).toMatch(
      /\.hn-note-editable\s*\{[^}]*display:\s*block;[^}]*flex:\s*1 1 auto;[^}]*max-width:\s*none;[^}]*\}/
    )
  })

  it("keeps an empty editable line tall enough to receive pointer focus", () => {
    // Given: browsers represent an empty contentEditable as empty DOM or one <br>.
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    // When: the empty-state rule is inspected.
    // Then: either representation retains one clickable line of height.
    expect(styles).toMatch(
      /\.hn-note-editable:empty,\s*\.hn-note-editable:has\(> br:only-child\)\s*\{[^}]*min-height:\s*1lh;[^}]*\}/
    )
  })

  it("keeps editable content visually neutral on hover and focus", () => {
    // Given: row content must not gain a border, outline, or background while editing.
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    // Then: the shared editable surface defines no hover/focus visual override.
    expect(styles).not.toMatch(/\.hn-note-editable:hover\s*\{/)
    expect(styles).not.toMatch(/\.hn-note-editable:focus\s*\{/)
    expect(styles).not.toMatch(
      /\.hn-note-code-editor\.hn-note-editable:(hover|focus)\s*\{/
    )
    expect(styles).not.toMatch(
      /\.hn-note-table-cell\.hn-note-editable:(hover|focus)\s*\{/
    )
  })
})

describe("block action handle layout", () => {
  it("visually joins independently sortable quote lines", () => {
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    expect(styles).toMatch(/\.hn-note-quote-line--continuation\s*\{/)
    expect(styles).toMatch(/\.hn-note-quote-line--final\s*\{/)
  })

  it("positions handles absolutely so they do not consume row width", () => {
    // Given: the stylesheet that renders the left gutter controls.
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    // Then: the unified block establishes positioning context and handles sit outside flow.
    expect(styles).toMatch(
      /\.hn-note-block\s*\{[^}]*position:\s*relative;[^}]*min-width:\s*0;[^}]*\}/
    )
    expect(styles).toMatch(
      /\.hn-note-block-handle\s*\{[^}]*position:\s*absolute;[^}]*\}/
    )
  })

  it("places add and convert handles side-by-side in the left gutter", () => {
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    // Then: the two handle variants have distinct horizontal offsets and share size.
    expect(styles).toMatch(
      /\.hn-note-block-handle--convert\s*\{[^}]*right:\s*calc\(100%\s*\+\s*4px\);[^}]*\}/
    )
    expect(styles).toMatch(
      /\.hn-note-block-handle--add\s*\{[^}]*right:\s*calc\(100%\s*\+\s*32px\);[^}]*\}/
    )
    expect(styles).toMatch(
      /\.hn-note-block-handle\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*\}/
    )
  })

  it("does not retain generic row or content wrapper styles", () => {
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    // Then: layout belongs to the unified block and semantic content itself.
    expect(styles).not.toMatch(/\.hn-note-block-row(?:\s|\{|:)/)
    expect(styles).not.toMatch(/\.hn-note-block-content(?:\s|\{|:)/)
  })
})

describe("editable code styles", () => {
  it("keeps a highlighted code layer visible while the plain-text editor is active", () => {
    // Given: the code block component switches from its preview to an editor on focus.
    const source = readFileSync(
      new URL("./NoteCodeEditorBlock.tsx", import.meta.url),
      "utf8"
    )

    // When: the editing branch is inspected.
    // Then: it renders a live highlight layer and updates it from editor input.
    expect(source).toMatch(/className=.*hn-note-code-highlight/)
    expect(source).toMatch(/onChange=.*setDraftCode/s)
  })

  it("uses one typography contract for preview, highlight, and editor layers", () => {
    // Given: every code surface must occupy the same pixels when editing starts.
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8"
    )

    // When: the shared code surface styles are inspected.
    // Then: all layers use the same explicit monospace token, size, and line height.
    expect(styles).toMatch(
      /\.hn-note-code-card pre,\s*\.hn-note-code-editor,\s*\.hn-note-code-preview,\s*\.hn-note-code-highlight\s*\{[^}]*font-family:\s*var\(--hn-code-font\);[^}]*font-size:\s*0\.9rem;[^}]*line-height:\s*1\.7;/
    )
    expect(styles).toMatch(
      /\.hn-note-code-editor\s*\{[^}]*color:\s*transparent;[^}]*caret-color:\s*#e2e8f0;/
    )
  })

  it("keeps code editing plain-text, IME-safe, and accessibly named", () => {
    // Given: the transparent editor must remain aligned with its highlighted layer.
    const source = readFileSync(
      new URL("./NoteCodeEditorBlock.tsx", import.meta.url),
      "utf8"
    )

    // When: the native multiline editor is inspected.
    // Then: textarea semantics keep paste plain-text and IME handling native,
    // while the active textbox retains the preview action's accessible name.
    expect(source).toMatch(/<textarea/)
    expect(source).not.toMatch(/handleEditableBlockKeyDown/)
    expect(source).toMatch(/ref=\{editorRef\}\s*aria-label=\{.*编辑代码/s)
  })
})

// CSS 合约测试：选区弹出层（SelectionPopover）的格式化按钮与行内样式。
// 这些断言确保 styles.css 暴露计划中新增的 BEM 类名，便于在实现阶段
// 通过测试失败而非人工评审来发现遗漏的样式。仅基于文件内容做确定性检查，
// 不渲染组件、不依赖 DOM。
describe("popover toolbar formatting styles", () => {
  // 共享读取一次 styles.css，保持与既有测试一致的文件级合约形式。
  const styles = readFileSync(
    new URL("./styles.css", import.meta.url),
    "utf8"
  )

  it("uses the component button primary variant without a custom active override", () => {
    // Given: 格式按钮的激活态由组件库 Button 的 primary variant 提供。
    // Then: 项目样式不再覆盖组件库的原生 primary 视觉。
    expect(styles).not.toMatch(/\.hn-note-popover-btn--active\s*\{/)
  })

  it("ships glyph variants for strikethrough, code, formula, and clear", () => {
    // Given: 新增的删除线、行内代码、行内公式与清除格式按钮均需各自的字形样式。
    // Then: 四个 BEM 修饰符同时存在于样式表中。
    expect(styles).toMatch(/\.hn-note-popover-glyph--strikethrough\s*\{/)
    expect(styles).toMatch(/\.hn-note-popover-glyph--code\s*\{/)
    expect(styles).toMatch(/\.hn-note-popover-glyph--formula\s*\{/)
    expect(styles).toMatch(/\.hn-note-popover-glyph--clear\s*\{/)
  })

  it("renders inline formula spans with base and rendered states", () => {
    // Given: 行内公式走与块级公式不同的 BEM 表面，渲染态需要独立修饰符。
    // Then: 基类与 --rendered 修饰符同时存在。
    expect(styles).toMatch(/\.hn-note-inline-formula\s*\{/)
    expect(styles).toMatch(/\.hn-note-inline-formula--rendered\s*\{/)
  })

  it("styles inline code via a dedicated BEM surface alongside inline formula", () => {
    // Given: 行内代码需与行内公式保持平行的命名约定，避免依赖章节级 code 样式。
    // Then: 样式表提供 .hn-note-inline-code 选择器作为行内代码的基础渲染契约。
    expect(styles).toMatch(/\.hn-note-inline-code/)
  })

  it("gives inline code a visible border and background", () => {
    // Given: R3a 要求行内代码有边框 + 背景的胶囊表示。
    // When: 提取包含 hn-note-inline-code 选择器的规则块。
    const rule = styles.match(/[^{}]*hn-note-inline-code[^{}]*\{([^}]*)\}/)
    // Then: 该规则同时声明 border 与 background。
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toMatch(/border\s*:/)
    expect(rule?.[1]).toMatch(/background\s*:/)
  })

  it("extends inline code styling to legacy bare <code> inside editable blocks only", () => {
    // Given: 存量数据的行内 <code> 没有 class，仍需被同一套边框/背景覆盖；
    // 语法高亮代码（带语言 class）不受影响。
    // Then: 样式表包含 [data-editable-block-id] code:not([class]) 选择器，
    // 且不存在无作用域的全局 code:not([class]) 选择器。
    expect(styles).toMatch(/\[data-editable-block-id\]\s+code:not\(\[class\]\)/)
    expect(styles).not.toMatch(/(^|[,{]\s*)code:not\(\[class\]\)/m)
  })

  it("keeps component button visuals native in the mobile bottom toolbar", () => {
    // Given: 移动端格式操作已直接合并进唯一的组件库 Popover 宿主。
    // Then: 项目样式不再通过旧 docked 表面覆盖组件库按钮变体。
    expect(styles).not.toMatch(/\.hn-note-popover--docked/)
    expect(styles).not.toMatch(
      /\.hn-note-bottom-toolbar\s+\.hn-button--(?:ghost|primary)\s*\{/
    )
  })
})
