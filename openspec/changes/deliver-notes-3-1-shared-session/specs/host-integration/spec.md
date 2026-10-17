# Spec Delta

## ADDED Requirements

### Requirement: 新旧保存协议作用域

本规格中 revision/CAS、conflict 和正文快照保存状态要求 MUST 继续适用于 3.0.0 NoteEditor 兼容入口。新增 NoteDocumentProvider 的 metadata、保存 barrier、公开状态及替换门禁 MUST 遵循 note-document-provider 规格；新 Provider 不提供 CAS/revision，不得将 sessionId/changeId 当成存储版本。通用 codec、上传、引用与封闭文档约束 SHALL 继续保留。

#### Scenario: 两种保存接入并存
- **WHEN** 宿主分别使用 NoteEditor 与 NoteDocumentProvider
- **THEN** 前者 SHALL 保持 NoteSave 的判别回调，后者 SHALL 使用 Promise<void> 和公开保存终态，二者不得互换解释

## MODIFIED Requirements

### Requirement: 宿主提供真实输入输出

笔记库 SHALL 通过宿主提供的保存回调执行真实写出，库本身 MUST NOT 假设或自行访问宿主的存储介质；MUST 将待持久化的内容以快照方式交给宿主回调。旧 NoteEditor 输入的 `initialRevision?` MUST 与同次初始 HNN 及 `loadKey` 一起构成保存基线；新 Provider SHALL 使用正文与 hostSnapshot 双 baseline。

#### Scenario: 触发保存
- **WHEN** 编辑器发起一次保存
- **THEN** 库以当前内容的快照调用宿主提供的保存回调，由宿主决定实际写出位置与方式

### Requirement: 保存使用宿主 CAS 与判别结果

旧 NoteEditor 的 NoteSave 回调 SHALL 接收 `onSave(snapshot, { documentId, baseRevision?, signal })`，并返回判别结果 `{ kind: 'saved', revision?: string }` 或 `{ kind: 'conflict' }`。该兼容接口的宿主 MUST 使用 documentId 与 baseRevision? 对实际存储执行 CAS；库内中止或忽略陈旧结果只保护库内状态，不能阻止已发出的旧请求覆盖宿主存储。新增 Provider MUST 使用其独立的无 CAS 契约，不能改变旧接口签名和行为。

#### Scenario: CAS 保存成功
- **WHEN** 旧编辑器以当前 document baseline 的 baseRevision? 发起保存且宿主 CAS 成功
- **THEN** 宿主返回 `{ kind: 'saved', revision? }`
- **AND** 库仅将该次 snapshot 设为新的文档 baseline
- **AND** 返回 revision 时库 SHALL 将其设为新的 revision baseline，未返回时 SHALL 清除 revision baseline

#### Scenario: CAS 检测到版本冲突
- **WHEN** 旧接口宿主发现 baseRevision? 不符合当前存储版本
- **THEN** 宿主返回 `{ kind: 'conflict' }`
- **AND** 宿主 SHALL NOT 以该请求覆盖当前存储内容

#### Scenario: 保存已在进行
- **WHEN** 同一旧编辑会话已有一次保存尚未完成又触发保存
- **THEN** 库 SHALL 保持单飞，不得为该会话发起第二个并发保存回调

#### Scenario: 宿主未提供保存回调
- **WHEN** 宿主未提供保存回调而用户触发旧编辑器保存
- **THEN** 库不自行写出任何内容，并以可观察的方式表明保存不可执行

### Requirement: 脏等于当前文档与最近成功保存快照不同

旧 NoteEditor 的脏状态 MUST 由当前文档与最近一次成功保存快照的结构差异决定；初始装载完成后 MUST 非脏；仅保存成功后更新比较基准。新 Provider MUST 额外独立跟踪 host metadata dirty，metadata-only 变化不得判 clean。

#### Scenario: 初始装载后非脏
- **WHEN** 文档刚完成装载且未发生任何编辑
- **THEN** 状态为非脏，且不呈现未保存提示

#### Scenario: 编辑后变脏
- **WHEN** 用户在已保存的文档上做出结构改变
- **THEN** 状态变为脏

#### Scenario: 保存成功后恢复非脏
- **WHEN** 一次保存成功完成且其后没有新的编辑
- **THEN** 状态变为非脏

#### Scenario: Provider 的 metadata 单独变化
- **WHEN** 仅接受新的 title/summary 快照
- **THEN** Provider SHALL host dirty，正文 dirty SHALL 保持原值

### Requirement: 会话切换与卸载中止或忽略陈旧回调

当编辑会话实际被替换或组件卸载时，库 MUST 中止在途保存与上传，并在库内忽略其陈旧结果；陈旧回调 MUST NOT 写入新会话文档。每个会话令牌及异步操作 AbortSignal MUST 不可复用。旧 NoteEditor 的宿主仍 MUST 用 CAS 防止陈旧保存请求在存储端生效。新 Provider 的身份不能提供存储 CAS，且 dirty、draft、保存、排队获取与 lease 的替换阻塞 MUST 优先于普通 props 切换。

#### Scenario: 保存中切换会话
- **WHEN** 旧 NoteEditor 的保存尚在途中时发生会话切换或装载标识变化
- **THEN** 该次保存结果被忽略，不写入新的会话文档

#### Scenario: 上传中卸载编辑器
- **WHEN** 资源上传尚在途中时编辑器被卸载
- **THEN** 上传被中止，其结果不影响任何会话文档

#### Scenario: Provider 的替换受阻
- **WHEN** Provider 有排队 acquire 或活动 lease，宿主传入新 loadKey
- **THEN** SHALL 保留旧会话，只有门禁清除并合法接受新 load 后才替换
