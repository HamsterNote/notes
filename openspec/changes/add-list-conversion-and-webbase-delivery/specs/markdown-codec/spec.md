# Spec Delta

## ADDED Requirements

### Requirement: 列表与任务状态通过既有 Markdown 方言往返
显式 Markdown 导入导出 SHALL 对简单无序、有序、待办列表分别使用 GFM 列表及 `- [ ]` / `- [x]`；导入 `[X]` SHALL 同样识别为已完成。往返 SHALL 保留列表种类、项顺序、支持的嵌套结构、起始编号及完成语义，不要求保留 Markdown 标点或由导入新生成的节点 ID。不能由 GFM 无损表达的混合嵌套、特殊编号、复杂项内容 SHALL 使用既有 HamsterNote 无损围栏，或按既有策略提供可定位降级诊断并等待确认，MUST NOT 静默去掉子列表、格式、引用或完成状态。默认保存继续使用 HNN。

#### Scenario: GFM 状态往返
- **WHEN** 导入含 `- [ ] 未做`、`- [x] 已做`、`- [X] 也已做` 的 Markdown 并显式导出再导入
- **THEN** 三项完成状态依次为 false、true、true，顺序及正文保留

#### Scenario: 起始值与混合嵌套
- **WHEN** 导出并重新导入从 5 开始的有序列表，且其项包含已完成待办子列表和格式化文本
- **THEN** 起始值、层级、完成语义和格式通过 GFM 或既有无损围栏保留；若选择降级路径则展示节点或位置诊断，未经确认不写出
