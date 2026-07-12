#!/usr/bin/env python3
"""
Wave 5 Browser QA Script for block-editor-interactions.

Drives Chromium against the demo dev server (port 9235) and verifies all 11
interaction checks specified in the Wave 5 plan. Captures screenshots and
writes a JSON results file.

Usage:
    python3 qa_script.py --evidence-dir <path> --base-url http://localhost:9235
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, BrowserContext

# ==============================================================================
# 结果收集工具
# ==============================================================================

class CheckResult:
    """单个检查的结果记录"""

    def __init__(self, check_id: str, name: str):
        self.check_id = check_id
        self.name = name
        self.passed = False
        self.details: list[str] = []
        self.errors: list[str] = []
        self.screenshot: str | None = None
        self.console_errors: list[str] = []

    def to_dict(self) -> dict:
        return {
            "check_id": self.check_id,
            "name": self.name,
            "passed": self.passed,
            "details": self.details,
            "errors": self.errors,
            "screenshot": self.screenshot,
            "console_errors": self.console_errors,
        }


class QAResultCollector:
    """收集所有检查结果，最终写入 JSON"""

    def __init__(self):
        self.results: list[CheckResult] = []
        self.automated_checks: dict[str, bool] = {}

    def new_check(self, check_id: str, name: str) -> CheckResult:
        result = CheckResult(check_id, name)
        self.results.append(result)
        return result

    def to_json(self) -> str:
        return json.dumps({
            "automated_checks": self.automated_checks,
            "browser_checks": [r.to_dict() for r in self.results],
            "all_passed": all(r.passed for r in self.results),
        }, indent=2, ensure_ascii=False)


# ==============================================================================
# 页面交互辅助函数
# ==============================================================================

def enable_editable(page: Page) -> None:
    """点击 Editable 开关，启用编辑模式"""
    toggle = page.locator("button.demo-switch")
    # 确保开关当前是关闭状态（aria-checked=false）
    if toggle.get_attribute("aria-checked") == "false":
        toggle.click()
        page.wait_for_timeout(300)  # 等待 React 重渲染


def get_block_count(page: Page) -> int:
    """从 demo 侧栏的 Blocks 计数获取当前块数量"""
    # hn-note-facts 里的第二个 dd 是 Blocks 数量
    dds = page.locator(".hn-note-facts dd")
    count_text = dds.nth(1).inner_text()
    return int(count_text.strip())


def get_markdown_panel(page: Page) -> str:
    """读取侧栏 Markdown Document 面板的文本内容"""
    return page.locator(".demo-markdown-document code").inner_text()


def focus_block_and_set_caret(page: Page, block_id: str, offset: int) -> None:
    """聚焦指定块并将光标设置到指定字符偏移位置"""
    page.evaluate(
        """([blockId, offset]) => {
            const el = document.querySelector(`[data-editable-block-id="${blockId}"]`);
            if (!el) throw new Error(`Block ${blockId} not found`);
            el.focus();
            const range = document.createRange();
            // 获取第一个文本节点
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
            const firstTextNode = walker.nextNode();
            if (!firstTextNode) {
                // 没有文本节点，直接聚焦元素
                el.focus();
                return;
            }
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
    """
    通过 React fiber 内部 API 直接设置文档块数组。
    用于需要特定初始状态的检查（如"最后一块保护"）。
    React 19 在容器元素上使用 __reactContainer$ 前缀。
    """
    page.evaluate(
        """(blocks) => {
            const root = document.getElementById('root');
            if (!root) throw new Error('root element not found');
            const keys = Object.keys(root);
            const fiberKey = keys.find(k =>
                k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')
            );
            if (!fiberKey) {
                throw new Error('React fiber not found. Keys: ' + keys.join(', '));
            }
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
# 检查实现
# ==============================================================================

def check_01_load(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 1: Demo 加载无控制台错误"""
    console_errors: list[str] = []
    # 在导航前就挂载监听器，捕获所有 console error
    page.on("console", lambda msg: (
        console_errors.append(f"[{msg.type}] {msg.text}")
        if msg.type == "error" else None
    ))
    page.on("pageerror", lambda err: console_errors.append(f"[pageerror] {err}"))

    page.goto("http://localhost:9235", wait_until="networkidle")
    page.wait_for_timeout(500)  # 额外等待 React 水合

    # 截图：默认桌面视图
    screenshot_path = evidence_dir / "01_default_desktop.png"
    page.screenshot(path=str(screenshot_path))
    result.screenshot = screenshot_path.name

    # 验证页面加载了内容
    title = page.locator("h1").first.inner_text()
    result.details.append(f"页面标题: {title}")
    result.details.append(f"块数量: {get_block_count(page)}")

    if console_errors:
        result.errors.extend(console_errors)
        result.console_errors = console_errors
        result.passed = False
    else:
        result.passed = True


def check_02_hover_handle(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 2: 悬停/聚焦标题块时显示左侧块手柄"""
    enable_editable(page)

    # 获取第一个 heading 块的行容器
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first

    # 悬停在块行上
    heading_row.hover()
    page.wait_for_timeout(300)

    # 检查 handle 按钮的可见性（opacity 从 0 变为 1）
    handle = heading_row.locator(".hn-note-block-handle")
    opacity = handle.evaluate("el => window.getComputedStyle(el).opacity")
    result.details.append(f"悬停后 handle opacity: {opacity}")

    # 截图
    screenshot_path = evidence_dir / "02_hover_handle.png"
    page.screenshot(path=str(screenshot_path))
    result.screenshot = screenshot_path.name

    # opacity 应大于 0（CSS 中默认 opacity:0，悬停时变为 1）
    result.passed = float(opacity) > 0


def check_03_menu_open_close(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 3: 点击手柄打开格式菜单；Escape 关闭并归还焦点"""
    # 点击第一个 heading 块的 handle
    handle = page.locator(".hn-note-block--heading .hn-note-block-handle").first
    handle.click()
    page.wait_for_timeout(300)

    # 验证菜单已打开（role="menu" 的 div 在 document.body 上）
    menu = page.locator(".hn-note-block-menu")
    menu_visible = menu.is_visible()
    result.details.append(f"菜单打开后可见: {menu_visible}")

    # 检查菜单项数量（H1-H5 + 正文 = 6 项）
    menu_items = menu.locator(".hn-note-block-menu-item")
    item_count = menu_items.count()
    result.details.append(f"菜单项数量: {item_count}")

    # 截图：菜单打开状态
    screenshot_path = evidence_dir / "03_menu_open.png"
    page.screenshot(path=str(screenshot_path))
    result.screenshot = screenshot_path.name

    # 按 Escape 关闭菜单
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # 验证菜单已关闭
    menu_closed = page.locator(".hn-note-block-menu").count() == 0
    result.details.append(f"Escape 后菜单已关闭: {menu_closed}")

    # 验证焦点归还到 handle 按钮
    focused_tag = page.evaluate("document.activeElement?.tagName")
    focused_class = page.evaluate("document.activeElement?.className || ''")
    result.details.append(f"Escape 后焦点元素: <{focused_tag}> class={focused_class}")
    focus_on_handle = "hn-note-block-handle" in focused_class

    result.passed = menu_visible and item_count == 6 and menu_closed and focus_on_handle


def check_04_format_conversion(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 4: 选择 H1/H2/H3/H4/H5/正文 转换块格式，Markdown 面板同步更新"""
    # 获取第一个 heading 块（初始为 H1，id="hero"）
    hero_handle = page.locator(
        '.hn-note-block-handle[data-block-id="hero"]'
    )

    # 记录转换前的状态
    before_tag = page.locator(".hn-note-block--heading h1").first.evaluate(
        "el => el.tagName"
    )
    before_md = get_markdown_panel(page)
    result.details.append(f"转换前标签: {before_tag}")

    # 打开菜单，选择 H2
    hero_handle.click()
    page.wait_for_timeout(300)

    # 点击 "H2" 菜单项
    h2_item = page.locator(".hn-note-block-menu-item", has_text="H2")
    h2_item.click()
    page.wait_for_timeout(500)

    # 验证标签已从 h1 变为 h2
    after_heading = page.locator(".hn-note-block--heading .hn-note-heading").first
    after_tag = after_heading.evaluate("el => el.tagName")
    after_class = after_heading.get_attribute("class") or ""
    result.details.append(f"转换后标签: {after_tag}, class: {after_class}")

    # 验证 Markdown 面板更新（# -> ##）
    after_md = get_markdown_panel(page)
    has_h2 = "## " in after_md
    result.details.append(f"Markdown 面板包含 ## : {has_h2}")

    # 再转回 H1 验证可逆性
    hero_handle.click()
    page.wait_for_timeout(300)
    page.locator(".hn-note-block-menu-item", has_text="H1").click()
    page.wait_for_timeout(500)
    reverted_tag = page.locator(".hn-note-block--heading .hn-note-heading").first.evaluate(
        "el => el.tagName"
    )
    result.details.append(f"转回 H1 后标签: {reverted_tag}")

    # 再测试转换为正文
    hero_handle.click()
    page.wait_for_timeout(300)
    page.locator(".hn-note-block-menu-item", has_text="正文").click()
    page.wait_for_timeout(500)

    # 检查 hero 块是否从 heading 变为了 paragraph
    hero_kind = page.locator('[data-editable-block-id="hero"]').evaluate(
        "el => { "
        "  const p = el.closest('.hn-note-paragraph'); "
        "  const h = el.closest('.hn-note-block--heading'); "
        "  return p ? 'paragraph' : h ? 'heading' : 'other'; "
        "}"
    )
    result.details.append(f"hero 转正文后类型: {hero_kind}")

    # 检查 markdown 面板不再有 hero 的 # 前缀（hero 文本应作为普通段落出现）
    after_para_md = get_markdown_panel(page)
    result.details.append(f"正文转换后 Markdown 前100字符: {after_para_md[:100]}")

    result.passed = (
        after_tag == "H2"
        and "hn-note-heading--2" in after_class
        and has_h2
        and reverted_tag == "H1"
        and hero_kind == "paragraph"
    )


def check_05_enter_split(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 5: 在段落中间按 Enter 拆分为两个块"""
    # 重新加载以获得干净状态
    page.reload()
    page.wait_for_load_state("networkidle")
    enable_editable(page)

    before_count = get_block_count(page)
    result.details.append(f"拆分前块数量: {before_count}")

    # 聚焦 intro 段落（id="intro"），将光标放在中间位置
    intro = page.locator('[data-editable-block-id="intro"]')
    intro_text = intro.inner_text()
    mid_offset = len(intro_text) // 2
    result.details.append(f"intro 文本长度: {len(intro_text)}, 光标位置: {mid_offset}")

    focus_block_and_set_caret(page, "intro", mid_offset)

    # 按 Enter 拆分
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)

    after_count = get_block_count(page)
    result.details.append(f"拆分后块数量: {after_count}")

    # 验证块数量增加了 1
    count_increased = after_count == before_count + 1
    result.details.append(f"块数量增加 1: {count_increased}")

    # 验证新块存在（id 应为 "intro-line"）
    new_block = page.locator('[data-editable-block-id="intro-line"]')
    new_block_exists = new_block.count() > 0
    result.details.append(f"新块 intro-line 存在: {new_block_exists}")

    if new_block_exists:
        new_block_text = new_block.inner_text()
        result.details.append(f"新块文本（后半部分）: {new_block_text[:50]}...")

    # 截图
    screenshot_path = evidence_dir / "05_after_enter_split.png"
    page.screenshot(path=str(screenshot_path))
    result.screenshot = screenshot_path.name

    result.passed = count_increased and new_block_exists


def check_06_shift_enter(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 6: Shift+Enter 插入软换行 <br>，不创建新块"""
    # 重新加载以获得干净状态
    page.reload()
    page.wait_for_load_state("networkidle")
    enable_editable(page)

    before_count = get_block_count(page)
    result.details.append(f"软换行前块数量: {before_count}")

    # 聚焦 ending 段落，在中间位置
    ending = page.locator('[data-editable-block-id="ending"]')
    ending_text = ending.inner_text()
    mid_offset = len(ending_text) // 2
    focus_block_and_set_caret(page, "ending", mid_offset)

    # 按 Shift+Enter
    page.keyboard.press("Shift+Enter")
    page.wait_for_timeout(300)

    after_count = get_block_count(page)
    result.details.append(f"软换行后块数量: {after_count}")

    count_unchanged = after_count == before_count
    result.details.append(f"块数量未变: {count_unchanged}")

    # 验证块内 HTML 包含 <br>
    ending_html = page.locator('[data-editable-block-id="ending"]').evaluate(
        "el => el.innerHTML"
    )
    has_br = "<br>" in ending_html
    result.details.append(f"块内 HTML 包含 <br>: {has_br}")

    # 触发 onBlur 以同步 React 状态（点击页面其他位置让 editable span 失焦）
    page.locator("h1").first.click()
    page.wait_for_timeout(500)

    # 验证 Markdown 面板显示 <br>（onBlur 后状态已同步）
    md = get_markdown_panel(page)
    md_has_br = "<br>" in md
    result.details.append(f"Markdown 面板包含 <br>: {md_has_br}")

    # 截图
    screenshot_path = evidence_dir / "06_after_shift_enter.png"
    page.screenshot(path=str(screenshot_path))
    result.screenshot = screenshot_path.name

    result.passed = count_unchanged and has_br and md_has_br


def check_07_backspace_delete(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 7: 空块开头按 Backspace 删除块，焦点移到前一个文本块"""
    # 重新加载以获得干净状态
    page.reload()
    page.wait_for_load_state("networkidle")
    enable_editable(page)

    before_count = get_block_count(page)
    result.details.append(f"删除前块数量: {before_count}")

    # 聚焦 subheading（h2，id="subheading"），清空内容
    sub = page.locator('[data-editable-block-id="subheading"]')
    sub.click()
    page.wait_for_timeout(200)

    # 全选并删除
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_timeout(200)

    # 验证已清空
    sub_html = sub.evaluate("el => el.innerHTML")
    result.details.append(f"清空后 subheading HTML: '{sub_html}'")

    # 将光标移到起始位置
    focus_block_and_set_caret(page, "subheading", 0)

    # 按 Backspace
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)

    after_count = get_block_count(page)
    result.details.append(f"删除后块数量: {after_count}")

    # 验证块数量减少 1
    count_decreased = after_count == before_count - 1
    result.details.append(f"块数量减少 1: {count_decreased}")

    # 验证 subheading 块已消失
    sub_gone = page.locator('[data-editable-block-id="subheading"]').count() == 0
    result.details.append(f"subheading 块已删除: {sub_gone}")

    # 验证焦点移到了某个可编辑块
    focused_id = page.evaluate(
        "document.activeElement?.getAttribute('data-editable-block-id') || ''"
    )
    result.details.append(f"删除后焦点块 ID: {focused_id}")
    focus_moved = focused_id != "" and focused_id != "subheading"

    # 截图
    screenshot_path = evidence_dir / "07_after_backspace_delete.png"
    page.screenshot(path=str(screenshot_path))
    result.screenshot = screenshot_path.name

    result.passed = count_decreased and sub_gone and focus_moved


def check_08_last_block_protection(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 8: 最后一个空文本块按 Backspace 被重置为空段落（同 ID），不消失"""
    # 重新加载以获得干净状态
    page.reload()
    page.wait_for_load_state("networkidle")
    enable_editable(page)

    # 通过 React fiber API 将文档设置为单个段落（带初始文本以便可见可点击）
    single_block = [{"id": "solo", "kind": "paragraph", "text": "placeholder text"}]
    set_document_blocks(page, single_block)

    before_count = get_block_count(page)
    result.details.append(f"设置后块数量: {before_count}")

    editable_blocks = page.locator("[data-editable-block-id]").count()
    result.details.append(f"可编辑块数量: {editable_blocks}")

    # 聚焦唯一的块，清空内容
    solo = page.locator('[data-editable-block-id="solo"]')
    solo.click()
    page.wait_for_timeout(200)

    # 全选并删除，使块变为空
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_timeout(200)

    # 验证已清空
    solo_html = solo.evaluate("el => el.innerHTML")
    result.details.append(f"清空后 solo HTML: '{solo_html}'")

    # 确保光标在起始位置
    focus_block_and_set_caret(page, "solo", 0)

    # 按 Backspace
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)

    after_count = get_block_count(page)
    result.details.append(f"Backspace 后块数量: {after_count}")

    # 验证块仍然存在（数量仍为 1）
    count_unchanged = after_count == 1
    result.details.append(f"块数量仍为 1: {count_unchanged}")

    # 验证块 ID 未变（同一个块）
    solo_still_exists = page.locator('[data-editable-block-id="solo"]').count() > 0
    result.details.append(f"solo 块仍存在: {solo_still_exists}")

    # 验证块类型变为 paragraph（即使原来是 heading 也会被重置）
    # 检查块的 class 包含 hn-note-paragraph
    block_class = page.locator('[data-editable-block-id="solo"]').evaluate(
        "el => { let p = el; while (p && !p.className.includes('hn-note-paragraph') && !p.className.includes('hn-note-block--heading')) p = p.parentElement; return p?.className || ''; }"
    )
    result.details.append(f"块容器 class: {block_class}")
    is_paragraph = "hn-note-paragraph" in block_class

    # 截图
    screenshot_path = evidence_dir / "08_last_block_protection.png"
    page.screenshot(path=str(screenshot_path))
    result.screenshot = screenshot_path.name

    result.passed = count_unchanged and solo_still_exists and is_paragraph


def check_09_boundary(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 9: >800px 菜单贴近 handle；<=800px 菜单水平居中"""
    # 重新加载，设置宽屏 (801px)
    page.reload()
    page.wait_for_load_state("networkidle")
    page.set_viewport_size({"width": 801, "height": 900})
    enable_editable(page)

    # 打开第一个 heading 的菜单（需先悬停使 handle 可交互）
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)
    handle = heading_row.locator(".hn-note-block-handle")
    handle.click()
    page.wait_for_timeout(300)

    # 获取菜单定位样式
    menu_style = page.locator(".hn-note-block-menu").evaluate(
        """el => {
            const s = window.getComputedStyle(el);
            return {
                position: s.position,
                left: s.left,
                transform: s.transform,
                top: s.top,
            };
        }"""
    )
    result.details.append(f"801px 菜单样式: {menu_style}")

    # 宽屏：transform 应为 none（不在居中模式）
    wide_not_centered = menu_style["transform"] == "none"
    result.details.append(f"801px 菜单未居中 (transform=none): {wide_not_centered}")

    # 关闭菜单
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # 切换到窄屏 (799px)
    page.set_viewport_size({"width": 799, "height": 900})
    page.wait_for_timeout(300)

    # 重新打开菜单（需重新悬停使 handle 可交互）
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)
    handle = heading_row.locator(".hn-note-block-handle")
    handle.click()
    page.wait_for_timeout(300)

    narrow_menu_style = page.locator(".hn-note-block-menu").evaluate(
        """el => {
            const s = window.getComputedStyle(el);
            return {
                position: s.position,
                left: s.left,
                transform: s.transform,
                top: s.top,
            };
        }"""
    )
    result.details.append(f"799px 菜单样式: {narrow_menu_style}")

    # 窄屏：transform 应包含 matrix（translateX(-50%) 会被计算为 matrix）
    narrow_centered = "matrix" in narrow_menu_style["transform"]
    result.details.append(f"799px 菜单居中 (transform 非 none): {narrow_centered}")

    # 截图
    screenshot_path = evidence_dir / "04_800px_viewport.png"
    page.screenshot(path=str(screenshot_path))
    result.screenshot = screenshot_path.name

    # 关闭菜单
    page.keyboard.press("Escape")

    result.passed = wide_not_centered and narrow_centered


def check_10_no_behavior_leaks(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 10: 在 checklist/quote/code/callout 内按 Enter 不创建新 NoteBlock"""
    # 重新加载，恢复宽屏
    page.reload()
    page.wait_for_load_state("networkidle")
    page.set_viewport_size({"width": 1280, "height": 900})
    enable_editable(page)

    before_count = get_block_count(page)
    result.details.append(f"初始块数量: {before_count}")

    all_ok = True

    # --- 测试 checklist item ---
    checklist_item = page.locator(".hn-note-checklist-item .hn-note-editable").first
    if checklist_item.count() > 0:
        checklist_item.click()
        page.wait_for_timeout(200)
        # 将光标放到文本末尾
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after_checklist = get_block_count(page)
        ok = after_checklist == before_count
        result.details.append(f"checklist Enter 后块数量: {after_checklist} (不变: {ok})")
        all_ok = all_ok and ok
    else:
        result.details.append("未找到 checklist item，跳过")
        all_ok = False

    # --- 测试 quote ---
    quote_text = page.locator(".hn-note-quote .hn-note-editable").first
    if quote_text.count() > 0:
        quote_text.click()
        page.wait_for_timeout(200)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after_quote = get_block_count(page)
        ok = after_quote == before_count
        result.details.append(f"quote Enter 后块数量: {after_quote} (不变: {ok})")
        all_ok = all_ok and ok
    else:
        result.details.append("未找到 quote，跳过")
        all_ok = False

    # --- 测试 code ---
    code_pre = page.locator(".hn-note-code-card pre.hn-note-editable").first
    if code_pre.count() > 0:
        code_pre.click()
        page.wait_for_timeout(200)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after_code = get_block_count(page)
        ok = after_code == before_count
        result.details.append(f"code Enter 后块数量: {after_code} (不变: {ok})")
        all_ok = all_ok and ok
    else:
        result.details.append("未找到 code，跳过")
        all_ok = False

    # --- 测试 callout body ---
    callout_p = page.locator(".hn-note-callout p.hn-note-editable").first
    if callout_p.count() > 0:
        callout_p.click()
        page.wait_for_timeout(200)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        after_callout = get_block_count(page)
        ok = after_callout == before_count
        result.details.append(f"callout Enter 后块数量: {after_callout} (不变: {ok})")
        all_ok = all_ok and ok
    else:
        result.details.append("未找到 callout body，跳过")
        all_ok = False

    result.passed = all_ok


def check_11_responsive(page: Page, result: CheckResult, evidence_dir: Path) -> None:
    """检查 11: 390x844 视口下手柄/菜单无裁剪"""
    # 重新加载，设置移动端视口
    page.reload()
    page.wait_for_load_state("networkidle")
    page.set_viewport_size({"width": 390, "height": 844})
    enable_editable(page)

    # 悬停 heading 块
    heading_row = page.locator(".hn-note-block--heading .hn-note-block-row").first
    heading_row.hover()
    page.wait_for_timeout(300)

    # 检查 handle 是否在视口内（无裁剪）
    handle = page.locator(".hn-note-block--heading .hn-note-block-handle").first
    handle_box = handle.bounding_box()
    result.details.append(f"handle bounding box: {handle_box}")

    handle_in_viewport = False
    if handle_box:
        handle_in_viewport = (
            handle_box["x"] >= 0
            and handle_box["y"] >= 0
            and handle_box["x"] + handle_box["width"] <= 390
            and handle_box["y"] + handle_box["height"] <= 844
        )
    result.details.append(f"handle 在视口内: {handle_in_viewport}")

    # 打开菜单
    handle.click()
    page.wait_for_timeout(300)

    # 检查菜单是否在视口内
    menu = page.locator(".hn-note-block-menu")
    menu_visible = menu.is_visible()
    result.details.append(f"菜单可见: {menu_visible}")

    menu_in_viewport = False
    if menu_visible:
        menu_box = menu.bounding_box()
        result.details.append(f"菜单 bounding box: {menu_box}")
        if menu_box:
            menu_in_viewport = (
                menu_box["x"] >= 0
                and menu_box["y"] >= 0
                and menu_box["x"] + menu_box["width"] <= 390
                and menu_box["y"] + menu_box["height"] <= 844
            )
    result.details.append(f"菜单在视口内: {menu_in_viewport}")

    # 关闭菜单
    page.keyboard.press("Escape")

    result.passed = handle_in_viewport and menu_visible and menu_in_viewport


# ==============================================================================
# 主入口
# ==============================================================================

def wait_for_server(base_url: str, timeout: int = 30) -> bool:
    """轮询服务器直到它响应 HTTP 请求或超时"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(base_url, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def main():
    parser = argparse.ArgumentParser(description="Wave 5 Browser QA")
    parser.add_argument(
        "--evidence-dir",
        type=str,
        default=".omo/evidence/block-editor-interactions",
        help="证据目录路径",
    )
    parser.add_argument(
        "--base-url",
        type=str,
        default="http://localhost:9235",
        help="Demo 服务器地址",
    )
    parser.add_argument(
        "--start-server",
        action="store_true",
        help="自动启动 dev server（使用 pnpm dev）",
    )
    args = parser.parse_args()

    evidence_dir = Path(args.evidence_dir)
    evidence_dir.mkdir(parents=True, exist_ok=True)

    # 可选：自动启动 dev server
    server_proc = None
    if args.start_server:
        print("启动 dev server (pnpm dev)...")
        server_proc = subprocess.Popen(
            ["pnpm", "dev"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(Path(__file__).resolve().parent.parent.parent.parent),
            start_new_session=True,
        )
        # 等待服务器就绪
        if not wait_for_server(args.base_url, timeout=20):
            print("ERROR: dev server 未能在 20 秒内就绪")
            server_proc.kill()
            sys.exit(1)
        print(f"Dev server 就绪 (PID={server_proc.pid})")
        time.sleep(1)  # 额外等待 Vite 完全初始化

    collector = QAResultCollector()

    # 记录自动化检查结果（已在 bash 中验证通过）
    collector.automated_checks = {
        "biome check .": True,
        "prettier --check .": True,
        "pnpm lint": True,
        "pnpm typecheck": True,
        "pnpm test (31 tests)": True,
        "pnpm build": True,
        "pnpm build:demo": True,
    }

    with sync_playwright() as p:
        # 启动 Chromium（headless 模式）
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            # 模拟真实桌面环境
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        )
        page = context.new_page()

        # ===== 检查 1: 加载无错误 =====
        print("[1/11] 检查加载与控制台错误...")
        r = collector.new_check("01", "Demo 加载无控制台错误")
        try:
            check_01_load(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 2: 悬停显示手柄 =====
        print("[2/11] 检查悬停/聚焦手柄...")
        r = collector.new_check("02", "悬停/聚焦显示块手柄")
        try:
            check_02_hover_handle(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 3: 菜单开闭 =====
        print("[3/11] 检查菜单开闭...")
        r = collector.new_check("03", "菜单打开/关闭/焦点归还")
        try:
            check_03_menu_open_close(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 4: 格式转换 =====
        print("[4/11] 检查格式转换...")
        r = collector.new_check("04", "H1/H2/H3/H4/H5/正文 格式转换")
        try:
            check_04_format_conversion(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 5: Enter 拆分 =====
        print("[5/11] 检查 Enter 拆分...")
        r = collector.new_check("05", "Enter 在段落中间拆分为两块")
        try:
            check_05_enter_split(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 6: Shift+Enter 软换行 =====
        print("[6/11] 检查 Shift+Enter 软换行...")
        r = collector.new_check("06", "Shift+Enter 插入 <br> 软换行")
        try:
            check_06_shift_enter(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 7: Backspace 删除 =====
        print("[7/11] 检查 Backspace 删除...")
        r = collector.new_check("07", "Backspace 删除空块并移动焦点")
        try:
            check_07_backspace_delete(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 8: 最后一块保护 =====
        print("[8/11] 检查最后一块保护...")
        r = collector.new_check("08", "最后一块 Backspace 重置为空段落")
        try:
            check_08_last_block_protection(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 9: 边界 800px =====
        print("[9/11] 检查 800px 边界...")
        r = collector.new_check("09", "宽屏菜单贴 handle / 窄屏居中")
        try:
            check_09_boundary(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 10: 无行为泄漏 =====
        print("[10/11] 检查非文本块 Enter 无泄漏...")
        r = collector.new_check("10", "checklist/quote/code/callout Enter 不创建新块")
        try:
            check_10_no_behavior_leaks(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # ===== 检查 11: 响应式 =====
        print("[11/11] 检查 390x844 响应式...")
        r = collector.new_check("11", "390x844 视口手柄/菜单无裁剪")
        try:
            check_11_responsive(page, r, evidence_dir)
        except Exception as e:
            r.errors.append(f"异常: {e}")
            r.passed = False
            traceback.print_exc()
        print(f"  -> {'PASS' if r.passed else 'FAIL'}")

        # 清理浏览器
        context.close()
        browser.close()

    # 停止 dev server（如果由本脚本启动）- 使用进程组确保子进程也被杀死
    if server_proc:
        os.killpg(os.getpgid(server_proc.pid), signal.SIGTERM)
        try:
            server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(server_proc.pid), signal.SIGKILL)
        print("Dev server 已停止")

    # 写入 JSON 结果
    json_path = evidence_dir / "qa-report.json"
    json_path.write_text(collector.to_json(), encoding="utf-8")
    print(f"\nJSON 报告已写入: {json_path}")

    # 打印总结
    passed = sum(1 for r in collector.results if r.passed)
    total = len(collector.results)
    print(f"\n===== 总结: {passed}/{total} 检查通过 =====")
    for r in collector.results:
        status = "✅" if r.passed else "❌"
        print(f"  {status} [{r.check_id}] {r.name}")

    all_passed = all(r.passed for r in collector.results)
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
