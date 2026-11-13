# Spec Delta

## ADDED Requirements

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
