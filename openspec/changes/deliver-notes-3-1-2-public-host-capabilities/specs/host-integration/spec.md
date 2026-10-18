# Spec Delta

## ADDED Requirements

### Requirement: Provider 公开候选级与文档级引用失效

公共 Controller SHALL 提供 `invalidateReferences({ expectedSessionId, scope })`。scope MUST 支持 `{ kind: 'reference', reference: { kind, resourceId } }` 与 `{ kind: 'document' }`；reference.kind MUST 覆盖 mention、resource、externalItem。单候选以 kind/resourceId 匹配当前会话各 View 内所有同源引用，文档级覆盖全部已装载引用。返回 MUST 区分 accepted、noop(stale|not-ready)、abort(disposed)、failure(invalid-scope)，并携带当前 sessionId 或 null；accepted 只表示失效已生效，不表示异步解析完成。无匹配候选 MUST 安全 accepted，且不得拉取不在文档内的资源。

#### Scenario: Reader 删除高亮后显式刷新
- **WHEN** 同一 session 中宿主删除 Reader 高亮、resolver 对其返回 null，并失效该高亮对应的 mention 与 resource
- **THEN** 各 View 的对应引用 MUST 从旧 resolved 进入 loading，最终显示 missing；无 resolver 时直接 missing
- **AND** HNN 字节、sessionId、history、选区、焦点、metadata、dirty 和保存基线 MUST 保留，失效不得触发 onChange 或 onSave

#### Scenario: 文档级刷新与范围隔离
- **WHEN** 宿主执行文档级失效，或仅失效一个 kind/resourceId
- **THEN** 前者 MUST 重解析全部已装载引用，后者 MUST 只重解析匹配项，不影响其他 kind 或 id 的缓存
- **AND** 多 View 的重复节点 SHALL 各自正确更新；所有 View 暂时 detach 时调用亦安全，后续 View 按最新 resolver 解析

#### Scenario: 错误身份和输入
- **WHEN** 旧 controller、错误 expectedSessionId、未 ready 会话或非法 scope 收到失效命令
- **THEN** MUST 返回对应判别结果、零解析请求、零会话修改；disposed 返回 sessionId:null，stale 不得影响当前会话

### Requirement: 引用失效使用最新 resolver 并隔离旧结果

失效 MUST 中止匹配项旧请求并作废其结果，使用命令时当前已提交的 `onReferenceResolve` 重解析。失效 MUST 支持 resolved、missing、error、loading 状态；null 显示 missing，异常显示 error，合法结果显示 resolved。普通 rerender 或函数身份变化 MUST NOT 自动清空全部缓存；宿主在外部数据改变后显式失效。失效不等于取消候选搜索，也不自行导航；freeze 期间 SHALL 允许只读引用刷新而不改变正文。

#### Scenario: 重叠失效与迟到 resolver
- **WHEN** 第一轮 resolver 尚未返回，宿主更新 resolver 并再次失效；第一轮忽略 abort 后迟到返回 resolved
- **THEN** 只有最新一轮结果 SHALL 更新展示，旧请求 MUST 已收到 abort，旧结果不得覆盖新 missing/error

#### Scenario: 替换回调后受控更新
- **WHEN** 同 documentId/loadKey 更新 resolver，而未执行失效
- **THEN** 既有缓存 SHALL 保留且不重复发请求；下一次显式失效 MUST 使用新 resolver
- **AND** 在引用刷新前后 undo/redo MUST 继续作用于原共享正文历史

### Requirement: 公共 Provider 暴露兼容的图片上传能力

`NoteDocumentProviderProps` SHALL 新增可选 `onPictureUpload?: PictureUploadHandler`，复用包根已公开的 File 与 `{uploadId, attempt, signal}` / `{src, alt?}` 契约。提供回调时每个正式 View SHALL 支持图片 picker、粘贴、外部拖入及可访问的重试/取消控件；内部移动不得重复上传。仅 picture 文件上传受支持，无回调时 SHALL 不调用宿主、不生成持久图片或伪造地址，并保持 3.1.1 原有无上传行为。

#### Scenario: 成功完成及跨 View 撤销
- **WHEN** 在 View A 插入图片，宿主返回合法 http/https src 与可选 alt
- **THEN** MUST 在映射后的有效位置只提交一次持久 picture，两 View 同步，onChange 只通知一次且可从 View B undo/redo
- **AND** 成功前保存快照 MUST 不含占位、File、uploadId、attempt 或其他上传临时态

#### Scenario: 失败重试或取消
- **WHEN** 宿主 reject、同步抛错或返回非法 src，用户随后重试或取消
- **THEN** SHALL 显示失败且零持久插入；重试使用同 uploadId、递增 attempt、新 signal；取消 MUST abort 并移除占位，零正文历史事件

### Requirement: Provider 上传遵守会话和输入门禁

上传 MUST 绑定 session、来源 View 实例、每次 attempt 和映射锚点。取消、锚点删除、来源 View detach、Provider dispose 或移除回调 MUST abort 并丢弃陈旧结果。合法会话替换亦 MUST 隔离旧结果；存在未终结或失败占位时 MUST 拒绝会话替换，直到完成或显式取消。替换函数本身 SHALL 只影响未来请求，不取消当前 attempt；移除后重新提供回调 SHALL 无需 remount 恢复能力。

上传临时态 MUST 不进入正文历史或 HNN。存在 uploading/failed 占位时 freeze acquire MUST 使用既有 failure/pending-edit 拒绝，不生成 lease，且允许用户完成/取消后重试；冻结、acquire 处理中或 card/drawing 草稿锁定时 MUST 禁止新上传和重试。草稿锁定期间返回的成功结果 MUST 延后到允许正文提交时再校验来源/位置并提交，显式取消及卸载仍可清理；不得静默丢失成功结果或穿透草稿锁。保存 SHALL 沿用唯一 barrier，可保存已有持久正文，不承诺临时上传已保存。

#### Scenario: 取消后迟到与回调移除
- **WHEN** 上传取消或回调被移除，宿主忽略 signal 并迟到返回成功
- **THEN** MUST 不插入任何图片，不污染 peer 或新 session，不触发 onChange；重新启用回调可开始新的上传

#### Scenario: 来源生命周期与当前位置
- **WHEN** 上传期间正文编辑改变锚点位置、锚点被删，或来源 View 被关闭并以相同 viewId 重建
- **THEN** 有效锚点的成功 MUST 插入映射后位置；已删锚点或旧实例结果 MUST 被忽略，重开 View 保留原有正文共享 history

#### Scenario: 保存和 freeze 不误报上传完成
- **WHEN** 上传尚在途或处于 failed，宿主先 requestSave 再 acquire freeze
- **THEN** 保存 SHALL 仅处理持久正文；acquire MUST failure/pending-edit，不能凭保存成功放行导航；取消或成功后同请求可重试 acquire

#### Scenario: 草稿期间成功结果待提交
- **WHEN** 图片上传发出后打开 card/drawing 草稿，上传成功返回，再完成或取消草稿
- **THEN** 草稿开放期间 MUST 零图片正文提交；草稿关闭后仍有效的结果 MUST 恰好提交一次，并保留两个操作各自历史边界
