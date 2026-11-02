# Design

## Context

目标为 `HamsterNote/notes`，当前包版本 `3.1.3-ham107.1`，React 19 + Tiptap/ProseMirror。仓库已有 `schema: spec-driven`，未发现随仓库安装的 propose 命令/技能，故使用当前运行环境安装的 openspec-propose 和 CLI 返回模板。动机见 proposal.md。

已核查 `blockReorder.ts` 的顶层 decoration handle、500ms/10px 长按状态机、中点落点算法及独立撤销边界；`blockMenu.ts` 提供上移/下移、正文/标题1–3/代码块转换、表格/公式/图片插入；当前移动长按只绑定 handle。`styles.css` 的 `max-width:840px` 仍常显 handle。`extensions.ts` 的 StarterKit 显式 `underline:false`，因此不能只增加下划线按钮。`session.ts` 与 `documentSession.ts` 分别装配单编辑器和 Provider/View，需要同时接入且不绕过共享文档和 freeze 门禁。

相关既有 change `deliver-notes-3-1-shared-session`、`deliver-notes-3-1-2-public-host-capabilities` 的任务已完成但未归档，其 Provider/View、图片和共享 history 行为已存在于代码，作为保留约束；本 change 不修改这些产物。

`DESIGN.md` 含旧 selectMode/底部固定工具栏描述，840px 在不同章节有严格小于与包含边界两种写法，且旧基线讨论行级拖动。本提案明确将本次两个 popover 的交互替换为块下方/选区锚定布局，统一 ≤840px，继续仅顶层块重排；实施时同步相关章节，不恢复已废弃接口或拖动语义。这是对旧设计的显式调整。

## Goals / Non-Goals

**Goals:** 同一份块命令数据驱动桌面 handle 菜单与移动 popover；同一重排提交入口服务两种启动方式；每个视图独立管理交互临时状态，所有正文变更继续走权威会话。

**Non-Goals:** 不暴露 editor/schema/history 给宿主，不增加设备配置公共 API，不改变持久化节点、上传服务、同步或保存协议，不实现自动滚屏、多块拖动或嵌套重排。不修改 WebBase，也不执行发布。

## Decisions

### 1. 统一响应式策略与事件边界

使用内部 `matchMedia('(max-width: 840px)')` 策略与同一 CSS media query。选择布局视口宽度，避免 UA 与混合输入设备导致菜单和 handle 状态不一致；不按每次 pointer 类型切换设备模式。pointerType 只决定是否启动触摸/笔长按。移动布局鼠标可用文字上移/下移。

跨断点关闭临时菜单、取消 pending/active 手势，再基于当前有效焦点重建入口；不重建 editor 或会话。软键盘导致的可见高度变化只重新定位，不用其高度改变断点。隐藏 handle 时同时移除命中、Tab 和辅助技术可达性；不只把 opacity 设为零。

### 2. 复用重排状态机，入口从 handle 扩展到块正文

从编辑器根代理触摸/笔 pointerdown，解析直接顶层块 nodeId 与实时位置；排除嵌套控件、链接、表单、popover、已有非空选区和组合输入。按下可以自然产生焦点变化，但不能预先阻止默认滚动。沿用 pending → active → commit/cancel：500ms、10px；第二指针或取消撤销；激活后捕获对应指针、清除本次新生成的 DOM 选区、抑制该手势 contextmenu/click。

仅 pending 阶段自然生成、尚未由用户完成的选区可在激活时清除，手势开始前已有的文本选区始终优先。浏览器若在激活前因原生滚动或文本选择取消 pointer，应取消本次排序；不能全局设置 `touch-action:none` 去牺牲正文滚动。移动浏览器接管风险由浏览器验证覆盖。

复用现有 decoration 高亮、3px 落点线及主题 token，不新增动画。激活时防御性调用 `navigator.vibrate?.(10)`，异常吞掉且无重试，不新增 native 震动桥。pointerup 先用最终 clientY 更新 boundary，再复用 `reorderTopLevelBlock`；meta-only 视觉更新不进入 history，有效移动一笔 docChanged，配现有前后历史栅栏。pending/active 期间其他 docChanged、freeze、卸载、跨断点均取消，防止用陈旧索引移动错块。

替代方案为给正文添加第二个可见拖动按钮，会违背隐藏 handle 后直接长按的目标；不采用。

### 3. 共享块操作定义，分离菜单与 toolbar 呈现

将 `blockMenu.ts` 中实时 resolve、disabledReason、无损转换和预算提交逻辑提取为内部共享命令描述。桌面 handle 继续以现有纵向菜单呈现；移动以 role=toolbar 横向呈现 `转换为 / 插入 / 加粗 / 斜体 / 下划线 / 上移 / 下移`。转换/插入切换同一浮层内的展开行，选项分别使用现有五种转换、三种插入能力，不复制规则或嵌套 portal。按 Escape 关闭后记录一次交互抑制，直到焦点块或 selection 再变化才重开。

聚焦块归属由当前 selection 所在顶层祖先确定；NodeSelection 也可显示块操作，但禁用文字按钮。软换行不产生独立 toolbar。选区跨多个块时以 selection head 所属块作为转换/插入/重排目标，格式按钮仍作用于完整合法文本选区。

按钮 mousedown/pointer 交互保留编辑选区；进入 toolbar 的键盘焦点保留 selection bookmark。提交时必须核对所属视图、会话身份、当前有效选区和可编辑门禁，不能在延迟回调中盲目恢复旧 selection。按动作需要回焦相应编辑位置，图片继续走既有 picker/enqueue，转换与插入仍走现有预算事务。

不直接复用 `openAnchoredMenu` 的打开即聚焦首项行为显示移动菜单，否则每次正文 focus 都会被抢走。复用定位与关闭基础能力或增加内部非夺焦 toolbar 呈现，保留既有纵向菜单的行为和测试。

### 4. 非移动选区浮层与临时状态归属

每个编辑视图订阅 selectionUpdate、focus/blur、editable 状态；仅 >840px 且非空 TextSelection、非组合输入、非 freeze 时显示。正文拖选过程中延迟至 pointerup 稳定后呈现，键盘选择更新可直接刷新。工具栏恰为 `加粗 / 斜体 / 下划线`，不放转换、插入或其他格式。

复用 ProseMirror 选区和官方 toggle mark 命令，跨块 TextSelection 保留合法可格式化范围；NodeSelection/CellSelection 不当作文本选区。全部具备某格式时移除，否则统一添加；`aria-pressed` 表示全范围状态，混合范围不是全选中态。命令走预算预检和既有会话分发，不直接改 DOM。

`NoteEditor` 与 Provider 每个 View 安装同一内部交互协调器并登记 cleanup。其他视图内容变化后先重新验证当前选区，不抢占其焦点；菜单、计时器、pointer capture、媒体查询和事件监听随视图销毁清理。freeze 的 editable=false 使现有浮层立即关闭且不允许待执行命令通过。

### 5. 定位、溢出与无障碍

移动锚定当前顶层块 rect，非移动锚定选区 rect；优先下方，空间不足翻转，水平限制到可见视口。用 visualViewport（不可用时 window）响应软键盘、滚动和缩放；锚点不可见时关闭。宽度内单行横向滚动，展开选项也为横向行，不给正文增加溢出。复用现有颜色、阴影、层级，按钮可读中文标签，不制作 icon。

toolbar 采用可聚焦按钮、左右方向键和 Home/End roving focus、Enter/Space 激活、Escape 回编辑位置；禁用原因可被辅助技术读取。普通正文 focus 显示菜单时不自动进入菜单。外部点击只关闭自身菜单，不吞掉新目标交互。

### 6. 补齐下划线的封闭格式契约

启用 StarterKit 已包含的 underline 扩展，保持 codec 与 editor schema 来自同一 `createHnnExtensions` 装配，不添加第二份手写 schema 或宿主扩展接口。白名单由 schema 派生，补测 encode/decode、HTML 剪贴板、共享历史与预算失败。

当前 Markdown 文本 mark 分支对未列出的 mark 可能忽略，因此必须把 underline 识别为 GFM 无法直接无损表达的格式，进入已有 JSON-b64 围栏保真路径，不扩展 Markdown 语法；若既有可定位诊断降级路径被采用，必须走现有写出确认。HNN `schemaVersion:1` 保持，但旧版本的封闭 schema 会拒绝新 mark；不能宣称新文件对旧 notes 可读。

## Risks / Trade-offs

- [浏览器长按与原生选择竞争] → 激活前不阻断滚动，已有选区与控件优先；以触摸浏览器真实事件验证，pointercancel 必须无事务退出。
- [长内容块使下方锚点不可见] → 关闭不可见浮层并在锚点恢复可见时按当前焦点刷新，不改成永久底栏，不新增自动滚屏。
- [下划线新增持久 mark 的旧消费者兼容性] → 文档注明旧版本不能读取含新 mark 的文件，升级消费者后再使用；不转换旧文件或静默去格式。
- [多视图与 freeze 下陈旧回调] → 以视图/会话身份与即时 editable 校验，统一 cleanup 和现有权威 transaction 分发。
- [旧设计与当前需求存在差异] → 实施时仅更新相关响应式、popover、顶层拖动章节，保留主题基线并明确本 change 的覆盖范围。

## Migration Plan

先增加内部命令与格式能力，再将同一交互接入单编辑器及 Provider/View，补齐样式和 Web 测试。保持公共 props 与保存协议，无既有文档批量迁移。发布及宿主升级不在本 change 中；回退含下划线的文档前必须保留原数据，旧库不能直接作为无损回退读取器。

## Open Questions

无阻塞项。≤840px 的统一判定、500ms/10px、一次10ms震动及展开区域排布均为基于既有实现的提案设计值，等待整体评审，不代表用户已逐项确认。
