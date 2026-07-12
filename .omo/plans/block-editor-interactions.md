# block-editor-interactions - Work Plan

## TL;DR (For humans)

本计划为 HamsterNote 的 `NoteContent` 增加已批准的“简单文字块”交互：仅 `heading` 与 `paragraph` 在 editable 模式下显示左侧块操作按钮，可转换为 H1/H2/H3/H4/H5/正文；Enter 在光标处拆分出同格式下一行，Shift+Enter 在当前块内插入软换行，空块 Backspace 删除整行。计划不会把这套行为扩散到 title、summary、checklist item、quote、callout 或 code。实现前先补根目录 `DESIGN.md`，把现有 `styles.css` 的 token/状态规则固化为设计合同；实现时扩展 heading level 类型与 Markdown parser/serializer 到 H1-H5，并为“空 paragraph block”定义稳定 directive round-trip。为避免 `NoteContent.tsx` 继续膨胀，新增块编辑纯函数与菜单组件文件，`NoteContent` 只做最小 wiring。验证包含 Vitest 纯函数/Markdown round-trip、`pnpm test` 加入 CI、`pnpm typecheck`、`pnpm build`，以及真实浏览器在 801px/800px 边界、hover/focus/menu、Enter/Shift+Enter/Backspace、最后一块删除保护上的 QA 证据。Metis 审核已完成并已把所有 MUST_FIX/SHOULD_FIX 缺口合入本计划。当前是计划文件，不是执行；后续实现需由 `/start-work` 或单独 worker 启动。

## Scope

### In scope

- 在 `src/lib/types.ts` 中把 `NoteHeadingBlock.level` 从 `1 | 2 | 3` 扩展为 `1 | 2 | 3 | 4 | 5`。
- 在 `src/lib/NoteContent.tsx` 的 editable 模式中，仅为 `heading` 与 `paragraph` 的正文 editable 元素增加：
  - hover/focus 时显示左侧块操作按钮。
  - 点击按钮打开格式菜单：H1 / H2 / H3 / H4 / H5 / 正文。
  - Enter：在当前光标位置拆分当前块，下一块继承当前块格式。
  - Shift+Enter：在当前块内插入软换行。
  - 空块 Backspace：删除当前整行，并恢复焦点。
- 新增内部文件，避免把所有逻辑堆进 `NoteContent.tsx`：
  - `src/lib/blockEditing.ts`：纯函数与类型，例如 block conversion、split、delete、ID 生成、editable HTML normalization。
  - `src/lib/BlockActionMenu.tsx`：左侧 handle 与 portal menu 组件。
  - `src/lib/blockEditing.test.ts`：Vitest 单测覆盖纯逻辑。
- 更新 `src/lib/styles.css`：
  - 新增 H4/H5 heading 样式。
  - 新增 `.hn-note-block-*` 系列类名，全部基于 `DESIGN.md` 记录的现有 token/状态模式。
  - 保持 `.hn-note-*` 前缀，不引入 CSS Modules/CSS-in-JS。
- 新建根目录 `DESIGN.md`，从现有 `src/lib/styles.css` 抽取并记录：theme token、typography、spacing、radius/shadow、editable hover/focus、popover/menu、breakpoints、accessibility constraints、accepted debt。
- 更新 Demo Markdown 层：
  - `src/demo/markdownDocumentBlocks.ts` 支持 heading depth 1-5。
  - `src/demo/markdownDocument.ts` 序列化 H1-H5。
  - 定义并实现空 paragraph 的稳定 Markdown directive 约定。
  - 保证 Demo Markdown 面板能 round-trip H4/H5、空 paragraph、Shift+Enter soft break。
- 更新现有 Markdown 单测，并新增必要单测覆盖 H4/H5、空 paragraph、soft break、转换/拆分/delete ID 唯一性。
- 更新 `.github/workflows/ci.yml`，在 typecheck 前后合适位置加入 `pnpm test`，推荐顺序：lint → test → typecheck → build。
- 保存浏览器 QA 证据到 `.omo/evidence/block-editor-interactions/`。

### Out of scope / Must-NOT-Have

- 不把块操作按钮/菜单加到 title、summary、checklist item、quote、callout、code 或其它非 `heading`/`paragraph` editable 字段。
- 不新增 `NoteContentProps` callback；继续使用现有 `editable` 与 `onBlocksChange`。
- 不新增新的 public block kind。
- 不支持 H6；用户明确要求 H1-H5。
- 不引入 Popper、floating-ui、React Testing Library、jsdom、Playwright 依赖，除非 worker 发现当前环境无法完成 QA 并先停下回报。浏览器 QA 可用现有 MCP/工具执行并把证据写入 `.omo/evidence/...`。
- 不重写 SelectionPopover 的 `execCommand` 富文本实现；只做与 block menu 的互斥/不冲突处理。
- 不实现 undo/redo、拖拽排序、slash command、Markdown parser 公共导出或完整 Markdown 编辑器。
- 不改变 quote/callout/checklist/code 的语义转换行为；这些结构化块仍由原有 UI 编辑。
- 不把 theme color、editable 开关写入 Markdown 文档数据。

### Approved product decisions

- 只支持简单文字块：`heading` 和 `paragraph`。
- “正文”转换结果是 `kind: "paragraph"`。
- Heading → paragraph：保留 `id` 与当前正文 HTML；丢弃 heading-only `eyebrow`。
- Paragraph → heading：保留 `id` 与当前正文 HTML；丢弃 paragraph-only `tone`。
- H1-H5 是需求边界；不要扩到 H6。
- 菜单定位边界精确为：`window.innerWidth > 800` 时靠近按钮；`window.innerWidth <= 800` 时居中。

### Exact text editing contract

- Canonical editable text value remains an inline HTML string, because current `richText(value)` renders via `dangerouslySetInnerHTML` and existing selection formatting stores `<b>/<i>/<u>` tags.
- Add `normalizeEditableHtml(html: string): string` in `src/lib/blockEditing.ts`:
  - Convert browser-generated block wrappers from contentEditable Enter/Shift+Enter variants into canonical inline HTML.
  - Preserve existing `<b>`, `<i>`, `<u>`, and `<br>` tags.
  - Treat `<br>`, `<br />`, `<div><br></div>`, empty string, and whitespace-only visible text consistently for empty-block detection.
- Enter behavior:
  - Before changing the block array, read and normalize `event.currentTarget.innerHTML` and flush it into the source block.
  - If selection is non-collapsed, delete selected contents first, then split at the remaining caret.
  - Split current block at the caret into `beforeHtml` and `afterHtml`.
  - Current block keeps `beforeHtml`; inserted next block gets `afterHtml`.
  - If caret is at end, next block text is empty. If caret is at start, current block text becomes empty and next block gets previous text.
  - Inserted next block inherits kind/format:
    - heading: same `level`, no `eyebrow` unless existing product explicitly requires copying it later; current plan does **not** copy `eyebrow`.
    - paragraph: same `tone` as current paragraph.
- Shift+Enter behavior:
  - Do not create a new `NoteBlock`.
  - Insert canonical `<br>` at caret, preserve inline formatting around it, and let blur/input normalization store `<br>` in `block.text`.
  - Demo Markdown serializer must output `<br>` soft breaks in body text; parser must preserve inline HTML `<br>` as canonical `<br>` instead of dropping it.
- Backspace behavior:
  - Only intercept Backspace when current `heading`/`paragraph` visible text is empty and selection is collapsed in that empty editable element.
  - If more than one block exists: remove current block, then focus nearest previous editable heading/paragraph if available; otherwise nearest next editable heading/paragraph; otherwise no-op focus after state update.
  - If it is the only block, replace it with one empty paragraph using the same `id` when possible, `kind: "paragraph"`, `tone: "default"`, `text: ""`; focus that paragraph. This means an empty lone heading becomes an empty paragraph, not a persistent heading.

### Exact ID generation contract

- Add `createNextBlockId(blocks: readonly NoteBlock[], sourceId: string): string` in `src/lib/blockEditing.ts`.
- The ID must be deterministic and collision-free within the current document:
  - Base: `${sourceId}-line`.
  - If `sourceId-line` is unused, use it.
  - Otherwise use the first unused `${sourceId}-line-${n}` for `n >= 2`.
- Never use `Date.now()`, random numbers, `crypto.randomUUID()`, array indexes, or text-derived slugs for inserted block IDs.
- Tests must cover repeated insertion after the same source ID and pre-existing collisions.

### Exact empty Markdown convention

- Empty heading block:
  - Serialize as the normal `hn:block` directive followed by a Markdown heading marker with no text.
  - Example:
    ```md
    <!-- hn:block id="section-line" -->
    ##
    ```
  - Parser must accept heading depth 1-5 with empty text and produce `text: ""`.
- Empty paragraph block:
  - Serialize as a standalone `hn:block` directive with `empty="true"` and optional paragraph attributes.
  - Example default paragraph:
    ```md
    <!-- hn:block id="intro-line" empty="true" -->
    ```
  - Example muted paragraph:
    ```md
    <!-- hn:block id="intro-line" tone="muted" empty="true" -->
    ```
  - Parser rule: when `parseMarkdownBlocks` sees an `hn:block` directive with `empty="true"`, immediately emit a `kind: "paragraph"` block with `text: ""`, `id` from directive, and optional `tone`, then clear the pending directive. It must not wait for a following paragraph node.
- Non-empty paragraph keeps the existing directive + paragraph text convention.
- Tests must assert parse → serialize → parse preserves an empty paragraph block and does not drop its ID.

### Accessibility and layering contract

- Left handle button:
  - Must be a real `<button type="button">`.
  - Must have accessible label including the block type, e.g. `aria-label="打开段落块菜单"` / `aria-label="打开标题块菜单"`.
  - Must expose `aria-haspopup="menu"` and accurate `aria-expanded`.
  - Must be keyboard focusable when visible/focused; hover-only discoverability is not enough.
- Menu:
  - Use `role="menu"` and menu item buttons with readable text: `H1`, `H2`, `H3`, `H4`, `H5`, `正文`.
  - Current format should be indicated with `aria-checked` or `aria-current`, and a visible active style.
  - Escape closes menu and restores focus to the handle.
  - Outside pointer down closes menu.
  - Selecting a menu item closes menu and focuses the edited block.
- SelectionPopover conflict:
  - While block menu is open, render `SelectionPopover` with `editable={false}` or otherwise suppress it.
  - Do not allow text selection popover and block menu to be visible at the same time.
- Z-index:
  - Block menu must use the same layer family as `.hn-note-popover` and must not sit underneath it.

### Positioning contract

- Wrap only heading/paragraph render paths in a block row container such as `.hn-note-block-row` and `.hn-note-block-row--active`.
- The handle may be positioned inside the shell-safe left gutter; it must not be clipped by `.hn-note-shell { overflow: hidden; }` at common content widths.
- The menu itself must be portaled/fixed like `SelectionPopover`, not clipped by the shell.
- Desktop (`window.innerWidth > 800`): compute fixed menu position from handle `getBoundingClientRect()` and keep it within viewport with simple clamping.
- Mobile/narrow (`<= 800`): fixed centered menu, not tied to handle rect.
- Browser QA must test `801x900` and `800x900` specifically.

### Evidence / current state

- `src/lib/types.ts:12-18` currently limits heading level to `1 | 2 | 3`.
- `src/lib/NoteContent.tsx:93-102` `editableProps` currently only supports `onBlur` and is reused across many editable fields.
- `src/lib/NoteContent.tsx:111+` `renderBlock` handles all block variants; only heading/paragraph should get new block interaction wrappers.
- `src/lib/NoteContent.tsx:123-149` heading/paragraph currently write back only on blur.
- `src/lib/SelectionPopover.tsx:33-184` provides a reusable portal/escape/scroll pattern and should inspire, not be replaced by, the block menu.
- `src/lib/styles.css:155-165` only defines heading styles for 1/2/3.
- `src/lib/styles.css:320-341` defines editable hover/focus treatment.
- `src/lib/styles.css:355-426` defines fixed popover styling and z-index.
- `src/demo/markdownDocument.ts:60-70` serializes block fragments through mdast `html` nodes, so empty paragraph must be explicit and tested.
- `src/demo/markdownDocument.ts:72-88` serializes heading/paragraph content.
- `src/demo/markdownDocumentBlocks.ts:25-60` currently only emits blocks when concrete mdast block nodes appear; standalone directives do not currently create empty paragraph blocks.
- `src/demo/markdownDocumentBlocks.ts:223-224` currently accepts only heading depth 1/2/3.
- `.github/workflows/ci.yml:30-37` runs lint/typecheck/build but not tests.
- `package.json:32-43` already has `test: vitest run`.

## Verification strategy

### Test strategy

- Use TDD for pure block editing helpers and Markdown parser/serializer changes.
- Do not add React DOM test dependencies for this task.
- Browser interaction correctness is verified via real browser QA with saved evidence, not by jsdom simulation.

### Required automated checks

- `pnpm test`
  - Must pass locally.
  - Must be added to CI.
- `pnpm typecheck`
- `pnpm build`
- Optional but recommended before final claim if worker touches formatting-sensitive files: `pnpm lint`

### Required unit coverage

- `src/lib/blockEditing.test.ts`:
  - Converts paragraph → each heading level H1-H5 preserving `id` and text, dropping `tone`.
  - Converts heading → paragraph preserving `id` and text, dropping `eyebrow`.
  - Rejects/no-ops conversion for non-heading/non-paragraph block kinds through type-level or function contract tests.
  - Splits heading and paragraph at start/middle/end.
  - Flushes current normalized HTML before split/delete operations.
  - Preserves `<br>` soft break in normalized HTML.
  - Detects empty visible text for `""`, whitespace, `<br>`, `<div><br></div>`.
  - Generates deterministic collision-free IDs.
  - Last-block Backspace replacement creates one empty paragraph with stable ID.
- Existing `src/demo/markdownDocument.parse.test.ts` / `serialize.test.ts` or new focused tests:
  - Parse H4 and H5 headings.
  - Serialize H4 and H5 headings.
  - Parse and round-trip empty paragraph directive with `empty="true"`.
  - Parse and round-trip empty heading marker.
  - Preserve `<br>` soft break through serialize → parse.
  - Ensure unsupported H6 is not introduced by tests or fixtures.

### Required browser QA

Save evidence under `.omo/evidence/block-editor-interactions/`.

Minimum QA script/checklist:

1. Start demo: `pnpm dev --host 0.0.0.0 --port 9235`.
2. Desktop boundary `801x900`:
   - Enable Editable.
   - Hover a paragraph; screenshot `desktop-hover-handle.png` showing handle on the left.
   - Focus paragraph by keyboard/tab/click; screenshot `desktop-focus-handle.png`.
   - Open menu; screenshot `desktop-menu-near-handle-801.png`; verify menu is near handle and within viewport.
   - Select H4; verify rendered block uses H4 visual style and Markdown panel shows `####` for the same block.
   - Open menu again; verify SelectionPopover is not simultaneously visible.
3. Narrow boundary `800x900`:
   - Open the same menu; screenshot `mobile-centered-menu-800.png`; verify menu is centered, not anchored near handle.
4. Keyboard flow:
   - In a paragraph containing visible text, place caret in the middle and press Enter; record `keyboard-enter-split.md` with before/after text and assert current block contains before text, next block contains after text, and next block format matches paragraph.
   - In a heading, place caret at end and press Enter; assert next block is same heading level and empty.
   - Press Shift+Enter in a paragraph; assert no new block is created and Markdown panel preserves a `<br>` soft break.
   - Create an empty paragraph block, press Backspace; assert the block is removed and focus moves to adjacent block.
   - On a lone empty heading block, press Backspace; assert one empty paragraph remains and focus stays editable.
5. Accessibility:
   - Verify handle can receive keyboard focus.
   - Verify Escape closes menu and focus returns to handle.
   - Verify console has no errors; save `browser-console.txt`.

### Evidence paths

- `.omo/evidence/block-editor-interactions/test-output.txt`
- `.omo/evidence/block-editor-interactions/typecheck-output.txt`
- `.omo/evidence/block-editor-interactions/build-output.txt`
- `.omo/evidence/block-editor-interactions/browser-console.txt`
- `.omo/evidence/block-editor-interactions/desktop-hover-handle.png`
- `.omo/evidence/block-editor-interactions/desktop-focus-handle.png`
- `.omo/evidence/block-editor-interactions/desktop-menu-near-handle-801.png`
- `.omo/evidence/block-editor-interactions/mobile-centered-menu-800.png`
- `.omo/evidence/block-editor-interactions/keyboard-enter-split.md`

## Execution strategy

- Wave 1: Design contract and CI/test foundation. Create `DESIGN.md`; add CI test step; add failing tests for pure helpers and Markdown edge cases.
- Wave 2: Pure block editing model. Implement conversion/split/delete/ID/HTML normalization in `src/lib/blockEditing.ts` until tests pass.
- Wave 3: Markdown parser/serializer H1-H5 and empty/soft-break round-trip. Implement exact contracts and update tests.
- Wave 4: UI wiring and styles. Add `BlockActionMenu.tsx`, minimal `NoteContent.tsx` wiring, CSS, focus restoration, SelectionPopover mutual exclusion.
- Wave 5: Full verification and browser QA evidence. Run all required commands and capture artifacts.

## Todos

### Wave 1 — Design contract, CI, and failing tests

1. - [x] `DESIGN.md`: Extract existing note design tokens and interaction states before UI changes - expect a root design contract for new block handle/menu styles

   References:
   - No `DESIGN.md` currently exists.
   - `src/lib/styles.css:1-426` contains current theme variables, typography, editable states, popover layer, and responsive rules.
   - Frontend skill requires a design system contract before UI implementation.

   Implementation notes:
   - Document existing CSS custom properties, typography scale, spacing/radius/shadow, `.hn-note-editable` hover/focus, `.hn-note-popover`, breakpoint behavior, and accepted debt.
   - Add a section for planned block handle/menu tokens: use existing neutral/theme colors and popover shadows; no magic one-off colors.
   - Include accessibility constraints from this plan.

   Acceptance criteria:
   - Root `DESIGN.md` exists.
   - It names the token/state sources from `src/lib/styles.css`.
   - It explicitly covers block handle/menu states: hidden, hover, focus, open, active menu item, disabled/not applicable.

   QA:
   - Happy path: worker cites `DESIGN.md` sections before changing `src/lib/styles.css`.
   - Failure path: if `styles.css` adds block menu colors/sizes not represented in `DESIGN.md`, the todo is incomplete.

   Commit: `docs(ui): capture note design system contract`

2. - [x] `.github/workflows/ci.yml`: Add `pnpm test` to CI verification - expect parser/helper tests cannot be skipped in pull requests

   References:
   - `.github/workflows/ci.yml:30-37` currently runs lint, typecheck, build only.
   - `package.json:43` already has `"test": "vitest run"`.

   Implementation notes:
   - Insert a `Test` step with `run: pnpm test` after lint and before typecheck, unless worker has a concrete reason to place it after typecheck.
   - Do not remove existing lint/typecheck/build steps.

   Acceptance criteria:
   - CI workflow contains a `Test` step running exactly `pnpm test`.
   - Existing lint/typecheck/build steps remain.

   QA:
   - Happy path: run `pnpm test`; save output to `.omo/evidence/block-editor-interactions/test-output.txt` later in final wave.
   - Failure path: confirm CI file does not use `continue-on-error` for tests.

   Commit: `ci: run vitest in verification workflow`

3. - [x] `src/lib/blockEditing.test.ts`: Add failing tests for block conversion, split/delete, ID generation, and HTML normalization - expect red tests define the editing contract before implementation

   References:
   - `src/lib/types.ts:12-71` defines `NoteBlock` variants.
   - Exact text editing contract and ID generation contract in this plan.
   - TypeScript skill requires behavior tests for new logic.

   Implementation notes:
   - Use Vitest Given/When/Then comments or structure.
   - Test pure functions only; do not import React DOM.
   - Functions may not exist yet; initial failure because exports are missing is acceptable for red phase.

   Acceptance criteria:
   - Tests cover conversion paragraph↔heading, H1-H5 target levels, non-target block guardrails, middle/start/end split, empty detection, last block Backspace replacement, ID collision handling, and `<br>` normalization.
   - Tests are deterministic and do not depend on time/randomness.

   QA:
   - Happy path: run `pnpm test -- src/lib/blockEditing.test.ts` after implementation and expect pass.
   - Failure path: before implementation, tests must fail for missing behavior rather than syntax/import typos.

   Commit: `test(lib): define block editing behavior contract`

4. - [x] `src/demo/markdownDocument*.test.ts`: Add failing Markdown tests for H4/H5, empty paragraph, empty heading, and soft break round-trip - expect Demo serialization contract is locked before parser changes

   References:
   - `src/demo/markdownDocument.ts:60-88` current serializer.
   - `src/demo/markdownDocumentBlocks.ts:25-60` current parser loop.
   - Exact empty Markdown convention in this plan.

   Implementation notes:
   - Reuse existing test helper style from `src/demo/markdownDocument.test.helpers.ts`.
   - Add tests to existing parse/serialize test files unless splitting into a new file is clearer.

   Acceptance criteria:
   - Tests assert H4 and H5 parse/serialize.
   - Tests assert `<!-- hn:block id="x" empty="true" -->` creates an empty paragraph block and survives serialize → parse.
   - Tests assert an empty heading marker with directive survives parse → serialize → parse.
   - Tests assert `<br>` in serialized body survives parse as canonical soft break in `block.text`.

   QA:
   - Happy path: run `pnpm test -- src/demo/markdownDocument.parse.test.ts src/demo/markdownDocument.serialize.test.ts` after implementation and expect pass.
   - Failure path: tests must fail if empty paragraph directive is silently dropped.

   Commit: `test(demo): lock markdown block edge cases`

### Wave 2 — Pure block editing model

5. - [x] `src/lib/blockEditing.ts`: Implement target block conversions and deterministic ID generation - expect heading/paragraph conversions are pure and collision-free

   References:
   - `src/lib/types.ts:12-71` block union.
   - Approved product decisions and exact ID generation contract in this plan.
   - `src/lib/utils.ts:1-5` existing `assertNever` pattern if needed.

   Implementation notes:
   - Export only internal helpers needed by `NoteContent` and tests; do not export from `src/lib/index.ts` unless worker has a strong reason and records it.
   - Use exhaustive switches for supported block kinds.
   - Do not mutate the input `blocks` array or block objects.
   - Do not use `any`, non-null assertions, or random IDs.

   Acceptance criteria:
   - `convertTextBlockFormat(block, target)` handles heading/paragraph only.
   - `createNextBlockId` implements the exact deterministic base/suffix rule.
   - Existing non-target block kinds cannot be accidentally converted by generic code.

   QA:
   - Happy path: `pnpm test -- src/lib/blockEditing.test.ts` passes conversion/ID tests.
   - Failure path: adding a duplicate existing ID in tests forces suffix increment instead of collision.

   Commit: `feat(lib): add pure block format helpers`

6. - [x] `src/lib/blockEditing.ts`: Implement editable HTML normalization, visible-empty detection, split, insertion, deletion, and focus target calculation - expect keyboard behavior can be wired without stale state

   References:
   - `src/lib/NoteContent.tsx:93-149` currently stores edits on blur only.
   - Exact text editing contract and Backspace behavior in this plan.

   Implementation notes:
   - Add pure helpers such as `normalizeEditableHtml`, `isVisibleHtmlEmpty`, `splitTextBlockAtHtml`, `insertSplitBlock`, `deleteEmptyTextBlock`.
   - Keep selection/Range DOM extraction in `NoteContent` or a tiny local helper; pure functions should receive normalized strings and return new blocks/focus targets.
   - Model focus target as block ID + optional reason, not as an element reference.
   - Last-block deletion must replace with one empty paragraph using same ID when possible.

   Acceptance criteria:
   - Split returns new immutable blocks with current block beforeHtml and next block afterHtml.
   - Delete returns immutable blocks and correct focus target.
   - Empty detection treats `<br>` and wrapper-only content as empty but not `<b>x</b>`.
   - Soft break normalization preserves canonical `<br>`.

   QA:
   - Happy path: blockEditing tests pass for start/middle/end split and soft break.
   - Failure path: a test with unblurred `"abc"` flushed through helper must not insert from stale previous text.

   Commit: `feat(lib): model text block keyboard edits`

### Wave 3 — Markdown and heading-level integration

7. - [x] `src/lib/types.ts + src/lib/styles.css + src/lib/utils.ts`: Extend heading levels to H1-H5 in library types/rendering support - expect H4/H5 compile and display with deliberate styles

   References:
   - `src/lib/types.ts:12-18` heading level type.
   - `src/lib/NoteContent.tsx:115-132` dynamic heading render.
   - `src/lib/styles.css:155-165` current heading level styles.
   - `src/lib/utils.ts:16-35` reading minutes switch counts heading text without level-specific logic.

   Implementation notes:
   - Add H4/H5 to the union type.
   - Add `.hn-note-heading--4` and `.hn-note-heading--5` using `DESIGN.md` type scale decisions.
   - Confirm no exhaustive switch or helper assumes only 1/2/3.
   - Do not add H6.

   Acceptance criteria:
   - Typecheck accepts `NoteHeadingBlock` with `level: 4` and `level: 5`.
   - H4/H5 have explicit CSS styles.
   - H1-H3 visual styles are not regressed.

   QA:
   - Happy path: `pnpm typecheck` passes.
   - Failure path: grep/inspect confirms no `1 | 2 | 3` heading-level guard remains where H4/H5 are required.

   Commit: `feat(lib): support five heading levels`

  8. - [x] `src/demo/markdownDocument.ts + src/demo/markdownDocumentBlocks.ts`: Implement H1-H5, empty paragraph directive, empty heading, and soft break round-trip - expect Demo Markdown remains source-of-truth for new editor states

   References:
   - `src/demo/markdownDocument.ts:60-88` current serialization.
   - `src/demo/markdownDocumentBlocks.ts:25-60` current parse loop.
   - `src/demo/markdownDocumentBlocks.ts:223-224` current heading guard.
   - Exact empty Markdown convention in this plan.

   Implementation notes:
   - Expand `isHeadingLevel` to 1-5 only.
   - Parse `hn:block empty="true"` into empty paragraph immediately.
   - Serialize empty paragraph with standalone directive and `empty="true"`.
   - Preserve inline `<br>` in text parsing/serialization; do not attempt full inline HTML conversion beyond supported current tags/soft break unless already present.
   - Do not turn blank Markdown lines into empty paragraph blocks.

   Acceptance criteria:
   - Existing default demo document still parses and serializes.
   - H4/H5 headings round-trip.
   - Empty paragraph blocks round-trip with ID and optional tone.
   - Empty heading blocks round-trip with ID and level.
   - Soft break `<br>` survives.

   QA:
   - Happy path: `pnpm test -- src/demo/markdownDocument.parse.test.ts src/demo/markdownDocument.serialize.test.ts` passes.
   - Failure path: a document containing `<!-- hn:block id="x" empty="true" -->` must fail the test if output drops block `x`.

   Commit: `feat(demo): round-trip editable block edge cases`

### Wave 4 — UI wiring, menu, keyboard behavior, and CSS

  9. - [x] `src/lib/BlockActionMenu.tsx`: Add accessible handle/menu portal for text blocks - expect responsive menu positioning and keyboard accessibility without new dependencies

   References:
   - `src/lib/SelectionPopover.tsx:33-184` portal and Escape/scroll patterns.
   - `src/lib/styles.css:355-426` existing popover styling.
   - Accessibility and positioning contracts in this plan.

   Implementation notes:
   - Component should accept current block ID/format, handle rect, open state, callbacks, and target options.
   - Portal menu to `document.body`.
   - Use fixed positioning with `>800` near-handle and `<=800` centered behavior.
   - Close on Escape/outside pointer/scroll; restore focus per contract.
   - Use `type="button"` for all buttons.

   Acceptance criteria:
   - Handle button has `aria-haspopup`, `aria-expanded`, and accessible label.
   - Menu has accessible menu/menuitem semantics or equivalent button semantics with clear labels.
   - Current format is visibly and programmatically indicated.
   - No Popper/floating-ui dependency added.

   QA:
   - Happy path: browser QA screenshots show desktop near-handle and 800px centered menu.
   - Failure path: with menu open, Escape closes it and returns focus to handle.

   Commit: `feat(lib): add block action menu component`

10. - [x] `src/lib/NoteContent.tsx`: Wire block menu and keyboard behavior only for heading/paragraph editable elements - expect no behavior leaks to other editables

   References:
   - `src/lib/NoteContent.tsx:93-102` current shared `editableProps`.
   - `src/lib/NoteContent.tsx:115-149` heading/paragraph render paths.
   - `src/lib/NoteContent.tsx:191-290` checklist/quote/code/callout editables that must not receive block line behavior.
   - Metis MUST_FIX guardrail: do not add handlers to generic `editableProps` for every field.

   Implementation notes:
   - Keep `editableProps` generic for old blur behavior, but add a separate path/options only for heading/paragraph body editables.
   - Add refs keyed by block ID for focus restoration.
   - On keydown before block mutation, read `event.currentTarget.innerHTML`, normalize, and flush into the current block.
   - Range/caret extraction should split current DOM content at caret for Enter.
   - Suppress `SelectionPopover` while block menu is open, e.g. pass `editable={editable && openBlockMenuId === null}`.
   - Keep public `NoteContentProps` unchanged.

   Acceptance criteria:
   - Heading/paragraph blocks show handle on hover/focus in editable mode.
   - Non-editable mode shows no handle/menu.
   - title/summary/checklist/quote/callout/code do not show the block handle and do not split/delete blocks on Enter/Backspace.
   - Enter/Shift+Enter/Backspace behavior matches exact contract.
   - Focus restoration works after conversion, split, delete, and menu close.

   QA:
   - Happy path: browser QA executes all keyboard-flow checks and saves evidence.
   - Failure path: pressing Enter in checklist item or code block must not create a new `NoteBlock`; record this check in QA notes.

   Commit: `feat(lib): wire text block editing interactions`

11. - [x] `src/lib/styles.css`: Style H4/H5, block rows, handle, and menu states from `DESIGN.md` - expect polished UI consistent with existing note surface

   References:
   - `DESIGN.md` created in Wave 1.
   - `src/lib/styles.css:1-426` existing style system.
   - Positioning and accessibility contracts in this plan.

   Implementation notes:
   - Use `.hn-note-block-row`, `.hn-note-block-handle`, `.hn-note-block-menu`, `.hn-note-block-menu-btn` or similarly prefixed names.
   - Keep handle inside safe visual gutter so shell overflow does not clip it.
   - Use transform/opacity for any transition; do not animate layout properties.
   - Respect reduced motion if transitions are added.
   - Add focus-visible treatment at least as clear as existing editable focus.

   Acceptance criteria:
   - H4/H5 look intentional and hierarchy is distinguishable.
   - Handle appears only on row hover/focus/open states.
   - Menu active/hover/focus states are visible.
   - 801px and 800px screenshots satisfy positioning contract.

   QA:
   - Happy path: visual QA screenshots saved in evidence folder.
   - Failure path: if handle is clipped by shell overflow at 801px, styling is incomplete.

   Commit: `style(lib): add text block menu presentation`

### Wave 5 — Verification and evidence

12. - [x] `.omo/evidence/block-editor-interactions/*`: Run full automated and browser verification - expect evidence proves feature, scope, and no regressions

   References:
   - Required automated checks, browser QA, and evidence paths in this plan.
   - `package.json:32-43` available scripts.

   Implementation notes:
   - Run commands from repo root.
   - Save command outputs to evidence files; do not rely on summarized claims only.
   - Use real browser for QA; do not replace with static grep.

   Acceptance criteria:
   - `pnpm test` passes and output is saved.
   - `pnpm typecheck` passes and output is saved.
   - `pnpm build` passes and output is saved.
   - Browser QA evidence files listed in Verification strategy exist.
   - Browser console evidence contains no errors.

   QA:
   - Happy path: final evidence folder contains command logs, screenshots, and keyboard flow notes.
   - Failure path: if any required QA step cannot be automated, worker must record exact blocker and stop for user decision instead of declaring done.

   Commit: `test: verify block editor interactions`

## Final verification wave

After all todos are complete, run these checks as the worker's final gate. All must pass before claiming done.

1. **Plan compliance audit**
   - Compare implementation against this plan's Scope and Must-NOT-Have.
   - Confirm no block handle/menu or Enter/Backspace line behavior was added to title, summary, checklist, quote, callout, or code.
   - Confirm no H6 support was added.
   - Confirm `NoteContentProps` did not gain new callbacks.

2. **Code quality audit**
   - Confirm `NoteContent.tsx` contains only wiring; pure operations live in `blockEditing.ts` and menu UI in `BlockActionMenu.tsx`.
   - Confirm no `any`, `as any`, non-null assertion, random ID generation, or broad swallowed catch was introduced.
   - Confirm switches over `NoteBlock.kind` remain exhaustive where applicable.
   - Confirm changed files are not bloated unnecessarily; if `NoteContent.tsx` grows materially, record why and consider extracting more wiring.

3. **Automated checks**
   - `pnpm test`
   - `pnpm typecheck`
   - `pnpm build`
   - Optional: `pnpm lint`

4. **Browser QA audit**
   - Verify all required evidence files exist.
   - Verify screenshots demonstrate both breakpoint modes.
   - Verify keyboard-flow notes cover Enter split, Shift+Enter soft break, empty Backspace delete, and lone empty heading → paragraph replacement.
   - Verify browser console has no errors.

## Commit strategy

Use small commits matching the todo waves where possible:

1. `docs(ui): capture note design system contract`
2. `ci: run vitest in verification workflow`
3. `test(lib): define block editing behavior contract`
4. `test(demo): lock markdown block edge cases`
5. `feat(lib): add pure block format helpers`
6. `feat(lib): model text block keyboard edits`
7. `feat(lib): support five heading levels`
8. `feat(demo): round-trip editable block edge cases`
9. `feat(lib): add block action menu component`
10. `feat(lib): wire text block editing interactions`
11. `style(lib): add text block menu presentation`
12. `test: verify block editor interactions`

If the worker uses a single final commit instead, the commit message should mention: block editor interactions, H1-H5, Markdown empty block round-trip, and CI tests.

## Success criteria

- Editable heading/paragraph blocks expose a left-side operation handle on hover/focus.
- Menu converts the current simple text block to H1/H2/H3/H4/H5/正文 with correct preserved/dropped fields.
- Desktop `>800px` menu anchors near the handle; `<=800px` menu is centered.
- Enter splits current heading/paragraph at caret into a same-format next block and preserves unblurred edits.
- Shift+Enter inserts a soft line break inside the current block without creating a new block.
- Backspace on an empty heading/paragraph deletes that line; lone empty heading becomes one empty paragraph.
- Title, summary, checklist, quote, callout, and code do not receive this block-level behavior.
- H4/H5 are supported across public type, rendering styles, parser, serializer, and tests.
- Empty paragraph blocks round-trip through Demo Markdown using the exact `empty="true"` directive convention.
- `pnpm test` runs in CI.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- Browser QA evidence exists under `.omo/evidence/block-editor-interactions/` and demonstrates required desktop/mobile and keyboard states.
