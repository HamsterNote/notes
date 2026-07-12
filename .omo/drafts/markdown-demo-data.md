# markdown-demo-data — Planning Draft

status: plan-ready
intent: clear
review_required: false
classify: standard

## User request

用户希望：整个文档以数据形式存储，并使用 Markdown 格式存储；Demo 内内容全部改为由 Markdown 格式转换而来；在 Demo 左侧栏最底部展示 Markdown 文档数据。

## Components ledger

1. `markdown-source`: Demo 文档源数据从当前 `NoteBlock[]` 常量迁移为 Markdown 字符串数据。Evidence: `src/demo/noteData.ts` 当前直接导出 `demoBlocks: readonly NoteBlock[]`。
2. `markdown-parser`: 将 Markdown 文档解析为 `NoteContent` 需要的 `title/summary/tagLabel/updatedAt/blocks`。Evidence: `src/demo/App.tsx` 当前分别硬编码 title/summary/tagLabel，并从 `demoBlocks` 初始化 blocks。
3. `demo-render-flow`: Demo 渲染必须只消费 Markdown 解析产物，不能再手写 blocks 内容。Evidence: `src/demo/App.tsx` 当前 `useState` 初始值来自字符串和 `demoBlocks`。
4. `sidebar-markdown-display`: 左侧栏底部新增 Markdown 文档数据展示区域。Evidence: `src/demo/app.css` 当前侧栏已有滚动布局和控制组样式，但无 Markdown 预览面板样式。
5. `verification`: 需要验证解析映射、构建和实际 Demo UI。Evidence: `package.json` 当前有 `typecheck`, `build:demo`, `build`，没有 test runner。

## Discovered facts

- `NoteContent` public API 需要 `blocks`, `title`, 可选 `summary`, `updatedAt`, `tagLabel`, `themeColor`, `editable` 以及变更回调。Evidence: `src/lib/types.ts:73-98`。
- `NoteBlock` 支持的块类型只有 heading/paragraph/checklist/quote/code/callout；Markdown 转换应限制在这些现有块，避免扩大库 API。Evidence: `src/lib/types.ts:12-71`, `src/lib/NoteContent.tsx:111`。
- 现有 Demo 的内容数据集中在 `src/demo/noteData.ts`，但元数据 title/summary/tagLabel 仍在 `src/demo/App.tsx` 里硬编码。Evidence: `src/demo/App.tsx:23-29`, `src/demo/noteData.ts:3-93`。
- 当前项目没有 Markdown 解析依赖，也没有测试依赖；依赖清单只有 React/Vite/TS/ESLint/Prettier。Evidence: `package.json:48-68`。
- 当前 TS 配置严格，启用了 `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` 等。Evidence: `tsconfig.app.json:2-28`。

## User decisions

- Markdown parser dependency: user selected adding an external parser.
- Editing sync: user selected real-time reverse update from inline editing back to Markdown.
- Test strategy: user selected adding unit tests.

## Recommended approach for approval

- Markdown 文档数据放在 `src/demo/noteData.ts` 作为 `demoMarkdownDocument` 模板字符串，而不是单独 `.md` 文件；这样不需要配置 Vite raw import，也能在侧栏直接展示同一个源字符串。
- 使用 JSON metadata block 承载文档元数据：`title`, `summary`, `tagLabel`, `updatedAt`；正文 Markdown 承载 `NoteBlock[]`。用户已明确要求“用 JSON 格式存储元数据，正文用 Markdown”。
- 添加 Markdown 相关依赖，优先用 unified/remark 生态：`unified`, `remark-parse`, `remark-stringify`, `remark-gfm`；metadata 用内置 `JSON.parse` / `JSON.stringify` 处理，避免 YAML 依赖。
- 不修改 `src/lib/NoteContent` 的库 API；Markdown 双向转换仅属于 Demo 适配层，保持发布包 API 稳定。
- 新增 Demo 层转换模块，例如 `src/demo/markdownDocument.ts`，负责 `parseMarkdownDocument(markdown)` 与 `serializeMarkdownDocument(document)`。
- `App.tsx` 状态以解析结果初始化；`onTitleChange` / `onSummaryChange` / `onBlocksChange` 更新结构化状态后同步生成 Markdown 字符串，左侧栏底部实时显示。
- 新增 Vitest 依赖与 `test` script，为 Markdown→文档、文档→Markdown round-trip、任务列表/引用/代码块/callout 映射补单元测试。

## Open owner decisions

无。用户已决定：元数据用 JSON 格式存储，正文用 Markdown。

## Approval gate

Pending action: write `.omo/plans/markdown-demo-data.md` with the approved approach.

Approval brief: migrate Demo to a document source composed of a JSON metadata block plus Markdown body; parse the Markdown body into the existing `NoteContent` structure via remark/unified; parse/serialize metadata with native JSON APIs; serialize edited title/summary/blocks back into the same JSON+Markdown document format for real-time sidebar display; add Vitest unit coverage and existing build/typecheck/browser QA. Scope excludes changing the public library API, turning the Demo into a full Markdown editor, or persisting changes outside in-memory Demo state.

Approval received: user replied “同意”.

## Plan review notes

- Metis reviewed `.omo/plans/markdown-demo-data.md` and initially returned NOT PASS.
- Findings folded into the final plan: fixed `hn:*` directive mapping for all non-native `NoteBlock` fields; explicit `updatedAt` preservation rule; `DemoMarkdownParseError` throw-only failure contract; executable browser QA with selectors and stable assertions; per-todo labels changed from required commits to suggested change groups; commit strategy clarified as no `git commit` unless user explicitly asks.
