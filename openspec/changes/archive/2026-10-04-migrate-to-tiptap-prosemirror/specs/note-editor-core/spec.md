# note-editor-core Specification

## Purpose

本规格定义笔记编辑内核的公共契约。编辑内核以唯一公共入口 `NoteEditor` 对外提供完整可编辑能力，并由文档标识驱动编辑会话的生命周期。本规格同时明确旧有内容组件、旧块模型、受限 HTML 与自研 DOM 选区接口不再提供且不保留兼容，规定会话在标识切换或强制刷新时的销毁重建与状态清理行为、对宿主的内容变更通知、封闭的文档结构，以及对既有视觉与响应式、无障碍基线的遵循，从而保证编辑内核行为可观察、可测试且边界清晰。

## ADDED Requirements

### Requirement: 唯一入口与完整可编辑

完成公开 API 切换后，编辑内核 SHALL 仅通过唯一公共入口 `NoteEditor` 对外提供文档编辑能力；该入口 SHALL 呈现完整可编辑的笔记内容。Phase 5 可先实现不从 `src/lib/index.ts` 公开的内部 `NoteEditor`/`EditorSession`，其会话核心测试可以直接导入内部模块；该阶段不得改变冻结的旧公共 API。

#### Scenario: 通过唯一入口进入编辑

- **WHEN** 使用 `NoteEditor` 并传入初始文档
- **THEN** 呈现的笔记内容 SHALL 可编辑
- **AND** SHALL NOT 存在其他公共内容编辑入口

#### Scenario: Phase 5 内部入口不改变旧 API

- **WHEN** 完成 Phase 5 的内部会话实现但尚未执行公开 API 切换
- **THEN** 内部 `NoteEditor`/`EditorSession` SHALL NOT 从 `src/lib/index.ts` 导出
- **AND** 旧公共 API SHALL 保持冻结，直到宿主集成阶段切换根入口

### Requirement: 旧内容接口不兼容

在 Phase 7 完成根入口切换且 Phase 8 完成清理后，库 MUST NOT 再提供旧内容组件、旧块级文档模型、受限 HTML 渲染与解析路径或自研 DOM 选区接口，且 MUST NOT 保留其兼容层或迁移路径。Phase 5 的内部会话实施不得提前删除或改变冻结的旧 API。

#### Scenario: 旧接口不可用

- **WHEN** 检查库对外暴露的公共接口
- **THEN** 旧内容组件、旧块模型、受限 HTML 与自研选区接口 SHALL NOT 可用
- **AND** SHALL NOT 存在将旧格式转换为新文档的兼容路径

### Requirement: 文档标识驱动会话生命周期

当文档标识或 `loadKey` 变化时，编辑内核 MUST 先对新的初始 HNN 执行 `decodeHnn` 严格硬校验，成功后销毁既有编辑会话并按新的初始文档创建全新会话；不得用校验失败的输入构造降级会话。切换 MUST 清理选择状态、撤销/重做历史、变更标记与全部在途异步工作。初始文档 baseline MUST 取自当次 `editor.state.doc`；`initialRevision?` MUST 作为同次初始 HNN 与 `loadKey` 对应的 revision baseline。

#### Scenario: 切换文档标识

- **WHEN** 文档标识由 A 变为 B
- **THEN** 编辑内容 SHALL 展示 B 的初始文档
- **AND** 选择状态 SHALL 被重置
- **AND** 撤销/重做历史 SHALL 被清空
- **AND** 变更标记 SHALL 被重置
- **AND** 针对 A 的在途保存与资源上传结果 SHALL 被忽略

#### Scenario: 初始 HNN 不合法

- **WHEN** 创建或重建会话时传入的初始 HNN 未通过 `decodeHnn` 严格校验
- **THEN** 装载 SHALL 硬失败
- **AND** 编辑内核 SHALL NOT 以替代、截断或未校验的文档创建会话

#### Scenario: 卸载编辑器

- **WHEN** 编辑内核被卸载
- **THEN** 在途异步工作 SHALL 被中止且其结果 SHALL 被忽略

### Requirement: 强制刷新使用 loadKey

在文档标识不变而需要按外部内容重新装载时，编辑内核 SHALL 通过 `loadKey` 的变化强制刷新，并以新的初始文档及其 `initialRevision?` 重建会话内容。同一 `documentId` 与 `loadKey` 内，编辑内核 MUST 忽略 `initialDocument` 与 `initialRevision` 的后续变化，避免覆盖当前会话。

#### Scenario: loadKey 变化触发重新装载

- **WHEN** 文档标识不变而 `loadKey` 变化
- **THEN** 编辑内容 SHALL 按新的初始文档重建
- **AND** 相关编辑会话状态 SHALL 按会话重建规则清理

#### Scenario: 相同会话键更新初始 props

- **WHEN** `documentId` 与 `loadKey` 均不变，但宿主传入不同的 `initialDocument` 或 `initialRevision`
- **THEN** 当前会话 SHALL NOT 重建
- **AND** 当前文档、baseline、选择与 history SHALL NOT 被该变化替换

### Requirement: 向宿主通知内容变更

编辑内核 SHALL 在文档发生可持久化变更时通知宿主，并 SHALL 在触发保存时捕获当前文档快照、仅在宿主保存成功后更新变更基准。

#### Scenario: 编辑后通知宿主

- **WHEN** 用户在编辑器中产生可持久化变更
- **THEN** 宿主 SHALL 收到内容变更通知

#### Scenario: 保存使用快照

- **WHEN** 触发保存且宿主保存回调成功
- **THEN** 宿主回调 SHALL 收到触发保存时的文档快照
- **AND** 保存期间的新编辑 SHALL NOT 改变该快照
- **AND** 保存成功后该快照 SHALL 成为新的变更基准

### Requirement: 封闭的文档结构

编辑内核 MUST NOT 允许宿主附加任意可持久化的文档结构或注册自定义 schema；可持久化结构 SHALL 由库方定义并封闭。

#### Scenario: 宿主无法注入可持久化结构

- **WHEN** 宿主尝试附加自定义可持久化节点或注册自定义 schema
- **THEN** 该附加 SHALL NOT 生效
- **AND** 该结构 SHALL NOT 出现在保存的文档中

### Requirement: History 由库内封闭扩展维护

编辑内核 MUST 使用库内装配的封闭 history 扩展维护撤销/重做；宿主 MUST NOT 注册、替换或直接取得 schema、extensions 或 history 实例。会话重建时 history MUST 清空。

#### Scenario: 宿主无法定制 history 或扩展

- **WHEN** 宿主尝试传入 schema、extensions 或 history 配置
- **THEN** 编辑内核 SHALL NOT 提供接受该配置的公共入口
- **AND** 会话重建后撤销/重做 SHALL 不包含先前会话的操作

### Requirement: 遵循视觉与响应式、无障碍基线

编辑内核 SHALL 复用既有视觉基线的设计令牌与组件外观，并 SHALL 满足既有的响应式与无障碍约束；MUST NOT 引入基线之外的新配色或动效语言。

#### Scenario: 外观符合基线

- **WHEN** 渲染编辑器及其内容组件
- **THEN** 颜色、间距、弹层与抽屉等外观 SHALL 与既有视觉基线一致
- **AND** SHALL NOT 出现基线之外的新配色或动效

#### Scenario: 响应式与无障碍可用

- **WHEN** 在既有响应式断点下使用编辑器并进行键盘或辅助技术操作
- **THEN** 编辑操作 SHALL 保持可用
- **AND** 关键控件 SHALL 具备可被辅助技术识别的语义
