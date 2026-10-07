/// <reference types="node" />
/**
 * 7.5 视觉/响应式/无障碍静态基线：把 DESIGN.md 与本 change D9/D10/D11 的
 * CSS/a11y 契约钉成可回归的断言，防止“清旧”或后续改动悄悄 flatten 设计。
 * 全部静态断言（源码级）：真实浏览器视觉验收属 7.5 后半（等 demo 完成后另 dispatch）。
 * 注意：vitest 配置把 CSS import stub 成空模块（?raw/?inline 同样为空），
 * 因此样式与组件源码统一用 node:fs 按源文件读取。
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/** 以本测试文件为基准读源码文本。 */
const readSource = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")

const stylesText = readSource("../styles.css")
const hostReferenceCss = readSource("./HostReferenceUI.css")
const markdownExportCss = readSource("./MarkdownExport.css")
const noteSaveStatusCss = readSource("./NoteSaveStatus.css")
const blockReorderSource = readSource("./blockReorder.ts")
const blockMenuSource = readSource("./blockMenu.ts")
const menuPopoverSource = readSource("../hnn/menuPopover.ts")
const tableEdgeControlsSource = readSource("../hnn/tableEdgeControls.ts")
const drawerSource = readSource("./HnnDataDrawer.tsx")
const hostReferenceSource = readSource("./HostReferenceUI.tsx")
const exportSource = readSource("./MarkdownExport.tsx")
const extensionsSource = readSource("../hnn/extensions.ts")

/** 去掉块注释：lineage 注释允许提到 hn-note-*，选择器断言只看有效规则。 */
const css = stylesText.replace(/\/\*[\s\S]*?\*\//g, "")

/** 取 `selector { ... }` 的规则体（brace 匹配，兼容 keyframes 等嵌套块）。 */
const ruleBody = (source: string, selector: string): string => {
  const start = source.indexOf(selector)
  if (start < 0) throw new Error(`未找到规则：${selector}`)
  const open = source.indexOf("{", start)
  if (open < 0) throw new Error(`规则缺少大括号：${selector}`)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1
    if (source[i] === "}") {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`规则大括号不闭合：${selector}`)
}

/** 取包含某选择器的 `@media (max-width: 840px)` 媒体块体（brace 匹配）。 */
const compactMediaBlock = (source: string, selector: string): string => {
  const needle = "@media (max-width: 840px)"
  let from = 0
  for (;;) {
    const start = source.indexOf(needle, from)
    if (start < 0) throw new Error(`840px 断点内未找到：${selector}`)
    const open = source.indexOf("{", start)
    let depth = 0
    let end = open
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1
      if (source[end] === "}") {
        depth -= 1
        if (depth === 0) break
      }
    }
    const body = source.slice(open + 1, end)
    if (body.includes(selector)) return body
    from = end + 1
  }
}

describe("7.5 基线：旧实现清除与根 token 保留", () => {
  it("旧 .hn-note-* 选择器全部移除，注释中的 lineage 提及除外", () => {
    expect(css).not.toContain(".hn-note-")
    // 旧重排定位机制（--hn-row-leading @property/消费）只服务旧规则，一并清除
    expect(css).not.toContain("--hn-row-leading")
    expect(css).not.toContain("--hn-row-offset")
    expect(css).not.toContain("--hn-block-menu-")
  })

  it(":root 保留宿主可依赖的主题 token 缺省（--hn-theme 由宿主注入，仅给缺省色）", () => {
    const root = ruleBody(css, ":root")
    for (const token of [
      "--hn-theme: #3b82f6",
      "--hn-theme-soft:",
      "--hn-theme-border:",
      "--hn-theme-text:",
      "--hn-bg:",
      "--hn-surface:",
      "--hn-surface-hover:",
      "--hn-border:",
      "--hn-border-strong:",
      "--hn-text:",
      "--hn-text-muted:",
      "--hn-text-soft:",
      "--hn-radius: 24px",
      "--hn-code-font:"
    ]) {
      expect(root).toContain(token)
    }
  })
})

describe("7.5 基线：显式 light/dark 完整 token 集", () => {
  const CORE_TOKENS = [
    "--hn-theme-soft:",
    "--hn-theme-border:",
    "--hn-theme-text:",
    "--hn-bg:",
    "--hn-surface:",
    "--hn-surface-hover:",
    "--hn-border:",
    "--hn-border-strong:",
    "--hn-text:",
    "--hn-text-muted:",
    "--hn-text-soft:",
    "--hn-danger:",
    "--hn-code-font:"
  ]

  it("两个修饰类都声明完整 token 集（light 可覆盖暗色祖先）", () => {
    const light = ruleBody(css, ".hn-editor--light")
    const dark = ruleBody(css, ".hn-editor--dark")
    for (const token of CORE_TOKENS) {
      expect(light).toContain(token)
      expect(dark).toContain(token)
    }
    expect(light).toContain("color-scheme: light")
    expect(dark).toContain("color-scheme: dark")
    // 危险色按主题分档：深底用浅红保对比度
    expect(light).toContain("--hn-danger: #dc2626")
    expect(dark).toContain("--hn-danger: #f87171")
  })

  it("主题只走显式修饰类，不响应系统媒体查询", () => {
    expect(css).not.toContain("prefers-color-scheme")
  })

  it("透明编辑壳：.hn-editor 不拥有背景/圆角/阴影/最大宽度", () => {
    const shell = ruleBody(css, ".hn-editor {")
    expect(shell).not.toMatch(/background\s*:/)
    expect(shell).not.toContain("border-radius")
    expect(shell).not.toContain("box-shadow")
    expect(shell).not.toContain("max-width")
  })
})

describe("7.5 基线：popover 表面与 hn-popover-in 动效语言", () => {
  it("hn-popover-in 是纯 opacity 淡入（不与定位 transform 冲突）", () => {
    const keyframes = ruleBody(css, "@keyframes hn-popover-in")
    expect(keyframes).toContain("opacity: 0")
    expect(keyframes).toContain("opacity: 1")
    expect(keyframes).not.toContain("transform")
  })

  it("mini popover（公式/card/drawing 共用）沿用深色表面 + 阴影 + 10px 半径 + 淡入", () => {
    const popover = ruleBody(css, ".hn-editor-mini-popover {\n  position: fixed;")
    expect(popover).toContain("#1e293b")
    expect(popover).toContain("0 8px 24px rgba(15, 23, 42, 0.28)")
    expect(popover).toContain("border-radius: 10px")
    expect(popover).toContain("animation: hn-popover-in 0.12s ease")
  })

  it("reduced-motion 下关闭 mini popover 淡入；三个独立 CSS 组件各有 reduced-motion 处理", () => {
    expect(css).toContain("prefers-reduced-motion: reduce")
    for (const standalone of [hostReferenceCss, noteSaveStatusCss, markdownExportCss]) {
      expect(standalone).toContain("prefers-reduced-motion")
    }
    // 引用候选菜单镜像同一淡入语言（独立 keyframes，不依赖 styles.css 的规则体）
    expect(hostReferenceCss).toContain("@keyframes hn-reference-popover-in")
  })
})

describe("7.5 基线：桌面 handle 与重排预览（D10 优先于 DESIGN.md §13 旧描述）", () => {
  it("桌面 handle 随块 hover/块内聚焦/自身 hover/focus/拖拽/菜单打开显现", () => {
    for (const selector of [
      ".hn-editor-block-handle:has(+ :hover)",
      ".hn-editor-block-handle:has(+ :focus-within)",
      ".hn-editor-block-handle:hover",
      ".hn-editor-block-handle:focus-visible",
      ".hn-editor-block-handle--dragging",
      ".hn-editor-block-handle--menu-open"
    ]) {
      expect(css).toContain(selector)
    }
    // focus 态是 2px 主题色描边（DESIGN.md §9 Focus）；带 " {" 锚定以避开逗号选择器组
    expect(ruleBody(css, ".hn-editor-block-handle:focus-visible {")).toContain(
      "0 0 0 2px var(--hn-theme"
    )
    // 菜单打开期间手柄保持 active/open token 处理（DESIGN.md §9 Open state）；
    // css 已去注释，用规则体特征串锚定带 token 处理的那一条（显现组里同名选择器只给 opacity）
    expect(css).toContain(".hn-editor-block-handle--menu-open {\n  background: var(--hn-theme-soft")
    expect(css).toContain("color: var(--hn-theme-text")
  })

  it("只读模式直接隐藏 handle，不留假手柄", () => {
    expect(css).toContain('.hn-editor-content[contenteditable="false"] .hn-editor-block-handle')
  })

  it("插入边界预览：3px --hn-theme 线 + --hn-theme-soft 描边", () => {
    const indicator = ruleBody(
      css,
      ".hn-editor-block-drop-before::after,\n.hn-editor-block-drop-after::after"
    )
    expect(indicator).toContain("height: 3px")
    expect(indicator).toContain("var(--hn-theme, #3b82f6)")
    expect(indicator).toContain("var(--hn-theme-soft")
  })

  it("840px 紧凑断点（含边界）内 handle 常显半透明：触屏唯一重排入口", () => {
    const block = compactMediaBlock(css, ".hn-editor-block-handle")
    const handleRule = ruleBody(block, ".hn-editor-content > .hn-editor-block-handle")
    expect(handleRule).toContain("opacity: 0.55")
    expect(handleRule).toContain("pointer-events: auto")
    // 紧凑断点收进 1.5rem 内边距
    const shellRule = ruleBody(block, ".hn-editor {")
    expect(shellRule).toContain("1.5rem 1.5rem 2rem")
  })

  it("重排实现是桌面原生 draggable + 移动端手柄 500ms 长按（非 DESIGN 旧整行长按）", () => {
    expect(blockReorderSource).toContain("HNN_REORDER_HOLD_MS = 500")
    expect(blockReorderSource).toContain('handle.setAttribute("draggable", "true")')
    expect(blockReorderSource).toContain('handle.setAttribute("data-drag-handle", "")')
  })

  it("手柄独占触摸手势：touch-action: none 只挂在手柄上（bug-7.5-1），正文滚动不受影响", () => {
    const handleRule = ruleBody(css, ".hn-editor-block-handle {")
    expect(handleRule).toContain("touch-action: none")
    // 正文/内容容器不得出现 touch-action 限制：正常滚动手势保留
    expect(ruleBody(css, ".hn-editor-content {")).not.toContain("touch-action")
  })

  it("拖拽预览与源高亮由 PM 持有的 decorations 渲染，不再直写内容 DOM（bug-7.5-2）", () => {
    // 块重排：独立装饰插件承载 dragging/drop 指示类
    expect(blockReorderSource).toContain("hnnBlockReorderDrag")
    expect(blockReorderSource).toContain("Decoration.node(")
    // 旧机制（直写/簿记内容 DOM class）不得回归
    expect(blockReorderSource).not.toContain("indicatorDom")
    expect(blockReorderSource).not.toContain("sourceDom?.classList")
    // 表格行列拖拽：同一修复机制
    expect(tableEdgeControlsSource).toContain("hnnTableDragPreview")
    expect(tableEdgeControlsSource).not.toContain("cell.dom.classList.add(PREVIEW_CLASSES")
  })

  it("手柄同时是键盘可达的块操作菜单入口（DESIGN.md §9/D9），不再是 aria-hidden 纯指针控件", () => {
    expect(blockReorderSource).not.toContain('handle.setAttribute("aria-hidden", "true")')
    expect(blockReorderSource).toContain('handle.setAttribute("role", "button")')
    expect(blockReorderSource).toContain('handle.setAttribute("tabindex", "0")')
    expect(blockReorderSource).toContain('handle.setAttribute("aria-label", "块操作菜单")')
    expect(blockReorderSource).toContain('handle.setAttribute("aria-haspopup", "menu")')
    expect(blockReorderSource).toContain('handle.setAttribute("aria-expanded", "false")')
    // Enter/Space/ArrowDown 打开菜单；菜单内上移/下移即键盘重排通道
    expect(blockReorderSource).toContain('event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown"')
    expect(blockMenuSource).toContain('label: "上移"')
    expect(blockMenuSource).toContain('label: "下移"')
    // 与拖拽重排共享同一提交入口（同一事务/undo 边界）
    expect(blockMenuSource).toContain("reorderTopLevelBlock")
    // 复合块转换禁用并注明原因，绝不静默 flatten
    expect(blockMenuSource).toContain("该块包含复合结构，转换会丢失内容")
  })
})

describe("7.5 基线：锚定菜单表面（块操作/表格行列操作共用，DESIGN.md §9）", () => {
  it("深色 surface + 10px 半径 + popover 阴影 + 纯 opacity 淡入，不引入新色", () => {
    // 带 "position: fixed" 锚定以避开 reduced-motion 媒体块里的同名选择器
    const menu = ruleBody(css, ".hn-editor-menu {\n  position: fixed;")
    expect(menu).toContain("#1e293b")
    expect(menu).toContain("border-radius: 10px")
    expect(menu).toContain("0 8px 24px rgba(15, 23, 42, 0.28)")
    expect(menu).toContain("animation: hn-popover-in 0.12s ease")
  })

  it("条目状态复用 popover 按钮语言；禁用项降透明度且无 hover 背景", () => {
    const item = ruleBody(css, ".hn-editor-menu-item {")
    expect(item).toContain("background: transparent")
    expect(item).toContain("#e2e8f0")
    const hover = ruleBody(css, ".hn-editor-menu-item:hover,\n.hn-editor-menu-item:focus-visible {")
    expect(hover).toContain("rgba(255, 255, 255, 0.14)")
    expect(hover).toContain("#ffffff")
    expect(ruleBody(css, ".hn-editor-menu-item:disabled:hover {")).toContain("background: transparent")
  })

  it("in-menu 两步确认态是实心危险色反转；reduced-motion 同样取消菜单淡入", () => {
    expect(ruleBody(css, ".hn-editor-menu-item.is-confirming {")).toContain("var(--hn-danger")
    const reduced = ruleBody(css, "@media (prefers-reduced-motion: reduce)")
    expect(reduced).toContain(".hn-editor-menu")
  })

  it("菜单语义与关闭路径由共用 menuPopover 承担（role/键盘/Escape 回焦）", () => {
    expect(menuPopoverSource).toContain('element.setAttribute("role", "menu")')
    expect(menuPopoverSource).toContain('button.setAttribute("role", "menuitem")')
    expect(menuPopoverSource).toContain('case "Escape"')
    expect(menuPopoverSource).toContain("confirmLabel")
  })

  it("底部锚点垂直翻转/钳制；视口过短限高 + 内部滚动可达全部条目（bug-7.5-3）", () => {
    // 翻转决策与视口边距在 menuPopover 内（量实际高度后决定朝向）
    expect(menuPopoverSource).toContain("aboveSpace")
    expect(menuPopoverSource).toContain("belowSpace")
    expect(menuPopoverSource).toContain("VIEWPORT_MARGIN")
    // 内部滚动不触发全局关闭：按事件目标区分
    expect(menuPopoverSource).toContain("element.contains(event.target)")
    // 限高样式类：overflow-y auto + 滚动链阻断
    const scroll = ruleBody(css, ".hn-editor-menu--scroll {")
    expect(scroll).toContain("overflow-y: auto")
    expect(scroll).toContain("overscroll-behavior: contain")
  })
})

describe("7.5 基线：表格控件语言（DESIGN.md §10 边界 + 与焦点行/列操作方案）", () => {
  it("边界 + 与行/列操作控件默认隐藏，is-visible 显现，只用既有 token", () => {
    const btn = ruleBody(css, ".hn-editor-content .hn-editor-table-edge,\n.hn-editor-content .hn-editor-table-op {")
    expect(btn).toContain("display: none")
    expect(btn).toContain("var(--hn-bg")
    expect(btn).toContain("var(--hn-border-strong")
    expect(btn).toContain("var(--hn-text-muted")
    const visible = ruleBody(
      css,
      ".hn-editor-content .hn-editor-table-edge.is-visible,\n.hn-editor-content .hn-editor-table-op.is-visible {"
    )
    expect(visible).toContain("display: flex")
    // 边界 + 是中心压在边界点上的圆形控件
    const edge = ruleBody(css, ".hn-editor-content .hn-editor-table-edge {")
    expect(edge).toContain("border-radius: 999px")
    expect(edge).toContain("translate(-50%, -50%)")
  })

  it("拖动/菜单打开保持 token 激活态；插入预览是 --hn-theme 实线；只读整体隐藏", () => {
    const active = ruleBody(
      css,
      ".hn-editor-content .hn-editor-table-op.is-dragging,\n.hn-editor-content .hn-editor-table-op.is-menu-open {"
    )
    expect(active).toContain("var(--hn-theme-soft")
    expect(active).toContain("var(--hn-theme, #3b82f6)")
    for (const cls of ["row-before", "row-after", "col-before", "col-after"]) {
      expect(ruleBody(css, `.hn-editor-content .hn-editor-table-preview--${cls} {`)).toContain(
        "var(--hn-theme, #3b82f6)"
      )
    }
    expect(css).toContain('.hn-editor-content[contenteditable="false"] .hn-editor-table-edge')
    expect(css).toContain('.hn-editor-content[contenteditable="false"] .hn-editor-table-op')
  })

  it("删除是 in-menu 两步确认（删除行/列 → 确认删除行/列）且控件有可访问名称", () => {
    expect(tableEdgeControlsSource).toContain("label: `删除${unit}`")
    expect(tableEdgeControlsSource).toContain("confirmLabel: `确认删除${unit}`")
    // 首行上/首列左专属语义：边界 + 与行/列操作按钮的可访问名称
    expect(tableEdgeControlsSource).toContain('top: "在上方插入行"')
    expect(tableEdgeControlsSource).toContain('left: "在左侧插入列"')
    expect(tableEdgeControlsSource).toContain('"行操作"')
    expect(tableEdgeControlsSource).toContain('"列操作"')
  })
})

describe("7.5 基线：Drawer 60vh 与组件库 token 映射", () => {
  it("card/drawing 与 Markdown 导出 Drawer 都是 bottom 60vh", () => {
    expect(drawerSource).toContain('"--hn-drawer-size": "60vh"')
    expect(exportSource).toContain('"--hn-drawer-size": "60vh"')
  })

  it("portal 里的 Drawer 面板把组件库 --hn-color-* 映射回编辑壳调色板", () => {
    const mapping = ruleBody(css, ".hn-editor-data-drawer {")
    expect(mapping).toContain("--hn-color-surface: var(--hn-bg")
    expect(mapping).toContain("--hn-color-text: var(--hn-text")
    expect(mapping).toContain("--hn-color-accent: var(--hn-theme")
    expect(mapping).toContain("--hn-color-danger: var(--hn-danger")
  })
})

describe("7.5 基线：行内容呈现（公式/图片/提及）", () => {
  it("公式预览整行是可激活按钮，带标准 hover 与 2px 主题色 focus 环", () => {
    expect(css).toContain(".hn-editor-content .hn-editor-formula-preview:hover")
    expect(ruleBody(css, ".hn-editor-content .hn-editor-formula-preview:focus-visible")).toContain(
      "outline: 2px solid var(--hn-theme"
    )
    // KaTeX display 外边距归零，渲染与行排版对齐
    expect(css).toContain(".hn-editor-formula-rendered .katex-display")
  })

  it("图片表面只用 --hn-border + 8px 半径，不引入卡片底/阴影", () => {
    const img = ruleBody(css, ".hn-editor-content .hn-editor-picture-img")
    expect(img).toContain("var(--hn-border, rgba(15, 23, 42, 0.08))")
    expect(img).toContain("border-radius: 8px")
    expect(img).not.toContain("box-shadow")
  })

  it("提及是 theme-soft 底 + theme-text 字 + 999px inline pill", () => {
    const mention = ruleBody(css, ".hn-editor-content .hn-editor-mention")
    expect(mention).toContain("border-radius: 999px")
    expect(mention).toContain("var(--hn-theme-soft")
    expect(mention).toContain("var(--hn-theme-text")
  })
})

describe("7.5 基线：辅助技术契约（role/label/live）", () => {
  it("引用候选菜单：listbox/option/aria-selected，焦点保留在编辑器", () => {
    expect(hostReferenceSource).toContain('role="listbox"')
    expect(hostReferenceSource).toContain('role="option"')
    expect(hostReferenceSource).toContain("aria-selected={index === active}")
  })

  it("可访问校验错误用 role=alert 播报（公式/提示块/图片/折叠块等 NodeView）", () => {
    const alertCount = extensionsSource.split('setAttribute("role", "alert")').length - 1
    expect(alertCount).toBeGreaterThanOrEqual(3)
  })

  it("弹出编辑器与 textarea 有可访问名称", () => {
    expect(extensionsSource).toContain('popover.setAttribute("aria-label", spec.label)')
    expect(extensionsSource).toContain('textarea.setAttribute("aria-label", spec.label)')
  })

  it("状态与错误走 live region：NoteSaveStatus/MarkdownExport role=status，抽屉错误 role=alert", () => {
    expect(noteSaveStatusCss).toContain("hn-save-status")
    expect(exportSource).toContain('role="status"')
    expect(exportSource).toContain('role="alert"')
    expect(drawerSource).toContain('role="alert"')
  })
})
