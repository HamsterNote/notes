# Final Wave F2 — Code Quality Audit

Timestamp: `2026-07-12T21:29:19+08:00`

Verdict: **APPROVE**

## Scope Read

Required files read in full:

- `src/lib/NoteContent.tsx`
- `src/lib/BlockActionMenu.tsx`
- `src/lib/blockEditing.ts`
- `src/lib/blockEditing.test.ts`

New/refactored internal helpers read in full:

- `src/lib/NoteContentBlocks.tsx`
- `src/lib/NoteContentEditing.ts`
- `src/lib/NoteParagraphBlock.tsx`
- `src/lib/NoteSecondaryBlocks.tsx`
- `src/lib/NoteTextBlockLayouts.tsx`
- `src/lib/NoteTextBlocks.ts`
- `src/lib/useBlockEditing.ts`

Additional related changed library files read in full:

- `src/lib/SelectionPopover.tsx`
- `src/lib/types.ts`
- `src/lib/utils.ts`

## Architecture Quality

- **PASS — pure operations are isolated in `blockEditing.ts`.** Deterministic format conversion, editable HTML normalization, split, insert, delete, and next-ID selection live in `src/lib/blockEditing.ts`. UI wiring calls these helpers from `src/lib/NoteTextBlocks.ts`; `NoteContent.tsx` does not own the block editing algorithms.
- **PASS — menu UI is isolated in `BlockActionMenu.tsx`.** Handle/menu rendering, portal placement, positioning, item state, keyboard navigation, outside/Escape/scroll/resize close behavior, and menu selection UI live in `src/lib/BlockActionMenu.tsx`.
- **PASS — `NoteContent.tsx` is wiring-only and under the limit.** Current `NoteContent.tsx` is 110 pure LOC. It computes shell metadata, wires `useBlockEditing`, delegates per-block rendering to `renderBlock`, and disables `SelectionPopover` while a block menu is open.

## Strict TypeScript Anti-Pattern Scan

- **PASS.** Search over `src/lib/**/*.{ts,tsx}` found no `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, non-null assertions, random/time/crypto ID sources, or broad swallowed catches.
- Note: `SelectionPopover.tsx` has `catch { document.execCommand("copy") }` for clipboard fallback. This is not swallowed; it performs an explicit fallback action and then closes the popover.
- Existing type assertions are not `as any`: `as CSSProperties`, `as Node | null`, and `as const` are present where used for DOM/CSS typing.

## Deterministic ID Generation

- **PASS.** `createNextBlockId(blocks, sourceId)` uses only `sourceId` plus the current block ID set.
- The generated sequence is `${sourceId}-line`, then `${sourceId}-line-2`, `${sourceId}-line-3`, etc. until the first free ID.
- No `Math.random`, `Date.now`, `crypto`, `randomUUID`, or array index source is used for IDs in the audited block-editor code.

## Exhaustiveness

- **PASS.** Exhaustive closed-union switches use `assertNever`:
  - `src/lib/NoteContentBlocks.tsx::renderBlock` handles all `NoteBlock.kind` variants and defaults to `assertNever(block)`.
  - `src/lib/utils.ts::getReadingMinutes` handles all `NoteBlock.kind` variants and defaults to `assertNever(block)`.
  - `src/lib/blockEditing.ts::convertTextBlockFormat`, `toStoredTextBlock`, and `toPlainStoredTextBlock` use `assertNever` for their closed text-block/target unions.
- Selective text-block operations in `blockEditing.ts` intentionally pass through non-text blocks unchanged when applying split/delete behavior to a whole `NoteBlock[]`.

## Pure LOC Counts

Command used:

```bash
for f in "src/lib/NoteContent.tsx" "src/lib/BlockActionMenu.tsx" "src/lib/blockEditing.ts" "src/lib/blockEditing.test.ts" "src/lib/NoteContentBlocks.tsx" "src/lib/NoteContentEditing.ts" "src/lib/NoteParagraphBlock.tsx" "src/lib/NoteSecondaryBlocks.tsx" "src/lib/NoteTextBlockLayouts.tsx" "src/lib/NoteTextBlocks.ts" "src/lib/useBlockEditing.ts" "src/lib/SelectionPopover.tsx" "src/lib/types.ts" "src/lib/utils.ts"; do n=$(python3 -c 'import sys, pathlib; p=pathlib.Path(sys.argv[1]); print(sum(1 for line in p.read_text().splitlines() if line.strip() and not line.lstrip().startswith(("//", "/*", "*", "*/"))))' "$f"); printf '%s %s\n' "$n" "$f"; done
```

Results:

- `src/lib/NoteContent.tsx`: 110 pure LOC — PASS.
- `src/lib/BlockActionMenu.tsx`: 221 pure LOC — PASS.
- `src/lib/blockEditing.ts`: 194 pure LOC — PASS.
- `src/lib/blockEditing.test.ts`: 211 pure LOC — PASS.
- `src/lib/NoteContentBlocks.tsx`: 33 pure LOC — PASS.
- `src/lib/NoteContentEditing.ts`: 100 pure LOC — PASS.
- `src/lib/NoteParagraphBlock.tsx`: 28 pure LOC — PASS.
- `src/lib/NoteSecondaryBlocks.tsx`: 202 pure LOC — PASS.
- `src/lib/NoteTextBlockLayouts.tsx`: 88 pure LOC — PASS.
- `src/lib/NoteTextBlocks.ts`: 132 pure LOC — PASS.
- `src/lib/useBlockEditing.ts`: 44 pure LOC — PASS.
- `src/lib/SelectionPopover.tsx`: 162 pure LOC — PASS.
- `src/lib/types.ts`: 73 pure LOC — PASS.
- `src/lib/utils.ts`: 81 pure LOC — PASS.

Every audited changed TS/TSX source/test/helper file is <=250 pure LOC.

## LSP Diagnostics

`lsp_diagnostics` was run on each audited TS/TSX file:

- `src/lib/NoteContent.tsx` — no diagnostics.
- `src/lib/BlockActionMenu.tsx` — no diagnostics.
- `src/lib/blockEditing.ts` — no diagnostics.
- `src/lib/blockEditing.test.ts` — no diagnostics.
- `src/lib/NoteContentBlocks.tsx` — no diagnostics.
- `src/lib/NoteContentEditing.ts` — no diagnostics.
- `src/lib/NoteParagraphBlock.tsx` — no diagnostics.
- `src/lib/NoteSecondaryBlocks.tsx` — no diagnostics.
- `src/lib/NoteTextBlockLayouts.tsx` — no diagnostics.
- `src/lib/NoteTextBlocks.ts` — no diagnostics.
- `src/lib/useBlockEditing.ts` — no diagnostics.
- `src/lib/SelectionPopover.tsx` — no diagnostics.
- `src/lib/types.ts` — no diagnostics.
- `src/lib/utils.ts` — no diagnostics.

## Prettier

Command run from repo root:

```bash
pnpm exec prettier --check "src/lib/NoteContent.tsx" "src/lib/BlockActionMenu.tsx" "src/lib/blockEditing.ts" "src/lib/blockEditing.test.ts" "src/lib/NoteContentBlocks.tsx" "src/lib/NoteContentEditing.ts" "src/lib/NoteParagraphBlock.tsx" "src/lib/NoteSecondaryBlocks.tsx" "src/lib/NoteTextBlockLayouts.tsx" "src/lib/NoteTextBlocks.ts" "src/lib/useBlockEditing.ts" "src/lib/SelectionPopover.tsx" "src/lib/types.ts" "src/lib/utils.ts"
```

Output:

```text
Checking formatting...
All matched files use Prettier code style!
```

Prettier verdict: **PASS**.

## Final Verdict

**APPROVE** — the previous `NoteContent.tsx` LOC blocker is resolved, block-editor logic is factored into helpers, strict TypeScript/code-quality checks are clean, deterministic IDs are preserved, relevant switches are exhaustive with `assertNever`, LSP diagnostics are clean, and Prettier passes on audited changed source files.
