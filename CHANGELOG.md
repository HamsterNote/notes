# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-10-07

### Added
- 以 TipTap/ProseMirror 为唯一编辑内核的 `NoteEditor` 宿主会话组件：由 `documentId` 与 `loadKey` 定义一次会话，支持 `initialDocument`/`initialRevision`、`onChange` 全量 HNN 快照通知与 `onInitialLoadError` 严格校验失败回调
- HNN v1 持久化编解码：`decodeHnn`/`encodeHnn`/`HnnCodecError`，严格校验 schemaVersion、节点、mark、attrs 与结构，支持无损往返
- HNN 资源上限：512 KiB 外壳、树深度 32、节点总数 512、单 attr 8 KiB，以及表格几何等保守预算，防止不可信输入占用过多内存
- Markdown 导入/导出：`importMarkdown`/`exportMarkdown` 支持 GFM + HamsterNote 围栏方言；导出无法无损表达时产出降级诊断而非静默降级，导入超限或转换失败不替换源 Markdown
- `NoteSaveStatus` 保存状态组件与 `MarkdownExport` 导出组件
- 宿主契约回调：图片上传（稳定 `uploadId` 幂等与 retry）、引用候选/激活/解析（mention/resource/externalItem），解析结果仅运行时展示、不写入文档
- 顶层内容块重排：桌面原生拖拽与移动端长按手势，配合块操作菜单及键盘上移/下移，重排与前序输入分属独立撤销事件
- 封闭 schema：不向宿主开放自定义扩展/schema/history 注入
- Demo 宿主参考实现：基于 Web Locks 的原子 CAS 持久化与外部写入模拟

### Changed
- 编辑内核迁移至 TipTap 3.31.3：以原生选区、剪贴板与撤销/重做取代旧自研实现
- README 与 Demo 全面改写为新公共契约及装载/保存语义
- 发布流程新增测试与项目专属验证门禁

### Fixed
- 修复 TipTap 迁移审查发现的 NodeView 回归：容器复制纯文本（含部分选区与 atom 子序列化）、filename/author label 512 UTF-8 字节预检（超限零事务并恢复输入与合法状态）、NodeView attr 提交后的相邻输入撤销历史隔离

### BREAKING CHANGES
- 旧公共 API 整体移除：`NoteContent`、`useNoteContentUndoRedo`、`createNoteId` 以及旧 `NoteBlock` 块模型等不再导出，且不提供兼容层
- 编辑改为以 `NoteEditor` 作为宿主会话：宿主须提供 `documentId`/`loadKey` 与初始 HNN，并按需提供保存（CAS）、上传与引用回调
- 旧 block 模型数据与 HNN v1 不兼容，不提供旧文档的自动回退或迁移
- 自研专有剪贴板 MIME 与受限 HTML 渲染移除，改用 ProseMirror 原生剪贴板与封闭 schema
- 宿主须显式导入 `styles.css` 与 `formula.css`

## [2.0.0] - 2026-08-03

### Added
- External item drag and drop support: drag files, images, links and text from outside the note into the editor
- Card block with full Dialog editing interaction and card drawer / inspector
- Drawing block with persistent bottom toolbar and @mention filtering
- Inline Markdown shortcuts (quick input with conversion to structured blocks)
- Cross-region selection and formatting across title, summary and blocks as one note text flow
- Continuous text selection with atomic selection units (image, drawing, card, directory, standalone formula block, table row)
- Structured clipboard: copy/paste preserves internal structure via `application/x-hamsternote-fragment+json` (v2)
- `useNoteContentUndoRedo` hook and `NoteContentUndoRedoHandle` for undo/redo history
- Restricted HTML sanitization for rich text at render and commit boundaries
- Always show code editor when editable
- Lock field on `NoteCardData`
- `topPadding`/`bottomPadding` support kept for Docked mode scroll
- ADR docs: restricted HTML for rich text, commit cross-region edits as note transactions

### Changed
- Migrated Dialog/Popover/Button to `@hamster-note/components`, removed custom portal overlays
- Switched package manager from pnpm to yarn
- Clipboard & selection overhaul (pointer selection, region codec, snapshot mutation)
- Refactored block editing into focused components with syntax highlight support
- README and design docs updated for continuous text selection semantics

### Fixed
- Special block ID and mention boundary handling
- Inline Markdown shortcut persistence for nested structures and popover style clearing
- Dialog content area flex layout, theme/themeColor propagation to CardBlock Dialog
- List keyboard shortcut type branch completion and multi-line input regression

### BREAKING CHANGES
- Package manager switched from pnpm to yarn (use `yarn install`)
- Internal clipboard fragment MIME bumped to v2

## [1.2.0-beta] - 2026-07-20

### Added
- Inline formula rendering and format toolbar (bold/italic/underline/strikethrough/code/formula)
- List features upgrade: todo, unordered list, ordered list, directory, collapsible blocks and text color
- Markdown quick input and empty block Backspace demote to paragraph
- Cross-block selection formatting support
- Format button highlight state and clear formatting button
- Selection popover component

### Fixed
- List keyboard shortcut type branch completion
- Editor list and multi-line input regression
- CI lint errors

## [1.1.0] - 2026-07-18

### Added
- Table block support with row/column insert and editing
- Text block editing with syntax highlight support
- Block action menu component
- Five heading levels support
- Block-level drag and drop with selection mode
- Theme prop for component customization
- Metadata panel in note header (reading time, block count, last updated)
- `topPadding`/`bottomPadding` props for Docked mode scroll
- Visible glyph to block handle

### Fixed
- Table row/column insert position and ref type compatibility
- CSS: enlarged container horizontal padding to expose add button
- Shift+Enter line break handling
- Block handle alignment

### Changed
- Extracted block editing into focused components with syntax highlight support
- Flattened content block DOM structure for drag support
- Removed note header metadata panel
- Removed shell decorations

### CI
- Added concurrency cancellation, read-only permissions, and typecheck step

### Style
- Added text block menu presentation

### Test
- Verified block editor interactions

## [1.0.0] - 2026-07-18

### Added
- Initial release
