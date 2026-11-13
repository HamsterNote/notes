# Design

## Context

动机见 proposal.md。基线为 `5237b9bd59ef768015c1310199dd4a23776297ab`，配套 WebBase 基线为 `3c303712e3028542126e16405a627a99717d8bd9`。静态定位发现：`blockMenu.ts` 的插入图片直接建 hidden input 并调用 enqueue；`hnn/menuPopover.ts` openChild 目前由 click/键盘展开；`pictureUpload.ts` 已有 decoration、attempt、abort、事务映射与历史隔离，可继续复用。`NoteEditor.tsx` 旧壳渲染页尾保存/插图/导出组合，Provider 另挂 PictureUploadControls 和每栏 ViewToolbar。

图片校验链为 `pictureUpload.ts` → `isSafeHnnUrl` → `codec.ts` picture attrs → `extensions.ts` 的 HTTP(S) NodeView；因此上传回调即使返回有效文件路径也无法直接显示。WebBase 已接回调，但目前 10 MiB、同源 SW/IDB、默认关闭远端写及 SHA-256 JSON 存储与本需求不符。跨仓库完整证据表见 WebBase 同名 design.md。本轮未运行失败复现，不将环境条件误称为唯一故障根因。

配置为 spec-driven，采用 CLI 1.13.1 与运行时随附 propose 技能，未检出仓库自带 propose 文件。现有 `add-list-conversion-and-webbase-delivery` 已改转换菜单并尚有版本交付任务；本提案沿用其列表能力，不重复设计转换或宣称已发布。

## Goals / Non-Goals

**Goals:** 让菜单、模态框、上传核心和 NodeView 形成一个可取消、可验证、可共享历史的组件协议；真实存储完全由宿主负责。

**Non-Goals:** 库内 MD5/文件写入、编辑图片、文档文件拖入打开、任意路径访问、提升 HNN 512 KiB 外壳限额或修改 schemaVersion。只新增封闭的 picture 引用形式，不放宽链接 URL。

## Decisions

### 1. 菜单结构与定位

`src/lib/editor/blockMenu.ts` 维护唯一菜单：移动与列表缩进条目不变；“转换为”保留当前所有转换项；“下一行”包含“表格 / 公式 / 图像”，复用现有 insertItems 的单事务命令。避免在 WebBase 包装菜单或复制转换逻辑。`hnn/menuPopover.ts` 增加可重复调用而不 toggle 的子菜单打开行为：鼠标悬停即展开（建议延迟 120 ms），离开父项/子菜单联合区域后延迟 180 ms 关闭，进入子菜单清除关闭计时；切换另一父项关闭旧层。键盘 Enter/Space/ArrowRight、Esc/ArrowLeft、Home/End/方向键继续可用，触屏点击展开。所有计时在关闭/销毁时清理。

模态框目标记录为 view/session 标识与锚点 nodeId，确认时重新解析该块当前末尾；菜单打开后块移动可跟随正确身份，块被删或替换则拒绝确认，不能只记旧 pos。共享会话同一时间最多一个图像模态框，避免另一个视图重复起传；其他视图焦点不被抢走。

### 2. 选择与确认分离

新增 `src/lib/editor/PictureUploadDialog.tsx`，由 Provider/View 的视图交互层承载，菜单 capability 改为请求打开图像对话框；不让 headless 插件依赖 React。默认一次选择一张（提案假设）；原粘贴与编辑器外部拖放可以保持多图通道。

选择或拖入只保留 File 与预览 blob URL，不调用宿主、不改正文、不变 dirty。显示选中文件、预览与限额/类型错误；空文件、非图、超过限额不能确认；错误文件可重新选择。右上有可访问关闭按钮、右下确认，空选/无效/在途时确认禁用。确认才 enqueue，避免“先上传再点确认”的伪确认。成功插入后关闭；失败留在对话框并显示重试、取消，重试保持 uploadId。关闭/Esc 取消本次上传并保留原正文；遮罩点击不关闭以免误丢选择。焦点陷阱、dialog 标签、打开初始焦点和退出回焦齐全，320px 分栏及明暗主题可用。

不直接复用卡片/画板的 draft 锁来阻塞 canCommit：图像对话框拥有独立会话交互状态，使其上传完成事务可以通过当前权威 dispatch。等待确认期间禁止新建第二个编辑草稿及取得离开 freeze lease；关闭/失败/成功均按当前会话解锁，不建立新文档或独立 history。

### 3. 核心和 UI 共用校验与生命周期

在 `pictureUpload.ts`、`documentSession.ts` 和兼容 `session.ts` 接通统一单文件限额 104,857,600 字节，所有 picker/paste/drop/retry 都复核，宿主亦复核。100M 按 100 MiB 理解，格式暂保留 PNG/JPEG/WebP，校验真实类型；恰等于上限允许，超过 1 字节拒绝。大型预览 URL 在换文件、关闭及卸载释放。

成功继续使用现有 decoration 映射、预算化事务与共享 dispatch，单次撤销只撤本次插图。上传中的锚点被删除、session/loadKey 替换或 view detach 时 abort 并丢弃迟到结果；同文档另一 view 的编辑由既有事务映射定位，不能插到别的块。readOnly、freeze、IME 和 HNN 预算失败零正文变更。已有插件状态不可随着移除页尾控件变得不可取消：对话框/局部上传反馈接管 retry/cancel。

### 4. 持久引用与公开解析

在 `hnn/urlPolicy.ts` 新增 picture 专属判定：允许原安全 HTTP(S)，或精确匹配 `^hamster_note_data/images/[a-f0-9]{32}\.(png|jpg|webp)$`。该路径不是通用链接 URL；不接收前导斜杠、点段、反斜杠、百分号编码、查询、片段、scheme 或任意文件目录。codec、上传结果、clipboard 与 Markdown picture 分支使用一致规则；普通 link 保留原协议白名单。HNN 外壳、nodeId、alt 和预算上限不变。Markdown 的单独图片可保留该路径，必要时走已有无损围栏而非丢失；导出不会自动搬运图片文件。

公开 `onPictureResolve(src, { signal, documentId, loadKey }): Promise<{ url: string; dispose?: () => void }>`，在 `types.ts` / `documentTypes.ts` 定义并从公共根导出。Provider 与兼容独立编辑器均传递；路径引用必须有 resolver，普通外链未提供 resolver 时继续直显，提供 resolver 时可处理旧托管 URL。宿主结果只接受 HTTP(S)/blob 运行时地址；库创建的临时预览也不进入 HNN。解析和存储分开，不让 NodeView 或 codec 访问文件系统。

`hnn/extensions.ts` 的 picture NodeView 经独立 `editor/pictureResolution.ts` 适配生命周期：按源引用、session 与 nodeId 请求，取消旧请求；加载/缺图/失败均可观察且允许重试；只有当前请求结果可更新 img；结果替换、节点销毁、卸载时调用一次 dispose，迟到结果也立即释放。异步 DOM 更新由 NodeView 自己完成，不产生正文事务或 dirty，更不要求宿主 querySelectorAll('img')。回调新增/移除可原地更新，不能重建 session/history。

WebBase 配套服务负责当前挂载文件创建、MD5、去重、字节校验、旧图兼容和 URL 释放；本仓库只规定消费契约。返回路径的宿主必须确保真实存储成功，不能仅把 File 放缓存后宣称成功。

### 5. 旧页尾及包交付

`NoteEditor.tsx` 去除旧 hn-editor-controls 中截图对应组合行；保留其公开保存/导出 API。`NoteDocumentProvider.tsx` 去掉常驻 PictureUploadControls 的 picker，由模态框/局部反馈承接，保留 ViewToolbar。更新 styles.css，删无引用样式，不用 CSS 遮住仍有交互的 DOM。

本地源码 package 为 3.1.3-ham133.3，而 WebBase 声明消费 3.2.0。后续先核对 3.2.0 的公开 API 与列表 change 交付基线，再实现并交付兼容新版本，不预先指定未存在的版本或擅自降级。宿主通过正式可消费包接入，禁止私有源码/打包产物补丁。发布是后续独立授权阶段，本轮不执行。

## Risks / Trade-offs

- [允许新路径后旧读者不识别] → 新路径需匹配新版消费者，回滚不自动用旧编辑器覆盖；旧 HTTP(S) 保持兼容。
- [100 MiB 图片解码大] → 选择阶段只生成必要预览、一次一图，不复制 File 内容；释放 URL，原始字节仍由宿主分块处理。
- [模态状态与共享 freeze 死锁] → 明确图像交互状态与 canCommit 边界，使用同一权威 dispatch 并测试确认/取消/离开。
- [旧 UI 移除丢失失败恢复] → 每种上传来源都有可访问失败项及 retry/cancel，不能依赖已删除的页尾。

## Migration Plan

先实现路径校验/公开协议，再接菜单模态和 NodeView，保留旧 HTTP(S) 文档及既有 Provider API 回归。完成独立打包消费验证后供 WebBase 更新。按 WebBase 配套提案验收真实写入、去重、重开；库 mock 上传通过不等于跨库闭环通过。回滚只关闭新入口，不降级改写新路径文档。

## Open Questions

无阻塞问题。100 MiB、一次一图、PNG/JPEG/WebP 为提案假设，评审可调整；最终兼容包版本需后续按当前实际发布状态选择。
