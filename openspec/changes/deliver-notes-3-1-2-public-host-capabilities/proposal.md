# Proposal

## Why

HAM-36 在正式 notes 3.1.1 上确认两个阻塞：Reader 高亮删除后，已缓存引用仍显示 resolved；公共 Provider 未暴露图片上传回调，无法验证成功、失败、迟到与取消。本次以加法式 3.1.2 补齐公开能力，供 HAM-36 升级后复验。

## What Changes

- 新增 Controller 显式引用失效入口，覆盖 `{kind, resourceId}` 单候选及当前文档全部引用；使用最新 resolver 重解析，保留 session、正文、history、选区和保存基线。普通 rerender 不自动重复拉取。
- Provider 新增可选 `onPictureUpload`，复用已公开 `PictureUploadHandler`；正式 View 接通 picker/paste/drop、失败重试/取消、陈旧结果隔离，并明确 freeze、卸载及多视图的行为。
- 保持 3.1.1 根 runtime、类型、CSS 与既有行为；交付精确 3.1.2 包、源提交/hash、干净安装与真实浏览器证据。合并和发布已有 issue 授权，执行留给 apply 阶段。
- 不修改 WebBase 或 HAM-36 tasks，不改变共享撤销 A / freeze lease，不引入 remount、正文改写、私有导入、包 patch 或每次 render 拉取；不做无关重构。

## Capabilities

### New Capabilities

- `package-consumption`：3.1.2 对 3.1.1 的兼容硬门禁、精确包身份与独立消费验收。沿用未归档 `deliver-notes-3-1-shared-session` 的同名能力路径，新增版本专属要求；不改该 change 或其历史发布授权。

### Modified Capabilities

- `host-integration`：增加保留会话/history 的公开引用失效，以及公共 Provider 图片上传的完整契约；既有 NoteEditor 的 CAS 保存与上传签名保留。

## Impact

目标仓库为 `HamsterNote/notes`，源码基线为 `v3.1.1` / `e40ee77`。涉及 `src/lib/editor/{documentTypes,documentSession,NoteDocumentProvider,hostReferences,pictureUpload}.ts(x)`、包根导出、契约/组件测试及浏览器验证脚本。无需新增运行时依赖或 HNN 格式变化。

`v3.1.1` 源码 package.json 仍为 3.1.0：`scripts/prepare-release.mjs` 在发布时按 tag 注入版本；不得误用源码字段否定发布身份，也不得把未经注入的 pack 当成 3.1.2。旧 change 的 Provider 保存语义是唯一写队列，不将主规格中旧 NoteEditor 的 CAS 契约套到 Provider。
