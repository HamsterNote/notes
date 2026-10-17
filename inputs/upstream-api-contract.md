# 上游公开 API 契约：A 共享撤销栈（migrate-notes-v3）

- 状态：**A 产品语义已批准，契约文本定稿；迁移执行计划待评审，正式实现/发布尚未授权**
- 更新：2026-10-17；修勾选择 A 的评论 `01a149e9-00cc-7454-af85-d42c7a7c53e9`
- 基线：官方 `v3.0.0` tag，peeled commit `2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c`
- 项目现状：`@hamster-note/notes` 仍锁定 2.0.0
- 目标上游新版本：**精确 `@hamster-note/notes@3.1.0`**；新增公开 Provider/View/Controller，保留 3.0.0 入口兼容。本版本号是计划目标，不是现存包或发布授权
- 隔离原型证据：notes `378aba1`，尚未进入正式 `src/lib` 导出；freeze 两项 P2 已由代码审核员独立复验通过（评论 `01a14a10-162d-73ee-be89-2323757c33c2`，24/24 定向测试）
- 本次仅修改 change 与 notes 隔离文档；不改 WebBase 生产代码、依赖、锁文件及任务完成状态

> 本文取代 2026-10-12 草案的每 pane 局部撤销与 boolean freeze 语义。
> 类型名是 3.1.0 的目标公共契约，不是 3.0.0 现有导出；原型通过不代表正式库或宿主已通过。

---

## 0. 事实与授权边界

### 0.1 事实

- 官方 `v3.0.0` 的 commit 为 `2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c`，作为本次调研基线。
- 项目依赖仍为 2.0.0；规划消费目标为精确 3.1.0。2026-10-17 查询 npm，只有 2.0.0/3.0.0，latest=3.0.0，3.1.0 尚不可消费。
- 原 21 项任务中，仅 **1/21**（task 1.1 阻塞报告）报告为 done，其余未勾选。
- 三项门禁（保存状态/编码失败、Drawer 草稿、同文件双视图）**均未关闭**。
- Web 侧四个入口 `pnpm typecheck`、`pnpm test:run`、`pnpm build:web`、`pnpm test:e2e:web` **均未执行**，不得报告为通过。
- 现有依赖/锁文件、旧文件拒绝策略、已批准的 Reader 候选规划、无 CAS 结论**不变**。

### 0.2 授权

- 用户已批准隔离原型，并在 2026-10-17 批准 A 为 MVP 口径；协调员授权据此更新契约、design/tasks 及执行计划。
- 本轮只交付规划与原失败反例的说明。正式上游实现、包发布和 WebBase apply 在计划评审后另开，不把 A 批准等同于三项门禁关闭。
- 禁止：私有 session/schema/transaction、读取 DOM 拼快照、自动点击控件、package patch、第二持久化 producer。

---

## 1. 本草案的范围

- 只描述让三项门禁可被可信接入所需的**最小公共 surface**，避免巨大通用 API。
- 只覆盖：正文权威模型、宿主 metadata 快照、保存请求与终态、输入冻结、草稿公开状态、双视图权威接入。
- 明确不覆盖：CAS/revision、跨设备冲突、上传、Markdown 导出 UI、Reader 原始数据迁移、原生验收。
- 本文为正式实现的验收输入；正式 API/打包结果须经任务 1.3 核验，不能以隔离文件路径或私有导入替代。

---

## 2. 最小公共 surface（3.1.0 目标类型）

> 以下代码块为规划草案中的上游公共类型建议，**不是 3.0.0 现有导出，未经实现、未经编译**。
> 多个 ts 代码块是同组草案片段、共享同一组 types 与前向声明，**不假装可独立编译**。

```ts
// 草案片段（未编译）：下述多个 ts 块共享同一组类型与前向声明，非可独立编译模块。
import type {
  HnnDocument, HostCandidateProvider, HostReferenceResolve,
  HostReferenceActivate, InitialLoadErrorHandler,
} from '@hamster-note/notes'
import type { ReactNode, Ref, ReactElement } from 'react'

// —— 草稿公开状态：只暴露状态与归属，不暴露 payload ——
type DraftKind = 'card' | 'drawing'
type DraftPhase = 'none' | 'editing' | 'validating' | 'invalid'

type PublicDraftState =
  | { phase: 'none' }
  | {
      phase: 'editing' | 'validating' | 'invalid'
      draftId: string
      kind: DraftKind
      ownerViewId: string
      changed: boolean
    }

// —— 生命周期 / 身份 / 编码 ——
type NoteStateLifecycle = 'validating' | 'ready' | 'load-error' | 'disposed'
type EncodingState = 'valid' | 'error'
type ActiveIdentity = { documentId: string; loadKey: string | number; sessionId: string }

// —— 保存态 ——
type SaveState = 'clean' | 'dirty' | 'pending' | 'blocked' | 'failure'

type NotePublicState = {
  lifecycle: NoteStateLifecycle
  identity: ActiveIdentity | null
  encoding: EncodingState
  dirty: { body: boolean; host: boolean } // 正文与 host metadata 分别标记
  save: SaveState
  inputFrozen: boolean
  undoPolicy: 'shared'
  draft: PublicDraftState
  views: Array<{ viewId: string; owner: boolean; canDetach: boolean }>
  error?: unknown // 诊断用，不作为放行依据
}
```

### 2.1 Provider 与 View

```ts
// Provider：持有权威正文 + baseline + metadata snapshot + draft + 写队列
// provider props 草案（不额外暴露内部对象）
type NoteDocumentProviderProps = {
  documentId: string
  loadKey: string | number
  initialDocument: unknown
  initialHostSnapshot: HostMetadataSnapshot
  onSave: OnSave
  onChange(document: HnnDocument, identity: ActiveIdentity): void
  controllerRef?: Ref<NoteDocumentController>
  onReferenceCandidates?: HostCandidateProvider
  onReferenceResolve?: HostReferenceResolve
  onReferenceActivate?: HostReferenceActivate
  onInitialLoadError?: InitialLoadErrorHandler
  children: ReactNode
}

// NoteEditorView(viewId)：双可编辑视图；selection / focus 各自独立
// 不再要求 stable key 跨 React 父级必然不 remount（不承诺）
type NoteEditorViewProps = { viewId: string; theme?: 'light' | 'dark' }

// 仅草案片段、未编译；Provider 与 View 共享同一组 types/前向声明
declare function NoteDocumentProvider(props: NoteDocumentProviderProps): ReactElement
declare function NoteEditorView(props: NoteEditorViewProps): ReactElement
```

### 2.2 Controller

```ts
type HostMetadataSnapshot = {
  changeId: number // 有限安全整数，严格递增
  value: { title: string; summary: string } // 仅 JSON，范围限于应用 metadata
}

type SaveReason =
  | 'autosave'
  | 'editor-button'
  | 'host-save'
  | 'host-close'
  | 'host-retry'
  | 'load-switch'

type SavePayload = {
  document: HnnDocument // 库类型：{ schemaVersion: 1, data }
  hostSnapshot: HostMetadataSnapshot
}

type SaveContext = {
  identity: ActiveIdentity
  operationId: string
  reason: SaveReason
  signal: AbortSignal
}

// 唯一持久化回调：await 真实 adapter writePromise 成功才推进 baseline
type OnSave = (payload: SavePayload, context: SaveContext) => Promise<void>

type SaveTerminal =
  | { kind: 'saved'; sessionId: string; operationId: string; writesCompleted?: number }
  | { kind: 'clean'; sessionId: string }
  | { kind: 'blocked'; sessionId: string | null; cause: 'encoding-error' | 'draft-open' }
  | { kind: 'failure'; sessionId: string | null; operationId: string; error: unknown }
  | { kind: 'noop'; sessionId: string | null; cause: 'not-ready' | 'stale' }
  | { kind: 'abort'; sessionId: string | null; cause: 'disposed' | 'replaced' }

type SavePending = {
  kind: 'pending'
  sessionId: string
  operationId: string
  completion: Promise<SaveTerminal>
}
type RequestSaveResult = SaveTerminal | SavePending

type AcquireFreeze = { expectedSessionId: string; requestId: string }
type ReleaseFreeze = AcquireFreeze & { leaseId: string }
type FreezeOutcome = { identity: ActiveIdentity | null; requestId: string } & (
  | { kind: 'applied'; action: 'acquired'; leaseId: string; inputFrozen: true }
  | { kind: 'applied'; action: 'released'; leaseId: string; inputFrozen: boolean }
  | { kind: 'noop'; reason: 'already-owned'; leaseId: string; inputFrozen: true }
  | { kind: 'noop'; reason: 'not-ready' | 'stale' | 'stale-lease' | 'request-ended' }
  | { kind: 'abort'; reason: 'disposed' }
  | { kind: 'failure'; reason: 'composition-commit' | 'pending-edit' | 'invalid-request' | 'other'; error: unknown }
)

type UpdateHostSnapshotResult = { sessionId: string | null } & (
  | { kind: 'accepted'; changeId: number }
  | { kind: 'noop'; reason: 'stale' | 'unchanged' }
  | { kind: 'blocked'; reason: 'input-frozen' | 'not-ready' }
  | { kind: 'failure'; reason: 'invalid-snapshot' | 'non-monotonic-change-id' }
)

type DetachViewResult = { sessionId: string | null } & (
  | { kind: 'allowed' }
  | { kind: 'blocked'; reason: 'draft-owner' }
  | { kind: 'noop'; reason: 'unknown-view' | 'not-ready' | 'stale' }
)

interface NoteDocumentController {
  getState(): NotePublicState
  subscribe(listener: (state: NotePublicState) => void): () => void
  updateHostSnapshot(
    snapshot: HostMetadataSnapshot,
    options: { expectedSessionId: string },
  ): UpdateHostSnapshotResult
  requestSave(input: { reason: SaveReason; expectedSessionId: string }): RequestSaveResult
  setInputFrozen(frozen: true, options: AcquireFreeze): Promise<FreezeOutcome>
  setInputFrozen(frozen: false, options: ReleaseFreeze): Promise<FreezeOutcome>
  canDetachView(viewId: string, options: { expectedSessionId: string }): DetachViewResult
}
```

### 2.3 surface 约束

- `complete`/`cancelDraft` 可只保留为**库内用户按钮**，不额外公开命令；公开草稿状态 `phase` 与 `blocked` outcome 已足够。
- 若最终公开草稿命令，**务必仅由明确用户动作触发**，保存流程不得自动调用。
- `draft` 公开字段为 `phase(none/editing/validating/invalid) + draftId + kind(card,drawing) + ownerViewId + changed`，**不暴露 payload**。
- 上述草稿名均为本草案新名，不是 3.0.0 导出。
- reference 三个宿主回调由 Provider 统一配置；内部异步插入须同时捕获来源 view 实例、session 与位置，重建/删除后丢弃过期结果。View 负责主题、独立选区及命令 UI，不另建持久化 producer。
- 所有 mutating/check 命令（`updateHostSnapshot`/`requestSave`/`setInputFrozen`/`canDetachView`）均须携带 `expectedSessionId` 并**严格校验**；原 `boolean`/`void` 返回不可信，改为带判别与 `sessionId` 的结果。

### 2.4 host snapshot 约束

- 只接受 JSON `{ changeId, value: { title, summary } }`。
- 范围严格限于**应用 metadata**，不泛化为复杂平台对象。
- `changeId` 为有限安全整数且**严格递增**；value 不变且同 `changeId` 可判 `noop`；`changeId` 倒退或同 id 不同 value 判 `failure`。
- 内部采用**防御拷贝**保存，不能只依赖 TS `Readonly` 的编译期约束。

### 2.5 onSave 约束

- `onSave(payload{document, hostSnapshot}, context{identity, operationId, reason, signal})` 是**唯一 persist**。
- 必须 `await` 真实 adapter 的 `writePromise`，成功才推进 baseline；失败保留当前 dirty，不放行。
- 不每次 readback，不使用 revision/CAS。
- 新 `onSave` 仅属于新增 Provider，不改变 3.0.0 `NoteEditor`/`NoteSave` 的签名及行为；3.0.0 入口保留作为兼容 API，WebBase 迁移使用新 Provider/View。新类型必须从包根导出，不能从 `src/prototype` 消费。若无法保持兼容，暂停 3.1.0 发布计划，重新评审 major 版本，不在此处默默接受 breaking change。

---

## 3. 保存语义

- `onChange` 仅在**合法正文**编码成功时通知；编码错误时无 `onChange`，但 state 仍进入 `encoding: 'error'`。
- 600ms timer **只触发 `requestSave`**；host metadata 变更也走同一 timer。
- 队列 preflight：输入不合法时不启动新写入。
- inflight 写 A 期间，B/M2 可继续编辑。
- A 成功只推进 **A/M1 的 baseline**。
- 串行捕获 latest B/M2 并 drain 后才算 barrier 成功。
- 重复 `requestSave` 加入**同一 barrier**，最大并发为 1。
- 失败即停止，不无尽自重试；保留最新 dirty，由**显式 retry** 再发起。
- 闭环 close：先捕获 session/requestId → 锁 host metadata → await 本请求 acquire 成功 → `requestSave` 并 await pending `completion`；仅当 same-session、仍持有本请求 lease 且回执为 `saved`/`clean`，才可 bridge 放行。导航完成或请求明确结束后 finally 释放自己的 lease；超时但仍有在途导航/写入不能提前解锁。
- 导航仍须宿主**核验**，不能仅凭回执即认为 done。
- state 为 error 或存在 draft 时，即使刚有 A 成功也必须 `blocked`。
- metadata-only 变更不得被漏判为 clean。
- adapter pending abort **不能撤销实际远端已写**；`session`/`changeId` 不是 storage rev。

### 3.1 requestSave 终态语义

- 入参含 `expectedSessionId`，用于**防止旧 controller 操作新 load**。
- terminal：`saved` / `clean` / `blocked(encoding-error|draft-open)` / `failure` / `noop(not-ready|stale)` / `abort(disposed|replaced)`。
- dirty 时返回 `pending{kind:'pending', sessionId, operationId, completion}`（`kind` 判别与 terminal 一致）；completion 完成后**不再次 pending**。
- 每个 outcome 都带 session 识别；`not-ready`/`disposed` 等无会话时 `sessionId` 为 `null`；`writesCompleted` 仅可作**辅助诊断**，不是放行依据。
- `saved`/`clean` 成立条件：当前 body + host baseline 匹配、队列 idle、无 draft、无 encoding-error。
- `pending`/`noop`/`abort` 任一都**不能导航**。

### 3.2 输入冻结与请求归属（MUST）

1. 宿主每次逻辑请求生成非空 requestId（不可全空白、最长 128 UTF-16 code unit）；归属键为 `(sessionId, requestId)`，释放须同时匹配 session/request/lease。session 校验优先；旧请求不得解冻新会话。
2. 所有调用在同一会话串行线性化，参数入队时捕获。同请求并发/重复 acquire 返回原 lease（`noop/already-owned`），不同请求独立持有；错误归属及重复释放返回 `noop/stale-lease`。
3. 成功释放后保留请求结束记录直到 dispose，迟到 acquire 返回 `noop/request-ended`。acquire failure 不生成 lease、不消费 requestId，可同请求重试。没有 TTL、自动解冻或强制清空；返回值丢失可用同 requestId 找回 lease，requestId 也丢失则安全保留会话并报告。
4. acquire 先尝试提交已有 DOM/composition；无法确认结束返回 `failure/composition-commit`，存在待落地编辑返回 `failure/pending-edit`，不静默丢弃。failure/abort/任意非获取成功的 noop 不保存、不放行。实体 IME 仍需 Web 专项证据，不能用合成事件冒充。
5. 活动 lease 冻住所有 view/toolbar/portal/异步窄命令及 host metadata，拒绝 `updateHostSnapshot`，但保留已接受正文/metadata、草稿和共享历史。只有最后 lease 释放恢复输入。保存不释放 lease，blocked/failure 也不自动释放。
6. 从 acquire **同步入队**到该请求完成，以及存在活动 lease 期间，Provider MUST 拒绝替换会话，即使文档 clean。多个 pending acquire 独立登记，最后 release / 下一排队 acquire 的交界不得打开替换窗口；`inputFrozen` 仍只表示活动 lease，不等同于排队门禁。
7. dispose 清空 lease 与结束记录，queued/inflight acquire 返回 `abort/disposed, identity:null`，不复活旧会话。公开获取/释放通知允许同步重入 dispose；通知返回后 MUST 复核生命周期，已销毁则返回同样 abort、无 lease，不能返回旧 identity 的成功。原型 `378aba1` 两项生命周期 P2 已独立复验通过；正式组件与真实宿主仍须分别验证。
8. 每个结果带 identity/requestId；`applied/acquired` 或 `noop/already-owned` 才表示本请求拥有 lease。`inputFrozen` 与 released 回执均为总体状态快照，不是导航许可证。宿主须核对自己的活动 lease、same-session、saved/clean 和真实导航完成门禁。强制卸载无法被库阻止，宿主必须遵守阻塞结果。
9. freeze 不撤销远端已写、不锁跨标签/设备。结束记录为 O(会话请求数)，正式实现须报告资源预算，不能随意回收 tombstone 破坏重放安全。旧 Provider 强制销毁后，旧 controller 不得操作新 Provider。

---

## 4. 草稿语义

- Provider 保留草稿的 payload/bookmark/focus/history。
- 仅“完成”按钮（用户触发）执行 validate，成功后**一次正文 transaction + 一次 onChange**，并恢复 owner。
- `cancel` 为用户动作，**零正文 transaction**。
- 草稿不被 save/close/load **自动**完成或取消。
- validation 失败**保留 draft**。
- Drawer 开放期间用 modal 锁住两个正文 view，避免其他 pane 改动目标。
- portal 仍可编辑；host freeze 叠加锁 portal。
- 临时 modal 锁不是永久 readonly，列为**建议待审查行为**。
- owner pane `canDetach` 为 `blocked`；其余可 detach，但 survivor 必须保留。
- 正文保存遇 draft 返回 `blocked`。
- 已发生的合法写 A **不可能倒退撤销**；`blocked` 指没有新增 write，测试的“绝对零写”前提是 queue idle。

---

## 5. 双视图与共享撤销栈 A（已批准）

- 一个 Provider 位于同文件 split 上方，持有一个 authoritative model 和一个正文 history。两个 pane 都可编辑；不允许 stale 全量快照互相覆盖、每次输入换 loadKey、永久只读镜像或依靠存储 CAS 同步。
- 所有正文用户操作（文本、mark、结构、card/drawing 完成及引用插入）进入同一全局栈。任意 pane 的键盘与 toolbar undo 撤销**全会话最近一个历史事件**，可能撤销另一 pane 的操作；redo 按全局事件顺序恢复。不是按 pane 所有权过滤，不承诺每个字符独立成事件。
- 同一 view 连续输入沿用 PM history 分组，切换发生编辑的 view 时关闭前组；只切焦点不重写历史。undo 后任何 pane 新编辑清空 redo 分支；非正文选区变化、metadata、草稿编辑/取消、freeze/unfreeze 与保存不进入正文 history。
- 选区/focus/stored marks 各 view 独立；undo 的执行 pane 采用历史 bookmark，peer 的选区映射到当前 doc，不强行夺取 peer 焦点。普通输入不 remount。关闭/重开 pane 不清空 Provider 的共享栈，新 view 可撤销此前任何 pane 的全局最近事件；所有 view 暂时 detach 也保留会话栈。显式新 load/Provider dispose 后 history 不持久化。
- 草稿开放或持有 freeze lease 时禁用两侧正文 undo/redo，不清历史；用户完成草稿形成一次正文历史事件，取消不产生历史事件。metadata 不被正文 undo 回滚。
- transaction router 使用当前模型，安全 map/rebase 或原子拒绝 stale transaction；每次成功正文提交只发一次 onChange。异步 reference/upload 内部捕获 session/view 实例/op/bookmark，在 current mapping 后以窄命令落地；删除/重建/过期不得错误插入。不向宿主暴露 PM 对象。

| 步骤 | A 的可见正文 |
| --- | --- |
| A 输入 AA，B 在中间输入 B | `ABA共享正文` |
| A 栏 undo（撤销最近的 B 事件） | `AA共享正文` |
| 任一栏再次 undo（撤销 A 事件） | `共享正文` |
| 两次 redo | `ABA共享正文` |

原“只撤 A、保留 B → B共享正文”的选择性撤销**不属于 A 验收**。notes `session.test.ts` 原失败反例保留，标为已知不满足的历史 B 契约，断言不删、不 skip/xfail；其失败不能被当作 A 的行为，但必须在全量报告中单列。A 的正向断言来自 `round2.test.ts` 和真实 shared 页面。原型 baseline 不会因本文自动变成 A 正式产品。

---

## 6. 证据矩阵

> 每条含 input / observable / assertions / owner。上游未来测试命令按其 package/config 确认（未知不编造）；本项目四入口为 `pnpm typecheck`/`test:run`/`build:web`/`test:e2e:web`，orchestrator 为 overall validation owner，Web-only 无 native。
> owner 列的 lane 为**未来执行归属**标注；不得把上游项目测试假称为父级已运行，也不把宿主 lane 假称为上游已跑。

| # | input | observable | assertions | owner |
|---|-------|-----------|------------|-------|
| 1 | 先合法写 A 成功，再进入不可编码状态 B | save 终态 | 不放行旧快照；state error；零新增 write | 上游契约/原型 lane（父级审查）|
| 2 | 仅修改 host metadata（title/summary） | dirty/save | metadata-only 不被漏成 clean，写经同一队列 | 上游契约/原型 lane（父级审查）|
| 3 | A inflight 期间编辑 B/M2 | queue 行为 | A 只推进 A/M1；latest 被捕获 drain 后 barrier 成功 | 上游契约/原型 lane（父级审查）|
| 4 | 重复 requestSave | barrier | 加入同一 barrier，最大并发 1 | 上游契约/原型 lane（父级审查）|
| 5 | 写失败后保留 dirty 并显式 retry | 终态 | 失败不放行；最新 dirty 保留；retry 可恢复 | 上游契约/原型 lane（父级审查）|
| 6 | composition 提交失败时 freeze | FreezeOutcome | 返回 FAILURE；不保存不放行；同 editor 可重试 | 上游+宿主 |
| 7 | freeze 同/异请求、错误归属、portal、排队与重入销毁 | FreezeOutcome/替换门禁 | 同请求原 lease；最后引用才解锁；入队至完成拒绝替换；通知内 dispose 回 abort/null；草稿/已接受 snapshot 不丢 | 上游契约 lane；代码审核员复验 |
| 8 | card 草稿修改 + complete | draft 状态 | validate 后一次 transaction + onChange，恢复 owner | 上游契约/原型 lane（父级审查）|
| 9 | drawing 草稿 cancel | draft 状态 | 零正文 transaction | 上游契约/原型 lane（父级审查）|
| 10 | 草稿 validation 失败 | draft 状态 | 保留 draft，不写入 | 上游契约/原型 lane（父级审查）|
| 11 | 草稿存在且 inflight A | save 终态 | blocked，不新增 write | 上游契约/原型 lane（父级审查）|
| 12 | A 输入 AA，B 中间输入 B；任意栏 undo/redo | A 共享模型/全局历史 | `ABA→AA→原正文`，redo 逆序恢复；不 stale overwrite；选区独立；允许撤另一栏最近事件；旧选择性断言单列历史不满足 | 上游+宿主 |
| 13 | pane 关闭重开、全部 detach 后重挂载 | 视图/共享 history | 会话栈保留，新 view 使用同一栈；survivor 实例/选区保留；Provider 新 load 后才清历史 | 上游+宿主 |
| 14 | 异步 reference/upload 跨 session | 命令落地 | 旧 session 失效；current mapping 后窄命令落地；不错误插入 | 上游契约/原型 lane（父级审查）|
| 15 | 真实 host bridge 闭环 close | 回执 | 真实写入完成早于成功回执；same-session 才放行 | 宿主 lane；父级验收 |
| 16 | 真实 Web 存储重开/刷新后导航状态 | 存储与状态 | 内容可读；导航门禁仍成立 | 宿主 lane；父级验收 |
| 17 | card 与 drawing 两种 pendingDraft 均未完成时 host 返回 | close 门禁 | 两种 draft 均返回 blocked；queue idle 前提下零 write；保留 draft/history/selection；无 auto commit/cancel | 上游契约/原型 lane（父级审查）；宿主 lane 复核 |

> 正式 Provider 类型块尚未实现/编译。原型 `378aba1` 已有 769 通过、1 个旧选择性撤销失败；浏览器 17 项通过、1 个旧契约失败，详见 notes 修复报告。它们不替代本矩阵的正式库与宿主证据；WebBase 四入口尚未执行。

---

## 7. 后续顺序与停止点

1. 本轮 A 契约与 `migration-execution-plan.md` 交评审；代码审核员已通过 freeze `378aba1` 两项 P2 的独立复验，不再将该复验列为待办。
2. 评审通过并获实现授权后，正式实现 3.1.0 的公共 Provider/View/Controller，覆盖完整 NodeView/reference、共享 history 与兼容入口。
3. 经授权的本地打包验证可先于公网发布；记录 commit、包内 version、tarball SHA-256、根导出/类型和测试，确认版本为精确 3.1.0。公开发布仍另需批准。
4. 任务 1.3 获得可消费包及三门禁正式上游证据，才启动任务 2.1 的宿主依赖切换；不能安装仅带版本号而无能力的包，不能把当前隔离分支直接当正式依赖。
5. 按 design/tasks 的依赖顺序实施，父级 owner 跑四项 Web 验收，三门禁证据齐才关闭。完整 20 项剩余任务与停止点见执行计划。

---

## 8. 正式实现仍待证明

- 新公共根导出、类型、React Provider 生命周期，以及保持旧 NoteEditor 兼容的实现。
- 共享 history 覆盖完整 NodeView、引用插入与异步失效的正确性；原型不是完整编辑器替代。
- 正式组件的 freeze 回归、真实 Web composition/IME 与宿主 finally/超时/导航生命周期；原型两项 P2 的独立复验已通过，不代表这些集成证据齐备。
- 长会话 mapping/history/tombstone 资源预算；不能以无依据回收记录改变契约。

上述是正式库/宿主实施的前置证据，现有原型不代表已经解决；选择性撤销已从当前范围移除，不再作为它们的额外前置条件。

---

## 9. 停止声明

- A 产品决定已生效，本轮规划可修改；正式实现、消费包及发布等计划评审后另开。
- 三项门禁**仍未关闭**，3.1.0 正式可消费包及真实宿主回归是明确前置依赖；原型 freeze 两项 P2 已闭环。
- 依赖仍为 2.0.0；四个 Web 入口**均未执行**。
- 任何越过第 0.2 节授权边界的动作都不被本文支持。
