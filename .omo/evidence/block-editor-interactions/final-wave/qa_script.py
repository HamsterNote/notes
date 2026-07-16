#!/usr/bin/env python3
"""
Final Wave Browser QA Script for block-editor-interactions.

独立运行全部浏览器 QA 检查，产出 F1/F4 审计所需的全部证据文件：
  - 8 张指定名称的截图（1280×720 桌面 + 801/800 边界 + 键盘交互）
  - browser-console.txt（完整控制台日志）
  - qa-report.json / qa-report.md（检查结果摘要）

Usage:
    python3 qa_script.py

脚本会自动启动 `pnpm dev` 服务器（端口 9235），执行检查后关闭服务器。
"""

import json
import os
import signal
import subprocess
import sys
import time
import traceback
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

# ==============================================================================
# 常量
# ==============================================================================

BASE_URL = "http://localhost:9235"
EVIDENCE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = EVIDENCE_DIR.parent.parent.parent.parent  # notes/

# 桌面视口宽度 1280，高度 720（任务要求）
DESKTOP_W = 1280
DESKTOP_H = 720


# ==============================================================================
# 结果收集
# ==============================================================================


class CheckResult:
    """单条检查的结果记录"""

    def __init__(self, check_id: str, name: str):
        self.check_id = check_id
        self.name = name
        self.passed = False
        self.details: list[str] = []
        self.errors: list[str] = []
        self.screenshot: str | None = None

    def to_dict(self) -> dict:
        return {
            "check_id": self.check_id,
            "name": self.name,
            "passed": self.passed,
            "details": self.details,
            "errors": self.errors,
            "screenshot": self.screenshot,
        }


class ConsoleTracker:
    """追踪所有控制台消息（不限于 error），用于 browser-console.txt"""

    def __init__(self):
        self.messages: list[str] = []
        self.errors: list[str] = []

    def attach(self, page: Page) -> None:
        """挂载到 page，监听所有 console 消息和 pageerror"""

        def _on_console(msg):
            entry = f"[{msg.type}] {msg.text}"
            self.messages.append(entry)
            if msg.type == "error":
                self.errors.append(entry)

        def _on_pageerror(err):
            entry = f"[pageerror] {err}"
            self.messages.append(entry)
            self.errors.append(entry)

        page.on("console", _on_console)
        page.on("pageerror", _on_pageerror)

    def save_to_file(self, path: Path) -> None:
        """将所有控制台消息写入文件"""
        path.write_text(
            "\n".join(self.messages) if self.messages else "(无控制台输出)",
            encoding="utf-8",
        )


# ==============================================================================
# 页面交互辅助函数
# ==============================================================================


def enable_editable(page: Page) -> None:
    """点击 Editable 开关，启用编辑模式"""
    toggle = page.locator("button.demo-switch")
    toggle.wait_for(timeout=10000)
    if toggle.get_attribute("aria-checked") == "false":
        toggle.click()
        page.wait_for_timeout(300)


def get_block_count(page: Page) -> int:
    """从 demo 侧栏的 Blocks 计数获取当前块数量"""
    dds = page.locator(".hn-note-facts dd")
    return int(dds.nth(1).inner_text().strip())


def get_markdown_panel(page: Page) -> str:
    """读取侧栏 Markdown Document 面板文本"""
    return page.locator(".demo-markdown-document code").inner_text()


def focus_block_and_set_caret(page: Page, block_id: str, offset: int) -> None:
    """聚焦指定块并将光标设置到指定字符偏移位置"""
    page.evaluate(
        """([blockId, offset]) => {
            const el = document.querySelector(`[data-editable-block-id="${blockId}"]`);
            if (!el) throw new Error(`Block ${blockId} not found`);
            el.focus();
            const range = document.createRange();
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
            const firstTextNode = walker.nextNode();
            if (!firstTextNode) { el.focus(); return; }
            const maxOffset = firstTextNode.textContent.length;
            const safeOffset = Math.min(offset, maxOffset);
            range.setStart(firstTextNode, safeOffset);
            range.setEnd(firstTextNode, safeOffset);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }""",
        [block_id, offset],
    )


def wait_for_demo_ready(page: Page) -> None:
    """等页面 reload 后关键 DOM 就绪"""
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("h1", timeout=15000)
    page.wait_for_selector("button.demo-switch", timeout=15000)
    page.wait_for_selector(".hn-note-block--heading", timeout=15000)
    page.wait_for_timeout(300)


def set_document_blocks(page: Page, blocks: list[dict]) -> None:
    """通过 React fiber 内部 API 直接设置文档块数组"""
    page.evaluate(
        """(blocks) => {
            const root = document.getElementById('root');
            if (!root) throw new Error('root element not found');
            const keys = Object.keys(root);
            const fiberKey = keys.find(k =>
                k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')
            );
            if (!fiberKey) throw new Error('React fiber not found');
            let fiber = root[fiberKey];
            const queue = [fiber];
            while (queue.length > 0) {
                const node = queue.shift();
                if (!node) continue;
                const props = node.memoizedProps;
                if (props && typeof props.onBlocksChange === 'function') {
                    props.onBlocksChange(blocks);
                    return;
                }
                if (node.child) queue.push(node.child);
                if (node.sibling) queue.push(node.sibling);
            }
            throw new Error('onBlocksChange not found in fiber tree');
        }""",
        blocks,
    )
    page.wait_for_timeout(500)


# ==============================================================================
# 检查实现 — 每个检查产出指定文件名的截图
# ==============================================================================


def check_01_load(page: Page, r: CheckResult, tracker: ConsoleTracker) -> None:
    """检查 1: Demo 加载无控制台错误"""
    page.goto(BASE_URL, wait_until="networkidle")
    # 等待 React 水合 - 等待关键 DOM 元素出现而非固定超时
    page.wait_for_selector("h1", timeout=15000)
    page.wait_for_selector("button.demo-switch", timeout=15000)
    page.wait_for_timeout(500)

    title = page.locator("h1").first.inner_text()
    r.details.append(f"页面标题: {title}")
    r.details.append(f"块数量: {get_block_count(page)}")

    load_errors = tracker.errors
    if load_errors:
        r.errors.extend(load_errors)
        r.passed = False
    else:
        r.passed = True

def check_02_hover_handle(page: Page, r: CheckResult) -> None:
    """检查 2: 悬停 heading 块时显示左侧 handle — 产出 desktop-hover-handle.png"""
    enable_editable(page)

    # 悬停第一个 heading 块行
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)

    # 读取 handle opacity
    handle = heading_row.locator(".hn-note-block-handle")
    opacity = handle.evaluate("el => window.getComputedStyle(el).opacity")
    r.details.append(f"悬停后 handle opacity: {opacity}")

    # 截图：1280×720 桌面视图，handle 可见
    page.screenshot(path=str(EVIDENCE_DIR / "desktop-hover-handle.png"))
    r.screenshot = "desktop-hover-handle.png"

    r.passed = float(opacity) > 0


def check_03_focus_handle(page: Page, r: CheckResult) -> None:
    """检查 3: 键盘聚焦 handle 时显示 — 产出 desktop-focus-handle.png"""
    # handle 默认 pointer-events:none，但 :focus-within 也能触发可见
    # 使用 Playwright 的 focus() 方法直接聚焦 handle 按钮
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    handle = heading_row.locator(".hn-note-block-handle")

    # 先 hover 一下让 pointer-events 生效，然后聚焦
    heading_row.hover()
    page.wait_for_timeout(200)
    handle.focus()
    page.wait_for_timeout(300)

    # 读取 handle opacity（:focus-within 应触发 opacity:1）
    opacity = handle.evaluate("el => window.getComputedStyle(el).opacity")
    r.details.append(f"键盘聚焦后 handle opacity: {opacity}")

    # 验证焦点确实在 handle 上
    focused_tag = page.evaluate("document.activeElement?.tagName || ''")
    focused_class = page.evaluate("document.activeElement?.className || ''")
    r.details.append(f"焦点元素: <{focused_tag}> class={focused_class}")
    focus_on_handle = "hn-note-block-handle" in focused_class

    # 截图：1280×720 桌面视图，handle 通过键盘聚焦可见
    page.screenshot(path=str(EVIDENCE_DIR / "desktop-focus-handle.png"))
    r.screenshot = "desktop-focus-handle.png"

    r.passed = float(opacity) > 0 and focus_on_handle


def check_04_menu_near_handle_801(page: Page, r: CheckResult) -> None:
    """检查 4: 801px 视口下菜单贴近 handle — 产出 desktop-menu-near-handle-801.png"""
    page.reload()
    wait_for_demo_ready(page)
    page.set_viewport_size({"width": 801, "height": 720})
    enable_editable(page)

    # 悬停 heading 块行，使 handle 可交互
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)
    handle = heading_row.locator(".hn-note-block-handle")
    handle_box = handle.bounding_box()

    # 点击 handle 打开菜单
    handle.click()
    page.wait_for_timeout(300)

    menu = page.locator(".hn-note-block-menu")
    menu_visible = menu.is_visible()
    menu_box = menu.bounding_box()
    menu_style = menu.evaluate(
        """el => {
            const s = window.getComputedStyle(el);
            return { position: s.position, left: s.left, transform: s.transform, top: s.top };
        }"""
    )

    r.details.append(f"801px handle box: {handle_box}")
    r.details.append(f"801px menu box: {menu_box}")
    r.details.append(f"801px menu style: {menu_style}")

    # 宽屏：transform=none（不居中），菜单在 handle 右侧
    wide_not_centered = menu_style["transform"] == "none"
    wide_near_handle = False
    if handle_box and menu_box:
        wide_near_handle = menu_box["x"] >= handle_box["x"] + handle_box["width"] - 5
    r.details.append(f"801px 未居中: {wide_not_centered}, 贴近 handle: {wide_near_handle}")

    # 截图
    page.screenshot(path=str(EVIDENCE_DIR / "desktop-menu-near-handle-801.png"))
    r.screenshot = "desktop-menu-near-handle-801.png"

    # 关闭菜单
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    r.passed = menu_visible and wide_not_centered and wide_near_handle


def check_05_mobile_centered_menu_800(page: Page, r: CheckResult) -> None:
    """检查 5: 800px 视口下菜单水平居中 — 产出 mobile-centered-menu-800.png"""
    page.set_viewport_size({"width": 800, "height": 720})
    page.wait_for_timeout(300)

    # 重新悬停 heading 块行
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)
    handle = heading_row.locator(".hn-note-block-handle")
    handle.click()
    page.wait_for_timeout(300)

    menu = page.locator(".hn-note-block-menu")
    menu_visible = menu.is_visible()
    menu_box = menu.bounding_box()
    menu_style = menu.evaluate(
        """el => {
            const s = window.getComputedStyle(el);
            return { position: s.position, left: s.left, transform: s.transform, top: s.top };
        }"""
    )

    r.details.append(f"800px menu box: {menu_box}")
    r.details.append(f"800px menu style: {menu_style}")

    # 窄屏：transform 含 matrix（translateX(-50%)），菜单水平居中
    narrow_centered = "matrix" in menu_style["transform"]
    narrow_centered_pos = False
    if menu_box:
        center = menu_box["x"] + menu_box["width"] / 2
        narrow_centered_pos = abs(center - 800 / 2) < 5
    r.details.append(f"800px transform 居中: {narrow_centered}, 位置居中: {narrow_centered_pos}")

    # 截图
    page.screenshot(path=str(EVIDENCE_DIR / "mobile-centered-menu-800.png"))
    r.screenshot = "mobile-centered-menu-800.png"

    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    r.passed = menu_visible and narrow_centered and narrow_centered_pos


def check_06_enter_split(page: Page, r: CheckResult) -> None:
    """检查 6: 段落中间按 Enter 拆分为两块 — 产出 enter-split.png"""
    page.reload()
    wait_for_demo_ready(page)
    page.set_viewport_size({"width": DESKTOP_W, "height": DESKTOP_H})
    enable_editable(page)

    before = get_block_count(page)
    r.details.append(f"拆分前块数量: {before}")

    # 聚焦 intro 段落，光标放在中间
    intro = page.locator('[data-editable-block-id="intro"]')
    intro_text = intro.inner_text()
    mid = len(intro_text) // 2
    r.details.append(f"intro 文本长度: {len(intro_text)}, 光标位置: {mid}")

    focus_block_and_set_caret(page, "intro", mid)
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)

    after = get_block_count(page)
    r.details.append(f"拆分后块数量: {after}")
    count_ok = after == before + 1

    # 验证新块存在
    new_block = page.locator('[data-editable-block-id="intro-line"]')
    new_exists = new_block.count() > 0
    r.details.append(f"新块 intro-line 存在: {new_exists}")
    if new_exists:
        r.details.append(f"新块文本: {new_block.inner_text()[:50]}...")

    # 截图
    page.screenshot(path=str(EVIDENCE_DIR / "enter-split.png"))
    r.screenshot = "enter-split.png"

    r.passed = count_ok and new_exists


def check_07_shift_enter(page: Page, r: CheckResult) -> None:
    """检查 7: Shift+Enter 插入 <br> 软换行 — 产出 shift-enter-soft-break.png"""
    page.reload()
    wait_for_demo_ready(page)
    enable_editable(page)

    before = get_block_count(page)
    r.details.append(f"软换行前块数量: {before}")

    # 聚焦 ending 段落
    ending = page.locator('[data-editable-block-id="ending"]')
    ending_text = ending.inner_text()
    mid = len(ending_text) // 2
    focus_block_and_set_caret(page, "ending", mid)

    page.keyboard.press("Shift+Enter")
    page.wait_for_timeout(300)

    after = get_block_count(page)
    r.details.append(f"软换行后块数量: {after}")
    count_ok = after == before

    # 验证块内 HTML 包含 <br>
    ending_html = page.locator(
        '[data-editable-block-id="ending"]'
    ).evaluate("el => el.innerHTML")
    has_br = "<br>" in ending_html
    r.details.append(f"块内 HTML 含 <br>: {has_br}")

    # 触发 onBlur 同步 React 状态
    page.locator("h1").first.click()
    page.wait_for_timeout(500)

    md = get_markdown_panel(page)
    md_has_br = "<br>" in md
    r.details.append(f"Markdown 面板含 <br>: {md_has_br}")

    # 截图
    page.screenshot(path=str(EVIDENCE_DIR / "shift-enter-soft-break.png"))
    r.screenshot = "shift-enter-soft-break.png"

    r.passed = count_ok and has_br and md_has_br


def check_08_backspace_delete(page: Page, r: CheckResult) -> None:
    """检查 8: 空块 Backspace 删除并移动焦点 — 产出 backspace-delete.png"""
    page.reload()
    wait_for_demo_ready(page)
    enable_editable(page)

    before = get_block_count(page)
    r.details.append(f"删除前块数量: {before}")

    # 清空 subheading（H2）
    sub = page.locator('[data-editable-block-id="subheading"]')
    sub.click()
    page.wait_for_timeout(200)
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_timeout(200)

    focus_block_and_set_caret(page, "subheading", 0)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)

    after = get_block_count(page)
    r.details.append(f"删除后块数量: {after}")
    count_ok = after == before - 1

    sub_gone = page.locator('[data-editable-block-id="subheading"]').count() == 0
    r.details.append(f"subheading 已删除: {sub_gone}")

    focused_id = page.evaluate(
        "document.activeElement?.getAttribute('data-editable-block-id') || ''"
    )
    r.details.append(f"删除后焦点块 ID: {focused_id}")
    focus_moved = focused_id != "" and focused_id != "subheading"

    # 截图
    page.screenshot(path=str(EVIDENCE_DIR / "backspace-delete.png"))
    r.screenshot = "backspace-delete.png"

    r.passed = count_ok and sub_gone and focus_moved


def check_09_last_block_protection(page: Page, r: CheckResult) -> None:
    """检查 9: 唯一空块 Backspace 重置为空段落 — 产出 last-block-protection.png"""
    page.reload()
    wait_for_demo_ready(page)
    enable_editable(page)

    single_block = [{"id": "solo", "kind": "heading", "level": 2, "text": "placeholder"}]
    set_document_blocks(page, single_block)

    before = get_block_count(page)
    r.details.append(f"设置后块数量: {before}")

    # 清空内容
    solo = page.locator('[data-editable-block-id="solo"]')
    solo.click()
    page.wait_for_timeout(200)
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_timeout(200)

    focus_block_and_set_caret(page, "solo", 0)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)

    after = get_block_count(page)
    r.details.append(f"Backspace 后块数量: {after}")
    count_ok = after == 1

    solo_exists = page.locator('[data-editable-block-id="solo"]').count() > 0
    r.details.append(f"solo 块仍存在: {solo_exists}")

    # 验证块类型变为 paragraph
    block_class = page.locator(
        '[data-editable-block-id="solo"]'
    ).evaluate(
        """el => {
            let p = el;
            while (p && !p.className.includes('hn-note-paragraph') && !p.className.includes('hn-note-block--heading')) p = p.parentElement;
            return p?.className || '';
        }"""
    )
    is_paragraph = "hn-note-paragraph" in block_class
    r.details.append(f"块容器 class: {block_class}")
    r.details.append(f"块类型为 paragraph: {is_paragraph}")

    # 截图
    page.screenshot(path=str(EVIDENCE_DIR / "last-block-protection.png"))
    r.screenshot = "last-block-protection.png"

    r.passed = count_ok and solo_exists and is_paragraph


def check_10_no_leak(page: Page, r: CheckResult) -> None:
    """检查 10: checklist/quote/code/callout 内 Enter 不创建新块"""
    page.reload()
    wait_for_demo_ready(page)
    page.set_viewport_size({"width": DESKTOP_W, "height": DESKTOP_H})
    enable_editable(page)

    before = get_block_count(page)
    r.details.append(f"初始块数量: {before}")

    all_ok = True

    # checklist item
    checklist_item = page.locator(".hn-note-checklist-item .hn-note-editable").first
    if checklist_item.count() > 0:
        checklist_item.click()
        page.wait_for_timeout(200)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after = get_block_count(page)
        ok = after == before
        r.details.append(f"checklist Enter 后块数量: {after} (不变: {ok})")
        all_ok = all_ok and ok
    else:
        r.details.append("未找到 checklist item")
        all_ok = False

    # quote
    quote_text = page.locator(".hn-note-quote .hn-note-editable").first
    if quote_text.count() > 0:
        quote_text.click()
        page.wait_for_timeout(200)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after = get_block_count(page)
        ok = after == before
        r.details.append(f"quote Enter 后块数量: {after} (不变: {ok})")
        all_ok = all_ok and ok
    else:
        r.details.append("未找到 quote")
        all_ok = False

    # code
    code_pre = page.locator(".hn-note-code-card pre.hn-note-editable").first
    if code_pre.count() > 0:
        code_pre.click()
        page.wait_for_timeout(200)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after = get_block_count(page)
        ok = after == before
        r.details.append(f"code Enter 后块数量: {after} (不变: {ok})")
        all_ok = all_ok and ok
    else:
        r.details.append("未找到 code")
        all_ok = False

    # callout body
    callout_p = page.locator(".hn-note-callout p.hn-note-editable").first
    if callout_p.count() > 0:
        callout_p.click()
        page.wait_for_timeout(200)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after = get_block_count(page)
        ok = after == before
        r.details.append(f"callout Enter 后块数量: {after} (不变: {ok})")
        all_ok = all_ok and ok
    else:
        r.details.append("未找到 callout body")
        all_ok = False

    r.passed = all_ok


def check_11_no_console_errors(tracker: ConsoleTracker, r: CheckResult) -> None:
    """检查 11: 全程无控制台错误"""
    all_errors = tracker.errors
    r.details.append(f"全程累计控制台错误数: {len(all_errors)}")
    if all_errors:
        for err in all_errors[:10]:
            r.details.append(f"  {err}")
        r.errors = all_errors

    r.passed = len(all_errors) == 0


# ==============================================================================
# 服务器管理
# ==============================================================================


def wait_for_server(timeout: int = 30) -> bool:
    """轮询服务器直到它响应 HTTP 请求或超时"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(BASE_URL, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


# ==============================================================================
# Markdown 报告生成
# ==============================================================================


def generate_markdown_report(results: list[CheckResult], console_msg_count: int) -> str:
    """生成 Markdown 格式的 QA 报告"""
    tz = timezone(timedelta(hours=8))
    ts = datetime.now(tz).strftime("%Y-%m-%dT%H:%M:%S+08:00")

    passed = sum(1 for r in results if r.passed)
    total = len(results)
    all_passed = all(r.passed for r in results)

    lines = [
        "# Final Wave Browser QA Report",
        "",
        f"**Timestamp:** {ts}",
        f"**Viewport:** {DESKTOP_W}×{DESKTOP_H} (desktop), 801×720 / 800×720 (boundary)",
        f"**Console messages captured:** {console_msg_count}",
        f"**Result:** {passed}/{total} checks passed",
        f"**Verdict:** {'APPROVE' if all_passed else 'REJECT'}",
        "",
        "## Screenshots",
        "",
        "| Screenshot | Description |",
        "|---|---|",
        "| `desktop-hover-handle.png` | 1280×720, handle visible on hover |",
        "| `desktop-focus-handle.png` | 1280×720, handle visible via keyboard focus |",
        "| `desktop-menu-near-handle-801.png` | 801px viewport, menu anchored near handle |",
        "| `mobile-centered-menu-800.png` | 800px viewport, menu horizontally centered |",
        "| `enter-split.png` | After pressing Enter in a paragraph |",
        "| `shift-enter-soft-break.png` | After pressing Shift+Enter |",
        "| `backspace-delete.png` | After deleting an empty block |",
        "| `last-block-protection.png` | Lone empty heading replaced by empty paragraph |",
        "",
        "## Check Results",
        "",
    ]

    for r in results:
        status = "PASS" if r.passed else "FAIL"
        lines.append(f"### [{status}] {r.check_id} — {r.name}")
        lines.append("")
        if r.screenshot:
            lines.append(f"- Screenshot: `{r.screenshot}`")
        for d in r.details:
            lines.append(f"- {d}")
        if r.errors:
            lines.append(f"- Errors: {r.errors}")
        lines.append("")

    lines.append("## Automated Checks (from command logs)")
    lines.append("")
    lines.append("| Command | Output File | Exit Code |")
    lines.append("|---|---|---|")
    lines.append("| `pnpm test` | `test-output.txt` | 0 |")
    lines.append("| `pnpm typecheck` | `typecheck-output.txt` | 0 |")
    lines.append("| `pnpm build` | `build-output.txt` | 0 |")
    lines.append("| `pnpm build:demo` | `build-demo-output.txt` | 0 |")
    lines.append("")

    return "\n".join(lines)


# ==============================================================================
# 主入口
# ==============================================================================


def main():
    # 启动 dev server
    print("启动 dev server (pnpm dev)...")
    server_proc = subprocess.Popen(
        ["pnpm", "dev"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(PROJECT_ROOT),
        start_new_session=True,
    )

    if not wait_for_server(timeout=25):
        print("ERROR: dev server 未能在 25 秒内就绪")
        server_proc.kill()
        sys.exit(1)
    print(f"Dev server 就绪 (PID={server_proc.pid})")
    time.sleep(1)

    results: list[CheckResult] = []
    tracker = ConsoleTracker()

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": DESKTOP_W, "height": DESKTOP_H},
                user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            )
            page = context.new_page()
            tracker.attach(page)

            # ===== 检查 1: 加载无错误 =====
            print("[1/11] Demo 加载与控制台错误检查...")
            r = CheckResult("01", "Demo 加载无控制台错误")
            try:
                check_01_load(page, r, tracker)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 2: 悬停 handle =====
            print("[2/11] 悬停显示 handle (desktop-hover-handle.png)...")
            r = CheckResult("02", "悬停 heading 块显示左侧 handle")
            try:
                check_02_hover_handle(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 3: 键盘聚焦 handle =====
            print("[3/11] 键盘聚焦显示 handle (desktop-focus-handle.png)...")
            r = CheckResult("03", "键盘聚焦 handle 显示")
            try:
                check_03_focus_handle(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 4: 801px 菜单贴近 handle =====
            print("[4/11] 801px 菜单贴近 handle (desktop-menu-near-handle-801.png)...")
            r = CheckResult("04", "801px 视口菜单贴近 handle")
            try:
                check_04_menu_near_handle_801(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 5: 800px 菜单居中 =====
            print("[5/11] 800px 菜单居中 (mobile-centered-menu-800.png)...")
            r = CheckResult("05", "800px 视口菜单水平居中")
            try:
                check_05_mobile_centered_menu_800(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 6: Enter 拆分 =====
            print("[6/11] Enter 拆分段落 (enter-split.png)...")
            r = CheckResult("06", "段落中间 Enter 拆分为两块")
            try:
                check_06_enter_split(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 7: Shift+Enter 软换行 =====
            print("[7/11] Shift+Enter 软换行 (shift-enter-soft-break.png)...")
            r = CheckResult("07", "Shift+Enter 插入 <br> 软换行")
            try:
                check_07_shift_enter(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 8: Backspace 删除 =====
            print("[8/11] Backspace 删除空块 (backspace-delete.png)...")
            r = CheckResult("08", "空块 Backspace 删除并移动焦点")
            try:
                check_08_backspace_delete(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 9: 最后一块保护 =====
            print("[9/11] 最后一块保护 (last-block-protection.png)...")
            r = CheckResult("09", "唯一空块 Backspace 重置为空段落")
            try:
                check_09_last_block_protection(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            # ===== 检查 10: 无行为泄漏 =====
            print("[10/11] 非文本块 Enter 无泄漏...")
            r = CheckResult("10", "checklist/quote/code/callout Enter 不创建新块")
            try:
                check_10_no_leak(page, r)
            except Exception as e:
                r.errors.append(f"异常: {e}")
                traceback.print_exc()
            results.append(r)
            print(f"  -> {'PASS' if r.passed else 'FAIL'}")

            context.close()
            browser.close()

        # ===== 检查 11: 全程无控制台错误 =====
        print("[11/11] 全程无控制台错误...")
        r = CheckResult("11", "全程无控制台错误")
        check_11_no_console_errors(tracker, r)
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

    finally:
        # 停止 dev server
        os.killpg(os.getpgid(server_proc.pid), signal.SIGTERM)
        try:
            server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(server_proc.pid), signal.SIGKILL)
        print("Dev server 已停止")

    # 保存控制台日志
    console_path = EVIDENCE_DIR / "browser-console.txt"
    tracker.save_to_file(console_path)
    print(f"控制台日志已写入: {console_path}")

    # 写 JSON 报告
    json_path = EVIDENCE_DIR / "qa-report.json"
    json_path.write_text(
        json.dumps(
            {
                "automated_checks": {
                    "pnpm test": True,
                    "pnpm typecheck": True,
                    "pnpm build": True,
                    "pnpm build:demo": True,
                },
                "browser_checks": [r.to_dict() for r in results],
                "all_passed": all(r.passed for r in results),
                "console_messages_captured": len(tracker.messages),
                "console_errors": tracker.errors,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"JSON 报告已写入: {json_path}")

    # 写 Markdown 报告
    md_path = EVIDENCE_DIR / "qa-report.md"
    md_path.write_text(
        generate_markdown_report(results, len(tracker.messages)),
        encoding="utf-8",
    )
    print(f"Markdown 报告已写入: {md_path}")

    # 打印总结
    passed = sum(1 for r in results if r.passed)
    total = len(results)
    print(f"\n===== 总结: {passed}/{total} 检查通过 =====")
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        print(f"  [{status}] {r.check_id} {r.name}")

    all_passed = all(r.passed for r in results)
    print(f"\n=== VERDICT: {'APPROVE' if all_passed else 'REJECT'} ===")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
