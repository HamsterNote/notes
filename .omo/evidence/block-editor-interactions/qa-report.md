# Wave 5 QA Report — block-editor-interactions

**Date:** 2026-07-12  
**Status:** ✅ ALL CHECKS PASSED  
**Automated checks:** 7/7 passed  
**Browser checks:** 11/11 passed  
**Console errors:** 0

---

## 1. Automated Checks

| Command | Exit Code | Status |
|---------|-----------|--------|
| `biome check .` | 0 | ✅ PASS |
| `pnpm exec prettier --check .` | 0 | ✅ PASS |
| `pnpm lint` | 0 | ✅ PASS |
| `pnpm typecheck` | 0 | ✅ PASS |
| `pnpm test` (31 tests) | 0 | ✅ PASS |
| `pnpm build` | 0 | ✅ PASS |
| `pnpm build:demo` | 0 | ✅ PASS |

### Infrastructure fixes applied (non-product-source)

- **`biome.json`**: Added `vcs.useIgnoreFile: true` and `files.includes: ["**", "!.omo", "!dist"]` so Biome skips `dist/` (build artifacts) and `.omo/` (scratch data). Previously Biome v2 defaulted `useIgnoreFile` to `false`, causing it to scan minified `dist/` output.
- **`.prettierignore`** (new file): Excludes `dist/`, `.omo/`, `pnpm-lock.yaml`, `*.tsbuildinfo` from Prettier checks.
- **`vite.demo.config.ts`**: Fixed import ordering (node: builtins before third-party) per Biome `assist/source/organizeImports`.
- **Formatting normalization**: Ran `prettier --write` on source files with pre-existing formatting drift (`app.css`, `SelectionPopover.tsx`, `utils.ts`, `blockEditing.test.ts`, etc.). No behavioral changes.

---

## 2. Browser QA Checks

All 11 checks executed against `pnpm dev` (Vite dev server, port 9235) using headless Chromium via Python Playwright.

### Check 01 — Demo loads with no console errors ✅

- **Screenshot:** `01_default_desktop.png`
- **Details:** Page title "@hamster-note/notes", 10 blocks loaded.
- **Console errors:** None.

### Check 02 — Hover/focus reveals block handle ✅

- **Screenshot:** `02_hover_handle.png`
- **Details:** After enabling editable mode, hovering the first heading block row sets the handle button's `opacity` from `0` to `1`, making it visible.

### Check 03 — Menu open/close with Escape ✅

- **Screenshot:** `03_menu_open.png`
- **Details:** Clicking the handle opens a `role="menu"` portal with 6 items (H1–H5 + 正文). Pressing Escape closes the menu and returns focus to the handle button (`<BUTTON class="hn-note-block-handle">`).

### Check 04 — Format conversion (H1↔H2↔正文) ✅

- **Details:**
  - H1 → H2: heading tag changes from `<h1>` to `<h2>`, class becomes `hn-note-heading--2`, Markdown panel shows `##`.
  - H2 → H1: reverts correctly.
  - H1 → 正文: hero block changes from `.hn-note-block--heading` to `.hn-note-paragraph`, confirmed via `closest()` DOM traversal.

### Check 05 — Enter splits paragraph ✅

- **Screenshot:** `05_after_enter_split.png`
- **Details:** Caret placed at offset 94 in the `intro` paragraph (188 chars). After Enter, block count increased from 10 to 11. New block `intro-line` created with the after-caret text ("hy, callouts, checklists, and code snippets for pr...").

### Check 06 — Shift+Enter inserts `<br>` soft break ✅

- **Screenshot:** `06_after_shift_enter.png`
- **Details:** Block count unchanged (10→10). Block innerHTML contains `<br>`. After triggering `onBlur` (clicking elsewhere), Markdown panel reflects `<br>`.

### Check 07 — Backspace deletes empty block ✅

- **Screenshot:** `07_after_backspace_delete.png`
- **Details:** Emptied the `subheading` (h2) block via Ctrl+A+Delete. Backspace reduced block count from 10 to 9. The `subheading` block was removed. Focus moved to the `intro` block (nearest previous text block).

### Check 08 — Last block protection ✅

- **Screenshot:** `08_last_block_protection.png`
- **Details:** Set document to a single paragraph block (via React fiber API). Emptied it via Ctrl+A+Delete. Pressed Backspace. Block count remained 1. Block ID `solo` unchanged. Block type confirmed as `hn-note-paragraph hn-note-paragraph--default`.

### Check 09 — Boundary >800px / ≤800px ✅

- **Screenshot:** `04_800px_viewport.png`
- **Details:**
  - **801px width:** Menu `transform: none`, `left: 73px` (positioned at handle's right edge + 8px gap). Not centered.
  - **799px width:** Menu `transform: matrix(1, 0, 0, 1, -80, 0)` (translateX(-50%)), `left: 399.5px` (50% of 799). Centered.

### Check 10 — No behavior leaks in non-text blocks ✅

- **Details:** Pressed Enter inside checklist item, quote body, code block, and callout body. Block count remained 10 after each. No new `NoteBlock` was created.

### Check 11 — Responsive 390×844 ✅

- **Details:** At 390×844 viewport, handle bounding box `{x:21, y:378.9, w:24, h:24}` is within viewport. Menu bounding box `{x:115, y:410.9, w:160, h:207.8}` is also within viewport. No clipping.

---

## 3. Evidence Artifacts

| File | Description |
|------|-------------|
| `01_default_desktop.png` | Initial demo load at 1280×900 |
| `02_hover_handle.png` | Handle visible after hovering heading block |
| `03_menu_open.png` | Format menu open via portal |
| `04_800px_viewport.png` | Menu at 799px width (centered mode) |
| `05_after_enter_split.png` | After Enter split on intro paragraph |
| `06_after_shift_enter.png` | After Shift+Enter soft break in ending paragraph |
| `07_after_backspace_delete.png` | After Backspace deleted subheading block |
| `08_last_block_protection.png` | Last block protection: single empty paragraph persists |
| `qa-report.json` | Machine-readable results |
| `qa-report.md` | This file |
| `qa_script.py` | Playwright QA script |

---

## 4. Summary

All Wave 5 verification checks pass. The block editor interactions implemented in Waves 1–4.3 are fully functional:
- Block handle visibility, menu open/close, and format conversion work correctly.
- Enter split, Shift+Enter soft break, and Backspace delete behave as specified.
- Last block protection prevents the document from becoming empty.
- The 800px responsive breakpoint correctly switches menu positioning.
- Non-text blocks (checklist, quote, code, callout) do not leak NoteBlock creation on Enter.
- Mobile viewport (390×844) shows handle and menu without clipping.
