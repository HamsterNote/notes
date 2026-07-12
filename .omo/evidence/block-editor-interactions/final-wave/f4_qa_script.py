#!/usr/bin/env python3
"""
Final Wave F4 Browser QA Script for block-editor-interactions.

独立重跑全部 10 条断言，覆盖：
1.  Demo 加载无控制台错误
2.  hover/focus heading+paragraph 显示左侧 handle
3.  点击 handle 打开格式菜单（H1-H5 + 正文）
4.  选择 H1/H2/H3/H4/H5/正文 转换块
5.  段落中间按 Enter 拆分为两块
6.  Shift+Enter 插入 <br> 软换行（同一块内）
7.  空块 Backspace 删除并恢复焦点；唯一块则重置为空段落
8.  >800px 菜单贴近 handle；<=800px 菜单水平居中
9.  checklist/quote/code/callout 无 handle 且 Enter 不拆分
10. 全程无控制台错误

Usage:
    python3 f4_qa_script.py
"""

import json
import os
import signal
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

# ==============================================================================
# 常量
# ==============================================================================

BASE_URL = "http://localhost:9235"
EVIDENCE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = EVIDENCE_DIR.parent.parent.parent.parent  # notes/

# ==============================================================================
# 结果收集
# ==============================================================================


class CheckResult:
    """单条断言的结果"""

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


class GlobalConsoleTracker:
    """跨所有检查追踪控制台错误（断言 10）"""

    def __init__(self):
        self.errors: list[str] = []
        self._page = None

    def attach(self, page: Page) -> None:
        self._page = page
        page.on(
            "console",
            lambda msg: self.errors.append(f"[{msg.type}] {msg.text}")
            if msg.type == "error"
            else None,
        )
        page.on(
            "pageerror",
            lambda err: self.errors.append(f"[pageerror] {err}"),
        )

    def snapshot(self) -> list[str]:
        return list(self.errors)


# ==============================================================================
# 页面交互辅助
# ==============================================================================


def enable_editable(page: Page) -> None:
    """点击 Editable 开关启用编辑模式"""
    toggle = page.locator("button.demo-switch")
    if toggle.get_attribute("aria-checked") == "false":
        toggle.click()
        page.wait_for_timeout(300)


def get_block_count(page: Page) -> int:
    """从 demo 侧栏 Blocks 计数获取当前块数量"""
    dds = page.locator(".hn-note-facts dd")
    return int(dds.nth(1).inner_text().strip())


def get_markdown_panel(page: Page) -> str:
    """读取侧栏 Markdown Document 面板文本"""
    return page.locator(".demo-markdown-document code").inner_text()


def focus_block_and_set_caret(page: Page, block_id: str, offset: int) -> None:
    """聚焦指定块并设置光标偏移"""
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


def set_document_blocks(page: Page, blocks: list[dict]) -> None:
    """通过 React fiber 直接设置文档块数组"""
    page.evaluate(
        """(blocks) => {
            const root = document.getElementById('root');
            if (!root) throw new Error('root element not found');
            const keys = Object.keys(root);
            const fiberKey = keys.find(k =>
                k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')
            );
            if (!fiberKey) throw new Error('React fiber not found. Keys: ' + keys.join(', '));
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


def hover_and_get_handle_opacity(page: Page, block_selector: str) -> tuple[float, str]:
    """悬停块行并返回 handle opacity + 截图文件名"""
    row = page.locator(f"{block_selector} .hn-note-block-row").first
    row.hover()
    page.wait_for_timeout(300)
    handle = row.locator(".hn-note-block-handle")
    opacity = float(handle.evaluate("el => window.getComputedStyle(el).opacity"))
    return opacity, ""


# ==============================================================================
# 10 条断言实现
# ==============================================================================


def assert_01_load_no_console(page: Page, r: CheckResult, tracker: GlobalConsoleTracker) -> None:
    """断言 1: Demo 加载无控制台错误"""
    page.goto(BASE_URL, wait_until="networkidle")
    page.wait_for_timeout(500)

    page.screenshot(path=str(EVIDENCE_DIR / "01_load.png"))
    r.screenshot = "01_load.png"

    title = page.locator("h1").first.inner_text()
    r.details.append(f"页面 H1: {title}")
    r.details.append(f"初始块数量: {get_block_count(page)}")

    errors_before_editable = tracker.snapshot()
    r.details.append(f"加载阶段控制台错误数: {len(errors_before_editable)}")

    r.passed = len(errors_before_editable) == 0


def assert_02_hover_handle(page: Page, r: CheckResult) -> None:
    """断言 2: hover/focus heading+paragraph 显示左侧 handle"""
    enable_editable(page)

    # --- heading 块 ---
    heading_opacity, _ = hover_and_get_handle_opacity(
        page, ".hn-note-block--heading"
    )
    r.details.append(f"heading hover handle opacity: {heading_opacity}")
    page.screenshot(path=str(EVIDENCE_DIR / "02a_hover_heading.png"))

    # --- paragraph 块（intro）---
    # intro 的容器是 .hn-note-paragraph（外层 div 带此 class）
    # 使用 evaluate 直接 hover + 读取 opacity，避免 ElementHandle 类型问题
    para_handle_opacity = float(
        page.evaluate(
            """() => {
                const el = document.querySelector('[data-editable-block-id="intro"]');
                if (!el) return '0';
                const row = el.closest('.hn-note-block-row');
                if (!row) return '0';
                // 模拟 hover 事件触发 CSS :hover（Playwright hover 更可靠，但此处用 JS 触发）
                const handle = row.querySelector('.hn-note-block-handle');
                if (!handle) return '0';
                return window.getComputedStyle(handle).opacity;
            }"""
        )
    )
    # 使用 Playwright hover 确保真实 hover 状态（用于截图）
    page.locator('[data-editable-block-id="intro"]').hover()
    page.wait_for_timeout(300)
    para_handle_opacity = float(
        page.evaluate(
            """() => {
                const el = document.querySelector('[data-editable-block-id="intro"]');
                const row = el ? el.closest('.hn-note-block-row') : null;
                const handle = row ? row.querySelector('.hn-note-block-handle') : null;
                return handle ? window.getComputedStyle(handle).opacity : '0';
            }"""
        )
    )
    r.details.append(f"paragraph hover handle opacity: {para_handle_opacity}")
    page.screenshot(path=str(EVIDENCE_DIR / "02b_hover_paragraph.png"))
    r.screenshot = "02b_hover_paragraph.png"

    r.passed = heading_opacity > 0 and para_handle_opacity > 0


def assert_03_menu_items(page: Page, r: CheckResult) -> None:
    """断言 3: 点击 handle 打开格式菜单，含 H1-H5 + 正文"""
    # 悬停 heading 行使 handle 可交互
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)
    handle = heading_row.locator(".hn-note-block-handle")
    handle.click()
    page.wait_for_timeout(300)

    menu = page.locator(".hn-note-block-menu")
    menu_visible = menu.is_visible()
    r.details.append(f"菜单可见: {menu_visible}")

    items = menu.locator(".hn-note-block-menu-item")
    item_count = items.count()
    r.details.append(f"菜单项数量: {item_count}")

    # 读取所有菜单项标签
    labels = []
    for i in range(item_count):
        label = items.nth(i).locator(".hn-note-block-menu-item-label").inner_text()
        labels.append(label)
    r.details.append(f"菜单项标签: {labels}")

    page.screenshot(path=str(EVIDENCE_DIR / "03_menu_open.png"))
    r.screenshot = "03_menu_open.png"

    expected = ["H1", "H2", "H3", "H4", "H5", "正文"]
    has_all = all(lbl in labels for lbl in expected) and item_count == 6

    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    r.passed = menu_visible and has_all


def assert_04_format_conversion(page: Page, r: CheckResult) -> None:
    """断言 4: 逐一选择 H1/H2/H3/H4/H5/正文 转换块"""
    # 使用 hero 块（初始 H1），依次转 H2→H3→H4→H5→正文→H1
    hero_id = "hero"
    conversions = [
        ("H2", "H2", "hn-note-heading--2"),
        ("H3", "H3", "hn-note-heading--3"),
        ("H4", "H4", "hn-note-heading--4"),
        ("H5", "H5", "hn-note-heading--5"),
        ("正文", "paragraph", None),
        ("H1", "H1", "hn-note-heading--1"),
    ]

    all_ok = True
    for label, expected_kind, expected_class in conversions:
        # 悬停 hero 块的可编辑 span（hover 会冒泡到 .hn-note-block-row 触发 CSS :hover）
        page.locator(f'[data-editable-block-id="{hero_id}"]').hover()
        page.wait_for_timeout(200)
        # 点击该行内的 handle（通过 DOM 查询定位，避免 ElementHandle 类型问题）
        page.evaluate(
            """(blockId) => {
                const el = document.querySelector(`[data-editable-block-id="${blockId}"]`);
                const row = el ? el.closest('.hn-note-block-row') : null;
                const handle = row ? row.querySelector('.hn-note-block-handle') : null;
                if (handle) (handle).click();
            }""",
            hero_id,
        )
        page.wait_for_timeout(300)

        # 点击目标菜单项
        item = page.locator(".hn-note-block-menu-item", has_text=label)
        item.click()
        page.wait_for_timeout(500)

        if expected_kind == "paragraph":
            # 检查 hero 变为 paragraph
            kind = page.locator(f'[data-editable-block-id="{hero_id}"]').evaluate(
                """el => {
                    const p = el.closest('.hn-note-paragraph');
                    const h = el.closest('.hn-note-block--heading');
                    return p ? 'paragraph' : h ? 'heading' : 'other';
                }"""
            )
            ok = kind == "paragraph"
            r.details.append(f"转 {label}: kind={kind} ok={ok}")
        else:
            tag = page.locator(
                f'[data-editable-block-id="{hero_id}"]'
            ).evaluate("el => el.tagName")
            cls = page.locator(
                f'[data-editable-block-id="{hero_id}"]'
            ).get_attribute("class") or ""
            ok = tag == expected_kind and expected_class in cls
            r.details.append(
                f"转 {label}: tag={tag} class_has={expected_class in cls} ok={ok}"
            )

        all_ok = all_ok and ok

    page.screenshot(path=str(EVIDENCE_DIR / "04_format_conversion.png"))
    r.screenshot = "04_format_conversion.png"

    # 验证 Markdown 面板同步
    md = get_markdown_panel(page)
    md_has_h1 = md.lstrip().startswith("# ") or "\n# " in md
    r.details.append(f"最终 Markdown 面板以 H1 开头: {md_has_h1}")

    r.passed = all_ok


def assert_05_enter_split(page: Page, r: CheckResult) -> None:
    """断言 5: 段落中间按 Enter 拆分为两块"""
    page.reload()
    page.wait_for_load_state("networkidle")
    enable_editable(page)

    before = get_block_count(page)
    r.details.append(f"拆分前块数量: {before}")

    intro = page.locator('[data-editable-block-id="intro"]')
    intro_text = intro.inner_text()
    mid = len(intro_text) // 2
    r.details.append(f"intro 文本长度: {len(intro_text)}, 光标: {mid}")

    focus_block_and_set_caret(page, "intro", mid)
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)

    after = get_block_count(page)
    r.details.append(f"拆分后块数量: {after}")
    count_ok = after == before + 1

    new_block = page.locator('[data-editable-block-id="intro-line"]')
    new_exists = new_block.count() > 0
    r.details.append(f"新块 intro-line 存在: {new_exists}")

    if new_exists:
        r.details.append(f"新块文本: {new_block.inner_text()[:50]}...")

    page.screenshot(path=str(EVIDENCE_DIR / "05_enter_split.png"))
    r.screenshot = "05_enter_split.png"

    r.passed = count_ok and new_exists


def assert_06_shift_enter(page: Page, r: CheckResult) -> None:
    """断言 6: Shift+Enter 插入 <br> 软换行（同一块内）"""
    page.reload()
    page.wait_for_load_state("networkidle")
    enable_editable(page)

    before = get_block_count(page)
    r.details.append(f"软换行前块数量: {before}")

    ending = page.locator('[data-editable-block-id="ending"]')
    ending_text = ending.inner_text()
    mid = len(ending_text) // 2
    focus_block_and_set_caret(page, "ending", mid)

    page.keyboard.press("Shift+Enter")
    page.wait_for_timeout(300)

    after = get_block_count(page)
    r.details.append(f"软换行后块数量: {after}")
    count_ok = after == before

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

    page.screenshot(path=str(EVIDENCE_DIR / "06_shift_enter.png"))
    r.screenshot = "06_shift_enter.png"

    r.passed = count_ok and has_br and md_has_br


def assert_07_backspace(page: Page, r: CheckResult) -> None:
    """断言 7: 空块 Backspace 删除+恢复焦点；唯一块重置为空段落"""
    # --- 7a: 多块场景，删除空块 ---
    page.reload()
    page.wait_for_load_state("networkidle")
    enable_editable(page)

    before = get_block_count(page)
    r.details.append(f"[7a] 删除前块数量: {before}")

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
    r.details.append(f"[7a] 删除后块数量: {after}")
    count_ok = after == before - 1

    sub_gone = page.locator('[data-editable-block-id="subheading"]').count() == 0
    r.details.append(f"[7a] subheading 已删除: {sub_gone}")

    focused_id = page.evaluate(
        "document.activeElement?.getAttribute('data-editable-block-id') || ''"
    )
    r.details.append(f"[7a] 删除后焦点块 ID: {focused_id}")
    focus_ok = focused_id != "" and focused_id != "subheading"

    page.screenshot(path=str(EVIDENCE_DIR / "07a_backspace_delete.png"))

    # --- 7b: 唯一块场景，重置为空段落 ---
    page.reload()
    page.wait_for_load_state("networkidle")
    enable_editable(page)

    single = [{"id": "solo", "kind": "paragraph", "text": "placeholder text"}]
    set_document_blocks(page, single)

    solo = page.locator('[data-editable-block-id="solo"]')
    solo.click()
    page.wait_for_timeout(200)
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_timeout(200)

    focus_block_and_set_caret(page, "solo", 0)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)

    after_b = get_block_count(page)
    r.details.append(f"[7b] Backspace 后块数量: {after_b}")
    count_ok_b = after_b == 1

    solo_exists = page.locator('[data-editable-block-id="solo"]').count() > 0
    r.details.append(f"[7b] solo 块仍存在: {solo_exists}")

    block_class = page.locator(
        '[data-editable-block-id="solo"]'
    ).evaluate(
        """el => {
            let p = el;
            while (p && !p.className.includes('hn-note-paragraph') && !p.className.includes('hn-note-block--heading')) p = p.parentElement;
            return p?.className || '';
        }"""
    )
    is_para = "hn-note-paragraph" in block_class
    r.details.append(f"[7b] 块容器为 paragraph: {is_para}")

    page.screenshot(path=str(EVIDENCE_DIR / "07b_last_block.png"))
    r.screenshot = "07b_last_block.png"

    r.passed = count_ok and sub_gone and focus_ok and count_ok_b and solo_exists and is_para


def assert_08_boundary(page: Page, r: CheckResult) -> None:
    """断言 8: >800px 菜单贴近 handle；<=800px 水平居中"""
    page.reload()
    page.wait_for_load_state("networkidle")

    # --- 宽屏 801px ---
    page.set_viewport_size({"width": 801, "height": 900})
    enable_editable(page)

    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)
    handle = heading_row.locator(".hn-note-block-handle")
    handle_box = handle.bounding_box()
    handle.click()
    page.wait_for_timeout(300)

    menu = page.locator(".hn-note-block-menu")
    menu_box = menu.bounding_box()
    menu_style = menu.evaluate(
        """el => {
            const s = window.getComputedStyle(el);
            return { position: s.position, left: s.left, transform: s.transform, top: s.top };
        }"""
    )
    r.details.append(f"[801px] handle box: {handle_box}")
    r.details.append(f"[801px] menu box: {menu_box}")
    r.details.append(f"[801px] menu style: {menu_style}")

    # 宽屏：transform=none（不居中），菜单在 handle 右侧附近
    wide_not_centered = menu_style["transform"] == "none"
    # 菜单 left 应接近 handle 右边缘 + 8px
    wide_near_handle = False
    if handle_box and menu_box:
        wide_near_handle = menu_box["x"] >= handle_box["x"] + handle_box["width"] - 5
    r.details.append(f"[801px] 未居中: {wide_not_centered}, 贴近 handle: {wide_near_handle}")

    page.screenshot(path=str(EVIDENCE_DIR / "08a_wide_menu.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # --- 窄屏 799px ---
    page.set_viewport_size({"width": 799, "height": 900})
    page.wait_for_timeout(300)

    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)
    handle = heading_row.locator(".hn-note-block-handle")
    handle.click()
    page.wait_for_timeout(300)

    menu = page.locator(".hn-note-block-menu")
    narrow_menu_box = menu.bounding_box()
    narrow_style = menu.evaluate(
        """el => {
            const s = window.getComputedStyle(el);
            return { position: s.position, left: s.left, transform: s.transform, top: s.top };
        }"""
    )
    r.details.append(f"[799px] menu box: {narrow_menu_box}")
    r.details.append(f"[799px] menu style: {narrow_style}")

    # 窄屏：transform 含 matrix（translateX(-50%)）
    narrow_centered = "matrix" in narrow_style["transform"]
    # 菜单水平居中：box 中心 ≈ viewport 中心
    narrow_centered_pos = False
    if narrow_menu_box:
        center = narrow_menu_box["x"] + narrow_menu_box["width"] / 2
        narrow_centered_pos = abs(center - 799 / 2) < 5
    r.details.append(f"[799px] transform 居中: {narrow_centered}, 位置居中: {narrow_centered_pos}")

    page.screenshot(path=str(EVIDENCE_DIR / "08b_narrow_menu.png"))
    r.screenshot = "08b_narrow_menu.png"
    page.keyboard.press("Escape")

    r.passed = wide_not_centered and wide_near_handle and narrow_centered and narrow_centered_pos


def assert_09_no_leak(page: Page, r: CheckResult) -> None:
    """断言 9: checklist/quote/code/callout 无 handle 且 Enter 不拆分"""
    page.reload()
    page.wait_for_load_state("networkidle")
    page.set_viewport_size({"width": 1280, "height": 900})
    enable_editable(page)

    before = get_block_count(page)
    r.details.append(f"初始块数量: {before}")

    all_ok = True

    # --- 9a: 检查无 handle ---
    # checklist
    checklist_handles = page.locator(
        ".hn-note-checklist-item .hn-note-block-handle"
    ).count()
    r.details.append(f"checklist 内 handle 数: {checklist_handles}")
    all_ok = all_ok and checklist_handles == 0

    # quote
    quote_handles = page.locator(
        ".hn-note-quote .hn-note-block-handle"
    ).count()
    r.details.append(f"quote 内 handle 数: {quote_handles}")
    all_ok = all_ok and quote_handles == 0

    # code
    code_handles = page.locator(
        ".hn-note-code-card .hn-note-block-handle"
    ).count()
    r.details.append(f"code 内 handle 数: {code_handles}")
    all_ok = all_ok and code_handles == 0

    # callout
    callout_handles = page.locator(
        ".hn-note-callout .hn-note-block-handle"
    ).count()
    r.details.append(f"callout 内 handle 数: {callout_handles}")
    all_ok = all_ok and callout_handles == 0

    # --- 9b: Enter 不拆分 ---
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

    page.screenshot(path=str(EVIDENCE_DIR / "09_no_leak.png"))
    r.screenshot = "09_no_leak.png"

    r.passed = all_ok


def assert_10_no_console_errors(tracker: GlobalConsoleTracker, r: CheckResult) -> None:
    """断言 10: 全程无控制台错误"""
    all_errors = tracker.snapshot()
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
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(BASE_URL, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


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
    tracker = GlobalConsoleTracker()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        )
        page = context.new_page()
        tracker.attach(page)

        # ===== 断言 1 =====
        print("[1/10] Demo 加载无控制台错误...")
        r = CheckResult("01", "Demo 加载无控制台错误")
        try:
            assert_01_load_no_console(page, r, tracker)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 断言 2 =====
        print("[2/10] hover/focus 显示 handle...")
        r = CheckResult("02", "hover/focus heading+paragraph 显示 handle")
        try:
            assert_02_hover_handle(page, r)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 断言 3 =====
        print("[3/10] 点击 handle 打开格式菜单...")
        r = CheckResult("03", "点击 handle 打开格式菜单 H1-H5+正文")
        try:
            assert_03_menu_items(page, r)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 断言 4 =====
        print("[4/10] 格式转换 H1/H2/H3/H4/H5/正文...")
        r = CheckResult("04", "选择 H1/H2/H3/H4/H5/正文 转换块")
        try:
            assert_04_format_conversion(page, r)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 断言 5 =====
        print("[5/10] Enter 拆分段落...")
        r = CheckResult("05", "Enter 段落中间拆分为两块")
        try:
            assert_05_enter_split(page, r)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 断言 6 =====
        print("[6/10] Shift+Enter 软换行...")
        r = CheckResult("06", "Shift+Enter 插入 <br> 软换行")
        try:
            assert_06_shift_enter(page, r)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 断言 7 =====
        print("[7/10] Backspace 删除/最后一块保护...")
        r = CheckResult("07", "Backspace 删除空块+最后一块重置")
        try:
            assert_07_backspace(page, r)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 断言 8 =====
        print("[8/10] 800px 边界菜单定位...")
        r = CheckResult("08", ">800px 贴 handle / <=800px 居中")
        try:
            assert_08_boundary(page, r)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 断言 9 =====
        print("[9/10] 非文本块无 handle+Enter 不拆分...")
        r = CheckResult("09", "checklist/quote/code/callout 无 handle+不拆分")
        try:
            assert_09_no_leak(page, r)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            traceback.print_exc()
        results.append(r)
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        context.close()
        browser.close()

    # ===== 断言 10 =====
    print("[10/10] 全程无控制台错误...")
    r = CheckResult("10", "全程无控制台错误")
    assert_10_no_console_errors(tracker, r)
    results.append(r)
    print(f"  -> {'PASS' if r.passed else 'FAIL'}")

    # 停止 dev server
    os.killpg(os.getpgid(server_proc.pid), signal.SIGTERM)
    try:
        server_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(server_proc.pid), signal.SIGKILL)
    print("Dev server 已停止")

    # 写 JSON 报告
    json_path = EVIDENCE_DIR / "f4-qa-report.json"
    json_path.write_text(
        json.dumps(
            {
                "checks": [r.to_dict() for r in results],
                "all_passed": all(r.passed for r in results),
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # 打印总结
    passed = sum(1 for r in results if r.passed)
    total = len(results)
    print(f"\n===== F4 总结: {passed}/{total} 通过 =====")
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        print(f"  [{status}] {r.check_id} {r.name}")

    all_passed = all(r.passed for r in results)
    print(f"\n=== VERDICT: {'APPROVE' if all_passed else 'REJECT'} ===")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
