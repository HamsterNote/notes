# Final Wave Browser QA Report

**Timestamp:** 2026-07-12T21:47:14+08:00
**Viewport:** 1280×720 (desktop), 801×720 / 800×720 (boundary)
**Console messages captured:** 21
**Result:** 11/11 checks passed
**Verdict:** APPROVE

## Screenshots

| Screenshot | Description |
|---|---|
| `desktop-hover-handle.png` | 1280×720, handle visible on hover |
| `desktop-focus-handle.png` | 1280×720, handle visible via keyboard focus |
| `desktop-menu-near-handle-801.png` | 801px viewport, menu anchored near handle |
| `mobile-centered-menu-800.png` | 800px viewport, menu horizontally centered |
| `enter-split.png` | After pressing Enter in a paragraph |
| `shift-enter-soft-break.png` | After pressing Shift+Enter |
| `backspace-delete.png` | After deleting an empty block |
| `last-block-protection.png` | Lone empty heading replaced by empty paragraph |

## Check Results

### [PASS] 01 — Demo 加载无控制台错误

- 页面标题: @hamster-note/notes
- 块数量: 10

### [PASS] 02 — 悬停 heading 块显示左侧 handle

- Screenshot: `desktop-hover-handle.png`
- 悬停后 handle opacity: 1

### [PASS] 03 — 键盘聚焦 handle 显示

- Screenshot: `desktop-focus-handle.png`
- 键盘聚焦后 handle opacity: 1
- 焦点元素: <BUTTON> class=hn-note-block-handle

### [PASS] 04 — 801px 视口菜单贴近 handle

- Screenshot: `desktop-menu-near-handle-801.png`
- 801px handle box: {'x': 41, 'y': 317.015625, 'width': 24, 'height': 24}
- 801px menu box: {'x': 73, 'y': 317.015625, 'width': 160, 'height': 207.78125}
- 801px menu style: {'position': 'fixed', 'left': '73px', 'transform': 'none', 'top': '317.016px'}
- 801px 未居中: True, 贴近 handle: True

### [PASS] 05 — 800px 视口菜单水平居中

- Screenshot: `mobile-centered-menu-800.png`
- 800px menu box: {'x': 320, 'y': 348.96875, 'width': 160, 'height': 207.78125}
- 800px menu style: {'position': 'fixed', 'left': '400px', 'transform': 'matrix(1, 0, 0, 1, -80, 0)', 'top': '348.969px'}
- 800px transform 居中: True, 位置居中: True

### [PASS] 06 — 段落中间 Enter 拆分为两块

- Screenshot: `enter-split.png`
- 拆分前块数量: 10
- intro 文本长度: 188, 光标位置: 94
- 拆分后块数量: 11
- 新块 intro-line 存在: True
- 新块文本: hy, callouts, checklists, and code snippets for pr...

### [PASS] 07 — Shift+Enter 插入 <br> 软换行

- Screenshot: `shift-enter-soft-break.png`
- 软换行前块数量: 10
- 软换行后块数量: 10
- 块内 HTML 含 <br>: True
- Markdown 面板含 <br>: True

### [PASS] 08 — 空块 Backspace 删除并移动焦点

- Screenshot: `backspace-delete.png`
- 删除前块数量: 10
- 删除后块数量: 9
- subheading 已删除: True
- 删除后焦点块 ID: intro

### [PASS] 09 — 唯一空块 Backspace 重置为空段落

- Screenshot: `last-block-protection.png`
- 设置后块数量: 1
- Backspace 后块数量: 1
- solo 块仍存在: True
- 块容器 class: hn-note-paragraph hn-note-paragraph--default
- 块类型为 paragraph: True

### [PASS] 10 — checklist/quote/code/callout Enter 不创建新块

- 初始块数量: 10
- checklist Enter 后块数量: 10 (不变: True)
- quote Enter 后块数量: 10 (不变: True)
- code Enter 后块数量: 10 (不变: True)
- callout Enter 后块数量: 10 (不变: True)

### [PASS] 11 — 全程无控制台错误

- 全程累计控制台错误数: 0

## Automated Checks (from command logs)

| Command | Output File | Exit Code |
|---|---|---|
| `pnpm test` | `test-output.txt` | 0 |
| `pnpm typecheck` | `typecheck-output.txt` | 0 |
| `pnpm build` | `build-output.txt` | 0 |
| `pnpm build:demo` | `build-demo-output.txt` | 0 |
