# note-document-format Specification

## Purpose

本规格定义笔记库的权威持久化格式 HNN 及其严格解析与生成契约。HNN 是一个版本化的 JSON 外壳，承载一份完整的结构化文档，且不包含标题、摘要、标签、时间等笔记级元数据字段。本规格确保文档可被无损地编码与解码，在格式不合法或版本不受支持时以可定位的诊断失败，对来自不可信来源的内容施加结构与资源安全限制，并保证任何失败都不会产生可保存的替代文档或覆盖原始输入，从而使持久化契约稳定、可严格校验且不静默丢失数据。

## ADDED Requirements

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

解析 MUST 对 JSON 外壳大小、文档树深度、节点总数、单个属性的大小，以及持久标识的唯一性与格式施加限制；输入 SHALL 被视为不可信内容，超出任一限制 MUST 按失败处理；属性中的 URL MUST 采用协议白名单并拒绝危险协议。

#### Scenario: 超出规模或深度限制

- **WHEN** 解析超过允许字节数、树深度或节点总数的输入
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
