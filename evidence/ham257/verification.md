HAM-257 实施与自测记录

基线：`origin/main` / `438eac9`。change：`improve-note-editor-interactions`。六项需求在同一分支实现，没有拆派。

环境：Linux x86_64（Ubuntu，kernel 7.0.0-31-generic）、Node 24.15.0、Yarn 1.22.22、Chromium 148.0.7778.96、OpenSpec 1.13.1。浏览器主流程使用 `yarn dev` 的真实 demo；工具栏专项使用公开 Provider/View 夹具。所有键盘操作均为自动化，未使用真实 macOS/Windows 键盘。

## 需求覆盖

| 原始需求 | 实现与验证 |
| --- | --- |
| 1 去掉引用署名 | `extensions.ts` 只渲染 quote body；schema/codec 的 author 保持不变。编辑、只读无输入/空 footer，旧 author 编辑保存重开保留；`NoteEditor.test.tsx`、`nodeViewReviewRegressions.test.ts`、S1。 |
| 2 Enter 引用外换行，Shift+Enter 引用内换行 | `quoteInteractions.ts` 拆分连续引用祖先，保留内容、格式与 author，修复新增 ID；列表/代码优先，不越表格单元格边界；同块选区原子替换，跨块沿用原命令；`quoteInteractions.test.ts`、S2。 |
| 3 左侧块菜单增加需确认的删除 | `blockDelete.ts` 的模态确认默认取消、Tab 限域、三种取消归还焦点；绑定 Editor 会话生命周期、nodeId、不可变正文版本，其他视图正文变化拒绝旧确认；原子删除/末块补空段落/单步历史；图片只删引用且不重复上传；`blockMenu.test.ts`、`blockDelete.test.ts`、`independentProviderHistory.test.tsx`、S3。 |
| 4 底栏夜间模式 | vendor 0.8.4 实际使用硬编码颜色，没有 shell/menu 色彩变量。沿用其 `toolbarProps.style` 接口覆盖 shell，再以视图内高优先级 CSS 覆盖 panel/交互态。该版本 panel 在视图子树中渲染，不使用 body portal。`NoteSaveStatus` 状态文字使用可读的视图令牌；`ViewToolbar.test.tsx`、S4。 |
| 5 仅逻辑行首的九项转换 slash 菜单 | `blockConversion.ts` 共用既有无损预检，`slashCommands.ts` 按当前文本行定位，段落/标题、引用/列表/表格合法行均支持；仅新键入单个 `/` 触发。消费 `/` 与转换/光标恢复单事务，陈旧/权限/预算拒绝不产生部分修改，旧菜单回调不影响新菜单。支持方向键/Home/End/Enter/鼠标/Escape；活动项语义、移动视口限高且不遮 caret，与同视图菜单/文字工具条互斥；`slashCommands.test.ts`、`documentSession.test.ts`、S5。 |
| 6 Cmd/Ctrl 撤销重做 | `historyKeys.ts` 仅处理拥有正文焦点的有效事件。复用 StarterKit 官方 history 命令/插件或共享 authority/宿主回调，禁用重复的平台快捷键映射，不建新栈；大小写 Z、Shift、Mod+Y、空栈消费、Alt/IME/229/只读/freeze/表单守卫；`historyKeys.test.ts`、`documentSession.test.ts`、`independentProviderHistory.test.tsx`、`session.test.ts`、S6。 |

## 逐任务结论

| 任务 | 结果 |
| --- | --- |
| 1.1 | 完成：移除署名 UI，保留数据与正文编辑。 |
| 1.2 | 完成：引用起/中/末、多段与嵌套拆分、ID/格式与单步历史。 |
| 1.3 | 完成：Shift+Enter、列表/代码/表格边界、选区、权限、IME 与预算失败守卫。 |
| 2.1 | 完成：删除入口、可访问确认层及取消/焦点。 |
| 2.2 | 完成：跨视图编辑/移动/删除过期，纯选区允许，freeze/销毁清理。 |
| 2.3 | 完成：整块删除、末块补空、共享精确恢复、资源与上传回归。 |
| 3.1 | 完成：依 vendor 实际接口接线，明暗 shell/panel/状态/交互态。 |
| 3.2 | 完成：1440/390px、inline/浮动、动态切换、明暗分屏、颜色/焦点/会话状态/占位验证。 |
| 4.1 | 完成：提取转换定义与无损预检，原块菜单/列表/图片入口回归。 |
| 4.2 | 完成：行首新输入触发及上下文限制，固定九项。 |
| 4.3 | 完成：键盘/鼠标、读屏活动项、视口定位与弹层互斥。 |
| 4.4 | 完成：原子消费与转换、嵌套行、预算/陈旧拒绝、撤销/重做。 |
| 5.1 | 完成：Cmd/Ctrl、大小写、Shift/Mod+Y 与历史所有权。 |
| 5.2 | 完成：焦点、表单、权限和组合输入守卫、有效空栈消费。 |
| 5.3 | 完成：全局时间序列、宿主恰好一次/false 不兜底、重建/redo 分支/dirty 基线回归。 |
| 6.1 | 完成：四项项目检查全部通过，见相邻原始输出。 |
| 6.2 | 部分完成，保持未勾选：Linux Chromium 浏览器与自动化已执行；真实 macOS/Windows 键盘未覆盖。 |
| 6.3 | 完成：六项原话、两个 delta spec、实现与证据逐项对照，strict validate 通过；保留 6.2 验证缺口。 |

## 命令与原始输出

相邻 `.txt` 文件保留未经摘改的命令原始输出（包括工具告警）：

| 命令 | 结论 | 原始输出 |
| --- | --- | --- |
| `yarn test` | 60 文件 / 1153 测试通过 | `test.txt` |
| `yarn typecheck` | 通过 | `typecheck.txt` |
| `yarn lint` | 通过 | `lint.txt` |
| `yarn build` | 库及 demo 构建通过 | `build.txt` |
| `node scripts/check-pane-toolbar-browser.mjs` | 通过 | `toolbar-browser.txt` |
| `yarn dev` + `node scripts/check-note-interactions-browser.mjs` | 自动化冒烟通过 | `smoke-browser.txt` |
| `openspec validate improve-note-editor-interactions --strict` | 通过 | `openspec-validate.txt` |

## S1–S6 冒烟结论

| 编号 | 实际结果与证据 |
| --- | --- |
| S1 | 通过：真实 demo 打开含“张三”author 的 HNN，无署名 UI，改正文后等待保存完成并重新载入，author/正文无损。新引用与只读由自动化补充。`browser-hnn.json` 的 S1。 |
| S2 | 通过：demo 验证起点/中间/末尾、空/嵌套引用、Shift+Enter，以及逐次精确 undo/redo。列表、表格、同块/跨块选区、IME/229、freeze、容量失败由单测补充。`browser-hnn.json` 的 S2。 |
| S3 | 通过：demo 验证取消/Escape/遮罩、默认取消焦点、Tab、整引用删除与精确 undo/redo。末块、跨视图陈旧拒绝、选区变化、freeze 与图片删除/上传由单测补充。`delete-confirm.png`、`browser-hnn.json` 的 S3。 |
| S4 | 通过：1440/390px 明暗动态切换与浮动底栏、inline 明暗双视图/文件菜单、焦点、状态/选区/正文/编辑器身份不变，320px 上传控件占位与重试/取消回归。shell 普通文字对比度 light 13.98:1 / dark 14.85:1；焦点同值，文件菜单文字也高于 4.5:1。`toolbar-*.png`、`toolbar-browser.txt`。 |
| S5 | 自动化通过：demo 的 1440/390px 行首 `/`、九项列表、方向键选标题 2、消费符号、边界定位、Escape、行内不触发与精确 undo/redo；截图确认可读且不与移动文字工具条重叠。九项逐项转换、Home/End/点击、嵌套引用/列表/表格、格式保留/禁用、深度预算、另一视图修改/freeze、旧回调拒绝由单测补充。`slash-1440.png`、`slash-390.png`。 |
| S6 | 仅自动化 KeyboardEvent / 浏览器自动化键盘覆盖：Linux Chromium 的 Meta/Control Z 与 Shift+Z、三种历史所有者、表单/权限/IME/空栈等均通过。真实 macOS、真实 Windows 未验证，不能认定真机通过。 |

## 尚需复核与风险

- 6.2 保持未完成，需人工在真实 macOS/Windows 键盘补跑 S6；Safari、Windows 浏览器与真实移动软键盘/输入法未在本机验证。
- 删除确认故意在任意正文变更后过期，需要重新打开；会话由 Editor 实例生命周期绑定，切换时销毁旧确认。
- vendor 主题采用其现有 style 接口及局部 CSS 覆盖；升级 vendor 时应重跑工具栏浏览器检查。
- 原始输出含现有第三方 sourcemap 缺失、Node `url.parse` 弃用、jsdom `scrollBy` 未实现提示，以及构建大 chunk 告警；最终检查无失败。
- 高节点数预算压力用例在并行构建压力下超过默认 5 秒，已仅为两个 512 节点用例设置 20 秒上限；断言和文档上限未放宽。

本轮停在自测交接，不归档 change，不创建/合并 PR，不发布。
