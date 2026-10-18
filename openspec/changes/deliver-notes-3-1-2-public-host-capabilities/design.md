# Design

## Context

动机见 proposal.md。基线 `v3.1.1` 的完整源提交为 `e40ee779bf36b7f5c9f5d5fd10b622c66febbeb6`；检出时与 origin/main 相同。

已读取 HAM-36 阶段报告附件 `01a14d65-395e-733a-a650-09bbb3bcbab0` 和原始日志归档 `01a14d64-217e-7d73-9865-89dcb6559055`。其中 `save-stage-reference-repro.log` 的公开 Provider 最小复现是 expected missing / received resolved；`save-stage-browser-final.log` 为 13 passed / 1 failed，失败位于 `webview/e2e-app/hnn-references.spec.ts:63`。关联 WebBase PR #24 head `bc338573`。这是历史证据读取，本次未重跑宿主测试。

源码观察：

- `documentSession.ts:updateCallbacks` 只比较三个引用回调的有无；已有闭包会读取最新 options，但 `hostReferences.ts:syncReferences` 遇到已有 kind/id 只改 name，不重新 resolve。
- `NoteDocumentProviderProps` 不含 `onPictureUpload`；`attachView` 的 block menu 上传能力固定为 false。旧 `session.ts` 与 `pictureUpload.ts` 已实现 handler 热更新、独立 signal、retry/cancel、decoration 锚点映射及合法 URL/预算校验，可复用。
- `documentSession.ts:dispatch` 控制权威正文和共享 history，freeze 拒绝 pending-edit。已有 `NoteEditor` 上传实现不能直接当作共享 Provider 已完成的证据。
- `deliver-notes-3-1-shared-session` 已完成但未归档；其 Provider/save/A/lease 文档作为现有行为约束。主 `host-integration` 的旧 CAS 保存仍适用于旧 NoteEditor，不重写它。
- 仓库无自带 propose 命令或技能文件；本次遵循安装的 `openspec-propose`，CLI 1.13.1、配置 schema=spec-driven，无额外 context/rules。

## Goals / Non-Goals

**Goals:** 用封闭公共类型覆盖两项宿主能力，复用现有安全校验与编辑路径；不新增内部 PM/Tiptap 句柄到包根；让命令接受状态、异步展示终态和真实持久内容可分别验证。

**Non-Goals:** 不改 HNN schema、撤销策略、lease 所有权或保存结果联合；不引入轮询、全局跨文档缓存、服务端上传、跨设备事务或新运行时依赖。只在 notes 仓库实现和验证，不代替 HAM-36 修改接线与验收。

## Decisions

### 1. 显式失效命令，保持 resolver 的已有更新行为

建议新增包根类型及 Controller 方法：

```ts
type ReferenceInvalidationScope =
  | { kind: 'reference'; reference: HostReferenceLookup }
  | { kind: 'document' }
type ReferenceInvalidationResult = { sessionId: string | null } & (
  | { kind: 'accepted' }
  | { kind: 'noop'; reason: 'stale' | 'not-ready' }
  | { kind: 'abort'; reason: 'disposed' }
  | { kind: 'failure'; reason: 'invalid-scope' }
)
// 新增到 NoteDocumentController
invalidateReferences?(input: {
  expectedSessionId: string
  scope: ReferenceInvalidationScope
}): ReferenceInvalidationResult
```

3.1.2 实际 Controller MUST 始终提供该方法；旧接口类型将新增成员声明为可选，以保留 3.1.1 结构 mock/adapter 的赋值兼容。宿主在调用前检查方法存在（缺失应报告包能力不符，不能假装已刷新）。先校验 lifecycle，再 expectedSessionId，再 scope；对 scope 防御拷贝并沿用引用 kind/id 预算校验。ready 的错误身份返回 stale；disposed 返回 null。accepted 是同步的失效受理，UI 的 `data-hnn-resolve-status` 承载解析终态。无需新增等待网络的导航 barrier，也不声称既有 Controller state 已公开全部引用解析状态。

`DocumentSession` 广播到当前各 View 的内部 reference installer。按 kind/id 精确匹配，多个同源节点共享该 View 的一次解析；跨 View 允许各自请求，不引入新共享缓存。文档级扫描当前已存在引用，不查询宿主候选列表。无匹配或无 View 仍安全 accepted；之后 attach 按最新 options 初始解析。

installer 新增内部失效能力：作废旧 token、abort、清掉旧 label/description/error，再生成独立 token/signal 并使用最新 resolver。token 必须在任何宿主回调/订阅重入前变更；每个后续动作及 Promise 回调都复核 active、instance 和生命周期。同步通知内 dispose/二次失效不能复活旧请求，命令返回前复核 disposed。仅通知 runtime 引用 UI，不 dispatch 正文、不 onChange、不影响 history 分组。null→missing，异常→error；从 missing/error 可再次恢复 resolved。

替代方案：自动在每次函数身份变化时全量重拉会因普通 React rerender 反复请求，也改变旧行为；重建 Provider 或改正文会破坏明确的会话/history 边界，均不采用。宿主先提交新 resolver，再调用显式失效；若闭包读取最新外部 store，原 resolver 函数也可直接配合失效。此契约不会让 HAM-36 原先“只换 resolver”的诊断探针自动转绿：升级后应保留其基线说明，并另加公开失效调用；原真实删除高亮 E2E 的 missing 断言不得放宽。

### 2. Provider 复用既有上传 handler 和 UI

`documentTypes.ts` 引入已公开 `PictureUploadHandler` 作为可选 Provider prop；`index.ts` 导出新增失效相关类型，保留旧所有类型。View 的 picker/paste/drop/重试/取消经同一 installer，`HostReferenceUI` 不参与上传。每个 View 安装自己的上传 plugin，成功通过现有 `DocumentSession.dispatch` 提交权威正文，由共享同步使 peer 获得图片；不为 peer 重复上传。

接线 `configurePictureUpload` 与 menu 能力动态 getter。有→有仅未来 attempt 读取新回调；无→有增量安装；有→无 abort/销毁且清理占位，重新增加可恢复。既有 uploadId、attempt、signal、URL/字节预算及单事务语义保持。UI 复用现有 placeholder 可访问重试/取消按钮，无 callback 不显示可用上传入口。

替代方案：仅公开“不支持”虽然是 issue 允许的退路，但已有 uploader 可复用，实际接通能完成 MVP 需要的真实上传验证；扩展到 card/drawing 附件不属于此次范围。

### 3. 上传完成必须通过共享会话输入门禁

现有 installer 在同步 dispatch 后清理占位，不能直接照搬后假设共享权威一定接受。接线要允许成功提交确认：只有当前 session、View instance、attempt/token、锚点仍有效且正文提交被接受才标为完成。位置沿 decoration mapping 更新，锚点被删除即取消；预算/提交失败保留 failed 可重试或取消，不把未提交的成功误报完成。

card/drawing modal 锁期间可让网络继续，保存合法返回结果但延迟窄命令；草稿结束时重校验并提交一次，不重传文件，不覆盖整份正文。取消、移除回调、View detach、dispose 会清理队列及 token，即使宿主忽略 signal 也不能回写。来源 View detach 仍沿现有 canDetachView 行为允许，明确取消其 runtime 上传；不增加旧 DetachViewResult 变体。会话替换在 uploading/failed/待提交结果存在时拒绝，避免无提示丢失；强制卸载只 abort，不保证远端资源回收。

freeze acquire 复用已有 pending-edit failure，覆盖 uploading、failed 和待提交结果；失败不消费 requestId，等待/取消后可重试。同步 acquire 入队到完成期间阻止新上传与 retry，全部 lease 持有期间亦阻止；不增加 FreezeOutcome 变体、不自动释放 lease。引用失效仅更新运行时展示，可在 freeze 期间执行。

普通 requestSave 保留现有签名：只保存持久 HNN，允许上传占位存在，不把它作为 saved 的内容。受控导航必须先 acquire 并检查成功，不能凭 saved 推断上传完成。这个选择保留旧上传临时态不进入快照的约定，避免给 SaveTerminal 增加破坏 exhaustive switch 的变体。

### 4. 证据以公开包为边界

契约/组件测试落在 `hostReferences.test.ts`、`pictureUpload.test.ts`、`documentSession.test.ts`、`NoteDocumentProvider.test.tsx` 和根类型测试附近，保留旧入口 fixture。真实浏览器扩展仓库现有 `scripts/check-shared-browser.mjs`，或沿其 Vite/Playwright 模式增加独立脚本，使用实际 Provider/View 和受控 Promise resolver/uploader，绝不把内部测试 hook 当成消费接口。覆盖双 View、同 session/history、取消后迟到、最终 HNN 与独立安装包。

旧 Controller 结构 mock 不包含新方法也必须仍能编译；新增能力检测与实际 Controller 方法存在均由根类型/runtime 测试验证。若暴露其他源兼容问题，停在兼容门禁回报，不以删 fixture 或类型断言掩盖。

## Risks / Trade-offs

- [上传 plugin 与共享 authority 的本地状态同步] -> 用真实双 View、相邻编辑/undo、同锚点多文件乱序完成测试，确保占位不进入 peer HNN且成功只提交一次。
- [modal 延后结果或 pending 计数泄漏] -> 统一结束路径保证幂等清理，覆盖失败、取消、重入卸载及永不 resolve 的宿主 Promise；abort 后不得永久卡替换/freeze。
- [3.1.1 版本字段与 tag 不同] -> 在独立 pack staging 通过发布脚本注入 3.1.2，保留命令/源提交/包 hash；不修改已发布 3.1.1。
- [主 spec 与未归档旧 change 的叠加] -> 本次全部为新 requirement，不替换旧 CAS、A 或 lease 文本；`package-consumption` 沿用旧 change 路径且 requirement 名称区分版本，不自动归档任何 change。
- [宿主侧仍需显式接线] -> 交付失效调用样例及回调时序，HAM-36 单独升级并复跑；本单上游浏览器绿不能代替真实 Reader 证据。

## Migration Plan

1. 以已发布 3.1.1 源码实施，保留旧导出与根 fixture；只有新增公共能力，旧消费者不必传新 prop。
2. 正式检查、兼容 fixture、公共浏览器及独立 pack 消费通过后开标题含 HAM-36 的 PR，附完整证据。失败就停止，不走 major 或包 patch 绕过。
3. 按 HAM-39/HAM-42 先例执行已有合并/发布授权：保持已验收源树，tag `v3.1.2` 驱动现有 Release 工作流，核对 registry 包与已验收包逐文件差异。上游包交付与宿主复跑分别报告。
4. HAM-36 自己接线数据变更后的引用失效与图片 handler、精确升级 3.1.2，复跑 `hnn-references.spec.ts` 与上传链路。发现回归保留现场、停止消费推广；未发布前撤回变更，发布后保持版本不可变，用后续修复版本处理，不能覆盖 3.1.1/3.1.2。

## Open Questions

无影响范围/验收的未决问题。显式失效、支持上传、freeze 拒绝未完成上传及草稿内延后提交是本提案的设计选择，并非用户逐项确认；实现若需改变这些可观察语义，应先更新并评审本 change。
