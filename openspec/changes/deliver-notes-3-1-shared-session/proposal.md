# Proposal

## Why

HAM-36 的 WebBase 迁移依赖正式公共保存状态、草稿门禁与同文件双视图能力，3.0.0 的单编辑器公开接口不足以提供这些保证。已批准的 A 口径和 freeze 原型需要转化为真实库能力与可独立安装的 3.1.0 pack，原型审核不能替代正式验收。

## What Changes

- 新增包根 `NoteDocumentProvider`、`NoteEditorView`、`NoteDocumentController` 和契约类型，提供权威正文、metadata 快照、保存 barrier、草稿公开状态。
- 双视图共享全会话正文 undo/redo 栈，允许撤销另一栏最近事件；选区独立，pane 重开及全部 detach 保留栈。
- freeze 使用 session/request/lease 归属，同步入队建立替换门禁，处理通知内同步 dispose 的 abort/null 结果。
- 保留 3.0.0 根 runtime/type/CSS 入口及 `NoteSave` 签名和行为；新增 Provider 的 Promise<void> 保存契约不使用 CAS。兼容失败立即停止并重审 major。
- 目标版本精确 3.1.0，交付 pack、源码 commit、SHA-256、根 runtime/.d.ts 和干净副本消费证据。版本号与兼容性均为待实现目标。

## Capabilities

### New Capabilities

- `note-document-provider`: Provider/View/Controller 生命周期、A 共享历史、保存/metadata/草稿与请求归属 freeze 的正式契约。
- `package-consumption`: 3.0.0 兼容门禁、3.1.0 包身份与独立消费证据。

### Modified Capabilities

- `note-editor-core`: 将唯一编辑入口约束改为保留 NoteEditor 并新增 Provider/View；内部 schema/history 继续封闭。
- `host-integration`: 明确旧 NoteEditor 的 CAS、正文 dirty 和会话切换要求的作用域，新增 Provider 按独立契约运行。

## Impact

实施涉及 `src/lib/editor/`、`src/lib/hnn/extensions.ts` 的会话/NodeView/命令接入、`src/lib/index.ts`、公开 API 测试、demo 与打包配置。沿用已锁定的 Tiptap/ProseMirror，不引入选择性撤销算法。

本轮仅交规划文档。非目标：WebBase 改动、HAM-36 勾选、npm 发布、每 pane 选择性撤销、CAS/跨设备冲突、旧文件转换及原生验收。历史反例保留原断言并单列报告，不以原型作为正式证据。

输入来源：HAM-36 评论 `01a14a1a-b92d-7840-8a5e-271a085b71dc` 的 `upstream-api-contract.md`、`migration-execution-plan.md`；基线 `2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c`。本 change 是 HAM-39 的上游交付计划，不复制宿主的 20 项迁移任务。
