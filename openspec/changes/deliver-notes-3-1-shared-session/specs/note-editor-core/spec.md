# Spec Delta

## MODIFIED Requirements

### Requirement: 唯一入口与完整可编辑

编辑内核 SHALL 保留 3.0.0 `NoteEditor` 的完整编辑行为，并新增包根 `NoteDocumentProvider` 与 `NoteEditorView` 提供同文件多视图编辑。二者 MUST 使用库内封闭文档结构，宿主不得获取私有 schema/extensions/history。此处兼容仅指 3.0.0，不恢复 3.0.0 之前已移除的旧内容 API。

#### Scenario: 通过唯一入口进入编辑
- **WHEN** 使用原 NoteEditor 并传入初始文档
- **THEN** 内容 SHALL 完整可编辑，原 props 和保存回调 SHALL 保持兼容

#### Scenario: 新公共入口
- **WHEN** 通过包根渲染一个 Provider 下的两个 View
- **THEN** 两 view SHALL 使用同一正文与共享历史，宿主 SHALL 无需导入私有模块

#### Scenario: Phase 5 内部入口不改变旧 API
- **WHEN** 对照已完成的 3.0.0 Phase 5 内部会话实施记录
- **THEN** 当时的内部 EditorSession SHALL 仍不构成公共入口；3.1.0 SHALL 仅新增本次声明的封闭接口
