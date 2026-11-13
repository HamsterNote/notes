# Proposal

## Why

HAM-237 的三类列表基础能力已在 M1 合入 main；本次在同一 change 补充用户试用后的三项优化：有序列表层级编号循环、引用快捷输入和选区链接配置。补齐这些编辑细节后再进入 npm 发布及 WebBase 集成。

## What Changes

- 为三种列表提供统一创建与转换入口，支持光标及同层连续项选择、混合嵌套、缩进/反缩进、换行和退出列表。
- 明确六个方向的互转：只转换目标层选中项，保留子列表类型和层级；普通项变待办默认未完成，待办变普通项移除完成状态，撤销可恢复；新建有序段的整数序号从 1 开始，保留未转换段的原序号。
- 自动编号按列表嵌套深度循环十进制、小写字母、小写罗马数字；明确 start/继续编号、字母超过 26 项、与 5/1/7 拆段共存及 Markdown 语义优先策略。保留已有显式 type 编号，自动模式使用既有 type=null，不迁移 HNN。
- 在普通段落开头输入 `> ` 后转为既有 blockquote；沿用 HNN v1、署名和 Markdown 引用路径，不新增节点类型。
- 为同一文本块的文字选区增加链接配置层，默认选中文字为可修改标题；支持已有链接编辑/移除、取消、URL 白名单及 HNN/Markdown 往返，持久化为文字与 link mark。
- 明确待办状态以 HNN v1 `taskItem.attrs.checked` 布尔值存储，支持保存重开、共享视图和历史；Markdown 简单列表走 GFM，复杂列表沿用既有无损围栏/诊断机制。
- 先完成 notes 库和打包消费验证，再通过既有 tag 发布流程发布 npm 包；WebBase 升级 `webview/package.json` 精确版本及 `webview/pnpm-lock.yaml`，继续通过公开组件与样式消费。
- 分三个里程碑：M1 列表编辑与持久化闭环（基础项已交付，新增 1.11–1.16 待实现）；M2 可消费的 notes 正式 npm 版本；M3 WebBase Web 场景集成验收。新增项须在 M2 前完成验证，发布仍沿用已有的人类确认版本流程，本提案不代表发布授权。
- 范围外：提醒、截止日期、任务汇总、多用户协作、旧格式迁移、自定义编号配置 UI、列表项拖拽重构及其他笔记工具能力。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `note-content-blocks`: 列表互转、层级编号、引用快捷输入、链接配置与交互边界。
- `note-document-format`: 列表、引用、链接沿用 HNN v1 的持久化与派生显示契约。
- `markdown-codec`: 列表编号、待办、引用和链接导入导出及无损边界。
- `host-integration`: npm 交付与 WebBase 对新增三项能力的保存重开验收。

## Impact

notes 主要涉及 `src/lib/editor/blockMenu.ts`、`NoteEditor.tsx`、`interactionToolbar.ts`、列表命令、`src/lib/hnn/{extensions,codec,markdown}.ts`、样式及对应测试；复用已有 `@tiptap/extension-list`，不新增任务数据模型或公开私有编辑器 API。当前 schema 已支持此数据，预计保持 HNN v1。

WebBase 涉及 `webview` npm 依赖、锁文件和 `HnnDocumentSession` / HNN 保存读取链路的回归。主 .hnn 文件的宿主外壳保持不变，正文仍放在 `notes` 字段。

已观察到 notes checkout 及 `v3.2.0` tag 的 package.json 均为 `3.1.3-ham133.3`；现有发布脚本会从 tag 重写版本，WebBase 实际锁定 `3.2.0`。当前开发基线为 M1 已合入的 `5237b9b`，原提案基线 `53f82c8` 和发布 tag `v3.2.0`（`6c923ec`）保留用于追溯；M2 再核对 npm 包身份及宿主公开 API，选择未占用且高于 3.2.0 的新正式版本，不能仅凭仓库 package.json 判断发布版本。

开发时验收为 Web-only。WebBase 只使用类型检查、单元测试、Web 构建、浏览器 E2E（`pnpm typecheck`、`pnpm test:run`、`pnpm build:web`、`pnpm test:e2e:web`）；notes 使用对应 yarn 检查及浏览器验证。Android/iOS、Maestro、native/EAS build、模拟器与真机不作为开发完成判据；既有原生发布路径保留，仅适用于发布、专项原生验证或用户明确请求，native 成败不阻塞开发完成。

本次基于 main `5237b9b` 增量更新文档；保留已完成 M1 1.1–1.10 的记录，新增策略的细节为本次产品设计决策。仅生成并提交规划文档，不实现、不发布、不集成；画笔 timestamp 既有问题不在本次范围。
