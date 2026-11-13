# Design

## Context

本次增量以 main `5237b9b` 为实现基线。M1 1.1–1.10 已合入并经独立复审，下面原始方案保留其设计缘由；新增实现仅对应 tasks 1.11–1.16，不重置既有完成记录。M2 等待既有发布版本确认流程，M3 仍在 M2 之后；本轮不启动其中任何实现或发布操作。

动机见 proposal.md。OpenSpec CLI 为 1.13.1，notes 使用 repo-local `spec-driven`；本 change 统一放在 notes，不为同一需求在 WebBase 重复建 change。仓库未发现专属 propose 命令文件，按已安装 openspec-propose 技能及 CLI artifact instructions 执行。

原提案基线 notes `53f82c8` 已包含发布 tag v3.2.0（`6c923ec`）及其后的宿主工具栏等改动。tag 和当时 HEAD 的 package.json 都写 3.1.3-ham133.3，`.github/workflows/release.yml` 在 v* tag 触发后由 `scripts/prepare-release.mjs` 重写为 tag 版本，故该差异不等于源码落后。正式包身份仍需在实际发布时核对。

原提案已检查 `src/lib/hnn/extensions.ts`：StarterKit 和嵌套 TaskItem/TaskList 已注册；`codec.ts` 已严格验证 checked 布尔值、orderedList start/type 及子节点结构；`markdown.ts` 已有 GFM 列表和复杂列表围栏路径。M1 现已补齐菜单和独立列表命令；仍不能直接把 list 当作 `setBlockType` 文本转换。

补充只读核查：远端 `feat-list-feature-upgrade` HEAD 为 `f489336`，`git merge-base --is-ancestor origin/feat-list-feature-upgrade HEAD` 返回 0，说明其历史已包含在当前基线中，并非未合并的新功能分支。该分支的 `8630b95` 实现 checklist、Markdown 快捷输入等能力，`f489336` 修复列表与多行输入回归；主线随后在 `8db8146` 完成 Tiptap/ProseMirror 迁移。

旧分支的 `src/lib/blockConversion.ts` 已实现 todo / unorderedList / orderedList 之间转换；`NoteContentEditing.ts` 切换 `items[].checked`，`NoteChecklistBlock.tsx` 渲染勾选，`markdownShortcut.ts` 处理 `[] `、`[x] `、`- ` 和数字列表快捷输入；`blockConversion.test.ts`、`NoteEditorRegressions.test.tsx` 等有相关回归案例。其类型基于 `NoteBlock.kind`、普通列表块的纯文本 `text` 以及 todo/checklist 的 `items[]`，与现行 HNN v1 文档树不同，不能把旧实现或旧数据读取路径直接搬回。开发应复用现行 Tiptap 列表能力，参考旧案例补充当前内核测试，不重复开发已存在的 schema/codec。旧快捷输入规则也不等于本次 Markdown 导入导出契约，尤其旧测试排除大写 `[X]` 快捷输入，不应据此修改本次 GFM 导入要求。本轮未运行旧分支测试，不能据静态检查宣称其实现通过本次验收。

WebBase 的 `webview/package.json` 与锁文件均精确消费 npm notes 3.2.0；`main.tsx` 引入公开样式，`HnnDocumentSession.tsx` 使用 NoteDocumentProvider，`hnn-notes-schema.ts` 调用公开 decodeHnn/encodeHnn。宿主 `hnn-document.ts` 保存 metadata 与 notes 的外壳，而 notes 库只管理 notes 内的 HNN v1。

## Goals / Non-Goals

**Goals:** 在既有 schema、共享文档会话及保存链路上补齐列表交互；确定可原子验证的转换边界；保证发布产物能被真实宿主安装。

**Non-Goals:** 不另建任务实体、checked 存储、编辑器内核或保存协议；不公开原始 Editor/私有命令；不迁移旧版 blocks 数据；不改造宿主原生运行路径。

## Decisions

### 1. 将列表操作从文本块转换中独立建模

现已实现的 `src/lib/editor/listCommands.ts` 统一计算操作目标、disabled/active、转换候选和事务提交，后续增量复用此模块。交互工具栏使用当前视图的光标或同容器同层连续项；块菜单明确使用锚定列表全部直属项。普通段落批量包装和单段创建复用该模块。菜单点击保持本视图选择，执行前重新校验目标及权限，不从另一视图恢复旧选区。

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

新增三项能力必须在 M1 增量完成后进入 M2 的 pack 和正式 npm 消费测试，M3 同时验收这三项；不得先发不含增量的包再将增量误报为已集成。本轮只写 notes 内规划产物；以上跨仓库实现、发布与依赖更新全部留给后续开发阶段。

### 6. 层级编号只派生显示，不改变整数计数

保持 `orderedList.attrs.start` 和 `type`，不增 schema 字段。type=null 定义自动模式；d 为从文档根至该节点的三类列表容器总数，忽略其他包装。用 d 映射 decimal/lower-alpha/lower-roman 并在全部存活视图一致呈现；类型 1/a/A/i/I 的历史显式值优先。普通 HTML ol/浏览器默认不会自动实现循环，需在现行渲染扩展或视图 decoration 中标明派生样式并用库样式显示，不能只写死三层 CSS 选择器。优先使用渲染/decoration 派生，避免为一次缩进创建额外持久化事务、污染历史或使装载变脏；style/data 属性不能进入 HNN。两栏不同宽度仍应得到相同编号。

整数计数仍以 start+index 为权威；现有拆段 5/1/7 不改，二级可视值为 e/a/g。新缩进子列表 start=1；已有目标列表按其插入位置连续计数；源未移动后段继续使用原 start+原索引。移动子树只改变自动样式，不修改内部 start/type/checked。字母采用 bijective base-26（z→aa），罗马 1–3999 标准减法，超界十进制回退；为 marker 留足宽度避免 aa. 或长序号遮挡正文。

Markdown 采用语义优先：不保存/复原输入源码逐项 marker；自动模式仍导出 GFM 数字，按 start 和结构往返后重新派生样式。当前 `standardBlock` 对复杂嵌套可能使用无损围栏，此路径仍保留，不为追求 GFM 强行扁平化；显式非 null type 继续沿用现有围栏/诊断策略。替代方案持久化每层 a/i 会把派生值变成显式值，反缩进后样式不再自动变化，故不用。

### 7. 引用复用已核实的现行节点与 Markdown 路径

`extensions.ts` 的 HnnBlockquote 已定义 name=blockquote、content=block+、author=null，且在最终装配注册；StarterKit 的 blockquote 被禁用，现行自定义 Node 未定义 addInputRules，因此不能直接假设上游快捷输入仍在。`codec.ts` 已允许 blockquote 和 author 校验；`markdown.ts` 的 blockquote 导入分支构造 author=null 和子块，导出对无署名可表达内容生成标准引用。链接同样已有 HnnLink，仅持久化 href，关闭自动识别和点击打开；不因本次 UI 打开这些全局选项。

为 HnnBlockquote 或独立内部交互扩展增加受预算、权限、IME 保护的 `> ` input rule；检查段落起点和上下文，排除代码、列表项首段和非空选区。只消费新键入前缀，不扫描正文内所有大于号，也不把 Markdown 文件导入和即时输入混为一谈。保留 prefix 后文本和原段落 ID，新引用分配唯一 ID；一次撤销恢复字面前缀。现行自定义节点也没有直接继承上游引用的键盘行为，因此同时补 Enter 继续、末尾空段落退出最近层、Shift+Enter 软换行的回归。替代方案新建 quote 节点或升 schema 无必要，明确拒绝。

### 8. 链接配置是选区事务，不是 Markdown 文本插入

在 `interactionToolbar.ts` 接入单独链接动作，复用 `menuPopover.ts` 的定位/键盘关闭机制或同等可访问配置层。输入有明确 label，打开后焦点进入配置，Tab 在配置控件间移动，Escape 关闭并将焦点交还发起视图。捕获该视图的文档/会话令牌、选区及内容指纹；配置期间任意文档事务即使来自另一视图也使目标失效，保存时要求重新选择。纯焦点与选区事务不应使目标失效。freeze/会话切换后禁止提交，关闭不跨会话恢复旧选择。保守失效比盲目重用 from/to 更容易验证且避免误改。

复用 `HnnLink` 与 `urlPolicy.ts`；空 URL 是字段错误，显式“移除链接”才去 mark，不能用清空 URL 代替取消/移除。只 trim 首尾 U+0020 空格，随后用原安全检查拒绝 Cc/Cf、零宽字符、非法代理项及协议外 URL。允许的绝对协议 http/https/mailto/hnmagic 与 codec 完全一致；不新增 tel、相对 URL 或自动补 https 的猜测逻辑。

只支持同一文本块纯文字范围；遇到单一既有链接部分选区时扩至连续完整 link mark 范围，折叠光标也能编辑该链接。跨 link 与普通文字、多链接混选禁用，避免标题字段含混。保持标题时逐片保留原 marks；改变标题时用用户的新纯文字替换完整目标，继承共有兼容 marks，配置层说明混合格式随标题替换移除。含 code mark/原子/软换行或跨块的选区本期禁用。保存或移除生成一个预算事务并在确实接受后才关闭；失败保持草稿和错误，避免重现 M1 评审发现的“返回成功但无落地”问题。

Markdown 编解码已在 `inlineNodes` / `phrasing` 中处理安全 link、危险 URL 诊断以及文字保留，沿用这些路径，增加配置生成文档的往返测试。字段“链接标题”是 anchor text，不是 Markdown 可选 title；原实现对可选 title 有降级诊断，本次不改该契约。特殊字符交给既有 AST/stringifier 转义，不自行拼接未转义字符串。

## Risks / Trade-offs

- [type=null 的旧嵌套列表外观改变] → 明确为用户要求的自动模式增强，显式 type 保留；HNN 字节不迁移，旧版本仍可读但可能显示数字。
- [引用和链接绕过既有事务过滤器] → 所有入口走现行预算与授权边界，回归列表与卡片/画板授权提交，禁止顺手修改 timestamp 校验。
- [链接标题替换损失局部混合格式] → 不改标题时全量保留，改标题按共有 marks 且在配置层告知；复杂非文字选择直接禁用。

- [内置命令自动 join 或递归改变后代] → 六向矩阵、部分选区、不同 start 和混合子列表分别做结构断言，必要时显式构造事务。
- [移除 checked 后用户希望找回] → 策略在规格中明确；一次撤销恢复，本期不引入隐式历史字段。
- [列表嵌套快速触及预算] → 用现有全局限制，禁止部分提交；不承诺无限层级。
- [只验证源码而发布包漏样式/类型] → pack 消费与正式 npm 干净安装各验证一次。
- [仓库版本与 tag 不一致导致误发] → 依据 tag 发布脚本，发布时记录 revision/版本/完整性，并核对宿主公开接口。
- [跨仓库交付遗漏宿主验证] → M3 是整条 HAM-237 完成的必要条件，仅 notes 发布成功不能宣称需求完成。

## Migration Plan

无 HNN schema 迁移；保存前后仍为 v1，宿主外壳不变。按 M1 基础（已合入）→ M1 增量 1.11–1.16 → M2 → M3 执行，WebBase 依赖升级必须晚于正式包可安装。功能问题修复用新版本发布，不覆盖已有 npm 版本。旧版本读取自动列表可能仍显示十进制，这是显示能力回退，不重写数据；引用与 link 都是旧 schema 已支持的数据。

回滚 WebBase 依赖和锁文件到升级前版本并重新 Web 构建；三种列表节点在既有 schema 已受支持，回滚前用包含列表的样本文档核对旧版本可读，保留用户文件，不做降级重写。若旧版本不能读取新文件，阻止自动回退编辑，保留文件并发布兼容修复。

## Open Questions

- 正式版本号和 npm 包完整性在 M2 取得，交接记录中必须补齐；不会改变本提案行为和任务范围。
- 本文转换策略为产品经理拟定的验收基线，评审若修改则同步更新四份 delta 和任务，当前无必须等待的产品问题。
