## Why

当前笔记库以自研的 `NoteBlock` 数据结构、受限 HTML 渲染和自研 DOM 交互为核心，经过了大量增量修补后，编辑内核、选区模型、剪贴板与内容块行为彼此耦合，难以继续演进。为获得可靠的富文本编辑、可维护的扩展机制和可预期的文档序列化，需要将文档与交互内核整体替换为 TipTap/ProseMirror，并明确新的文档格式、内容能力、Markdown 方言以及宿主的接入边界。这不是一次渐进重构：旧模型、旧 HTML 交互与旧格式将被整体弃用，不保留向前兼容。

## What Changes

- **完全弃用旧内核**：移除 `NoteBlock` 文档模型、受限 HTML 的渲染/解析路径以及自研的 DOM 级编辑与选区交互，不提供旧格式迁移或向前兼容层。
- **引入 `NoteEditor`**：以 TipTap/ProseMirror 作为唯一的文档模型与交互内核；编辑器内部编辑会话由 `documentId` 驱动。
- **新的文档格式 HNN**：`{ schemaVersion: 1, data: ProseMirror JSON }`，不包含标题、摘要等独立标签/字段；HNN 编解码必须无损往返。
- **保留旧内容能力并尽量重做**：原先支持的全部内容能力（各类内容块、行内格式、表格、图片、画板、卡片、目录、公式、提及/链接等）继续提供，尽量基于标准 TipTap 扩展实现，必要时以自定义 node/nodeview 补齐。
- **Markdown 方言**：采用 GFM，并在其上定义 HamsterNote 围栏扩展；支持 Markdown 导入、以 HNN 无损保存，以及可选的 Markdown 导出（导出时对无法无损表达的内容给出降级诊断）。
- **库与宿主职责边界**：库提供 codecs、编辑器和保存 UI；宿主负责真实 I/O、`onSave`、资源上传与引用解析等回调。
- 规格层面的行为以新增 capability 为准，旧内容能力对应的旧规格在本变更中不再延续。

## Capabilities

### New Capabilities
- `note-document-format`: HNN `{ schemaVersion: 1, data: ProseMirror JSON }` 文档契约、schemaVersion 处理、ProseMirror JSON 与 HNN 的无损编解码，以及“无标题/摘要标签”的表示约定。
- `note-editor-core`: `NoteEditor` 作为唯一文档与交互内核的行为，包括由 `documentId` 驱动的编辑会话、编辑器生命周期、TipTap/ProseMirror 扩展装配，以及对旧 `NoteBlock`/受限 HTML/自研 DOM 交互的整体替代且不向前兼容。
- `note-content-blocks`: 保留并重做的全部内容能力（段落、标题、列表、待办、引用、代码、标记/折叠块、表格、公式、图片、画板、卡片、目录、链接提及等）及其行内格式与编辑行为。
- `note-selection-and-clipboard`: 以 ProseMirror 原生 TextSelection/NodeSelection/CellSelection 与剪贴板语义为准的选择与复制粘贴行为，覆盖选择状态、节点级与单元格级选择以及标准剪贴板编解码；旧的跨标题/摘要/正文连续文本流、表格行原子选择以及自研剪贴板 MIME 一律废弃，不再复现旧 DOM/Range 连续文本选区。
- `markdown-codec`: GFM 与 HamsterNote 围栏方言的 Markdown 导入、无损保存为 HNN，以及可选 Markdown 导出与降级诊断。
- `host-integration`: 库对外暴露的 codecs、编辑器与保存 UI 契约，以及宿主提供的真实 I/O、`onSave`、资源上传和引用解析回调约定。

### Modified Capabilities

None。这是本仓库首个 OpenSpec 变更，`openspec/specs/` 下不存在现有主规格；上述 capability 均为新增，将各自建立独立规格。

## Impact

- **代码**：`src/lib` 中的旧文档模型、受限 HTML 与 DOM 交互实现将被替换或移除；`src/demo` 的演示与测试需随新内核调整。
- **公共 API**：`@hamster-note/notes` 的导出与组件契约发生不兼容变更，旧 `NoteContent`/`NoteBlock` 相关 API 不再保证可用。
- **依赖**：引入 TipTap/ProseMirror 相关依赖；既有 Markdown/公式/高亮等依赖的用法随之调整。
- **格式与兼容性**：HNN schema-version-1 成为新的持久化契约；不提供旧格式读取或迁移，Markdown 导出可能对部分内容降级并给出诊断。
- **职责边界**：文件读写、资源上传、引用解析等由宿主实现；库方仅定义并消费相应回调。
- **风险**：内容能力覆盖度、ProseMirror 选择与剪贴板语义、Markdown 无损往返等需要在各 capability 规格中逐一验证。
