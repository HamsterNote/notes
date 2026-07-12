# markdown-demo-data Learnings

## Project conventions
- React 19 + Vite + TypeScript 6 beta strict mode
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` enabled
- No `any`, no non-null assertions, type-only imports with `import type`
- Demo dev server: `vite --config vite.demo.config.ts --host 0.0.0.0 --port 9235`
- NoteBlock variants: heading, paragraph, checklist, quote, code, callout
- NoteContent editable callbacks: onTitleChange, onSummaryChange, onBlocksChange

## Wave 1 task 2 data migration
- `src/demo/noteData.ts` now exports `demoMarkdownDocument: string`; old 10 `demoBlocks` entries are encoded as 9 `hn:block` directives plus 1 `hn:checklist` directive.
- Encoded checklist items: 3 `hn:item` directives (`library`, `demo`, `publish`).
- Exported runtime string length: 2303 characters.
- Exported runtime string SHA-256: `6a18b0fda01f7b73d660c7205862fb521446ba60feb7b30202c419905a03ba59`.

## Wave 1 - Dependency Additions (2026-07-12)
- `unified` **11.0.5** — Markdown 处理管道框架
- `remark-parse` **11.0.0** — Markdown 解析器 (unified 插件)
- `remark-stringify` **11.0.0** — Markdown 序列化器 (unified 插件)
- `remark-gfm` **4.0.1** — GFM 扩展支持 (表格、删除线、任务列表等)
- `vitest` **4.1.10** (devDep) — 测试运行器，通过 `pnpm test` (即 `vitest run`) 执行
- `package.json` 新增 `"test": "vitest run"` 脚本
- 未添加 `@types/mdast` / `@types/unist`，待 TypeScript 编译验证后再决定是否需要

## Wave 2 task 3 parser implementation (2026-07-12)
- `src/demo/markdownDocument.ts` exports `DemoMarkdownParseError`, `DemoMarkdownDocument`, and `parseMarkdownDocument`; serializer intentionally not implemented.
- Parser uses `unified().use(remarkParse).use(remarkGfm).parse(body)` and mdast node walking for heading/paragraph/blockquote/list/code.
- Internal helpers are split into `src/demo/markdownDocumentBlocks.ts` and `src/demo/markdownDocumentDirectives.ts` to keep each touched TypeScript file below the 250 pure-LOC ceiling.
- TypeScript required explicit mdast package types, so `@types/mdast@4.0.4` and `@types/unist@3.0.3` were added to devDependencies.
- Runtime parser smoke check with Vite SSR confirmed `parseMarkdownDocument(demoMarkdownDocument)` returns metadata plus 10 blocks in order: hero, intro, principle, subheading, checklist, callout, code-heading, code, ending, warning.
- Full `pnpm typecheck` is still blocked by out-of-scope current `src/demo/App.tsx` importing removed `demoBlocks` from `./noteData`; parser files pass targeted strict TypeScript check.

## Wave 2 task 4 serializer implementation (2026-07-12)
- `src/demo/markdownDocument.ts` now also exports `serializeMarkdownDocument(document)`; parser logic and parser helper files were left unchanged.
- Serializer pretty-prints metadata as the first `json` fenced block with two-space indentation and preserves `updatedAt` exactly from the document object.
- Serializer emits the same `hn:block`, `hn:checklist`, and `hn:item` HTML comment directive contract as the parser consumes, including heading `eyebrow`, paragraph non-default `tone`, checklist title/item IDs, quote author line, code filename, and callout tone/title/text.
- Implementation uses `unified().use(remarkGfm).use(remarkStringify)` for deterministic root/stringify output while keeping each complete block as raw markdown so directive and target block stay adjacent with no extra blank line.
- Runtime round-trip smoke check with Vite SSR confirmed `serializeMarkdownDocument(parseMarkdownDocument(demoMarkdownDocument))` parses back to equivalent metadata and all 10 block IDs/kinds/fields.

## Wave 2 task 5 parser/serializer tests (2026-07-12)
- Added `src/demo/markdownDocument.test.ts` with 7 Vitest tests covering metadata parsing, representative default block fields, quote author extraction, parse → serialize → parse equivalence, metadata-only edits, checklist edit round-trip behavior, and parser error codes.
- Default fixture currently parses to 10 blocks in order: `hero`, `intro`, `principle`, `subheading`, `checklist`, `callout`, `code-heading`, `code`, `ending`, `warning`; `principle` is a quote and `ending` is a muted paragraph.
- Default checklist fixture has 3 checked items and no unchecked item, so tests lock the actual fixture state and the edit round-trip test toggles the first item to prove unchecked serialization/parsing behavior.
- `lsp_diagnostics src/demo/markdownDocument.test.ts` passed with no diagnostics after Biome organized imports.
- Targeted strict TypeScript check passed for `src/demo/markdownDocument.test.ts`, `src/demo/markdownDocument.ts`, parser helper files, `src/demo/noteData.ts`, and `src/lib/types.ts` using `tsc --ignoreConfig --noEmit ...`.
- `pnpm test` passed: Vitest ran 1 test file and 7 tests successfully.

## Wave 3 task 6 App initialization from parsed document (2026-07-12)
- `src/demo/App.tsx` no longer imports `demoBlocks`; now imports `demoMarkdownDocument` from `./noteData` and `parseMarkdownDocument` + type `DemoMarkdownDocument` from `./markdownDocument`.
- Module-level `const initialDocument = parseMarkdownDocument(demoMarkdownDocument)` parses once at load time.
- Dual state pattern set up for Wave 3.2: `document` (DemoMarkdownDocument) + `markdownDocument` (raw string) as primary states, with `title`/`summary`/`tagLabel`/`blocks` derived from `document` for current independent edit handlers.
- `updatedAt={document.updatedAt}` replaces hardcoded `"2026-07-11"`.
- `setDocument` and `setMarkdownDocument` are intentionally unused until Wave 3.2 wires edit handlers; `noUnusedLocals` is not enabled so this passes typecheck.
- Full `pnpm exec tsc --noEmit --project tsconfig.app.json` passes with zero errors for the entire project.
- LSP diagnostics on App.tsx: clean (0 errors).

## Wave 3 task 7 edit-handler wiring (2026-07-12)
- `src/demo/App.tsx` now imports `serializeMarkdownDocument` alongside `parseMarkdownDocument` and `useCallback` from React.
- Removed independent `title`/`summary`/`tagLabel`/`blocks` useState; these are now plain `const` derived directly from `document` at render time. `blocks` is spread into `[...document.blocks]` to produce a mutable `NoteBlock[]` copy for NoteContent.
- Added `updateDocument` useCallback: calls `setDocument` with an updater function, then inside that updater calls `setMarkdownDocument(serializeMarkdownDocument(next))` so both states stay in sync from the same `next` value, avoiding stale closures.
- All four edit entry points wired through `updateDocument`: sidebar title input, sidebar tag input, NoteContent `onTitleChange`, `onSummaryChange`, `onBlocksChange`. Each spreads `current` and replaces only the edited field, so `updatedAt` is never touched.
- `themeColor` and `editable` handlers remain independent `useState` and do NOT route through `updateDocument`, so changing them leaves `markdownDocument` unchanged.
- `markdownDocument` state value is deliberately unused in the render output (Wave 4 adds the sidebar panel). Used `const [, setMarkdownDocument] = useState(...)` to avoid ESLint `no-unused-vars` error; Wave 4 will restore the binding to `const [markdownDocument, setMarkdownDocument]`.
- `pnpm typecheck` passes with zero errors. `pnpm exec eslint src/demo/App.tsx` passes with zero errors. (Pre-existing `no-unsafe-assignment` errors in `markdownDocument.test.ts` are out of scope.)
- Formatting gotcha: running `biome check --write` reformats the entire file to tabs + semicolons, conflicting with the project's `.prettierrc.json` (`semi: false`, `singleQuote: false`, `trailingComma: "none"`). Always run `prettier --write` after any Biome LSP auto-fix to restore project formatting.

## Wave 4 task 8 sidebar markdown panel (2026-07-12)
- `const [, setMarkdownDocument]` restored to `const [markdownDocument, setMarkdownDocument]` — value now rendered in sidebar bottom panel.
- Panel placed after Tag Label `<section>` inside `<aside className="demo-sidebar">`; uses classes `demo-control-group demo-markdown-panel` with `<h3 className="demo-control-label">` heading + `<pre className="demo-markdown-document"><code>{markdownDocument}</code></pre>`.
- ESLint `jsx-a11y/no-noninteractive-tabindex` blocks `tabIndex={0}` on `<pre>`; `jsx-a11y/no-redundant-roles` blocks explicit `role="region"` on `<section>`. Solution: drop tabIndex from `<pre>` entirely, add `aria-label="Markdown document data"` to `<section>` so it becomes an implicit named landmark region — screen readers announce it without needing keyboard focus on the pre.
- CSS: `.demo-markdown-panel { margin-top: auto; min-height: 0; }` pushes panel to sidebar bottom and allows flex shrink. `.demo-markdown-document` uses `font-size: 0.75rem`, `white-space: pre`, `overflow: auto`, `max-height: 320px` (desktop) / `240px` (≤840px) — long lines scroll horizontally, content scrolls vertically.
- `pnpm typecheck` passes with zero errors. `pnpm exec eslint src/demo/App.tsx` passes with zero errors.
