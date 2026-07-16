# block-editor-interactions — Planning Draft

status: high-accuracy-review-approved
intent: clear
review_required: true
classify: standard

## User request

用户希望增加文字块级交互能力：

1. hover 或 focus 某一个文字块时，在最左侧出现操作按钮；点击按钮弹出菜单；窗口宽度大于 800px 时菜单靠近按钮，小于等于 800px 时菜单居中；菜单可以把当前块改为 H1 / H2 / H3 / H4 / H5 / 正文。
2. 文字块编辑中按 Enter 另起一行，新行格式与当前行一致；按 Shift+Enter 则在当前文字块内直接换行。
3. 文字块可以为空；如果用户在空文字块再次按 Backspace，则清除整行。

## Components ledger

1. `type-model`: 扩展 `NoteHeadingBlock.level` 与 Markdown parser/serializer 支持 H1-H5。Evidence: `src/lib/types.ts:12-18` 当前 `level: 1 | 2 | 3`; `src/demo/markdownDocumentBlocks.ts:223-224` 当前只接受 1/2/3。
2. `block-editor-state`: 在 `NoteContent` 管理 active/hovered block、菜单 open/close、焦点恢复与 DOM 定位。Evidence: `src/lib/NoteContent.tsx:303-381` 当前是无状态渲染，只持有 `shellRef`。
3. `editable-block-ops`: 新增纯函数处理 block 类型转换、插入同格式新块、删除空块、更新文本。Evidence: `src/lib/NoteContent.tsx:18-91` 当前只有字段更新函数，没有插入/删除/变更 heading level。
4. `keyboard-behavior`: 为 heading/paragraph 的 contentEditable 文本元素添加 Enter / Shift+Enter / Backspace 行为。Evidence: `editableProps` 在 `src/lib/NoteContent.tsx:93-102` 当前只接收 `onBlur`，无 `onKeyDown`。
5. `block-action-menu-ui`: 新增左侧操作按钮与菜单样式、desktop/mobile 定位、可访问性与 Escape/外点关闭。Evidence: `src/lib/SelectionPopover.tsx:33-184` 已有 portal popover 与 Escape/scroll 关闭模式；`src/lib/styles.css:355-426` 已有 popover 视觉语言可复用。
6. `markdown-sync`: 确保 H4/H5、空正文块、同格式新行、删除空行在 Demo 的 JSON+Markdown 源数据显示中可 round-trip。Evidence: `src/demo/markdownDocument.ts:72-114` 当前序列化 heading 用 `#`.repeat(level)，但类型与 parser 只允许 1-3；空 paragraph 在 Markdown AST 中需要 directive 约定才能稳定保留。
7. `verification`: 新增纯函数/serialization 单测与真实浏览器交互 QA，覆盖 hover/focus/menu、desktop/mobile、Enter/Shift+Enter/Backspace；同时把 `pnpm test` 加入 CI。Evidence: `package.json:32-43` 已有 `test/typecheck/build`；`.github/workflows/ci.yml:30-37` 当前缺少 test；当前没有 React DOM 测试依赖，浏览器 QA 应通过 Playwright/真实浏览器手动自动化完成。

## Discovered facts

- 项目是 React 19 + Vite 组件库，包入口只导出 `src/lib`；Demo 在 `src/demo`。Evidence: `package.json:45-75`, `vite.config.ts:9-33`。
- `NoteContent` public props 已有 `editable` 与 `onBlocksChange`，因此块级交互可以在现有 API 内完成，不需要新增外部 callback。Evidence: `src/lib/types.ts:73-98`。
- 当前 editable 文本通过 `contentEditable` + `onBlur` 写回 `innerHTML`，选区富文本 popover 依赖 `document.execCommand`。Evidence: `src/lib/NoteContent.tsx:93-109`, `src/lib/SelectionPopover.tsx:97-115`。
- 当前 heading 渲染动态使用 `const HeadingTag = \`h${block.level}\` as const`，样式只有 `.hn-note-heading--1/2/3`。Evidence: `src/lib/NoteContent.tsx:115-132`, `src/lib/styles.css:155-165`。
- 当前 Markdown parser 会忽略空行；普通 Markdown 无法稳定表达一个“空 paragraph block”。要让空文字块可序列化，需要给空正文块使用 `<!-- hn:block id="..." -->` 后跟约定占位或 parser 对“孤立 block directive”生成空 paragraph。Evidence: `src/demo/markdownDocumentBlocks.ts:25-60` 只在遇到 paragraph/heading/blockquote/code/list 时 push block。
- 当前 Demo 已把 inline edits 实时序列化为 Markdown 文档数据，新增交互必须保持该状态流。Evidence: `src/demo/App.tsx:39-48`, `src/demo/App.tsx:198-200`。
- 当前没有 `DESIGN.md`。根据 frontend skill，计划应先提取现有 CSS 变量/组件状态到 `DESIGN.md`，新增按钮/菜单样式必须复用该设计系统，而不是随意加魔法值。
- Read-only explore agent confirmed there are currently no component/UI interaction tests for `NoteContent.tsx` or `SelectionPopover.tsx`; existing Vitest coverage is Markdown parse/serialize only.
- `.github/workflows/ci.yml` currently runs `pnpm lint`, `pnpm typecheck`, and `pnpm build`, but does not run `pnpm test`. If the implementation adds tests for parser/serializer/block ops, the plan should include adding `pnpm test` to CI before build.
- `serializeBlocks` currently wraps serialized markdown fragments as mdast `html` nodes before `remark-stringify`, so empty paragraph preservation must be designed carefully and tested; do not rely on plain blank lines to represent empty blocks.
- Explore agent suggested considering H6, but the user requirement is explicitly H1-H5, so the default plan remains H1-H5 only.

## Adopted defaults / decisions

- 范围默认限定为“简单文字块”：`heading` 与 `paragraph`。不在 checklist item、quote、callout、code 的子文本上显示 H1-H5/正文块转换菜单，避免把结构化块一键转换成普通正文造成语义丢失。若用户希望所有可编辑文本字段都能转换为标题/正文，需要显式扩大范围。
- “正文”对应 `kind: "paragraph"` 且默认 `tone` 不保留；从 heading 转正文时保留 `id` 与 `text`，删除 heading-only `eyebrow`（或不再展示它）。从 paragraph 转 heading 时保留 `id` 与 `text`，删除 paragraph-only `tone`。
- H1-H5 是明确需求，因此扩展公共 `NoteHeadingBlock.level` 到 `1 | 2 | 3 | 4 | 5`，并同步 parser、serializer、样式、测试；这属于必要 API 扩展，不新增新的 block kind。
- Enter 行为：阻止 contentEditable 默认插入 `<div>`/`<p>`；在当前 block 后插入新的 heading/paragraph block，格式与当前 block 相同，text 为空，并在下一 tick 聚焦新块。Shift+Enter 保留在当前块内插入软换行 `<br>`/line break，并由现有 `innerHTML`/Markdown `break` 处理同步。
- Backspace 行为：仅当当前 heading/paragraph 的可见文本为空、且光标在空块内时阻止默认行为并删除当前块；删除后聚焦相邻前一块，若无前一块则聚焦后一块；至少允许文档内保留一个空正文块，避免删除最后一个可编辑行后没有落点。
- 菜单定位：>800px 使用按钮 `getBoundingClientRect()` 附近 fixed portal；≤800px 使用 fixed 居中 modal-like menu。使用 `window.matchMedia`/resize 同步即可，不引入 Popper 等依赖。
- 测试策略：TDD/测试优先用于纯函数与 Markdown round-trip；UI 交互用真实浏览器 QA 覆盖，因为当前项目没有 React Testing Library/jsdom 依赖，避免为一次交互引入沉重测试栈。
- 设计策略：先创建/更新根目录 `DESIGN.md`，抽取现有 `src/lib/styles.css` 的 theme tokens、popover/button/menu states、breakpoint 规则；新增 CSS 只使用这些 token/状态模式。

## Open owner decisions

无阻塞问题。若用户不反对，计划将按上面的默认范围执行：只让 heading/paragraph 参与块级格式菜单和 Enter/Backspace 行级行为。

## Approval gate

User approved the approach by replying: “确认”.

Pending action: write `.omo/plans/block-editor-interactions.md` with the approved approach, then run mandatory Metis gap review before final handoff.

Approval brief: implement block-level editing for heading/paragraph text blocks inside existing `NoteContent` API; expand heading levels to H1-H5 across types, renderer styles, parser, serializer, and tests; add a left-side block action handle plus responsive portal menu; implement Enter/Shift+Enter/empty-Backspace behavior with immutable block array operations and focus restoration; preserve Demo Markdown live serialization including H4/H5 and empty paragraph blocks; create `DESIGN.md` from the existing CSS before adding new UI states; add `pnpm test` to CI; verify with `pnpm test`, `pnpm typecheck`, `pnpm build`, and real browser QA at desktop and ≤800px.

Approval received. Formal plan path: `.omo/plans/block-editor-interactions.md`.

## Metis review integration

Mandatory Metis plan review completed in session `ses_0aa693c0bffeOPjYE20kzQUK8D`.

Findings integrated into final plan:

- Empty heading/paragraph Markdown convention must be exact, not vague.
- Enter at middle of a block must split content at caret, not always append an empty block.
- Keydown handlers must flush current `innerHTML` before mutating blocks to avoid losing un-blurred edits.
- Shift+Enter `<br>` storage/Markdown round-trip must be explicitly normalized and tested.
- New block ID generation must be deterministic and collision-free.
- Scope guardrails must prevent title/summary/checklist/quote/callout/code from receiving the heading/paragraph block handlers.
- Last-block Backspace behavior must be exact.
- Block handle/menu positioning, selection popover mutual exclusion, accessibility labels, 801px/800px breakpoint QA, file-size responsibility split, and evidence paths must be explicit.

## High-accuracy review

User requested option 2: “高精度审查”. Required dual review is now in progress against `.omo/plans/block-editor-interactions.md`.

- Native Momus review: `bg_f7c2e0cc` / session `ses_0aa5fc93fffeylbZYUDJHF11lG` — **OKAY / APPROVE**, no blocking fixes requested.
- Independent Oracle review: `bg_598b59d2` / session `ses_0aa5fc8c9ffeMy3NthzctRdDjt` — **APPROVE**, no blocking fixes requested.
- Fix/retry summary: no plan edits required after high-accuracy review; both reviewers approved the current `.omo/plans/block-editor-interactions.md` unconditionally.
