# note-document-format Specification

## Purpose

本规格定义笔记库的权威持久化格式 HNN 及其严格解析与生成契约。HNN 是一个版本化的 JSON 外壳，承载一份完整的结构化文档，且不包含标题、摘要、标签、时间等笔记级元数据字段。本规格确保文档可被无损地编码与解码，在格式不合法或版本不受支持时以可定位的诊断失败，对来自不可信来源的内容施加结构与资源安全限制，并保证任何失败都不会产生可保存的替代文档或覆盖原始输入，从而使持久化契约稳定、可严格校验且不静默丢失数据。

## Requirements

### Requirement: HNN 外壳形状

文档持久化格式 SHALL 精确为 `{ "schemaVersion": 1, "data": <纯文档 JSON> }`，其中 `schemaVersion` 固定为数字 `1`，`data` 为完整结构化文档 JSON；除这两个顶层字段外不得存在其他顶层字段。

#### Scenario: 生成合规外壳

- **WHEN** 将一份结构化文档编码为 HNN
- **THEN** 输出 SHALL 恰好包含 `schemaVersion` 与 `data` 两个顶层字段
- **AND** `schemaVersion` 的值 SHALL 为数字 `1`
- **AND** `data` SHALL 为该文档的完整结构化 JSON

#### Scenario: 读取合规外壳

- **WHEN** 解析一份顶层为对象且仅含 `schemaVersion` 与 `data` 的 HNN
- **THEN** 解析 SHALL 成功并返回由 `data` 还原的文档

### Requirement: data 不含笔记级元数据

`data` SHALL 仅为文档结构，不得包含笔记级 `title`、`summary`、`tag` 或 `time` 等字段；笔记标题与摘要 SHALL 作为文档正文内容存在，而非独立的笔记级字段。

#### Scenario: data 中不存在笔记级字段

- **WHEN** 检查编码得到的 HNN 的 `data`
- **THEN** `data` 顶层 SHALL NOT 出现 `title`、`summary`、`tag` 或 `time` 字段
- **AND** 笔记标题与摘要 SHALL 可在 `data` 的正文内容中找到

### Requirement: 无损编解码

HNN 编解码 SHALL 对受支持文档无损：将一份 HNN 解析为文档后再编码回 HNN，结果 SHALL 与输入在结构上等价。

#### Scenario: 往返等价

- **WHEN** 对一份受支持文档的 HNN 依次执行解码与重新编码
- **THEN** 重新编码的结果 SHALL 与原始 HNN 在结构上等价
- **AND** 原始输入 SHALL 保持不变

### Requirement: 外壳非法时失败并诊断

当输入不是对象、包含除 `schemaVersion` 与 `data` 之外的顶层字段，或 `schemaVersion` 不是受支持的版本 `1` 时，解析 MUST 失败，并给出指明出错位置与原因的可定位诊断。

#### Scenario: 顶层非对象

- **WHEN** 解析一个顶层为数组、字符串或 null 的输入
- **THEN** 解析 SHALL 失败并报告外壳形状错误

#### Scenario: 多余顶层字段

- **WHEN** 解析一个除 `schemaVersion` 与 `data` 外还含有其他顶层字段的输入
- **THEN** 解析 SHALL 失败并报告多余顶层字段的位置与名称

#### Scenario: 未知版本

- **WHEN** 解析一个 `schemaVersion` 为 `2` 或其他非 `1` 值的输入
- **THEN** 解析 SHALL 失败并报告不受支持的版本

### Requirement: 内容非法时失败并诊断

当 `data` 含未知节点类型、未知 mark、非法属性（类型不符、枚举越界或超出大小限制）或结构不满足文档约束时，解析 MUST 失败，并给出包含出错路径与原因的可定位诊断。

#### Scenario: 未知节点类型

- **WHEN** 解析含未受支持节点类型的文档数据
- **THEN** 解析 SHALL 失败并报告该节点的类型与路径

#### Scenario: 未知 mark

- **WHEN** 解析含未受支持 mark 的文档数据
- **THEN** 解析 SHALL 失败并报告该 mark 的类型与路径

#### Scenario: 非法属性

- **WHEN** 解析含类型不符、枚举越界或超出大小限制的属性的文档数据
- **THEN** 解析 SHALL 失败并报告该属性的路径与原因

#### Scenario: 结构无效

- **WHEN** 解析节点嵌套或内容顺序不满足文档约束的数据
- **THEN** 解析 SHALL 失败并报告结构不合法处的位置

### Requirement: 失败不得产生替代文档或覆盖源

解析失败时 MUST NOT 返回可保存的替代文档，也 MUST NOT 覆盖原始输入或其存储中的源内容；调用方 SHALL 能明确区分解析成功与失败。

#### Scenario: 失败不返回可保存文档

- **WHEN** 一次解析因外壳或内容非法而失败
- **THEN** 调用方 SHALL 收到失败结果而非文档
- **AND** 原始输入内容 SHALL 保持不变

### Requirement: 结构与资源安全限制

解析与生成 MUST 对 JSON 外壳大小、文档树深度、节点总数、单个属性的大小，以及持久标识的唯一性与格式施加限制；输入 SHALL 被视为不可信内容，超出任一限制 MUST 按失败处理；属性中的 URL MUST 采用协议白名单并拒绝危险协议。

#### Scenario: 超出树深度或节点总数

- **WHEN** 解析超过允许树深度或节点总数的输入
- **THEN** 解析 SHALL 失败并报告超限项

#### Scenario: 单个属性过大

- **WHEN** 解析含超出大小限制的单个属性的输入
- **THEN** 解析 SHALL 失败并报告该属性

#### Scenario: 持久标识不唯一或格式非法

- **WHEN** 解析含重复或格式不合法的持久标识的输入
- **THEN** 解析 SHALL 失败并报告该标识

#### Scenario: 危险的 URL 协议

- **WHEN** 解析属性中使用白名单之外协议（如 `javascript:` 或 `data:`）的输入
- **THEN** 解析 SHALL 失败并报告该 URL 属性

### Requirement: HNN 外壳 UTF-8 容量上限

HNN v1 的完整 JSON 外壳（包括 `schemaVersion`、`data`、JSON 语法与所有属性）编码为 UTF-8 后 SHALL 不超过 512 KiB（524,288 字节）。此限制独立于单个属性大小、树深度及节点总数限制，满足该容量限制的输入仍 MUST 接受其余严格校验。codec MUST 在会导致超出预算的解析、复制或输出分配之前安全拒绝输入或生成请求；拒绝 MUST 返回可定位的受控失败，而非返回部分文档、截断 JSON 或产生可保存替代文档。

#### Scenario: 恰处于 HNN 容量上限

- **WHEN** 一份在其他结构与资源限制内的 HNN 完整 UTF-8 外壳恰为 524,288 字节
- **THEN** 解析 SHALL 继续执行其余严格校验
- **AND** 校验通过时 SHALL 返回完整文档

#### Scenario: 超出 HNN 容量上限时分配安全地拒绝

- **WHEN** 一份 HNN 完整 UTF-8 外壳为 524,289 字节或更大
- **THEN** codec SHALL 在超出预算的解析、复制或输出分配前以受控失败拒绝该输入
- **AND** 失败诊断 SHALL 标明 HNN UTF-8 容量超限
- **AND** 调用方 SHALL 不获得文档、部分文档或可保存替代文档
- **AND** 原始输入 SHALL 保持不变

### Requirement: 列表及待办状态使用既有 HNN v1 节点持久化
正文 SHALL 使用 `bulletList` / `orderedList` 包含 `listItem`，`taskList` 包含 `taskItem`；每项首块为段落，后续可包含 schema 允许的块及嵌套列表。待办项 SHALL 在 `attrs.checked` 存储必填布尔值 true 或 false，MUST NOT 从 DOM、正文字符、CSS、宿主元数据或本地独立状态推导完成状态。普通列表项 MUST NOT 携带 checked。有序列表 SHALL 持久化正整数 start 和 schema 支持的 type 属性（默认 null），不持久化每项显示序号。HNN 外壳继续为 `{schemaVersion: 1, data: ...}`，沿用现有 nodeId 规则及资源限制，不新增字段保存已被转换移除的完成状态或编号。

#### Scenario: 混合列表往返
- **WHEN** 将含 start 为 5 的有序列表、无序子列表及 checked 分别为 true/false 的待办列表编码后解码
- **THEN** 节点类型、顺序、层级、start、type、布尔状态和既有标识保持结构等价，完成状态不依赖 UI 是否已挂载

#### Scenario: 非法任务状态严格失败
- **WHEN** 任务 checked 缺失、为字符串 "false"、数字或 null，或普通项含 checked
- **THEN** 编解码返回包含属性路径的失败，不自动修复、截断或返回可保存替代文档，源数据不变

#### Scenario: 旧的有效 v1 继续可读
- **WHEN** 装载不含任务列表的有效 HNN v1，或已有合法三类列表的 v1
- **THEN** 无需迁移即可装载并编辑，原有非列表内容及其结构不变

### Requirement: 自动编号引用和链接沿用既有 v1 表示
自动有序列表 SHALL 以既有 type=null 和整数 start 持久化，层级标号从文档树派生，MUST NOT 将 a./i.、计数缓存或显示深度写入正文或新增属性。显式 type SHALL 无损保留；缺省 type 继续按既有默认 null 解析，装载不产生迁移写入或脏状态。

引用 SHALL 使用既有 blockquote、块内容与 author 属性（新快捷引用为 null），继续遵守既有 nodeId 和子节点约束。链接 SHALL 使用文本节点的 link mark，attrs 只含 href；“链接标题” SHALL 为正文显示文字，不新增 link.title、独立节点或元数据。所有路径 SHALL 使用同一 URL 白名单及原有严格资源校验。

#### Scenario: 保存重开不改变自动模式
- **WHEN** 保存含五层自动列表、显式 type=A 的旧列表、引用和配置链接的 HNN v1 后重开
- **THEN** 自动层级样式重新派生，所有 start/type、author、href 和显示文字保留，不出现新增 schema 字段，也不因派生样式变脏

#### Scenario: 不可信链接属性拒绝
- **WHEN** 读取 link attrs 含额外 title 字段、危险 href，或不合法的引用内容
- **THEN** 按现有严格编解码路径定位失败，源输入保持，不返回可保存替代文档
