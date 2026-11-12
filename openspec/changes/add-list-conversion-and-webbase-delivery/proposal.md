# Proposal

## Why

HAM-237 要求用户能直接创建有序、无序和待办列表并互相转换，验证后发布 notes 并集成 WebBase。现有规格和 Tiptap schema 已包含三种列表及任务状态，但块转换菜单没有列表入口，互转范围、编号及完成状态处理缺少明确契约。

## What Changes

- 为三种列表提供统一创建与转换入口，支持光标及同层连续项选择、混合嵌套、缩进/反缩进、换行和退出列表。
- 明确六个方向的互转：只转换目标层选中项，保留子列表类型和层级；普通项变待办默认未完成，待办变普通项移除完成状态，撤销可恢复；新建有序段从 1 开始，保留未转换段的原编号。
- 明确待办状态以 HNN v1 `taskItem.attrs.checked` 布尔值存储，支持保存重开、共享视图和历史；Markdown 简单列表走 GFM，复杂列表沿用既有无损围栏/诊断机制。
- 先完成 notes 库和打包消费验证，再通过既有 tag 发布流程发布 npm 包；WebBase 升级 `webview/package.json` 精确版本及 `webview/pnpm-lock.yaml`，继续通过公开组件与样式消费。
- 分三个里程碑：M1 列表编辑与持久化闭环；M2 可消费的 notes 正式 npm 版本；M3 WebBase Web 场景集成验收。
- 范围外：提醒、截止日期、任务汇总、多用户协作、旧格式迁移、自定义编号配置 UI、列表项拖拽重构及其他笔记工具能力。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `note-content-blocks`: 补充创建、互转、嵌套、编号、完成状态及交互边界。
- `note-document-format`: 补充三类列表和勾选状态的严格 HNN 存储契约。
- `markdown-codec`: 补充列表及待办状态的显式导入导出契约。
- `host-integration`: 补充 npm 发布交付与 WebBase 消费、保存重开验收契约。

## Impact

notes 主要涉及 `src/lib/editor/blockMenu.ts`、`NoteEditor.tsx`、`interactionToolbar.ts`、列表命令、`src/lib/hnn/{extensions,codec,markdown}.ts`、样式及对应测试；复用已有 `@tiptap/extension-list`，不新增任务数据模型或公开私有编辑器 API。当前 schema 已支持此数据，预计保持 HNN v1。

WebBase 涉及 `webview` npm 依赖、锁文件和 `HnnDocumentSession` / HNN 保存读取链路的回归。主 .hnn 文件的宿主外壳保持不变，正文仍放在 `notes` 字段。

已观察到 notes checkout 及 `v3.2.0` tag 的 package.json 均为 `3.1.3-ham133.3`；现有发布脚本会从 tag 重写版本，WebBase 实际锁定 `3.2.0`。开发交接以当前源码 `53f82c8` 和发布 tag `v3.2.0`（`6c923ec`）为追溯基线，M2 再核对 npm 包身份及宿主公开 API，选择未占用且高于 3.2.0 的新正式版本，不能仅凭仓库 package.json 判断发布版本。

开发时验收为 Web-only。WebBase 只使用类型检查、单元测试、Web 构建、浏览器 E2E（`pnpm typecheck`、`pnpm test:run`、`pnpm build:web`、`pnpm test:e2e:web`）；notes 使用对应 yarn 检查及浏览器验证。Android/iOS、Maestro、native/EAS build、模拟器与真机不作为开发完成判据；既有原生发布路径保留，仅适用于发布、专项原生验证或用户明确请求，native 成败不阻塞开发完成。

本提案中的范围、转换策略和里程碑为产品建议，尚未经用户逐项确认；本轮仅生成文档，不实现、不发布、不集成。
