# Proposal

## Why

HAM-124 要求改善 notes 的移动端块编辑体验：隐藏占用正文空间的 handle 后，仍需能长按排序并就地访问块操作；非移动端选中文字后也应能直接设置基本格式。

## What Changes

- 移动布局隐藏正文左侧 handle 和 hover gutter，支持直接长按顶层内容块排序，保留滚动、取消及单步撤销语义。
- 移动布局聚焦内容块时，在块下方显示横向文字操作 popover，平铺转换、插入及加粗/斜体/下划线按钮，并保留既有上移/下移入口。
- 非移动布局出现非空文本选区时显示横向选区 popover，仅提供加粗、斜体、下划线。
- 两类 popover 暂用中文文字按钮，不制作或替换为 icon；补齐现有 schema 显式禁用的下划线能力及无损 HNN 保存。
- 沿用 840 CSS px 紧凑断点并明确边界，长按沿用 500ms/10px，激活给出视觉反馈，震动仅作可用时的增强。具体判定和交互取值为本提案建议，并非用户逐项确认。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `note-editor-core`: 增加移动布局判定、隐藏 handle、聚焦块下方横向 popover 及文字按钮约束。
- `note-content-blocks`: 修改重排要求以支持移动端正文长按；明确加粗、斜体、下划线的编辑与持久化。
- `note-selection-and-clipboard`: 增加非移动端原生文本选区格式 popover，保持选区与格式命令归属。

## Impact

目标仓库为 `HamsterNote/notes`，不是 `native-notes`；WebBase 仅是消费者，本 change 不修改宿主或更新依赖。涉及 `src/lib/editor/blockReorder.ts`、`blockMenu.ts`、`session.ts`、`documentSession.ts`、编辑器视图、`src/lib/hnn/menuPopover.ts`、`extensions.ts`、Markdown 格式保真判断和 `src/lib/styles.css`，以及对应测试和 `DESIGN.md`。不新增公共扩展注入 API，不升级 HNN 外壳版本；旧版 notes 消费者无法读取新下划线 mark，升级前需知晓这一兼容限制。

仅规划 issue 五项，不扩展块类型、嵌套拖动、多选拖动、自动滚屏、新格式工具、原生模块或发布流程。复用已有预算事务、共享 history、图片上传及封闭 schema。开发验证拟采用类型检查、单元/组件测试、Web 构建及浏览器交互验证；本轮仅校验 OpenSpec 文档，不执行实现或产品测试。
