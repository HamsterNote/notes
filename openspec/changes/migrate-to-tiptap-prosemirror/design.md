## Context

本仓库 `@hamster-note/notes` 当前以受控的 `NoteBlock` 数组、受限 HTML（`restrictedHtml`）和自研 DOM/Range 交互为核心：`NoteContent` 通过 `onBlocksChange`/`onNoteTransaction` 向外提交完整块数组，自带 `useNoteContentUndoRedo`、跨标题/摘要/正文的连续文本流选区、自研剪贴板 codec（含自定义 MIME）以及块编辑/拖拽。Markdown 仅在 Demo 中借 `remark-gfm` 等做导入演示，并非持久化契约。

本次变更已确定：完全弃用上述内核，不提供向前兼容；`NoteEditor` 以 TipTap/ProseMirror 为唯一状态与交互内核；持久化契约改为 HNN。动机与范围见 `proposal.md`，需求细节见 `specs/` 下各 capability 规格，本文只记录“如何实现”的架构决策。

约束：React 19 + Vite + 严格 TypeScript；库需继续由宿主（consumer）提供真实 I/O；视觉基线与组件视觉不得偏离根目录 `DESIGN.md`（Theme Tokens、Popover、Drawer、Handle/Menu、Editable Table Edge Controls、Formula/Picture/Card/Drawing、Link Mention 等）。现有块能力（heading、paragraph、todo、unorderedList、orderedList、quote、code、callout、table、formula、picture、card、drawing、directory、checklist、collapsible）及 mention/魔法链接需在语义上继续提供。

## Goals / Non-Goals

**Goals:**

- 让 TipTap/ProseMirror 成为唯一事实来源：文档状态、选区、undo/redo、输入规则、剪贴板全部走 PM，不再维护第二套块模型或 DOM/Range 交互。
- 定义精确、可严格校验、无损往返的 HNN 持久化外壳，并把会话生命周期（`documentId`/`loadKey`/dirty/保存/取消）固化为组件契约。
- 定义 GFM + HamsterNote 围栏的 Markdown 方言及其在 HNN 之间的双向转换与降级诊断。
- 在 PM 模型内尽量复刻旧内容能力，并为无法直接映射的能力（card/drawing 等）定义自定义节点与 NodeView。
- 保持 `DESIGN.md` 视觉基线不变，交互行为与旧实现尽可能一致。

**Non-Goals:**

- 不提供旧 `NoteBlock`/旧受限 HTML/旧 HNN 或旧剪贴板 MIME 的读取、迁移或向前兼容。
- 不实现宿主侧真实文件系统/网络 I/O、资源存储与引用解析——这些仍是宿主回调。
- 不实现多人协作、Yjs/peers、远端同步或富文本 OT/CRDT。
- 不扩展成通用 TipTap 发行版：不向宿主开放自定义 schema/扩展注入。
- 不改变 `DESIGN.md` 所定义的视觉 token 与组件外观。

## Decisions

### D1. TipTap/ProseMirror 是唯一状态与交互内核

`NoteEditor` 内部只持有一个 PM `EditorState`，文档为单个 PM doc，标题、摘要、正文、嵌套结构都在其中，不再有并行的 `NoteBlock` 状态。选区统一走 PM：默认 `TextSelection`，原子节点用 `NodeSelection`，表格单元格用 `CellSelection`；旧的跨标题/摘要/正文连续文本流、表格行原子选择与自研剪贴板 MIME 全部废弃，不再复现旧 DOM/Range 连续文本选区。剪贴板使用 PM 原生序列化（HTML + `text/plain`）与标准 `prosemirror-*` 行为，而非自研 MIME。

- **理由**：单一状态源消除旧实现双模型同步的整类缺陷；原生 selection/clipboard 与 IME、浏览器、a11y 的整合成本远低于自研。
- **替代方案**：保留 `NoteBlock` 作为外部契约、内部用 PM 投影（双向同步）。放弃——正是本次要消除的耦合；且无法回避旧选区/剪贴板语义。

### D2. HNN 外壳与严格校验

HNN 精确外壳为 `{ schemaVersion: 1, data: <纯 ProseMirror JSON doc> }`：`data` 是标准 PM `Node.toJSON()` 结果，不含任何包装字段、元数据或“标题/摘要标签”。解析与生成由 codec 负责且必须无损往返。

- HNN v1 完整 JSON 外壳的 UTF-8 编码严格上限为 **512 KiB（524,288 字节）**，包括外壳字段、JSON 语法与所有 `data` 内容；它与单 attr、深度和节点数上限并存，不因满足其中任一其他限制而放宽。codec 必须在会超预算的解析、复制或输出分配前安全拒绝。
- 遇到未知 `schemaVersion`、未知节点类型、未知 mark、非法 attrs（类型/枚举/越界）、或结构不满足 `schema` 时，一律**硬错误**：codec 抛出带路径与原因的诊断错误。
- 硬错误时**不得静默覆盖原文**：调用方必须能区分“解析失败”与“成功”，失败时原 HNN/原件保持不变，由宿主决定后续。
- **理由**：精确外壳可被严格校验且不随实现漂移；硬错误避免把无法理解的内容回写成更贫乏的文档造成数据丢失。
- **替代方案**：宽松解析 + 丢弃未知字段。放弃——会静默丢数据，与无损目标冲突。带 `schemaVersion` 的渐进迁移。放弃——本次明确不向前兼容，未支持版本视为错误。

### D3. 会话模型：`documentId` / `loadKey` / dirty / 保存 / 取消

- **会话键与初始装载**：`documentId` 与 `loadKey` 共同定义一次编辑会话。装载 HNN 时，必须先经 `decodeHnn` 的严格硬校验，再用成功解码结果创建 `EditorState`；不得以损坏输入构造降级会话。同一 `documentId` 与 `loadKey` 下，后续 `initialDocument` prop 的变化必须忽略，不能覆盖用户当前编辑。任一 `documentId` 或 `loadKey` 变化均以当次已验证 HNN 重建整个会话（PM state、plugins、NodeView、监听器）。
- **初始 revision 与 baseline**：`initialRevision?` 必须与本次 `initialDocument` 和 `loadKey` 一同作为该会话的 CAS 基线。会话创建后，文档 baseline 必须取自当次 `editor.state.doc`，revision baseline 取自 `initialRevision`；二者都只在成功保存或下一次会话重建时更新。
- **封闭 history**：undo/redo 使用库内封闭装配的 history 扩展及其状态；会话重建时清空。库不得向宿主暴露 schema、extensions 或 history 的注册、替换入口。
- **dirty**：以 `currentDoc.eq(savedBaseline)` 判定；`eq` 为 PM 结构等价，避免 JSON 字符串比较的键序问题。初始装载后 `savedBaseline` 即为当次 `editor.state.doc`，因此非 dirty。
- **保存与 CAS**：保存时捕获当前 doc 的深快照，以 `onSave(snapshot, { documentId, baseRevision, signal })` 交给宿主。每个会话同时最多一个在途保存；保存中再次触发不得新建并发请求。宿主返回判别结果 `{ kind: 'saved', revision?: string }` 或 `{ kind: 'conflict' }`：仅 `saved` 才将该快照设为新的文档 baseline，并在返回 revision 时更新 revision baseline；未返回 revision 时清除 revision baseline，避免把旧 revision 误当成已保存快照的 revision。保存期间的新编辑不影响在途快照，也不提前清除 dirty；失败保留原 baseline。
- **会话令牌与取消**：每次会话和每个异步操作必须使用不可复用的令牌及独立 `AbortSignal`。`documentId`/`loadKey` 变化或卸载时 abort 在途保存与上传；库仅通过令牌比对在自身状态中忽略陈旧结果，不能保证宿主已停止 I/O。
- **冲突与远端采用**：收到 `conflict` 时不自动合并、不替换当前文档、文档/revision baseline、选择或 history，只暴露冲突态。宿主若选择采用远端，必须以新的 `initialDocument` 加新的 `loadKey` 重载；若保留本地，宿主负责在后续策略中再次保存。宿主必须以 `documentId` 与 `baseRevision?` 实施 CAS，防止已被库忽略的旧请求仍实际覆盖存储。
- **理由**：会话令牌 + 快照/revision baseline 能可靠隔离库内竞态（切换后旧保存/旧上传返回）；宿主 CAS 负责库无法控制的存储端竞态；不自动合并符合“无协作内核”的边界。
- **替代方案**：以 `documentId` 内的 latest-write-wins 自动合并。放弃——无 CRDT 时合并语义不可靠，且掩盖冲突。以 JSON 字符串判 dirty。放弃——脆弱且开销大。

### D4. Markdown 方言与导出降级

- 方言 = GFM（`remark-gfm`）+ HamsterNote 围栏（沿用现有 `hamster-note-card`、`hamster-note-drawing` 等 fenced 约定）。
- **导入**：Markdown → PM doc → 可另存为 HNN。导入产生的文档与为损坏/非规范 HamsterNote 围栏或 JSON-b64 分片保留原内容所需的局部降级表示，都必须落在 D2/D12 的预算内；容量内必须保留该围栏或分片、其余可识别内容及可定位诊断。
- **容量外失败**：若损坏或非规范 Markdown JSON-b64 围栏或分片无法连同其余可识别内容在 512 KiB HNN 内完整、可编码地保留，codec 返回明确受控失败且不返回 document、部分 document 或可保存替代 document。它不截断、改写或生成替代 Markdown；调用方保留并拥有原始 Markdown 的后续处理权。这是有限持久化预算与不静默丢失数据之间的明确、有限例外。
- **HNN 保存**：始终以 HNN 无损保存，不经 Markdown 中转。
- **导出**：Markdown 导出为可选能力；当内容无法被方言无损表达时**必须产出降级诊断**（丢失/近似的节点与位置），并由保存/导出 UI 明确展示、要求用户确认后才落盘。不得静默降级。
- **理由**：Markdown 是互操作入口，HNN 是权威持久化；显式诊断避免用户以为导出等价于原始内容。
- **替代方案**：HNN 内嵌 Markdown 字符串作为正文。放弃——丧失 PM 结构与校验。导出直接丢内容不提示。放弃——不可接受的数据损失。

### D5. 依赖版本锁定与封闭 schema

- 所有 TipTap 包（`@tiptap/core`、`@tiptap/react`、`@tiptap/pm` 及全部官方扩展）**锁定同一精确版本**（exact，不使用 `^`/`~`），确保共享同一份 ProseMirror 实例与 `EditorState` 类型；`@tiptap/pm` 作为单一 PM 入口，避免多份 `prosemirror-*` 副本。
- **schema 封闭**：库定义的 extension 集合即唯一 schema，不向宿主暴露注册自定义扩展/schema 的入口。宿主需要新能力时由库方评审后内置。
- **理由**：TipTap/PM 对版本极度敏感，混版会引发 plugin key 冲突、重复实例与难以定位的崩溃；封闭 schema 保证 HNN 可被稳定严格校验、防止格式分裂。
- **替代方案**：开放 `extensions` prop。放弃——会让同一 `schemaVersion` 产生互不兼容的文档。用 semver range。放弃——会在安装时漂移。

### D6. 节点映射、NodeView 与提交语义

- **映射策略**：优先标准/官方扩展，其次自定义节点。
  - 标准/官方：`doc`、`paragraph`、`heading`、`bulletList`/`orderedList`/`listItem`、`blockquote`、`codeBlock`（+ 语法高亮）、`horizontalRule`、`hardBreak`、`bold`/`italic`/`strike`/`code`/`link`、history（undo/redo）、`dropcursor`/`gapcursor`；表格用官方 `table`/`tableRow`/`tableHeader`/`tableCell`；任务/待办与清单用 `taskList`/`taskItem`（承载旧 todo/checklist 语义）。
  - 自定义：`callout`、`collapsible`（可嵌套容器）、独立公式块与行内公式、`picture`、`card`、`drawing`、`directory`、`mention`（`@` 链接）、外部拖入项等。
- **card/drawing**：实现为 **atom + React NodeView**，节点只持有可持久化数据（card 的 data、drawing 的 DrawingValue 字符串）。编辑通过底部 Drawer 进行（`placement="bottom"`、`--hn-drawer-size: 60vh`）；Drawer 内一次编辑完成后的**提交通过 PM transaction/`updateAttributes`** 写回节点，而非绕过 PM 直接改 React state。预览画布保持 inert，仅一个触发器可交互。
- **一次手势/一次保存 = 一个历史步**：把一次连续手势（拖拽、Drawer 提交、粘贴重建等）收敛为单个 transaction，或使用 `appendTransaction`/`setMeta` 合并，避免 undo 需要多按几次；保存本身不额外产生历史步。
- **理由**：标准扩展覆盖大部分旧能力，减少自研面；NodeView + transaction 保证 card/drawing 数据也纳入 PM 撤销与序列化，避免第二状态源。
- **替代方案**：card/drawing 继续用 React state + 受控回调。放弃——会重新引入 PM 与外部状态双源。全部自研节点。放弃——成本高且失去官方维护。

### D7. directory 的位置可持久化，目录条目始终派生

`directory` 是可定位在文档中的动态内容节点，节点本身及其必要展示配置可进入 HNN；但节点展示的目录条目必须在渲染时从当前文档结构**派生**（扫描 heading 等生成），HNN 中绝不保存条目快照。

- **理由**：保留用户放置目录的位置，同时避免派生条目与真实结构不一致或把瞬时视图固化进格式。
- **替代方案**：持久化目录项。放弃——必然出现陈旧目录。

### D8. FileHandler / 资源上传 / placeholder / 重试 / 取消

- 图片、卡片、画板等资源由**宿主**通过 `FileHandler`（上传回调）落盘，库不直接接触真实存储。
- 上传中在文档内以 **placeholder / decoration** 表现（不可持久化的临时态），完成后再以 transaction 替换为真实资源节点/attrs。
- 失败可**重试**；`documentId`/`loadKey` 切换或卸载时 **abort 上传并忽略陈旧结果**（与会话令牌一致）。
- 上传的结果写入必须走 PM transaction，占位态不进入 HNN。
- **理由**：资源 I/O 属宿主职责；decoration 能在不污染文档的前提下表达临时态；会话令牌避免把旧会话资源写进新文档。
- **替代方案**：库内直传。放弃——越界且无法适配宿主存储。把上传态写进节点 attrs。放弃——会污染持久化与 undo。

### D9. 保持 `DESIGN.md` 视觉基线

新编辑器必须复用 `DESIGN.md` 的 token 与组件语言：Popover 表面/阴影/`hn-popover-in` 淡入、Drawer（bottom、60vh）、块 Handle/Menu 的 hover/focus/open 状态、表格边界 `+` 控件与插入预览线、公式/图片/卡片/画板/链接 mention 的具体规格、响应式断点（`840px`）与可访问性约束。除内核更换外不引入新的配色或动效语言。

- **理由**：这是能力迁移而非重设计，视觉回归会破坏既有用户体验与验收。
- **替代方案**：借机重做视觉。放弃——超出本变更范围，应由设计角色单独立项。

### D10. 拖拽手柄：原生 `draggable` + `data-drag-handle`

块级重排使用浏览器原生 `draggable` 与 `data-drag-handle` 属性驱动，保留“手柄 / 移动端长按 500ms 启动”的既有交互；**禁止**采用官方 DragHandle 扩展（因其绑定 Yjs/peers 协作假设，与本变更无协作内核的边界冲突）。

- **理由**：原生方案无协作依赖、可控且贴合 `DESIGN.md` 的块移动规格。
- **替代方案**：官方 DragHandle。放弃——引入不需要的协作语义与依赖。

### D11. mention / link / resource 语义

- `mention` 为独立 inline atom 节点，保存资源 `id`（与旧 `NoteLink.id` 对齐），点击回退宿主回调（如 `onLinkClick`）。
- 普通链接用官方 `link` mark，并对 URL 做协议白名单（见 D12）；`hnmagic://` 等魔法链接语义保留，点击交宿主处理，禁止原生跳转。
- 对“引用/资源”采用统一约定：节点/mark 只持有稳定的资源标识与展示所需最小 attrs，真实解析由宿主回调完成；渲染失败展示占位而非破坏文档。
- **理由**：链接与资源的来源是宿主，文档只应保存不依赖运行时解析的引用。
- **替代方案**：把 URL/资源内容直接内联进文档。放弃——会固化外部状态、无法重定位。

### D12. 安全限制

HNN 与导入内容按不可信输入处理，至少包含：

- **JSON 外壳**：完整 HNN v1 外壳 UTF-8 编码最多 512 KiB（524,288 字节）；解析、复制或输出分配前执行预算检查，并校验外壳形状，拒绝非对象/多余顶层键。超限为硬错误，不产生文档或可保存替代文档。
- **URL**：协议白名单（如 `http`、`https`、`mailto`、`hnmagic`），拒绝 `javascript:`/`data:` 等危险协议。
- **大小/深度/节点数**：严格限制 HNN 容量、树深度与节点总数，超限即硬错误（D2），防止构造性 DoS。
- **大 attrs**：限制单个 attr（字符串/数组/对象）大小，超限拒绝。
- **唯一 ID**：节点 id 需唯一且格式受限；粘贴时**重建 ID**，避免重复与伪造引用。
- 所有校验失败均按 D2 硬错误处理，绝不静默降级覆盖原文。
- Markdown 导入及其损坏/非规范围栏或 JSON-b64 分片的降级保留同样受上述容量预算约束：容量内保留可识别内容与诊断；若完整保留超过预算，受控失败并将未经改写的原 Markdown 留给调用方。

- **理由**：HNN/Markdown 可能来自不可信来源；限制可防止 XSS、资源耗尽与引用污染。
- **替代方案**：只做 HTML sanitize。放弃——PM JSON 通道同样需要校验，且当前已无 HTML 持久化。

## Risks / Trade-offs

- [内容能力覆盖不完整，旧块难在 PM 中对等映射] → 以 capability 规格逐项列出能力清单与验收；自定义节点优先复用标准 mark/attrs，无法等价时明确记录语义差异。
- [TipTap/PM 多实例或版本漂移导致运行时崩溃] → D5 精确锁版 + 单一 `@tiptap/pm` 入口，并在 CI 校验解析后版本一致。
- [NodeView/Drawer 提交绕过 PM 造成双状态源与 undo 断裂] → 强制经 transaction/`updateAttributes`，一次手势单历史步（D6），并以测试覆盖撤销与序列化。
- [会话切换竞态：旧保存/旧上传回写新文档] → 会话令牌 + 快照 baseline（D3/D8），陈旧结果一律忽略。
- [严格校验把可修内容判为硬错误，影响可用性] → 错误携带路径/原因，由宿主决定恢复策略；同时保证失败不覆盖原文。
- [Markdown 导出降级被用户忽略] → 导出诊断必须经 UI 确认（D4），未确认不落盘。
- [原生 table/selection 语义与旧“表格行原子选择”不同] → 明确接受差异并在规格中声明旧语义废弃（proposal 已更新），实现层不试图复现。
- [封闭 schema 抑制宿主扩展需求] → 由库方评审内置；本变更先保证格式稳定与可校验。
- [性能：大型文档 + 复杂 NodeView] → 限制文档规模与节点数（D12）；NodeView 保持纯展示、重计算下沉到明确的更新边界。

## Migration Plan

1. **落地 codec 与 schema**：先实现 HNN 外壳校验与无损编解码、封闭 extension 集合与安全限制（D2/D5/D12），建立可独立测试的格式契约。
2. **搭建内部 `NoteEditor`/`EditorSession` 会话骨架**：实现 `documentId`/`loadKey` 驱动的会话创建销毁、严格初始 HNN 装载、封闭 history、dirty（`eq` baseline）、CAS 保存快照与取消/忽略陈旧结果（D3）。此阶段不改变冻结的根入口或公开 API。
3. **迁移标准能力**：以标准/官方扩展覆盖段落、标题、列表、待办、引用、代码、表格等，并对齐 `DESIGN.md` 视觉与交互（D1/D6/D9）。
4. **迁移自定义能力**：逐个实现 callout、collapsible、公式、picture、card、drawing、mention、外部拖入项；card/drawing 采用 atom + React NodeView + Drawer + transaction 提交（D6/D11）。
5. **接入资源与拖拽**：宿主 `FileHandler` 上传、placeholder/decoration、失败重试与切换 abort（D8）；原生 `draggable` + `data-drag-handle` 重排（D10）。
6. **Markdown 方言**：实现 GFM + 围栏导入、HNN 无损保存与可选导出 + 降级诊断及 UI 确认（D4）。
7. **替换宿主 API 并清理旧代码**：在内容界面完成后，将根入口切换为公开的 `NoteEditor`、编解码与保存状态契约，更新 Demo；随后删除 `NoteBlock`/`restrictedHtml`/自研选区与剪贴板实现。Phase 5 的内部模块不得提前从 `src/lib/index.ts` 公开，且不保留迁移/兼容层。
8. **验证**：按各 capability 规格补齐测试（格式往返、严格校验与硬错误不覆盖、会话竞态、dirty/保存、选择与剪贴板、Markdown 降级、安全限制）。

**回滚策略**：本变更在功能分支推进，旧实现仅在移除步骤（第 7 步）一次性删除；若迁移受阻，回退该次删除提交即可恢复旧内核，格式/编辑器新代码可独立保留而暂不接入发布。
