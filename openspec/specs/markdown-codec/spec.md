# markdown-codec Specification

## Purpose

定义 Markdown 与笔记文档之间转换的对外行为：以 GFM 加 HamsterNote 围栏构成方言，导入后可成为同一份可编辑文档，默认以无损格式保存，导出为显式选择且对无法忠实表达的内容输出可读降级结果与按节点或位置指示的诊断，并要求在写出前经界面确认，绝不静默丢弃内容。

## Requirements

### Requirement: Markdown 方言为无元数据头的 GFM 加 HamsterNote 围栏
Markdown 方言 MUST 由 GFM 语法与 HamsterNote 围栏组成，且 MUST 不要求也不依赖任何前置元数据头来标识笔记文档；仅含正文的 GFM 文本与含 HamsterNote 围栏的文本均 MUST 被视为合法输入。

#### Scenario: 解析纯 GFM 文本
- **WHEN** 输入为仅含段落、标题、列表与表格的 GFM 文本且不含前置元数据头
- **THEN** 该输入被识别为合法方言内容并产生对应的文档结构

#### Scenario: 解析含 HamsterNote 围栏的文本
- **WHEN** 输入在 GFM 基础上包含 HamsterNote 围栏块
- **THEN** 这些围栏块被识别为对应的内容单元，且不因缺少元数据头而被拒绝

### Requirement: Markdown 导入成为同一份文档
将 Markdown 导入编辑器 SHALL 产生单一一份可继续编辑的笔记文档，导入的标题、正文与嵌套结构构成同一文档的内容，不得出现彼此分离的多份文档或平行内容。

#### Scenario: 导入后继续编辑
- **WHEN** 用户导入一段包含标题、列表与表格的 Markdown 并在其后继续输入
- **THEN** 新输入的内容与导入内容存在于同一文档中，撤销与重做也跨越二者

#### Scenario: 导入含嵌套结构的 Markdown
- **WHEN** 输入包含多层嵌套列表与引用
- **THEN** 导入后的文档保留相应嵌套层级，且作为同一文档的一部分可整体保存

### Requirement: 默认以无损格式保存
将当前文档保存为持久格式时，编辑器 MUST 默认采用无损格式保存，MUST 保证对受支持内容往返后语义与结构不发生丢失或改变，且 MUST NOT 以 Markdown 作为默认持久格式。

#### Scenario: 保存后重新装载
- **WHEN** 将一份包含受支持内容（含表格、行内格式与自定义内容单元）的文档以默认方式保存并重新装载
- **THEN** 重新装载后的文档与原文档在结构上等价，未发生内容丢失

#### Scenario: 默认保存不产生 Markdown
- **WHEN** 用户以默认方式保存文档而未显式选择导出 Markdown
- **THEN** 持久化结果不依赖 Markdown 文本中转，且再次打开不丢失仅 Markdown 无法表达的内容

### Requirement: Markdown 导出为显式选择
将文档导出为 Markdown SHALL 是显式选择的能力，MUST NOT 在默认保存路径中自动发生；只有用户明确发起导出时，才执行 Markdown 导出。

#### Scenario: 默认保存不导出 Markdown
- **WHEN** 用户执行常规保存而未选择导出 Markdown
- **THEN** 不产生 Markdown 文件，也不提示导出诊断

#### Scenario: 显式发起导出
- **WHEN** 用户明确选择将当前文档导出为 Markdown
- **THEN** 导出流程被启动，并进入可表示性检查与（如有必要）诊断确认环节

### Requirement: 无法忠实表达时输出可读降级结果与诊断
当文档内容无法被 Markdown 方言无损表达时，导出 MUST 产出可读的降级文本或围栏形式，MUST 返回诊断，且每条诊断 MUST 指示涉及的节点或位置；导出 MUST NOT 直接失败并丢弃整份文档。

#### Scenario: 导出无法表达的内容
- **WHEN** 当前文档中含有无法被方言无损表达的内容并触发导出
- **THEN** 导出结果仍包含该内容对应的可读文本或围栏形式，同时返回至少一条指明所涉节点或位置的诊断

#### Scenario: 多处不可表达内容
- **WHEN** 文档中存在多处彼此不同的无法忠实表达的内容
- **THEN** 导出为每一处或每一类分别给出可定位到节点或位置的诊断，而非只给出一条无位置信息的笼统提示

### Requirement: 保存或导出界面展示诊断并要求确认后才写出
当导出存在诊断时，保存或导出界面 MUST 向用户展示该诊断，MUST 在用户确认后才将结果写出；在用户未确认前，MUST NOT 写出文件或覆盖既有内容。

#### Scenario: 存在诊断时等待确认
- **WHEN** 导出产生降级诊断
- **THEN** 界面展示这些诊断，且在用户确认前不写出任何导出结果

#### Scenario: 用户取消导出
- **WHEN** 界面已展示诊断而用户选择取消
- **THEN** 不写出导出结果，既有内容保持不变

### Requirement: 不得静默丢弃特定内容
导出 Markdown 时 MUST NOT 静默丢弃 callout、卡片、画板、目录或复杂公式等难以无损表达的内容；这些内容若无法无损表达，必须以可读降级形式出现并附带诊断，或以明确不写入的方式让用户知晓，而不得无声消失。

#### Scenario: 含 callout 与卡片导出
- **WHEN** 文档中含有 callout 与卡片并执行导出
- **THEN** 导出结果中这些内容以可读降级形式存在，或伴随诊断明确告知其未被无损表达，不存在被无声省略的情况

#### Scenario: 含目录与复杂公式导出
- **WHEN** 文档中含有目录与复杂公式并执行导出
- **THEN** 每类内容都以可读降级形式出现或带有指向该内容的诊断，导出报告中不出现未说明的内容缺失

### Requirement: 导入非法围栏或不可识别输入产生诊断
当导入遇到语法非法的 HamsterNote 围栏或完全不可识别的输入时，导入 MUST 返回诊断说明问题所在，MUST NOT 静默忽略这些输入，且 MUST 保留可识别部分的内容。对于损坏或非规范的 `hamster-note-json-b64` 等 HamsterNote 围栏或分片，导入后的候选文档及其完整保留该围栏或分片所需的降级表示 MUST 受 HNN v1 512 KiB UTF-8 严格容量限制约束。

#### Scenario: 围栏语法非法
- **WHEN** 输入中包含一个语法非法的 HamsterNote 围栏
- **AND** 将该围栏连同可识别部分完整、可编码地保留后的 HNN 不超过 512 KiB UTF-8
- **THEN** 导入 SHALL 返回指向该围栏的诊断
- **AND** 该围栏 SHALL 以局部可读降级表示被完整保留
- **AND** 其余可识别内容 SHALL 仍被导入

#### Scenario: 损坏或非规范 JSON-b64 围栏或分片在容量内局部保留
- **WHEN** 输入包含损坏或非规范的 `hamster-note-json-b64` 围栏或分片
- **AND** 将该围栏或分片及其余可识别内容完整、可编码地保留后的 HNN 不超过 512 KiB UTF-8
- **THEN** 导入 SHALL 返回指向该围栏的诊断
- **AND** 返回的文档 SHALL 保留该围栏或分片的完整内容作为局部降级表示
- **AND** 返回的文档 SHALL 保留其余可识别内容

#### Scenario: 损坏或非规范 JSON-b64 围栏或分片无法在 HNN 容量内完整保留
- **WHEN** 输入包含损坏或非规范的 `hamster-note-json-b64` 围栏或分片
- **AND** 将该围栏或分片及其余可识别内容完整、可编码地保留会使 HNN 超过 512 KiB UTF-8
- **THEN** 导入 SHALL 返回明确的受控失败及容量超限诊断
- **AND** 导入 SHALL NOT 返回文档、部分文档或任何可保存替代文档
- **AND** 导入 SHALL NOT 截断、改写或生成替代的 Markdown
- **AND** 调用方 SHALL 保留原始 Markdown 并拥有其后续处理权

#### Scenario: 完全不可识别的输入
- **WHEN** 输入无法被识别为任何受支持方言内容
- **THEN** 导入返回说明输入不可识别的诊断，而不是静默产生空文档
