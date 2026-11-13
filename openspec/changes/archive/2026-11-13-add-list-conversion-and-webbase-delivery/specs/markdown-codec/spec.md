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

### Requirement: Markdown 编号保留整数语义而非层级显示字符
自动列表导出 SHALL 保留整数 start、顺序及嵌套语义，可由 GFM 无损表达时按标准数字列表表示，复杂结构继续使用既有无损围栏或降级诊断确认，MUST NOT 把二级 a.、三级 i. 写成普通文字伪装为 Markdown 列表。原 Markdown 的逐项字面 marker（如重复 1.）不属于已保存文档，不要求逐字恢复；与屏幕层级样式冲突时 SHALL 以 HNN 整数 start 与结构为准。重新导入自动列表 SHALL 还原 type=null 并重新派生层级显示；显式 a/A/i/I/1 等 type 无法由普通 GFM 无损表达时 SHALL 沿用既有无损围栏或诊断确认机制。外部 Markdown 渲染器不承诺采用本编辑器的层级样式。

#### Scenario: 字母显示导出数字语义
- **WHEN** 导出二级 start=5、屏幕显示 e./f./g. 的自动有序列表，再导入
- **THEN** 导出以数字标号表达 start=5，不把 e. 写入正文；重导入恢复整数起始值和深度，在本编辑器仍显示 e./f./g.

### Requirement: 引用与配置链接参与 Markdown 往返
无署名且可由 GFM 表达的引用 SHALL 导出为 `>` 引用语法，导入 SHALL 成为 author=null 的 blockquote，保留嵌套及正文。带署名或复杂结构 SHALL 继续使用既有无损围栏或降级诊断确认，不静默丢弃署名。

合法普通链接 SHALL 导出为等价的 `[显示文字](url)` 并可重新导入为相同文字与 href；必要时转义方括号、括号等特殊字符，不能将标题误存为 Markdown 的可选 title 属性。原有 marks 能由 GFM 表达时 SHALL 保留，无法表达时走既有围栏或诊断。危险 URL 导入 SHALL 沿用既有可定位诊断和可读文字保留路径，不产生可激活危险链接。默认持久化仍为 HNN。

#### Scenario: 引用与链接一起往返
- **WHEN** 导出由快捷输入创建且含“官网”链接的引用，再导入
- **THEN** GFM 表达等价于 `> [官网](https://example.com)`，恢复 blockquote、文字和安全 href

#### Scenario: 特殊字符与危险地址
- **WHEN** 导出标题含方括号的合法链接，或导入指向 javascript 协议的 Markdown 链接
- **THEN** 前者经正确转义往返不丢文字与 href；后者产生诊断、保留可读文字且不创建危险 link mark
