# Proposal

## Why

HAM-257 的六项反馈涉及引用编辑、块操作、主题与键盘操作，影响同一编辑流程的可用性。以一个 change 统一定义新交互及其对既有持久化、共享会话和 history 的影响，供开发按同一自测基线交付。

## What Changes

保留人类原话，编号作为规格与自测的追踪键：

1. 去掉引用的署名
2. 引用中直接回车应该开启新的一行而不是在引用内开启新的一行，在 shift + 回车时是在引用内开启新的一行
3. 行左侧的操作按钮的菜单中增加删除按钮，删除需要确认
4. 底部栏没有支持好夜间模式，晚上还是白底白字
5. 像 Notion 这种软件一样支持 `/` 开头的命令能力，第一期在 `/` 的菜单中放转换的列表，可以用方向键选择一项，相当于把这一行转换成这个，`/` 只在一行开头输入才有这个效果
6. 支持 cmd + z 和 shift + cmd + z 快捷键 撤销和恢复，windows 就是 ctrl 代替

- **BREAKING（编辑行为）**：移除引用署名的展示和输入；普通 Enter 从引用退出为新正文段落，Shift+Enter 留在引用内软换行。替换当前“署名可编辑”和“普通回车保留引用”的规格，不沿用冲突断言。
- 删除是针对菜单锚定顶层块的二次确认操作：默认焦点在“取消”，确认后才删整个块及其子树；取消/Escape/点击遮罩零变更。仅剩一块时替换为合法空段落。目标文档在确认期间有任何正文变更即拒绝陈旧确认并提示重开；不删除文件或外部资源。
- 底部工具栏及文件弹层、状态文字、交互态跟随所属视图主题，支持运行时切换、明暗分屏、窄屏和浮动底栏。
- `/` 第一期**只放转换列表**：正文、标题 1/2/3、代码块、引用、有序/无序/待办列表；与现有转换项及可用性规则一致，不带插入、删除、移动或其他命令。上下方向键选择、Enter 确认、Escape 关闭；只在逻辑行起点新输入 `/` 时打开，成功转换同一行且消费触发符。
- macOS Cmd+Z / Cmd+Shift+Z、Windows Ctrl+Z / Ctrl+Shift+Z 与工具栏进入同一历史通道；保留现有 Ctrl/Mod+Y 兼容入口。封闭本地 history、共享 DocumentSession 全局 history、已配置的宿主 onHistoryRequest 三条现有路径各自保持原所有权，禁止一次按键重复执行或另建历史栈。

## Capabilities

### New Capabilities

无；复用现有能力。

### Modified Capabilities

| capability / delta 路径 | 需求编号 | 规格变化 |
| --- | --- | --- |
| `note-content-blocks` → `specs/note-content-blocks/spec.md` | 1、2、3、5 | 修改“文本与列表类内容可编辑并持久化”“行首引用快捷输入复用引用块”；增加引用换行、确认删除与斜杠转换要求 |
| `note-editor-core` → `specs/note-editor-core/spec.md` | 4、6 | 修改“History 由库内封闭扩展维护”；增加底部栏主题要求，明确快捷键的作用域和既有历史所有权 |

## Impact

已读 `src/lib/hnn/quoteInteractions.ts`、`src/lib/editor/blockMenu.ts`、`src/lib/hnn/extensions.ts` 及两个 capability 的完整现有规格。引用 NodeView 目前带 author 输入，Enter 目前用 splitBlock，末尾空段落才 lift；块菜单有转换、移动和下一行插入，无删除。底栏由 `src/lib/editor/ViewToolbar.tsx` 复用 painting-toolbar 的 ToolbarShell / ToolbarFileMenu；主题需连同 `src/lib/styles.css` 与 `NoteSaveStatus.css` 的变量作用域检查。共享会话 `documentSession.ts` 已有 Mod-z / Mod-Shift-z / Mod-y 及 onHistoryRequest 分支，第 6 项应补齐实际键盘链路和回归，不假定所有入口都缺失。

相关回归落点：`quoteInteractions.test.ts`、`blockMenu.test.ts`、`NoteEditor.test.tsx`、`nodeViewReviewRegressions.test.ts`、`ViewToolbar.test.tsx`、`documentSession.test.ts`、`independentProviderHistory.test.tsx` 和 `scripts/check-pane-toolbar-browser.mjs`。`improve-picture-insertion` 也涉及块菜单和图片弹层；本 change 不改上传契约，删除图片只移除节点，重做不得重新上传。不新增公开 API、依赖或 HNN schema 版本；历史 author 属性继续无损往返但不在编辑器展示/编辑，显式导入导出保持现有数据契约。

## 冒烟 / 自测用例

开发阶段执行以下基线；本次 propose 仅生成文档，未宣称用例已通过。浏览器以 `yarn dev` 的 demo 或等价实际宿主操作；记录浏览器/系统、前后 HNN、关键截图及每条结果。桌面用 1440px、移动用 390px，权限与历史用实际公开入口或已有测试 harness。

| 编号 | 可执行步骤 | 期望结果 | 判定方式 |
| --- | --- | --- | --- |
| S1 / 需求 1 | 加载含 author="张三" 的 HNN 引用和一个新引用；检查编辑、只读、Tab 顺序；改正文保存重开 | 无署名文字、输入框和空 footer；正文仍可编辑；旧 author 往返不丢，新引用 author=null | DOM/无障碍树无署名入口；HNN 对比仅正文改变、旧 author 相同 |
| S2 / 需求 2 | 引用“甲乙”分别在起点、中间、末尾按 Enter；重置后按 Shift+Enter；重复空引用、多段和嵌套引用；再测引用内列表 Enter | Enter 在最外层连续引用之外生成正文并保留前后内容，光标在新正文起点；Shift+Enter 只插入 hardBreak；列表仍拆项/退出，空引用不残留非法空容器 | 检查 HNN 结构、文字顺序与光标；每次一次撤销恢复操作前文档，再重做恢复结果 |
| S3 / 需求 3 | 左侧菜单删除带子块的引用，分别取消、Escape、遮罩关闭及确认；删最后一块；确认层打开后另一视图改正文再确认；撤销/重做 | 三条取消路径不变；确认只删锚定块；最后一块变空段落；陈旧确认被拒绝；一次撤销完整恢复身份与子树 | 对比 HNN、nodeId、history 事件及 dirty；检查焦点归还、“取消”默认焦点、Tab 约束和错误提示；图片删除无外部删除调用 |
| S4 / 需求 4 | 1440/390px 下显示含撤销/重做/文件/保存/状态的底栏；light→dark→light 切换，打开文件菜单，查看 hover/focus/disabled；并排明暗两个视图 | 底栏和 portal 弹层各用所属视图主题，无白底白字、焦点不可见或串色；切换不重建会话 | 对比明暗截图和 computed style，普通文字对比度≥4.5:1、有效控件/焦点≥3:1；核对 sessionId、HNN、history 不变 |
| S5 / 需求 5 | 空段落或已有“正文”的行首键入 `/`，用上下键选择标题 2 并 Enter；逐项复测九个转换项、鼠标点击、Escape；输入 `a/`、空格后 `/`、视觉折行处 `/`；在代码块和 IME 组合输入中输入 `/`；开菜单后在另一视图改正文 | 仅逻辑行首新输入触发；菜单只有转换项，禁用项不可执行；成功消费 `/` 且保留该行正文，光标回正文；取消保留 `/`；行内等场景保持字面量；陈旧提交拒绝且不误转其他行 | 检查菜单项/键盘选中状态与 HNN；一次撤销转换回到含 `/` 的原行、重做消费 `/`；拒绝时 history/dirty 不额外变化；嵌套行仅转换当前行 |
| S6 / 需求 6 | macOS 分别按 Cmd+Z/Cmd+Shift+Z；Windows 按 Ctrl+Z/Ctrl+Shift+Z；依次验证输入、Enter、确认删除、斜杠转换；同 Provider A 编辑 B 撤销；独立 Provider 配置宿主历史后按键；在空栈、只读/freeze、IME、输入框、会话切换及撤销后新输入场景复测 | 一次按键对应一次既有 history 请求/事件；共享视图同步而不抢另一视图焦点；宿主处理时不再本地撤销；受限上下文不改正文；切换清空旧历史，撤销后新编辑清空 redo | 真实系统键盘冒烟加自动化 KeyboardEvent；spy history/onHistoryRequest 调用次数、前后 HNN/选区/dirty、跨视图同步和 sessionId；对照工具栏结果一致 |

## 假设与边界

以下是为可执行验收作出的设计假设，并非用户逐项确认：去掉署名指移除编辑器 UI，保留 HNN 数据兼容；“行”按逻辑文本块而非视觉折行；普通 Enter 退出最外层连续引用，但不越过列表项、表格单元格等结构边界，列表/代码子块优先执行自身键盘规则。斜杠后的额外字符本期按普通输入关闭菜单，不增加搜索能力；标题与段落、列表项/引用/表格内可编辑段落均按逻辑行触发，不能合法转换的选项禁用说明原因，不能退化为转换整个顶层容器。上述边界在 design 与 delta spec 中落实。

无阻塞性未决问题；本阶段只产出 proposal、design、delta specs、tasks，不实施。下一阶段由工程师 review 后执行 apply，按 S1–S6 自测。
