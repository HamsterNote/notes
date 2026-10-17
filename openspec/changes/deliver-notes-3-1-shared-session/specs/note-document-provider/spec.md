# Spec Delta

## Purpose

为宿主提供正式公开的文档会话接口，使多个可编辑视图共享正文、历史和持久化队列，同时能够观察草稿与保存状态，并用请求归属冻结保证关闭流程不会误放行或互相解锁。

## ADDED Requirements

### Requirement: 公共会话与封闭模型

库 SHALL 从包根提供 `NoteDocumentProvider`、`NoteEditorView`、`NoteDocumentController` 及其 props、状态、结果类型。Provider MUST 持有唯一权威正文、共享历史、正文及 metadata baseline、草稿和写队列。Controller SHALL 提供 `getState`、`subscribe`、`updateHostSnapshot`、`requestSave`、`setInputFrozen`、`canDetachView`，不得公开 schema、transaction 或内部会话。除只读观察外的所有命令 MUST 校验 `expectedSessionId`。公开 state MUST 包含 lifecycle、identity、encoding、body/host dirty、save、inputFrozen、`undoPolicy: 'shared'`、draft、views；无活动身份时 identity MUST 为 null。

#### Scenario: 根入口装配双视图
- **WHEN** 宿主仅通过包根创建一个 Provider 和两个不同 viewId 的 View
- **THEN** 两个视图 SHALL 可编辑同一正文，Controller SHALL 可订阅完整状态，宿主无需私有导入

#### Scenario: 旧命令不能操作新会话
- **WHEN** 命令携带上一会话的 expectedSessionId
- **THEN** 命令 MUST 返回 stale 判别结果且不得修改当前正文、metadata、lease 或保存队列

### Requirement: 装载与替换生命周期

Provider MUST 严格校验初始 HNN，失败不得构造兜底可保存会话。同 documentId/loadKey 的初始 props 更新 MUST NOT 覆盖当前文档；合法新 load 才建立新 sessionId 并清历史。Provider MUST 在 dirty、draft、保存未终结、pending acquire 或活动 lease 时拒绝替换，保留旧会话和身份。强制卸载 MUST abort 旧异步操作，旧 controller 不得操作新 Provider。

#### Scenario: 合法空闲会话重载
- **WHEN** clean、无草稿、无在途工作或 lease 的 Provider 接到合法新 loadKey
- **THEN** SHALL 建立全新会话和 baseline，清除旧 history，旧回调不得污染新会话

#### Scenario: 有未保存内容时尝试替换
- **WHEN** 正文或 metadata dirty、draft 开放或保存尚未终结时传入新 documentId/loadKey
- **THEN** SHALL 拒绝替换并保留旧文档、身份和状态

#### Scenario: 非法装载
- **WHEN** 初始 HNN 不合法
- **THEN** SHALL 公开 load-error，禁止保存，并调用已配置的装载错误回调

### Requirement: A 共享正文历史与独立选区

所有正文用户操作 MUST 进入全会话共享 undo/redo 栈，任意 view 的键盘或 toolbar 撤销 MUST 撤销全会话最近历史事件，允许撤销 peer 动作。连续同 view 输入 SHALL 沿用历史分组，切换编辑 view MUST 关闭前组，只切焦点不得改写历史。undo 后任意 view 新编辑 MUST 清除 redo 分支。metadata、选区、草稿编辑/取消、freeze 和保存 MUST NOT 进入正文历史。每 view 的 selection/focus/stored marks MUST 独立；执行 undo 的 view 使用历史 bookmark，peer 选区映射且不得抢焦点。普通编辑 MUST NOT remount，stale transaction MUST 安全映射或原子拒绝，不得全量旧快照覆盖；每次合法正文提交仅一次 onChange。

#### Scenario: 跨栏撤销顺序
- **WHEN** A 输入 AA，B 在中间输入 B，得到 ABA共享正文，再在 A 执行两次 undo
- **THEN** 正文 MUST 依次为 AA共享正文、共享正文，两次 redo MUST 恢复 ABA共享正文
- **AND** SHALL NOT 以“仅撤销 A 保留 B”为验收条件

#### Scenario: 独立选择与新编辑
- **WHEN** 两 view 有不同选区，A undo 后 B 新编辑
- **THEN** peer 选区 SHALL 映射且焦点不被抢夺，redo 分支 SHALL 清空，metadata SHALL 保留

#### Scenario: 结构与窄命令历史
- **WHEN** 用户执行 mark、结构修改、card/drawing 完成或引用插入
- **THEN** 每个正文事件 SHALL 可从任意 view 撤销/重做，且不得重复触发 onChange

### Requirement: 视图重挂载保留会话

关闭/重开 view 或全部 view 暂时 detach MUST NOT 清空 Provider history。新 view MUST 可以撤销此前任何 view 的最近全局事件；survivor 的实例与选区 MUST 保留。只有合法新 load 或 Provider dispose 才清空会话历史，刷新后的历史不承诺持久化。

#### Scenario: 重开或全部 detach
- **WHEN** A 编辑后关闭并重开，或全部 view detach 后重新挂载
- **THEN** 新 view MUST 能撤销 A 的事件，Provider 的正文和 baseline MUST 保留

### Requirement: Metadata 快照与唯一保存 barrier

Provider MUST 仅接受防御拷贝的 JSON `{changeId, value:{title, summary}}` metadata；changeId MUST 为有限安全整数且严格递增。同 id 同值返回 unchanged，倒退或同 id 不同值返回 failure。正文与 host dirty MUST 分开计算。600ms autosave 与按钮/宿主保存 MUST 全部调用同一 requestSave；唯一持久化为 `onSave({document,hostSnapshot},{identity,operationId,reason,signal}): Promise<void>`，MUST await 真实写入后才推进对应 baseline，不使用 CAS 或第二 producer。

重复请求 MUST 加入同一 barrier，最大写并发 MUST 为 1。写 A/M1 期间可编辑 B/M2；A 成功只推进 A/M1 baseline，队列 MUST 捕获 latest 并 drain。失败 MUST 保留 dirty、停止自动重试，显式 retry 才恢复。onChange MUST 仅通知可编码正文，编码失败仍公开 encoding:error。

#### Scenario: Metadata-only 与防御拷贝
- **WHEN** 仅更新 title/summary，随后调用方修改原对象
- **THEN** host dirty MUST 为 true，保存 MUST 使用已接受的拷贝，不得漏判 clean 或采用外部突变

#### Scenario: Inflight 期间更新并重复保存
- **WHEN** A/M1 写入中接受 B/M2 并重复 requestSave
- **THEN** MUST 共享 barrier、串行 drain 最新 B/M2，真实写入全部结束前不得报告 saved

#### Scenario: 保存失败重试
- **WHEN** adapter writePromise 拒绝
- **THEN** MUST 返回 failure，保留最新 dirty 和旧 baseline，停止自动重试；显式 retry SHALL 可再次保存

### Requirement: 保存终态可信且不能代替导航核验

requestSave MUST 返回带 sessionId 的 saved、clean、blocked(encoding-error|draft-open)、failure、noop(not-ready|stale)、abort(disposed|replaced)，或 pending(operationId,completion)。completion MUST 最终只返回 terminal。saved/clean MUST 要求当前 body/host baseline 匹配、队列 idle、无 draft/encoding-error；旧 A 成功不得使错误 B 放行。pending/noop/abort MUST NOT 被视为允许导航；writesCompleted 仅用于诊断。宿主仍 MUST 核验 same-session、自己的活动 lease、saved/clean 与真实导航完成；库不能撤销远端已写或阻止强制卸载。

#### Scenario: 已保存 A 后编码失败
- **WHEN** A 已写成功，当前正文 B 编码失败后再保存
- **THEN** MUST 返回 blocked/encoding-error 并零新增写入，不得以 A 的回执放行

#### Scenario: Pending 与销毁
- **WHEN** dirty 保存返回 pending，完成前 Provider 被 dispose
- **THEN** completion MUST 终结为 abort，不得永远 pending 或改变新会话 baseline

### Requirement: 请求归属 freeze lease

acquire MUST 接受 expectedSessionId/requestId，release MUST 额外携带 leaseId。requestId MUST 非空白且不超过 128 UTF-16 code unit；先校验 session，再校验请求。同会话调用 MUST 串行线性化且捕获入队参数。同请求重复/并发 acquire MUST 返回原 lease 的 noop/already-owned；不同请求各持 lease。错误归属、错误 lease 与重复 release MUST 返回 noop/stale-lease。成功释放 MUST 保留结束记录直到 dispose，迟到 acquire MUST 返回 noop/request-ended。acquire failure 不生成 lease 或消费 requestId，允许重试；不得 TTL 自动解冻。

#### Scenario: 幂等、归属与结束重放
- **WHEN** 请求 R 重复 acquire，另一个请求 S acquire，随后用错误归属释放 R，再正确释放 R 并重放 acquire R
- **THEN** R 的重复获取 MUST 返回同 lease，错误释放 MUST 不解锁，正确释放后 R MUST request-ended，S 的 lease MUST 仍有效

#### Scenario: 最后 lease 才解锁
- **WHEN** R/S 均持 lease，释放 R，保存发生 blocked/failure，再释放 S
- **THEN** 只有 S 成功释放后 inputFrozen 才为 false，保存不得自动释放任意 lease

#### Scenario: 输入不合法或提交失败
- **WHEN** requestId 无效，或既有 composition 无法确认提交，或仍有 pending edit
- **THEN** MUST 分别返回 failure/invalid-request、composition-commit 或 pending-edit，不得保存或放行，同请求 SHALL 可在故障修复后重试

### Requirement: Freeze 输入门禁与替换交界

acquire MUST 先尝试提交已有 DOM/composition，成功后冻结全部 view、toolbar、portal、异步窄命令与 host metadata；不得丢失已接受正文、metadata、draft 或 history。updateHostSnapshot MUST 返回 blocked/input-frozen。MUST 从 acquire 同步入队到该请求完成及活动 lease 期间拒绝会话替换；多个 pending acquire MUST 独立计数，inputFrozen 仅表示活动 lease。最后 release 与下一 acquire 之间及通知内新入队 MUST 不产生可替换窗口。

#### Scenario: 排队交界与重入入队
- **WHEN** 最后 release 的通知内检查替换并再入队 acquire，或下一 acquire 尚未完成
- **THEN** 即使 clean 或 inputFrozen 暂为 false，Provider MUST 拒绝替换；失败请求的清理不得清掉其他 pending 请求门禁

#### Scenario: 冻结覆盖真实控件
- **WHEN** 持 lease 时尝试两侧输入、undo、toolbar、portal 草稿修改、异步插入和 metadata 更新
- **THEN** MUST 拒绝修改且保留现有 draft/history，最后释放后 SHALL 恢复输入

### Requirement: Freeze 通知可重入销毁

公开 acquire/release 通知返回后 MUST 复核生命周期。通知内同步 dispose 时原操作 MUST 返回 `abort/disposed, identity:null` 且不含 lease 成功回执。dispose MUST 清理 lease 与结束记录，queued/inflight acquire MUST 同样 abort/null，不得复活旧会话。每个 freeze 结果 MUST 带 requestId 与 identity，非获取成功结果不得代表拥有 lease。

#### Scenario: 获取和释放通知内 dispose
- **WHEN** acquire 或 release 的订阅通知中同步销毁 Provider
- **THEN** 两种操作 MUST 返回 abort/disposed、identity:null，不得返回旧身份成功或旧 lease；排队获取 MUST 同样终结

### Requirement: 草稿归属与显式完成

Provider MUST 保留 card/drawing 草稿 payload/bookmark/focus/history，仅公开 phase(none/editing/validating/invalid)、draftId、kind、ownerViewId、changed，不得暴露 payload。仅用户完成动作 SHALL 校验并以一次正文 transaction/onChange 提交；取消 MUST 零正文 transaction，校验失败 MUST 保留草稿。save/close/load MUST NOT 自动完成或取消。草稿开放 MUST modal 锁两侧正文与 undo/redo，portal 可编辑但受 freeze 叠加锁；owner canDetach MUST blocked/draft-owner，其他 view 可 detach 并保留 survivor。

#### Scenario: 两种草稿的保存与离开
- **WHEN** card 或 drawing 草稿未完成且队列 idle，宿主保存并检查 owner detach
- **THEN** 保存 MUST blocked/draft-open 且零写，owner detach MUST blocked，草稿、历史及选区 MUST 保留

#### Scenario: 完成、取消与失败
- **WHEN** 用户分别完成合法 card、取消 drawing 或提交校验不通过的草稿
- **THEN** MUST 分别产生一次正文历史事件、零正文事件或保留 invalid 草稿，并恢复正确 owner 的焦点

### Requirement: 正式完整编辑与异步来源安全

新 View MUST 支持既有正文节点、NodeView、引用与编辑交互，不能用隔离原型的简化画布替代。Provider MUST 统一配置三个 reference 回调；内部异步引用/已有上传接入 MUST 绑定 session、view 实例、操作与位置，current mapping 后以窄命令落地，过期/删除/重建结果 MUST 丢弃，不得透出内部编辑对象。

#### Scenario: 异步来源失效
- **WHEN** 引用请求发出后其 view 被重建、目标被删除或 session 被替换
- **THEN** 迟到结果 MUST 不错误插入、不重复提交且不得写入新会话
