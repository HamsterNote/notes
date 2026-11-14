# Design

## Context

动机、六项原话与 S1–S6 基线见 proposal.md。OpenSpec 1.13.1、项目 schema 为 spec-driven，未发现仓库自带 propose 命令/技能，按运行时安装的 openspec-propose 与 CLI 返回模板生成。当前库为 Tiptap 3.31.3 / ProseMirror，HNN 封闭 schema 有容量、深度、身份和事务权限约束。

已核查 quoteInteractions 的高优先级 Enter/前缀处理，extensions 的 blockquote NodeView 与 StarterKit UndoRedo 开关，blockMenu 的实时 nodeId 复核及预算化转换，DocumentSession 的 authority history / onHistoryRequest 分流，以及独立 Provider history 回归。现有图片 change 已设计确认弹层、主题与目标校验，需兼容其入口，不能移除“下一行”或破坏图片流程。

## Goals / Non-Goals

**Goals:** 在封闭 schema 与既有保存/历史所有权下交付全部六项；目标定位使用当前视图、会话、nodeId 与正文版本；所有有效结构修改原子提交、可独立撤销，失败保持原文与历史。可观察行为由两个 delta spec 约束。

**Non-Goals:** 本阶段不实现；不开放宿主 schema/history 注入，不做通用命令平台、不添加搜索/插入 slash 命令；不迁移或删除既有 author 数据，不删除托管文件，不改变图片上传协议。

## Decisions

### D1：移除署名 UI，保留 HNN 属性

在 extensions 的引用 NodeView 中保留 contentDOM，移除 footer/input/error 及其事件监听与专属选择拦截，清理已无用途样式和测试。引用 UI 不再显示或允许编辑 author；现有 schema、codec、HNN 剪贴板与显式导入导出契约保持，旧 author 仍可往返，新建引用为 null。这样避免去掉视觉入口时静默损坏存量数据。直接删除 schema 属性会扩展为格式迁移，本期不采用。

### D2：Enter 分离引用，Shift+Enter 仍为软换行

在 quoteInteractions 中修改普通 Enter 分支，统一构建未提交 candidate 后走预算化单事务。折叠光标位于引用内普通段落（或可拆分标题）时，将光标前内容保留为前引用，光标后文字移入新正文段落；当前段之后的其他块保留为后引用。示例 `quote(甲|乙, 丙)` → `quote(甲), paragraph(|乙), quote(丙)`；末尾 Enter 为引用后空段落，起点 Enter 将整段文字移至新正文，不制造空引用。新正文位于最外层连续引用之外；空包装递归清理，若空引用是唯一块则得到一个空正文。

嵌套引用按同一切分点拆分连续引用祖先链，前后保留各自未编辑子树与相对次序。原节点只在保留的一侧沿用原 nodeId，新增正文/拆出包装使用唯一新 ID；不能复制同一 ID。引用外的非引用祖先结构边界不跨越，列表项优先原有拆项/空项退出、代码块保留原有回车；表格内引用只退出到所属单元格。Shift+Enter 插入 hardBreak，保持引用与其他内容不变。

同一文本块内非空选区先替换选区再执行上述动作，合为一事务；跨文本块选区保留现有选区替换/删除行为，不自定义引用提升。IME Enter、229、只读/freeze 不触发。拒绝结构/预算超限则保持原文、光标和 history，不回落到错误的引用内换行。普通 splitBlock 延续引用的旧方案与需求冲突，明确替换；更新旧测试而非并存两套 Enter 规则。

### D3：确认层是非文档状态，确认才提交删除

blockMenu 新增中文“删除”，锚定整个顶层块及子树，不使用残留文本选区。复用既有弹层的主题/焦点/清理方式，使用具备名称“删除内容块？”的模态确认层，说明“将删除此块及其全部内容，可撤销”，提供“取消”“确认删除”，默认取消聚焦，Tab/Shift+Tab 在层内循环。打开即关闭块菜单，未确认不提交正文事务。取消/Escape/遮罩关闭回到原手柄；原手柄消失则回到所属视图最近有效编辑位置，不抢另一视图焦点。

打开时记录 sessionId、目标 nodeId、正文版本及原焦点；确认时重验会话、文档版本、可编辑/freeze/IME 状态和目标身份。期间任意正文变更（包括另一视图编辑、移动或删除）使目标过期，禁用/拒绝确认并显示“内容已变化，请重新打开删除确认”；纯焦点或选区变化不算正文变化。使用整份正文版本的保守拒绝规则，避免用户确认未见内容；不只依赖位置或同 ID。

有效确认一次删除整块，若文档将空则同事务补一个具有新 ID 的空段落；光标落到后继可编辑位置，无后继则前驱，再否则新空段落。确认后回到发起视图。全部走 commitBudgetedTransaction 的权限、编码与预算检查和前后历史栅栏；一次 undo 还原删除前完整子树、属性与身份，redo 不再询问。失败显示原因，不产生部分删除。销毁/切换/只读/freeze 关闭确认层并清理监听。资源节点只删引用，异步结果继续遵守原有身份验证，不能重插已删节点。

不采用原生 window.confirm：需要可靠的视图主题、可访问焦点与陈旧目标错误。移动布局不新增左侧手柄，保持既有 840px 断点约束；本需求的删除入口限人类指定的左侧块菜单。

### D4：底栏主题由所属视图传播

ViewToolbar 复用 painting-toolbar 的 shell，不重造工具栏。以 src/lib/styles.css 中当前视图 --hn-* 色彩为源，将供应方轻量 toolbar 消费的变量映射到视图主题；若弹层 portal 到 body，给 portal 根携带所属视图主题值/标识，避免继承全局 light 或另一栏。NoteSaveStatus 的状态文字同样遵守作用域。开发需依据 vendor 包实际样式变量契约接线，不盲目添加同名 CSS 覆盖。

覆盖背景、文本、图标、边框、hover、pressed、focus-visible、disabled 和文件菜单，兼容 inline 旧布局与 layout.edge=bottom 浮动布局。主题切换只刷新呈现，不改会话、占位、正文、dirty 或 history。全局暗色覆盖容易污染明暗分屏，不采用。普通文字对比度至少 4.5:1，启用控件边界和焦点至少 3:1；disabled 保持可辨认。

### D5：转换能力共用，slash 使用逻辑行级目标

从 blockMenu 转换命令提取可内部复用的转换描述及执行预检，保留原块菜单的顶层块目标；新增编辑器内 slash 交互模块，由封闭 extensions/编辑视图装配接入。不要把 blockMenu 的顶层 getPos 直接用于嵌套行。slash 解析当前段落/标题的 nodeId、位置和所在父结构，转换仅作用该行；列表项首段不能变为非法标题等结构时对应条目禁用说明原因，允许的列表互转遵守原同层项契约；引用目标只包裹该行。表格和嵌套引用中的合法转换不扩大到整个容器。

只有折叠 caret 的文本块 offset=0、非代码上下文新输入单个 `/` 才打开；空格后的 `/`、视觉折行起点、hardBreak 后、粘贴 `/` 或预装载含 `/` 文档均不触发。UI 状态记录触发范围、行身份、sessionId、正文版本，触发符保留于正文。清单固定九项：正文、标题 1/2/3、代码块、引用、有序/无序/待办列表，沿用无损限制、当前类型禁用及原因；不包含移动、删除、插入。

弹层以 caret 锚定，默认第一可用项，上下键循环跳过禁用项，Home/End 到首末可用项，Enter/点击确认，Escape 取消；所有项禁用时显示原因且 Enter 不转换。采用可被读屏识别的列表/活动项语义，焦点留在编辑器，菜单导航消费按键以防 Enter 同时换行，鼠标不丢 caret。位置随可见视口调整，不遮挡 caret、不越屏，移动布局同样可用。

确认时重验触发范围、行身份、版本与权限，将“删除 `/` + 转换当前行 + 恢复 caret”合成单个预算化候选，不能先删 `/` 再尝试转换。撤销该转换恢复包含 `/` 的原行，前序键入 `/` 是既有输入事件；取消保留 `/` 且不额外增加历史。普通继续输入关闭菜单并保留字面文本，不引入未要求的查询搜索。光标离开触发行、正文被任何来源修改、只读/freeze、组合输入开始、scroll 令锚点不可见、视图卸载或会话切换都清理菜单；失效后旧回调不提交。与其他视图菜单独立，与同视图已有交互 popover 互斥，避免双重按键处理。

### D6：快捷键接入现有所有者并严格限定焦点

独立 NoteEditor 仍使用 createHnnEditorExtensions 的官方 UndoRedo；共享视图继续禁用各自 StarterKit history，经 documentSession.sharedDocumentHistory 将 Mod-z/Mod-Shift-z 路由至唯一 authority。onHistoryRequest 已配置时，方向和当前 identity 只上报一次；回调无论 true/false 都不再 fallback 到本地栈，host 通过既有 applyHostDocument 同步结果。保留 Mod-y，不用键盘事件另建快照历史。

键盘仅由拥有编辑焦点的正文视图处理，不注册 document 全局抢占。NodeView 表单、URL/文件输入、其他 input/textarea、弹层以及编辑器外内容保留自身原生撤销；IME、229、只读/freeze 不请求正文 history。正确处理大小写 Z、Meta/Ctrl 与 Shift 的实际事件，拒绝 Alt 混合键。有效正文快捷键即使空栈/宿主返回 false 也消费事件，防浏览器 contenteditable 原生撤销破坏受控状态；IME/外部输入不拦截。每次按键至多一次历史请求。

共享栈遵守全局时间顺序，不变成每视图局部栈；只恢复发起视图的有效书签，不抢其他视图焦点。撤销/重做是正文变更，沿用同步、onChange 与 dirty/baseline 计算；不会因撤销而伪造保存成功。会话键变化清空原栈，撤销后新编辑清空 redo；命令仍沿用既有单事务前后栅栏，不把本次结构动作与前后输入合并。

## Risks / Trade-offs

- [引用旧测试与现有规格相冲突] → 在 delta 中完整修改原 requirement，并以 S1/S2 更新冲突测试；codec 署名往返测试继续保留。
- [拆分嵌套引用造成内容或 ID 丢失/重复] → 未提交候选进行 schema/编码/预算预检，覆盖起中末、空引用、多段与嵌套，检查 ID 和撤销前后精确 HNN。
- [版本过期拒绝删除可能增加一次重开] → 显示明确原因，以安全、可解释的确认目标为优先，保留全部正文。
- [菜单 refactor 影响图片 change] → 保留 blockMenu 对外内部返回项与原顶层目标契约，回归下一行图像弹层、上传与重做幂等。
- [主题不继承到供应方 portal] → 显式主题传播并在双视图明暗交叉场景验证，不能仅检查主页面 data-theme。
- [操作系统修饰键测试仅模拟而漏实际浏览器] → 自动化 keydown 外保留 macOS/Windows 真机键盘冒烟，缺少平台时开发报告未覆盖项，不冒称通过。

## Migration Plan

仅交付规格文档，无运行时迁移或发布。本设计实施后保持 HNN v1 和旧 author 数据，回滚 UI/键盘改动不需转换已保存数据。后续工程师按 tasks 分步实现并执行 S1–S6 与既有图片/共享会话回归，再进入项目原有评审流程；不在此阶段 apply、部署、归档或分派。
