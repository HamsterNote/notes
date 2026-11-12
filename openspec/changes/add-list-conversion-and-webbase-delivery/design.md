# Design

## Context

动机见 proposal.md。OpenSpec CLI 为 1.13.1，notes 使用 repo-local `spec-driven`；本 change 统一放在 notes，不为同一需求在 WebBase 重复建 change。仓库未发现专属 propose 命令文件，按已安装 openspec-propose 技能及 CLI artifact instructions 执行。

当前 notes `53f82c8` 已包含发布 tag v3.2.0（`6c923ec`）及其后的宿主工具栏等改动。tag 和 HEAD 的 package.json 都写 3.1.3-ham133.3，`.github/workflows/release.yml` 在 v* tag 触发后由 `scripts/prepare-release.mjs` 重写为 tag 版本，故该差异不等于源码落后。正式包身份仍需在实际发布时核对。

已检查 `src/lib/hnn/extensions.ts`：StarterKit 和嵌套 TaskItem/TaskList 已注册；`codec.ts` 已严格验证 checked 布尔值、orderedList start/type 及子节点结构；`markdown.ts` 已有 GFM 列表和复杂列表围栏路径。`blockMenu.ts` 的文本转换目标只有正文、标题、代码、引用；`interactionToolbar.ts` 复用此菜单，不能直接把 list 加入 `setBlockType` 文本转换。

补充只读核查：远端 `feat-list-feature-upgrade` HEAD 为 `f489336`，`git merge-base --is-ancestor origin/feat-list-feature-upgrade HEAD` 返回 0，说明其历史已包含在当前基线中，并非未合并的新功能分支。该分支的 `8630b95` 实现 checklist、Markdown 快捷输入等能力，`f489336` 修复列表与多行输入回归；主线随后在 `8db8146` 完成 Tiptap/ProseMirror 迁移。

旧分支的 `src/lib/blockConversion.ts` 已实现 todo / unorderedList / orderedList 之间转换；`NoteContentEditing.ts` 切换 `items[].checked`，`NoteChecklistBlock.tsx` 渲染勾选，`markdownShortcut.ts` 处理 `[] `、`[x] `、`- ` 和数字列表快捷输入；`blockConversion.test.ts`、`NoteEditorRegressions.test.tsx` 等有相关回归案例。其类型基于 `NoteBlock.kind`、普通列表块的纯文本 `text` 以及 todo/checklist 的 `items[]`，与现行 HNN v1 文档树不同，不能把旧实现或旧数据读取路径直接搬回。开发应复用现行 Tiptap 列表能力，参考旧案例补充当前内核测试，不重复开发已存在的 schema/codec。旧快捷输入规则也不等于本次 Markdown 导入导出契约，尤其旧测试排除大写 `[X]` 快捷输入，不应据此修改本次 GFM 导入要求。本轮未运行旧分支测试，不能据静态检查宣称其实现通过本次验收。

WebBase 的 `webview/package.json` 与锁文件均精确消费 npm notes 3.2.0；`main.tsx` 引入公开样式，`HnnDocumentSession.tsx` 使用 NoteDocumentProvider，`hnn-notes-schema.ts` 调用公开 decodeHnn/encodeHnn。宿主 `hnn-document.ts` 保存 metadata 与 notes 的外壳，而 notes 库只管理 notes 内的 HNN v1。

## Goals / Non-Goals

**Goals:** 在既有 schema、共享文档会话及保存链路上补齐列表交互；确定可原子验证的转换边界；保证发布产物能被真实宿主安装。

**Non-Goals:** 不另建任务实体、checked 存储、编辑器内核或保存协议；不公开原始 Editor/私有命令；不迁移旧版 blocks 数据；不改造宿主原生运行路径。

## Decisions

### 1. 将列表操作从文本块转换中独立建模

新增内部列表操作模块（建议 `src/lib/editor/listCommands.ts`），统一计算操作目标、disabled/active、转换候选和事务提交。交互工具栏使用当前视图的光标或同容器同层连续项；块菜单明确使用锚定列表全部直属项。普通段落批量包装和单段创建复用该模块。菜单点击保持本视图选择，执行前重新校验目标及权限，不从另一视图恢复旧选区。

同层项范围以端点所在列表项和最近列表容器判定，半开区间终点位于下一项开头时排除该项；跨层/跨容器禁用。列表节点的全选由块菜单明确表达。这样避免文本选区误把子树递归转换。替代方案“任意跨块选择全部递归转换”本期拒绝，因难以预测哪些未选内容被改动。

在已有交互工具栏的转换区展示三种列表及转正文；块菜单为列表提供三类目标及转正文；移动布局提供同一入口及缩进/反缩进按钮，保证没有物理键盘仍可操作。复用已有视觉与菜单可访问性，不新增独立浮层系统。

### 2. 按选中直属项拆段转换

源容器拆为前段、目标段、后段，空段不生成。目标段只改列表包装类型和直属项类型，逐项保留完整 block 内容及子列表。新包装节点分配唯一 ID，仍存在的内容节点保持 ID；任务/普通项转换保留合法的原 ID 并删除目标不支持的属性。若源列表仅整体替换，容器 ID 尽量保留；拆分时旧 ID 只给一个存续段，不复制给多个节点。

| 来源 → 目标 | checked | 编号 |
| --- | --- | --- |
| 有序 → 无序 | 无 | 移除目标段 start/type |
| 有序 → 待办 | 全部 false | 移除目标段 start/type |
| 无序 → 有序 | 无 | 新段 start=1、type=null |
| 无序 → 待办 | 全部 false | 无 |
| 待办 → 有序 | 移除 | 新段 start=1、type=null |
| 待办 → 无序 | 移除 | 无 |

同类型请求不提交事务；子列表不参与上表。未转换有序前段保留 start，后段 start=原 start+原索引，保留 type；不自动合并相邻独立段。原有特殊编号可读取保留，本期无编辑起始值或字母编号 UI。转正文移除所选项包装，将其段落和子列表按原顺序放回父级；仅目标项的 checked/start 语义消失，子列表保持原类型及状态。若父结构不能接受该结果则禁用并保持原文档。

替代方案在普通项偷偷存 lastChecked/lastStart 会扩展封闭 schema，且难以解释保存重开行为，本期不用；状态恢复只走撤销。

### 3. 所有变化走既有预算事务和共享历史

参考 `textFormatting.ts` 的候选事务和 `budgetedTransaction.ts`：先生成完整候选，再 schema/nodeId/512 KiB、32 层、512 节点检查，一次提交并隔离历史边界。列表转换、勾选、键盘拆分及缩进都必须经过等价保护，不能仅保护菜单路径。复用 Tiptap list 命令前验证其 task/listItem 互转及自动 join 行为；如违背拆段和编号规则，使用显式事务构造，不能默认依赖 toggleList 的合并策略。

新待办项 checked=false；新行不继承已完成。层级调整移动整项子树，Tab 在无前项时不修改，顶层退出按上述解包策略。只读/freeze/IME 守卫必须覆盖任务 checkbox 的 NodeView 与键盘，checkbox 不能起拖；为键盘提供原生或等价的 checkbox role、checked 状态、标签和 Space 激活。共享 Provider 继续作为唯一文档/历史来源。

### 4. 持久化保持现有模型

复用 `taskItem.attrs.checked`；严格解析不接受字符串、null、缺省 checked，不能用 false 修复坏输入。为已有 codec/markdown 增加针对性回归，只有发现路径不满足新增契约才改实现。Markdown 简单列表输出 GFM，无法表达的结构走既有围栏或降级确认；不新建 Markdown 方言。

### 5. 发布产物与宿主集成按顺序交付

M1 完成 notes 功能、回归和浏览器交互后，以 `build:lib` 生成的包做独立消费验证（可复用 `scripts/fixtures/pack-consumer` 与 `verify-pack-consumer.mjs`），检查 JS、types、CSS 与公开入口。现有 v* tag 工作流使用正式 tag 的版本并发布 latest；选择未占用且高于 3.2.0 的兼容正式版本，具体号码在发布前确定，不预设本轮已发布。

M2 记录发布源码、tag、npm 版本、registry 完整性，干净环境安装正式包，验证发布身份和公开 API。保留现有发布检查，包括 lint、typecheck、test、依赖/legacy API/phase1 守卫和 build，不关闭门禁。

M3 在 WebBase `webview/package.json` 更新精确版本及子项目锁文件，保持既有 painting override，除非实际兼容验证证明需要调整且有单独说明。现有 Provider 和 decode/encode 路径应直接获得列表能力，宿主只补必要样式/适配和测试，不复制 notes 源码。Web-only 验证覆盖 HNN 保存关闭重开、同文档分屏和失败保护。

本轮只写 notes 内规划产物；以上跨仓库实现、发布与依赖更新全部留给后续开发阶段。

## Risks / Trade-offs

- [内置命令自动 join 或递归改变后代] → 六向矩阵、部分选区、不同 start 和混合子列表分别做结构断言，必要时显式构造事务。
- [移除 checked 后用户希望找回] → 策略在规格中明确；一次撤销恢复，本期不引入隐式历史字段。
- [列表嵌套快速触及预算] → 用现有全局限制，禁止部分提交；不承诺无限层级。
- [只验证源码而发布包漏样式/类型] → pack 消费与正式 npm 干净安装各验证一次。
- [仓库版本与 tag 不一致导致误发] → 依据 tag 发布脚本，发布时记录 revision/版本/完整性，并核对宿主公开接口。
- [跨仓库交付遗漏宿主验证] → M3 是整条 HAM-237 完成的必要条件，仅 notes 发布成功不能宣称需求完成。

## Migration Plan

无 HNN schema 迁移；保存前后仍为 v1，宿主外壳不变。按 M1 → M2 → M3 执行，WebBase 依赖升级必须晚于正式包可安装。功能问题修复用新版本发布，不覆盖已有 npm 版本。

回滚 WebBase 依赖和锁文件到升级前版本并重新 Web 构建；三种列表节点在既有 schema 已受支持，回滚前用包含列表的样本文档核对旧版本可读，保留用户文件，不做降级重写。若旧版本不能读取新文件，阻止自动回退编辑，保留文件并发布兼容修复。

## Open Questions

- 正式版本号和 npm 包完整性在 M2 取得，交接记录中必须补齐；不会改变本提案行为和任务范围。
- 本文转换策略为产品经理拟定的验收基线，评审若修改则同步更新四份 delta 和任务，当前无必须等待的产品问题。
