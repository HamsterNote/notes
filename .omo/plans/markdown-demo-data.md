# markdown-demo-data - Work Plan

## TL;DR (For humans)

本计划把 Demo 的内容源从手写 `NoteBlock[]` 改为“顶部 JSON 元数据块 + 正文 Markdown”的文档字符串，并让 Demo 的所有内容都由该文档转换而来。实现时会新增 remark/unified 解析与序列化依赖、Vitest 单测，以及 Demo 左侧栏底部的实时 Markdown 文档数据展示。用户已批准的关键决策：元数据用 JSON，不用 YAML；正文用 Markdown；inline editing 后需要实时反向更新文档字符串；需要新增单测。不会修改 `src/lib/NoteContent` 的公共 API，不会做持久化，也不会把 Demo 扩成完整 Markdown 编辑器。非 Markdown 原生字段统一用 `hn:*` HTML comment directives 编码；`updatedAt` 只从 JSON 读取，本任务内编辑不会自动改它。风险集中在 Markdown 子集映射和 round-trip 格式稳定性，计划用显式映射规则与 parser 单测锁定。

## Scope

### In scope

- 数据源迁移：把 `src/demo/noteData.ts` 当前 `demoBlocks: readonly NoteBlock[]` 改为导出完整文档字符串，例如 `demoMarkdownDocument`。
- 文档格式固定为：文件开头第一个 fenced code block 是 JSON 元数据块，随后空行后的内容是正文 Markdown。
  - 元数据块精确示例：
    ````md
    ```json
    {
      "title": "Launch Notes for the first public package",
      "summary": "An editorial note surface for changelogs, meeting recaps, or product knowledge cards.",
      "tagLabel": "Release candidate",
      "updatedAt": "2026-07-11"
    }
    ```

    # Ship a note component that feels editorial instead of generic
    ````
- 新增 Demo-only 转换模块，建议路径：`src/demo/markdownDocument.ts`。
  - `parseMarkdownDocument(markdown: string): DemoMarkdownDocument`
  - `serializeMarkdownDocument(document: DemoMarkdownDocument): string`
  - 类型名可按实现调整，但必须是 readonly typed value objects，避免 `any` 和类型断言。
- 新增依赖：
  - runtime dependencies: `unified`, `remark-parse`, `remark-stringify`, `remark-gfm`
  - dev dependency: `vitest`
  - 若 TypeScript 对 mdast 节点类型需要显式包，可添加 `@types/mdast` / `@types/unist` 到 devDependencies；只有编译需要时添加。
- `src/demo/App.tsx`：
  - 初始 `title/summary/tagLabel/updatedAt/blocks` 全部来自 `parseMarkdownDocument(demoMarkdownDocument)`。
  - `themeColor` 与 `editable` 仍是 Demo 设置，不进入文档数据。
  - `onTitleChange`、`onSummaryChange`、`onBlocksChange` 必须同时更新结构化状态与 `markdownDocument` 字符串。
  - `updatedAt` 从文档元数据传入 `NoteContent`，不再硬编码为 `"2026-07-11"`。
- `updatedAt` 是文档元数据，必须从 JSON 读取；本任务中 title、summary、tagLabel 或正文编辑都不得自动改写 `updatedAt`。未来如需自动更新时间，必须另立需求并定义时区/时钟来源。
- `src/demo/app.css`：左侧栏最底部新增 Markdown 文档数据显示样式；要求可滚动、等宽字体、长行可读，并在窄屏布局仍可访问。
- `package.json`：新增 `test` script（推荐 `vitest run`），必要时新增依赖安装结果并保持 `pnpm-lock.yaml` 同步。
- 新增 parser/serializer 单测，建议路径：`src/demo/markdownDocument.test.ts`。

### Out of scope / Must-NOT-Have

- 不修改 `src/lib/NoteContent.tsx`、`src/lib/types.ts` 的公共组件 API，除非类型检查证明现有导出无法表达 Demo 层转换；若必须改库 API，worker 必须停止并回报，不可自行扩大范围。
- 不把 Markdown parser 暴露为 npm 包公共 API；它属于 Demo 实现细节。
- 不做浏览器 localStorage、远端保存、文件保存或跨刷新持久化。
- 不支持任意 Markdown 到任意 `NoteBlock` 的无损转换；只支持当前 Demo/NoteContent 需要的明确 Markdown 子集。
- 不把 theme color、editable 开关写入 JSON 元数据；它们是 Demo 控件状态，不是文档内容。
- 不使用 YAML frontmatter。
- 不用 `dangerouslySetInnerHTML` 新增 Markdown HTML 渲染路径；正文仍渲染为既有 `NoteContent` 结构。

### Markdown field encoding contract

Markdown 原生语法无法表达的现有 `NoteBlock` 字段必须使用一套固定 HTML comment directive，parser 与 serializer 都必须实现同一套规则。执行者不得自行改用其它格式。

- 每个 block 的 `id` 必须编码，不允许由文本临时推导后丢失旧 ID。
- 通用 block directive 放在目标 block 前一行：`<!-- hn:block id="hero" -->`。
- heading 的 `eyebrow` 放在同一 directive：`<!-- hn:block id="hero" eyebrow="Hamster Note" -->`，下一行必须是 `#` / `##` / `###` heading。
- paragraph 的 `tone` 放在同一 directive：`<!-- hn:block id="intro" tone="accent" -->`，下一段落映射为 paragraph。
- checklist 使用专用 directive：`<!-- hn:checklist id="checklist" title="Release readiness" -->`，下一段 GFM task list 映射为 checklist。
- checklist item 的 `id` 必须用 `<!-- hn:item id="library" -->` 放在 list item 内容开头；serializer 必须稳定输出到该位置，parser 只需支持该位置。
- quote author 使用 quote 最后一行 `— Design note` 约定；serializer 必须回写该 author 行。
- code block 使用 fence info/meta 保存 language/filename：```` ```tsx filename="App.tsx" ````。
- callout 必须使用 blockquote admonition 约定：`> [!info] Structured input, flexible visuals` / `> [!success] ...` / `> [!warning] ...`；第一行的 tone/title 映射为 callout，后续 quote 文本映射为 callout text。
- 当前 `src/demo/noteData.ts` 的所有字段必须被编码并可 round-trip：block `id`、heading `eyebrow`、paragraph `tone`、checklist `title`、checklist item `id`、quote `author`、code `language`/`filename`、callout `tone`/`title`/`text`。

### Evidence / current state

- `src/demo/noteData.ts:3-93` 当前直接导出 `demoBlocks: readonly NoteBlock[]`，内容包括 heading、paragraph、quote、checklist、callout、code。
- `src/demo/App.tsx:23-29` 当前硬编码 `title`、`summary`、`tagLabel`，并从 `demoBlocks` 初始化 blocks。
- `src/demo/App.tsx:136-147` 当前传入 `updatedAt="2026-07-11"`，需改为来自 JSON metadata。
- `src/lib/types.ts:12-71` 定义所有受支持 `NoteBlock` 变体。
- `src/lib/types.ts:73-98` 定义 `NoteContentProps`，本计划保持该 API 不变。
- `src/lib/NoteContent.tsx:111+` 的 `renderBlock` 已覆盖所有 block kind。
- `package.json:32-42` 当前没有 `test` script；`package.json:48-68` 当前没有 Markdown parser 或 Vitest 依赖。
- `tsconfig.app.json:2-28` 严格 TS 配置启用 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`。
- remark/unified 文档：`remark-parse` 可解析 Markdown 到 mdast；`remark-stringify` 可把 mdast 序列化回 Markdown；GFM task lists 可通过 GFM 扩展支持。
- Vitest 文档：Vite + TypeScript 项目可直接写 `.test.ts`，package script 可运行 `vitest` / `vitest run`。

## Verification strategy

### Test strategy

- 用户选择：新增单测。
- 执行顺序：tests-after 可接受，因为当前项目没有 test harness；worker 先安装 Vitest 与 parser 依赖，再新增转换模块和测试，最后运行完整验证。

### Required automated checks

- `pnpm install` 或等价依赖安装命令必须更新 `pnpm-lock.yaml`。
- `pnpm test`：运行 Vitest parser/serializer 单测。
- `pnpm typecheck`：确保 Demo 与库严格 TS 通过。
- `pnpm build:demo`：确保 Demo 静态构建通过。
- `pnpm build`：最终全量构建，覆盖库构建与 Demo 构建。

### Parser failure contract

- `parseMarkdownDocument(markdown)` 遇到无效文档必须抛出 `DemoMarkdownParseError`；本任务不允许 fallback 到空文档、旧数据或部分渲染。
- `DemoMarkdownParseError` 必须包含稳定 `code: string` 与人类可读 `message: string`。
- 必须抛出该错误的场景：缺少文档开头第一个 `json` fenced block、JSON 语法错误、缺少必需 metadata 字段、metadata 字段类型错误。
- 单测至少覆盖 malformed JSON、缺少 `title`、`updatedAt` 非字符串。

### Required browser QA

- 启动 Demo：`pnpm dev --host 0.0.0.0 --port 9235`。
- 用 Playwright 或等价真实浏览器自动化执行以下断言；不得只用人工“看起来正确”替代：
  - 打开 `http://localhost:9235`。
  - 断言 `#title-input` 的值是 `Launch Notes for the first public package`。
  - 断言 `#tag-input` 的值是 `Release candidate`。
  - 通过标题/文本 `Markdown Document Data` 定位侧栏 Markdown 面板；断言其文本包含 ```` ```json ````、`"title": "Launch Notes for the first public package"`、`"tagLabel": "Release candidate"`、`# Ship a note component that feels editorial instead of generic`、`"updatedAt": "2026-07-11"`。
  - 将 `#title-input` 填为 `Edited Launch Notes`；断言渲染 note 标题与 Markdown 面板 JSON 都包含 `Edited Launch Notes`，且面板仍包含 `"updatedAt": "2026-07-11"`。
  - 将 `#tag-input` 填为 `Edited tag`；断言渲染 badge 与 Markdown 面板 JSON 都包含 `"tagLabel": "Edited tag"`，且 `updatedAt` 未变。
  - 通过 `button[role="switch"]` 启用 Editable；编辑包含 `This demo shows` 的已知段落；断言 Markdown 面板 body 包含编辑后的段落文本，且 `updatedAt` 未变。
  - 点击 accessible name 为 `标记为未完成` 的 checklist 按钮；断言 Markdown 面板中对应 item 从 `- [x]` 变为 `- [ ]`，且 `updatedAt` 未变。
  - 把 `#theme-color` 改为 `#16a34a`；断言 Markdown 面板文本与改色前捕获值完全一致。
  - 设置 viewport 为 `390x844`；断言 Markdown 面板可见，并且容器有可滚动 overflow。
  - 断言浏览器 console 没有 error。

### Evidence paths

- 单测输出保存/引用：终端输出 `pnpm test`。
- 类型检查输出：终端输出 `pnpm typecheck`。
- 构建输出：终端输出 `pnpm build:demo` 与 `pnpm build`。
- 浏览器 QA：截图或 Playwright evidence，至少包含默认渲染、侧栏 Markdown 面板、一次编辑同步后的面板变化。

## Execution strategy

- Wave 1: 依赖与文档格式建模。安装 parser/test 依赖，定义 JSON metadata + Markdown body 的精确 split/parse/serialize 合同。
- Wave 2: 实现 Demo-only 转换层与单测。先覆盖当前 demo 内容映射，再覆盖反向序列化和错误输入。
- Wave 3: 接入 App 状态流。让所有内容从 parsed document 初始化，并把所有编辑入口同步回 markdown string。
- Wave 4: UI 展示与样式。侧栏底部展示实时文档数据，避免破坏现有设置面板和响应式布局。
- Wave 5: 全量验证与修正。跑单测、typecheck、build、真实浏览器 QA。

## Todos

### Wave 1 — Dependencies and document contract

1. `package.json + pnpm-lock.yaml`: Add remark/unified parser dependencies and Vitest script for Markdown document conversion - expect `pnpm install` updates lockfile and `pnpm test` script exists

   References:
   - `package.json:32-42` currently has no test script.
   - `package.json:48-68` currently lacks Markdown parser and Vitest dependencies.
   - Approved decision: user selected “新增 parser” and “新增单测”.

   Implementation notes:
   - Add runtime deps: `unified`, `remark-parse`, `remark-stringify`, `remark-gfm`.
   - Add dev dep: `vitest`.
   - Add `"test": "vitest run"` to scripts.
   - Only add mdast type packages if TypeScript requires them.

   Acceptance criteria:
   - `package.json` includes `test` script.
   - `pnpm-lock.yaml` reflects new dependencies.
   - No npm/yarn lockfile is introduced.

   QA:
   - Happy path: run `pnpm install`; expect lockfile update with no install error.
   - Failure path: do not weaken the `test` script to pass before real tests exist; Wave 2 must add actual Vitest files so `pnpm test` passes legitimately.

   Suggested change group: `chore(demo): add markdown parser and test tooling`

2. `src/demo/noteData.ts`: Replace `demoBlocks` with `demoMarkdownDocument` JSON+Markdown source data - expect one complete document string stores all demo content

   References:
   - Existing content: `src/demo/noteData.ts:3-93`.
   - Existing metadata split: `src/demo/App.tsx:23-29`, `src/demo/App.tsx:141`.
   - Approved format: JSON metadata block first, Markdown body second.

   Implementation notes:
   - Preserve all current demo semantic content.
   - JSON metadata must include `title`, `summary`, `tagLabel`, `updatedAt`.
   - Markdown body must include the existing heading/paragraph/quote/checklist/callout/code/ending/warning content.
   - Use exact top-of-document fenced block format:
     ````md
     ```json
     { ... }
     ```

     # Body starts here
     ````

   Acceptance criteria:
   - `demoBlocks` export is removed or no longer used by App.
   - `demoMarkdownDocument` contains every old content string from `demoBlocks` and old App metadata.

   QA:
   - Happy path: parser tests in Wave 2 prove all content can be recovered.
   - Failure path: intentionally malformed JSON fixture in tests must throw `DemoMarkdownParseError`; no fallback rendering is allowed.

   Suggested change group: `feat(demo): store note demo as markdown document data`

### Wave 2 — Markdown conversion layer and tests

3. `src/demo/markdownDocument.ts`: Implement typed parser for JSON metadata block plus Markdown body - expect Markdown converts to `NoteContent` props without changing library API

   References:
   - `src/lib/types.ts:12-71` block variants to produce.
   - `src/lib/types.ts:73-98` props shape to satisfy.
   - `tsconfig.app.json:2-28` strict TS flags.
   - remark docs: `remark-parse` parses Markdown to mdast; GFM supports task list items.

   Required mapping contract:
   - JSON metadata → `{ title, summary, tagLabel, updatedAt }`; all four fields are required strings.
   - The Markdown document MUST encode every current `NoteBlock` field, not only visible text: block `id`, heading `eyebrow`, paragraph `tone`, checklist `title`, checklist item `id`, quote `author`, code `language`/`filename`, and callout `tone`/`title`/`text`.
   - Non-native Markdown fields MUST use the documented `hn:*` HTML comment directives from `Markdown field encoding contract`; parser and serializer must share the same convention.
   - Markdown heading depth 1/2/3 → `kind: "heading"`, `level: 1|2|3`, `text` from plain text content; preceding `hn:block` supplies `id` and optional `eyebrow`.
   - Paragraph → `kind: "paragraph"`; preceding `hn:block` supplies `id` and optional `tone`.
   - Blockquote ending with author line prefixed by `— ` → `kind: "quote"` with `author`; blockquote starting with `[!info]`, `[!success]`, or `[!warning]` is callout, not quote.
   - `<!-- hn:checklist id="checklist" title="Release readiness" -->` followed by GFM task list → one `kind: "checklist"`; list item `checked` maps from `[x]`/`[ ]`; `<!-- hn:item id="library" -->` supplies item id.
   - Fenced code → `kind: "code"`; language from fence info and filename from fence meta, e.g. ```` ```tsx filename="App.tsx" ````.
   - Callouts MUST use `> [!info] Structured input, flexible visuals` / `> [!success] ...` / `> [!warning] ...`; tone/title come from the first line and text comes from remaining quote lines.

   Implementation constraints:
   - Do not use `any`, `as any`, non-null assertions, or broad swallowed catches.
   - If parsing fails, throw `DemoMarkdownParseError` with stable `code` and `message`; do not silently render empty content and do not return fallback data.
   - Use exhaustive `switch` over mdast node types that the converter handles; unknown nodes may be skipped only through an explicit documented branch.

   Acceptance criteria:
   - `parseMarkdownDocument(demoMarkdownDocument)` returns title/summary/tagLabel/updatedAt/blocks matching the old Demo content.
   - IDs are deterministic across parse runs so React keys and serializer output are stable.
   - Unsupported Markdown nodes do not crash valid docs unless they violate the documented Demo subset.

   QA:
   - Happy path: unit test parses the default document and asserts title, metadata, block count, representative block kinds, block IDs, heading eyebrow, paragraph tone, checklist title, checklist item IDs, checklist checked states, quote author, code language/filename, callout tone/title/text.
   - Failure path: unit tests assert `DemoMarkdownParseError` for malformed JSON, missing first JSON fence, missing `title`, and non-string `updatedAt`.

   Suggested change group: `feat(demo): parse markdown document into note content data`

4. `src/demo/markdownDocument.ts`: Implement serializer from edited `NoteContent` state back to JSON+Markdown - expect inline edits can update sidebar source string in real time

   References:
   - User selected “实时反向更新”.
   - `src/lib/types.ts:65-71` discriminated union variants.
   - remark docs: `remark-stringify` serializes mdast to Markdown.

   Required serialization contract:
   - Metadata JSON is pretty-printed with stable two-space indentation.
   - JSON metadata fence remains the first block.
   - `updatedAt` is copied from document metadata and MUST NOT be auto-mutated during title, summary, tag, or block edits.
   - Heading/paragraph/quote/checklist/code/callout blocks serialize back to the same documented Markdown conventions used by parser.
   - All `hn:*` directives required by the mapping contract serialize deterministically.
   - Checklist checked state serializes as `- [x]` or `- [ ]`.
   - Code block language and filename convention round-trip.
   - Callout convention round-trips tone/title/text.

   Acceptance criteria:
   - `serializeMarkdownDocument(parseMarkdownDocument(demoMarkdownDocument))` produces a valid JSON+Markdown document that can be parsed again.
   - Updating title/summary in the document object changes JSON metadata only.
   - Updating blocks changes Markdown body only, except derived formatting normalization by remark-stringify.
   - Updating title, summary, tagLabel, or blocks leaves `updatedAt` unchanged.

   QA:
   - Happy path: round-trip unit test parse → serialize → parse asserts equivalent structured data.
   - Failure path: unit test serializing each block kind asserts unsupported/new `NoteBlock` variants cannot be ignored silently; exhaustive switch must fail at compile time or through `assertNever`.

   Suggested change group: `feat(demo): serialize edited note data back to markdown`

5. `src/demo/markdownDocument.test.ts`: Add Vitest coverage for parser, serializer, and edit round-trip behavior - expect conversion behavior locked before App wiring

   References:
   - Vitest docs: `.test.ts` files support TypeScript out of the box.
   - `src/demo/noteData.ts` default document fixture.
   - User selected “新增单测”.

   Required tests:
   - Given the default demo markdown document, when parsed, then metadata matches old App values and all representative block kinds exist.
   - Given the default demo markdown document, when parsed, then block IDs, heading eyebrow, paragraph tone, checklist title, checklist item IDs, quote author, code language/filename, and callout tone/title/text are preserved.
   - Given a parsed document with edited title/summary, when serialized, then top JSON block reflects those edits.
   - Given a parsed document with edited title/summary/tagLabel/blocks, when serialized, then `updatedAt` remains the original parsed value.
   - Given edited checklist checked state and text, when serialized and reparsed, then checklist state/text persists.
   - Given callout and code block markdown conventions, when parsed and serialized, then tone/title/language/filename persist.
   - Given malformed JSON metadata, missing first JSON fence, missing `title`, or non-string `updatedAt`, when parsed, then `DemoMarkdownParseError` is thrown with stable `code` and `message`.

   Acceptance criteria:
   - `pnpm test` passes.
   - Tests assert behavior, not snapshots of the whole Markdown string except where checking the JSON fence contract.

   QA:
   - Happy path: run `pnpm test`; expect all conversion tests pass.
   - Failure path: temporarily break one mapping locally during development to confirm the corresponding test fails for the right reason, then restore before final verification.

   Suggested change group: `test(demo): cover markdown document conversion`

### Wave 3 — App state integration

6. `src/demo/App.tsx`: Initialize all note content from parsed Markdown document - expect no hardcoded demo title/summary/tag/updatedAt/blocks remain in App

   References:
   - `src/demo/App.tsx:23-29` current hardcoded content state.
   - `src/demo/App.tsx:136-147` current `NoteContent` props.
   - `src/demo/noteData.ts` after Wave 1 exports `demoMarkdownDocument`.

   Implementation notes:
   - Parse once for initial state; use lazy `useState` initializer or module-level parsed constant to avoid reparsing on every render.
   - Track structured document state and `markdownDocument` string state explicitly.
   - `updatedAt` must come from parsed metadata.
   - Keep `themeColor` and `editable` state unchanged as Demo controls.

   Acceptance criteria:
   - App imports `demoMarkdownDocument`, `parseMarkdownDocument`, and `serializeMarkdownDocument` or equivalent.
   - App no longer imports `demoBlocks`.
   - App no longer hardcodes title/summary/tagLabel/updatedAt content strings.

   QA:
   - Happy path: `pnpm typecheck` passes after App wiring.
   - Failure path: remove/alter required metadata in a local test fixture only; parser tests catch missing metadata before App can silently render undefined.

   Suggested change group: `feat(demo): render note content from markdown document`

7. `src/demo/App.tsx`: Wire title, summary, and blocks edit handlers to regenerate JSON+Markdown document - expect sidebar data changes immediately after edits

   References:
   - `src/lib/types.ts:91-97` editable callbacks.
   - `src/demo/App.tsx:144-146` current callbacks directly set independent states.
   - User selected real-time reverse update.

   Implementation notes:
   - Replace independent `setTitle`, `setSummary`, `setBlocks` usage with small update handlers that update structured state and `markdownDocument` together.
   - Avoid stale state by deriving next document inside functional `setState` callbacks when needed.
   - Keep JSON metadata update for title/summary separate from Markdown body update for blocks.
   - Real-time reverse sync updates only edited metadata fields (`title`, `summary`, `tagLabel`) and Markdown body blocks; `updatedAt` remains the parsed value.
   - If `tagLabel` remains editable through sidebar input, changing it must update JSON metadata too; if the Tag Label input is removed, document why in comments/plan execution notes. Preferred: keep Tag Label input and sync it into metadata.

   Acceptance criteria:
   - Editing title updates rendered title and JSON metadata display.
   - Editing summary updates rendered summary and JSON metadata display.
   - Editing body blocks updates rendered block state and Markdown body display.
   - Changing tag input updates rendered badge and JSON metadata display.
   - Editing title, summary, tag, paragraph text, and checklist checked state does not change `updatedAt` in the displayed document data.

   QA:
   - Happy path: browser QA edits title, summary, tag, one paragraph/checklist; expect markdown panel reflects each and preserves `updatedAt`.
   - Failure path: toggle theme color and editable switch; expect markdown panel unchanged unless content was edited.

   Suggested change group: `feat(demo): sync inline edits back to markdown data`

### Wave 4 — Sidebar Markdown data panel

8. `src/demo/App.tsx + src/demo/app.css`: Add bottom-of-sidebar Markdown document panel - expect full current JSON+Markdown source is visible and readable

   References:
   - `src/demo/App.tsx:34-123` current sidebar controls.
   - `src/demo/app.css:39-51` sidebar layout is sticky, column, independently scrollable.
   - `src/demo/app.css:240-256` responsive behavior at max-width 840px.

   Implementation notes:
   - Place panel after existing controls so it appears at the bottom of the sidebar.
   - Use semantic label like “Markdown Document Data”.
   - Render `markdownDocument` inside `<pre><code>` or an accessible readonly `<textarea>`; prefer `<pre><code>` if no editing is intended from the panel.
   - Style for max height, overflow auto, monospace font, wrapping or horizontal scroll that preserves readability.
   - Ensure contrast and focus/selection are usable.

   Acceptance criteria:
   - Panel is visually at the bottom of the left sidebar.
   - Panel displays the JSON metadata fence and Markdown body.
   - Panel updates after edit handlers regenerate `markdownDocument`.
   - Mobile/narrow layout still exposes the panel without clipping.

   QA:
   - Happy path: browser screenshot at desktop width shows panel at sidebar bottom with JSON+Markdown text.
   - Failure path: browser screenshot at ≤840px shows panel still accessible and scrollable.

   Suggested change group: `feat(demo): show live markdown document data in sidebar`

### Wave 5 — Verification and cleanup

9. `src/demo/* + package files`: Run automated checks and fix strict TypeScript/lint/build issues - expect tests, typecheck, demo build, and full build pass

   References:
   - `package.json:33-39` existing scripts.
   - `tsconfig.app.json:2-28` strict TS settings.
   - Programming TypeScript rule: no `any`, no non-null assertions, type-only imports use `import type`.

   Required commands:
   - `pnpm test`
   - `pnpm typecheck`
   - `pnpm build:demo`
   - `pnpm build`
   - Optional but recommended if quick: `pnpm lint`

   Acceptance criteria:
   - All required commands pass.
   - No new `any`, `as any`, non-null assertions, or swallowed catches are introduced.
   - No unintended public library API changes appear in `src/lib/index.ts` or `src/lib/types.ts`.

   QA:
   - Happy path: required command outputs show success.
   - Failure path: if a command fails, fix root cause and rerun the same command; do not delete tests or loosen strict TS settings to pass.

   Suggested change group: `chore(demo): verify markdown document workflow`

10. `Demo browser session`: Perform real UI QA for Markdown-source rendering and live reverse sync - expect user-visible behavior matches approved scope

   References:
   - User request: Demo content must all be converted from Markdown, and left sidebar bottom must show Markdown document data.
   - `src/demo/app.css:240-256` responsive layout.

   QA script:
   - Start `pnpm dev --host 0.0.0.0 --port 9235`.
   - Open `http://localhost:9235`.
   - Assert `#title-input` has value `Launch Notes for the first public package`.
   - Assert `#tag-input` has value `Release candidate`.
   - Locate the Markdown panel by heading/text `Markdown Document Data`; assert its text contains ```` ```json ````.
   - Assert the same panel text contains `"title": "Launch Notes for the first public package"`, `"tagLabel": "Release candidate"`, `"updatedAt": "2026-07-11"`, and `# Ship a note component that feels editorial instead of generic`.
   - Fill `#title-input` with `Edited Launch Notes`; assert rendered note title and Markdown panel JSON both contain `Edited Launch Notes`; assert `"updatedAt": "2026-07-11"` still exists.
   - Fill `#tag-input` with `Edited tag`; assert rendered badge and Markdown panel JSON both contain `"tagLabel": "Edited tag"`; assert `updatedAt` is unchanged.
   - Enable Editable via `button[role="switch"]`; edit one known paragraph containing `This demo shows`; assert Markdown panel body contains the edited paragraph text and `updatedAt` is unchanged.
   - Click the checklist button with accessible name `标记为未完成`; assert Markdown panel body changes the matching item from `- [x]` to `- [ ]` and `updatedAt` is unchanged.
   - Capture Markdown panel text, change `#theme-color` to `#16a34a`, then assert Markdown panel text is unchanged from the captured value.
   - Set viewport to `390x844`; assert Markdown panel is visible and has scrollable overflow.
   - Assert browser console has no errors.

   Acceptance criteria:
   - All QA steps pass with screenshot or textual evidence.
   - No console errors during interactions.

   QA:
   - Happy path: all listed interactions work.
   - Failure path: if Markdown panel lags behind any edit, fix state synchronization and repeat the interaction.

   Suggested change group: `test(demo): verify live markdown data panel`

## Final verification wave

After all todos are complete, run these checks in parallel where possible; all must pass before claiming completion:

1. **Plan compliance audit**
   - Verify no public library API change unless explicitly justified and approved.
   - Verify document format is JSON metadata block + Markdown body, not YAML.
   - Verify all Demo content originates from parsed Markdown document data.
   - Verify sidebar bottom displays live current document data.
   - Verify editing title, summary, tag, and blocks preserves `updatedAt`.

2. **Code quality review**
   - Inspect `src/demo/markdownDocument.ts` for strict TS compliance: no `any`, no non-null assertions, no broad swallowed catch, exhaustive `NoteBlock` serialization.
   - Check file size; if a new file exceeds 250 pure LOC, split parser helpers/tests by responsibility before finalizing.
   - Confirm dependencies are minimal and justified.

3. **Automated verification**
   - `pnpm test`
   - `pnpm typecheck`
   - `pnpm build:demo`
   - `pnpm build`
   - `pnpm lint` if not blocked by unrelated existing lint failures; if blocked, record exact unrelated failure.

4. **Real browser QA**
   - Desktop and narrow-width screenshots/evidence.
   - Edit-sync evidence for metadata and body.
   - Console checked for runtime errors.

## Commit strategy

- Do not run `git commit` unless the user explicitly asks for commits.
- If the user asks for commits, keep them small and reviewable:
  1. `chore(demo): add markdown parser and test tooling`
  2. `feat(demo): store note demo as markdown document data`
  3. `feat(demo): parse markdown document into note content data`
  4. `feat(demo): serialize edited note data back to markdown`
  5. `test(demo): cover markdown document conversion`
  6. `feat(demo): render note content from markdown document`
  7. `feat(demo): sync inline edits back to markdown data`
  8. `feat(demo): show live markdown document data in sidebar`
  9. `chore(demo): verify markdown document workflow`
- If the downstream worker is not asked to commit, do not stage unrelated files and report final changes using these same suggested change groups.

## Success criteria

- `src/demo/noteData.ts` stores a single JSON+Markdown document data source for Demo content.
- `src/demo/App.tsx` renders all note content from parsed Markdown document data; no old hand-authored `demoBlocks` path remains.
- Left sidebar bottom displays the current JSON+Markdown document data.
- Inline editing of title/summary/tag/body blocks updates the displayed document data in real time.
- Inline editing and theme/editable controls preserve `updatedAt`; it remains the original parsed metadata value unless a future explicit UI control is added.
- Parser and serializer have Vitest unit coverage including happy paths and malformed metadata failure.
- `pnpm test`, `pnpm typecheck`, `pnpm build:demo`, and `pnpm build` pass.
- The public `@hamster-note/notes` component API remains stable.
