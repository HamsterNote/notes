# Design

## Context

动机见 proposal。实际基线为 notes `2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c`，package.version=3.0.0，React 19、Tiptap/PM 3.31.3，Yarn 1。`src/lib/editor/session.ts` 的 EditorSession 持有一个 Tiptap Editor、单正文 baseline、revision 和 pending save；`NoteEditor.tsx` 将会话与 EditorContent、控件和引用 installer 绑定。新 Provider 尚不存在。

现有 `src/lib/index.ts` 有八个 runtime 导出，公开类型测试枚举允许的根导出，且私有 schema/session 不可暴露。`vite.config.ts` 从此处生成 ESM/CJS 和 d.ts，package exports 还包含 styles.css/formula.css。新入口需要增量扩展允许列表，同时保留 3.0.0 快照用于兼容比对；不能把 2.x 的 legacy inventory 误用为 3.0.0 基线。

已读取主规格 note-editor-core、host-integration。唯一入口约束与无 CAS Provider 存在规格差异，本 change 显式给出 delta；已有旧接口 CAS 要求继续有效。HAM-36 附件契约/执行计划是本次行为来源，原型提交 824ac34/9a7d73a/378aba1/5b55650 仅是参考，不在当前正式基线。后续通过 Multica 附件获取原样反例和修复测试，不能假定未推送对象可 fetch。

## Goals / Non-Goals

**Goals:** 将多视图权威状态、双 baseline 保存、草稿与 lease 设计成可测试的库内边界；公开接口只传 HNN/JSON/身份/判别结果。保留旧编辑器行为，通过完整正式控件和干净消费确认新增能力。

**Non-Goals:** 不将旧 EditorSession 的 CAS 路径改造成新协议，不暴露 PM 对象，不恢复已删除的 2.x API，不新增持久化 producer。库不承担真实 WebBase 导航与存储集成，不在本任务发布 npm。

## Decisions

### 1. 新会话协调器与兼容入口并存

在 `src/lib/editor/` 新增内部文档会话协调器、React Provider、View 与公共 types。复用 codec、schema/extensions、控件和 NodeView 能力，按需拆分原 NoteEditor 内部装配边界。保留旧 NoteEditor/EditorSession 的保存协议，不能全局替换 NoteSave。直接导出 PrototypeSession 会缺少完整 NodeView 与生命周期，故不采用；复制整个旧 UI 将造成行为分叉，优先抽取内部共用装配而不改旧公共 props。

Provider props 与 Controller surface 按 HAM-36 附件第 2 节实现，包括全部 SaveReason/SaveTerminal/FreezeOutcome、HostMetadataSnapshot、PublicDraftState 及结果类型。实施时将已评审类型规范固化为公开类型与根入口消费断言；不得把草案未编译代码当作已实现声明。controller 绑定 Provider 实例；dispose 后保持终结，不能转指向新 Provider。subscribe 的快照不得被调用方突变。

### 2. 一个权威正文与 history，各 View 独立 UI 状态

沿用已有 PM history，不自写撤销引擎。内部权威状态持有 doc/history；各 view 持有独立 selection/focus/stored marks，dispatch 统一进入 router，使用 transaction 的来源版本与映射验证。合法 transaction 在 current doc 上原子应用，广播 doc 与映射后的选区；无法安全映射则拒绝并重同步，不接受旧全量 doc 覆盖。

将来源 view 切换标记为 history 分组边界；同 view 连续输入保持 PM 分组。所有键盘/toolbar undo 都路由至权威 history，执行 view 恢复历史 bookmark，peer 映射选区且不抢焦点。view detach 只销毁呈现/本地句柄，不销毁 Provider 的权威状态和历史；viewId 重用须有新实例令牌，防止迟到引用操作落入重建 view。每次正文提交在协调器编码并单次通知 onChange。

独立双 Editor 互灌全量 HNN 会失去正确选区/history，单 EditorContent 迁移 DOM 则无法提供双可编辑视图，均不采用。全部节点和插件必须接入真实 View，不能只验证简单文本。

### 3. 双 baseline 与串行 drain

正文使用不可变 doc baseline；metadata 在接收时校验并深拷贝。changeId 必须安全整数/递增，同 id 同值 unchanged，同 id 异值或倒退 failure。dirty 分别比较 body 与 host。唯一 600ms timer 只 requestSave，不直接持久化；按钮和宿主命令走同一 preflight/barrier。

队列最大写并发 1，捕获 document/metadata/identity/operationId/reason/signal 后 await adapter；成功只推进捕获基线，再 preflight 并 drain latest，重复请求共享 completion。encoding-error/draft 优先阻塞，包括旧写 A 完成后发生的错误；failure 停止自动重试并保留最新 dirty。终态发布前重新核验会话、生命周期与当前 dirty。新协议不提供 CAS，不对远端已经写入作撤销保证。

### 4. 同步登记门禁与 lease 队列

setInputFrozen 调用入口同步复制参数并登记 acquire 计数，异步串行队列只处理线性化操作。每个 acquire 在自己的 finally 减计数，dispose 不粗暴重置 pending 计数。替换门禁独立于 inputFrozen，检查 dirty/draft/save/pendingAcquire/activeLeases；最后 release 的通知阶段仍看到其他 queued acquire 登记。

按 `(sessionId,requestId)` 保存 lease 和 request-ended tombstone，release 要求三元组匹配；失败不消费 requestId，不使用 TTL。先提交/确认 DOM composition 与 pending edit，再发 lease；冻结检查位于所有输入和窄命令的统一入口，包含 toolbar/portal/metadata。保存从不释放 lease。结果发布经过订阅通知后再次检查 disposed；已销毁统一 abort/disposed + identity:null，不能泄露旧成功 lease。queued 操作也终结，不复活状态。

真实 IME 不能仅靠合成 composition 推断，正式浏览器交互和实体 IME 证据单列；无法验证时明确保留验收缺口，不算通过。

### 5. 草稿与完整节点接入

草稿状态属于 Provider，payload/bookmark/focus/history 私有；card/drawing 完成按钮验证成功后一次正文 transaction，取消零 transaction。草稿打开 modal 锁两侧正文与 undo，portal 保持编辑；lease 叠加锁全部入口。canDetachView 阻塞 owner，其余 detach 不清理 survivor。保存/load/close 不触发自动完成/取消。

复用实际 `hnn/extensions.ts`、`HnnDataDrawer.tsx`、`HostReferenceUI.tsx`、`hostReferences.ts`、`pictureUpload.ts`、block menu/reorder/clipboard 装配，并逐条接到 router/lease gate。Provider 统一配置 reference 回调；异步结果必须校验 session/view 实例/op/bookmark，再映射窄插入。旧入口上传继续兼容；不新增 WebBase 上传功能。

### 6. 验证集合与包交付

当前 package scripts 实际提供 `yarn test`、`yarn typecheck`、`yarn build:lib`、`yarn build`、`yarn lint`。正式测试集合必须全绿；基线不含 prototype。历史选择性撤销探针保留在明确隔离的研究证据集合并正常运行，不改断言/skip/xfail；完整报告如实列其非零退出及原因，不将历史集合混作正式全绿。

优先使用现有测试/演示环境扩展真实 Provider 组件和双视图页面；浏览器与实体 IME 的执行方式实施时按实际可用工具记录，不虚构不存在的 e2e script。原始 review-boundaries/freeze-lifecycle 测试另行保留并适配正式入口增加覆盖，不将原型通过挪作正式通过。

build 后本地 pack（按 Yarn 实际命令支持使用 `yarn pack --filename <path>`），检查 ESM/CJS/types/CSS 和所有 files；在仓库外干净临时消费项目仅安装 pack、声明依赖及消费构建工具，禁止 aliases/private imports。检查两种根 runtime、旧签名和新 Provider 保存/双视图，做类型和构建验证。记录源码完整 commit、package version、tarball SHA-256、包文件清单、平台/工具版本、命令和原始日志；证据报告后续提交与 pack 的 source commit 分开标明，避免自引用 commit/hash。

## Risks / Trade-offs

- 多视图插件原本绑定一个 Tiptap Editor，复用不当可能复制历史或重复 onChange → 正式组件覆盖全部 NodeView、控件、引用、选区与异步失效；不能以文本 demo 收口。
- 通知重入与 React 清理可能让成功回执泄露旧 lease → 提交/通知后生命周期复核，逐字保留原始 P2 反例并增加正式组件测试。
- 长会话 mapping/history/tombstone 占用增长 → 报告操作量/保留项/内存或可解释计数的资源预算；仅可安全压缩已无引用 mapping，禁止擅自回收 tombstone 改变重放语义。
- 独立消费需完整 CSS/fonts 和包内类型 → 以真实 tarball 安装为验收，不以源码测试替代。
- 旧历史探针有预期的已知失败 → 报告正式集合与历史集合各自退出码，未知失败一律阻塞交付。

## Migration Plan

1. 本轮仅提交 change 文档，所有实现任务未勾选。
2. 后续实施从本分支和 3.0.0 基线进入 apply，先固定旧入口兼容回归，再逐项实现与验证。
3. 将 package.version 调整为 3.1.0 并 pack 仅发生于实现阶段。兼容失败立即停止并重审 major，不能默改版本规避。
4. 上游交付 pack、安装说明和证据后，由 HAM-36 负责人独立判断依赖切换；本 change 不修改宿主。回退只保留已知可消费的 3.0.0，不能声称旧包满足新契约，也不转换已保存文件或自动迁移依赖。

## Open Questions

无待用户确认的产品问题。合理假设：草稿采用附件第 4 节建议的双正文 modal 锁，freeze 叠加锁 portal；本 change 将其明确写为验收行为。资源预算数值与实体 IME 的实际设备/浏览器记录由实施测量提供，不推断为已通过。
