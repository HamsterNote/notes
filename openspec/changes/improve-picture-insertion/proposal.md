# Proposal

## Why

HAM-240 要求从文字左侧菜单进入可拖拽或点击选择图片的确认模态框；当前插图直接触发隐藏文件选择器，上传状态散落页尾，且图片只能按绝对 HTTP(S) 地址渲染。需要由组件库提供统一交互与路径解析契约，使 WebBase 能优雅接入真实数据目录图片。

## What Changes

- 左侧块菜单新增“下一行”悬停子菜单，将已有表格、公式入口移入，图片入口命名“图像”；“转换为”也改为悬停展开，保留完整键盘与触屏操作。
- “图像”打开模态框：点击选择或拖入图片、预览及错误提示、右上关闭、右下确认。选择阶段不上传，确认后走现有 headless 上传通道；失败可重试或取消。
- 按单文件 100 MiB（104,857,600 字节，提案假设）在模态框、粘贴/拖放及上传核心统一校验；暂保持 PNG/JPEG/WebP 支持。
- 对 picture.src 增加严格限定的托管相对路径，并公开宿主解析契约；渲染结果与持久路径分离，绝不把 blob URL、字节或上传临时态写入 HNN。
- 去除旧页尾保存/插图/导出组合行，把上传错误操作迁入模态框或局部反馈；当前每栏 ViewToolbar 的撤销、重做、保存与状态保留。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `note-content-blocks`: 新增“下一行”、悬停菜单、图像确认模态框及页尾控件迁移行为。
- `host-integration`: 扩展图片上传结果允许稳定托管路径，新增可中止的图片解析回调，保留上传幂等与临时态隔离。
- `note-document-format`: 增加仅用于 picture.src 的封闭托管路径形式及往返、安全约束，不放宽普通链接 URL 白名单。

## Impact

本仓库 `src/lib/editor/blockMenu.ts`、`src/lib/hnn/menuPopover.ts`、`src/lib/editor/pictureUpload.ts`、`NoteDocumentProvider.tsx`、`NoteEditor.tsx`、`documentSession.ts`、`documentTypes.ts`、`types.ts`、`src/lib/hnn/{urlPolicy,codec,extensions,markdown}.ts` 与公共导出、样式及相关测试。新增图片模态框组件和解析生命周期模块，具体归属见 design.md。

配套 WebBase 同名 change 负责 MD5、挂载文件写入/读取与依赖升级，库不访问真实文件系统。保留当前列表转换 change 与共享会话行为；WebBase 当前声明消费 3.2.0，而本 checkout package.json 为 3.1.3-ham133.3，源码与已发布包不能视作同一基线，后续必须校齐公开 API 并交付高于实际消费版本的兼容版本。

本轮不实现、不发布。后续仅做 Web 侧库检查、构建与浏览器验证；WebBase 验收遵守其 Web-only 约束。
