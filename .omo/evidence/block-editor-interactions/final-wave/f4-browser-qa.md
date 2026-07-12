# Final Wave F4: Browser QA Audit

**Timestamp:** 2026-07-12T21:50:00+08:00
**Auditor:** Sisyphus-Junior (automated)
**Verdict:** APPROVE

---

## Summary

Re-audited all browser QA evidence for the `block-editor-interactions` feature and optionally re-ran the full QA script (`qa_script.py`). All 11 browser checks pass, 0 console errors, all 8 required screenshots exist and are non-empty, and the Enter split observation is documented. No product source files were modified.

## Evidence Files Verified

| File | Status |
|---|---|
| `qa-report.json` | 11/11 checks `passed: true`, `all_passed: true`, `console_errors: []` |
| `qa-report.md` | "Result: 11/11 checks passed", "Verdict: APPROVE" |
| `browser-console.txt` | 21 messages (all `[debug]`/`[info]`), 0 `[error]`/`[pageerror]` |
| `keyboard-enter-split.md` | Documents Enter split: block count 10->11, new block `intro-line`, text split at offset 94 |
| `qa_script.py` | 921-line Playwright script managing `pnpm dev`, 11 checks, screenshot/console capture |

## Required Screenshots (8/8 present, all non-empty)

| Screenshot | Size | Check | Evidence |
|---|---|---|---|
| `desktop-hover-handle.png` | 240 KB | 02 PASS | Handle opacity: 1 after hover on heading block row |
| `desktop-focus-handle.png` | 240 KB | 03 PASS | Handle opacity: 1 via keyboard focus; focused element: `<BUTTON class=hn-note-block-handle>` |
| `desktop-menu-near-handle-801.png` | 119 KB | 04 PASS | 801px: menu `position: fixed`, `left: 73px` (handle right 41+24+8=73), `transform: none` (not centered), anchored right of handle |
| `mobile-centered-menu-800.png` | 136 KB | 05 PASS | 800px: menu `transform: matrix(1,0,0,1,-80,0)` (translateX(-50%)), `left: 400px` (50% of 800), center = 400px = viewport center |
| `enter-split.png` | 225 KB | 06 PASS | Block count 10->11; new block `intro-line` created with second half of text |
| `shift-enter-soft-break.png` | 242 KB | 07 PASS | Block count unchanged 10->10; HTML contains `<br>`; Markdown panel contains `<br>` |
| `backspace-delete.png` | 150 KB | 08 PASS | Block count 10->9; `subheading` deleted; focus moved to `intro` |
| `last-block-protection.png` | 146 KB | 09 PASS | Block count stays 1; solo block still exists; class = `hn-note-paragraph hn-note-paragraph--default`; type = paragraph |

## Required Behavioral Checks

### Desktop handle hover/focus visibility
- **Check 02 (hover):** `.hn-note-block-row` hovered -> computed `opacity: 1` on `.hn-note-block-handle`. Screenshot captured at 1280x720.
- **Check 03 (focus):** `handle.focus()` -> computed `opacity: 1`; `document.activeElement` is the handle `<button>` with class `hn-note-block-handle`. Screenshot captured at 1280x720.

### 801px viewport menu anchored near handle
- **Check 04:** Viewport 801x720. Handle box `{x:41, y:317, w:24, h:24}`. Menu box `{x:73, y:317, w:160, h:207.8}`. Menu style: `position: fixed`, `left: 73px`, `transform: none`, `top: 317px`. Menu is NOT centered (transform=none) and IS anchored near handle (menu x=73 >= handle right edge 65 - 5 = 60).

### 800px viewport menu centered
- **Check 05:** Viewport 800x720. Menu box `{x:320, y:349, w:160, h:207.8}`. Menu style: `position: fixed`, `left: 400px`, `transform: matrix(1,0,0,1,-80,0)` (= translateX(-50%)), `top: 349px`. Menu center = 320 + 80 = 400 = 50% of 800. Centered: True.

### Enter split creates a new block
- **Check 06:** Focused `intro` paragraph, caret at offset 94 (midpoint of 188 chars). Pressed Enter. Block count 10 -> 11. New block `intro-line` exists with text `"hy, callouts, checklists, and code snippets for pr..."`. Focus moved to new block via `requestFocus`.
- **`keyboard-enter-split.md`:** Full observation documented - setup, mechanism (`splitTextBlockAtHtml` from `blockEditing.ts`), before/after text, block count delta, screenshot reference.

### Shift+Enter inserts a soft break
- **Check 07:** Focused `ending` paragraph, pressed Shift+Enter. Block count unchanged (10 -> 10). Block innerHTML contains `<br>`. After blur sync, Markdown panel contains `<br>`.

### Backspace deletes an empty block
- **Check 08:** Emptied `subheading` (H2) block, pressed Backspace at offset 0. Block count 10 -> 9. `subheading` block removed. Focus moved to `intro` block.

### Last block protection (lone empty heading -> empty paragraph)
- **Check 09:** Set document to single `solo` heading block (H2, text="placeholder"). Emptied content, pressed Backspace. Block count stays 1. `solo` block still exists. Container class = `hn-note-paragraph hn-note-paragraph--default`. Block type = paragraph (not heading).

## Console Log Analysis

`browser-console.txt` contains 21 lines, all classified as `[debug]` or `[info]`:
- 14 `[debug]` lines: Vite HMR connection messages (`[vite] connecting...` / `[vite] connected.`)
- 7 `[info]` lines: React DevTools download promotion

**Zero `[error]` or `[pageerror]` entries.** Grep for `\[error\]|\[pageerror\]` returns 0 matches.

## QA Report Consistency

### `qa-report.json`
- `all_passed: true`
- `console_errors: []`
- `console_messages_captured: 21`
- All 11 `browser_checks` entries have `passed: true`
- `automated_checks`: all 4 commands (`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm build:demo`) = `true`

### `qa-report.md`
- "Result: 11/11 checks passed"
- "Verdict: APPROVE"
- All 11 checks listed as `[PASS]`
- Automated checks table: 4 commands, all exit code 0

## Optional QA Script Re-run

Re-ran `python3 qa_script.py` from the evidence directory. The script:
1. Started `pnpm dev` on port 9235.
2. Executed all 11 browser checks in headless Chromium.
3. Captured screenshots and console logs.
4. Shut down the dev server.

**Result: 11/11 checks PASS, 0 console errors, VERDICT: APPROVE.**

```
[PASS] 01 Demo 加载无控制台错误
[PASS] 02 悬停 heading 块显示左侧 handle
[PASS] 03 键盘聚焦 handle 显示
[PASS] 04 801px 视口菜单贴近 handle
[PASS] 05 800px 视口菜单水平居中
[PASS] 06 段落中间 Enter 拆分为两块
[PASS] 07 Shift+Enter 插入 <br> 软换行
[PASS] 08 空块 Backspace 删除并移动焦点
[PASS] 09 唯一空块 Backspace 重置为空段落
[PASS] 10 checklist/quote/code/callout Enter 不创建新块
[PASS] 11 全程无控制台错误
```

## Cross-Wave Status

| Wave | Verdict | Evidence |
|---|---|---|
| F1 (Compliance) | REJECT (evidence only) | `f1-compliance.md` - product compliance now passes; F1 is being re-audited in parallel |
| F2 (Quality) | APPROVE | `f2-quality.md` - all files <=250 pure LOC, no anti-patterns |
| F3 (Automated) | APPROVE | `f3-automated.md` - all 7 commands exit 0, 32 tests pass |
| **F4 (Browser QA)** | **APPROVE** | This file - 11/11 browser checks pass, 0 console errors |

## Blockers

None. All required screenshots exist and are non-empty. All behavioral assertions pass. Console log is clean. QA reports are internally consistent. The optional re-run confirms the script still passes.
