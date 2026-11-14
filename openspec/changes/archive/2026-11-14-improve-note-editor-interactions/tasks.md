# Tasks

## 1. 引用署名与换行（需求 1、2；S1、S2）

- [x] 1.1 移除 `src/lib/hnn/extensions.ts` 引用 NodeView 的署名 footer、输入、专属事件及废弃样式，保留 contentDOM/schema/author 数据；更新 `NoteEditor.test.tsx`、`nodeViewReviewRegressions.test.ts` 的署名 UI 断言，验证新旧引用在编辑/只读均无署名且旧 author 保存重开不丢。
- [x] 1.2 在 `quoteInteractions.ts` 实现引用 Enter 的起点/中间/末尾切分与引用外正文、空包装清理、连续嵌套引用拆分及唯一 ID，全部走预算化单事务；以 `quoteInteractions.test.ts` 验证“甲|乙,丙”顺序、格式/资源保留、空引用与单步撤销/重做精确恢复。
- [x] 1.3 保留 Shift+Enter hardBreak、引用内列表/代码键盘优先及表格单元格边界，覆盖同块选区与跨块选区、只读/freeze/IME/229/容量失败；更新旧“Enter 延续引用”测试，验证 S2 的新契约及失败时 doc/selection/history 不变。

## 2. 块删除确认（需求 3；S3）

- [x] 2.1 为 `blockMenu.ts` 增加顶层锚定块的“删除”入口及视图内可访问确认层，默认取消、Tab 限域、Escape/遮罩取消和焦点归还；在 `blockMenu.test.ts` 或相邻交互测试验证全部取消路径零正文/历史/dirty 变更，且不影响现有“转换为”“下一行”。
- [x] 2.2 以 sessionId、nodeId 和正文版本校验确认目标，处理期间任意正文变化、只读/freeze/IME、会话切换和卸载，清理监听并显示过期错误；用双视图修改/移动/删除目标及纯选区变化测试，验证陈旧提交拒绝且纯选区变化仍可确认。
- [x] 2.3 实现原子整块删除、末块补空正文、后继/前驱 caret 和独立历史边界；验证复合引用删除与一次撤销/重做的精确 HNN、资源仅删引用不删文件，以及图片重做不重复上传、异步结果不复活已删节点。

## 3. 底栏夜间主题（需求 4；S4）

- [x] 3.1 在 `ViewToolbar.tsx` 与 `src/lib/styles.css` 的现有主题桥接中，将所属视图令牌映射到 vendor `painting-toolbar` 实际消费的 shell/menu 变量，并覆盖 `NoteSaveStatus.css` 状态文字和 portal 主题传播；通过 `ViewToolbar.test.tsx` 及 computed style 验证明暗分屏、动态切换、全部控件和交互态均无串色。
- [x] 3.2 扩展 `scripts/check-pane-toolbar-browser.mjs` 的 1440/390px、inline/浮动底栏、文件菜单和键盘焦点检查；记录 S4 明暗截图与对比度（普通文字≥4.5:1、有效控件/焦点≥3:1），验证主题切换前后 sessionId、选区、HNN、dirty 与 history 不变且占位无回归。

## 4. 行首斜杠转换（需求 5；S5）

- [x] 4.1 从 `blockMenu.ts` 内部转换能力提取可复用清单/预检，保留块菜单顶层锚点语义并增加逻辑文本行定位；运行既有 `blockMenu.test.ts` 与列表转换回归，验证九项转换清单、无损禁用理由与图片“下一行”入口均保留。
- [x] 4.2 在封闭编辑交互装配中接入行首 `/` 菜单与触发行身份/版本状态，支持段落、标题及嵌套合法文本行；补交互测试验证空行/有正文行首触发，行内/空白后/视觉折行/hardBreak 后/代码/粘贴/加载/非空选区/IME 不触发，菜单只有九项转换。
- [x] 4.3 实现上下键跳过禁用项、Home/End、Enter/点击确认、Escape 取消与读屏活动项、caret 定位及移动视口适配；浏览器验证导航不触发正文 Enter、无输入焦点丢失、全部禁用不执行，且与同视图原有 popover 互斥。
- [x] 4.4 将消费 `/`、转换当前逻辑行和 caret 恢复合为预算化单事务，新增陈旧版本/权限/容量拒绝与监听清理；以 HNN 测试验证嵌套行不误转整个容器、取消保留 `/`、一次撤销恢复 `/` 原行、失败无部分转换及 redo 正确。

## 5. 撤销重做快捷键（需求 6；S6）

- [x] 5.1 补齐独立 `session.ts` / `extensions.ts` 和共享 `documentSession.ts` 的键盘处理边界，保留既有历史所有者及 Mod+Y，覆盖大小写 Z、Meta/Ctrl+Shift、Alt 排除、空栈事件消费；自动化验证 Cmd/Ctrl 两组组合键分别等价工具栏且一次按键最多执行一次。
- [x] 5.2 为正文焦点、NodeView/外部 input/textarea、确认层、IME/229、只读/freeze 加入必要守卫；验证受限场景不调用正文/宿主 history、表单原生撤销不被抢占，正文空栈不回退浏览器原生历史。
- [x] 5.3 扩展 `documentSession.test.ts` 与 `independentProviderHistory.test.tsx`，验证共享全局时间序列、另一视图焦点、onHistoryRequest 方向/identity/恰好一次、返回 false 不本地 fallback，以及会话重建清栈、撤销后新输入清 redo、dirty/baseline 沿用现有契约。

## 6. 整体验证与交付基线

- [x] 6.1 在开发完成后执行 `yarn test`、`yarn typecheck`、`yarn lint`、`yarn build`，确认引用、块菜单、列表、共享会话、图片弹层/上传相关回归通过；失败先修复再记录实际结果，不把本次 propose 的文档校验当成功能验证。
- [ ] 6.2 在 `yarn dev` demo 或实际宿主按 proposal 的 S1–S6 执行完整冒烟，包含 macOS 与 Windows 真实键盘、1440/390px、明暗双视图、保存重开、取消/权限/陈旧拒绝和结构单步撤销；交付逐条结果、截图/HNN 与未覆盖平台，不将模拟键盘冒充真实系统验证。
- [x] 6.3 将六项原话、两个 delta spec 和实际实现逐项对照，执行 `openspec validate improve-note-editor-interactions --strict`；提供全部需求覆盖与自测证据后再交付下一阶段评审，不提前勾选未执行任务。

> 6.2 保持未勾选：S1–S5 已由浏览器自动化与人类浏览器验收覆盖，S6 仅自动化 KeyboardEvent 覆盖，真实 macOS / Windows 键盘未验证。2026-11-14 人类在浏览器验收通过并接受该限制。
