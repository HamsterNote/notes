# Tasks

以下为后续实现任务，本轮不执行。先对齐公开格式和解析契约，再完成菜单模态与消费包；与 WebBase 同名 change 共同验收真实存储及重开显示。只使用 Web 侧库检查、构建及浏览器验证。

## 1. 图片引用与公共解析契约

- [x] 1.1 在 `hnn/urlPolicy.ts` / `codec.ts` 增加 picture 专属封闭路径判定，接 `pictureUpload.ts` 上传结果；单元测试覆盖合法 MD5 三类后缀往返、旧 HTTP(S)、非法路径/协议/普通 link 相对路径拒绝，以及 HNN 512 KiB/alt/nodeId 原限制不变。
- [x] 1.2 在 `editor/types.ts`、`documentTypes.ts`、公共 `index.ts` 定义及导出 onPictureResolve 与结果释放类型，在 `documentSession.ts` / `session.ts` 传递更新；公共类型消费测试验证旧宿主 props 兼容、Provider/独立编辑器均可用，回调变化不重建会话。
- [x] 1.3 新增 `editor/pictureResolution.ts` 并接 `hnn/extensions.ts` picture NodeView，维护请求令牌/abort/占位/重试/dispose；单元和组件测试覆盖成功、缺能力、文件缺失、src/节点/会话替换、迟到释放、危险运行时 URL 拒绝，断言正文、dirty、history 不变。
- [x] 1.4 在 `hnn/markdown.ts`、clipboard 图片分支统一引用规则；往返测试验证托管路径与 alt 可保留、无法表达时走已有无损机制、导出不嵌入 blob/字节，其他 link 与旧图片行为不退化。

## 2. 悬停菜单与稳定插入目标

- [x] 2.1 在 `hnn/menuPopover.ts` 增加非 toggle 的悬停子菜单打开、联合区域退出延时与销毁清理；菜单单元测试覆盖父子跨区、换父项、重复进入、外部关闭及键盘/触屏原行为，确认层级和回焦正确。
- [x] 2.2 在 `editor/blockMenu.ts` 将表格/公式/图片归入下一行并以图像请求打开对话框，保留转换、列表与移动项目；块菜单测试验证结构、已有命令仍可撤销、只读/freeze/IME 禁用和能力缺失理由。
- [x] 2.3 在会话及视图交互层维护唯一图像对话框、session/view/nodeId 锚点和离开门禁；共享视图测试验证打开后移动目标跟随身份、删除目标拒绝、切换会话/卸载取消、第二个对话框及并行草稿受控，自己的上传提交不会被草稿锁死。

## 3. 确认模态与反馈迁移

- [x] 3.1 新增 `editor/PictureUploadDialog.tsx` 与样式，实现一次一张的点击/拖拽选择、预览、右上关闭和右下确认，空选/错误禁用；组件测试验证选择零上传/零 dirty、确认一次入队、重选释放预览、Esc/关闭取消、遮罩不关闭、焦点陷阱及退出回焦。
- [x] 3.2 在 `pictureUpload.ts`、`documentSession.ts` / `session.ts` 接统一真实格式及 104,857,600 字节上限，覆盖 picker/paste/drop/retry；核心测试验证恰等阈值接受、超 1 字节/伪扩展名拒绝且不调用宿主、失败 retry 保持 uploadId，成功仍为独立预算事务与共享撤销事件。
- [x] 3.3 将失败/在途反馈接入对话框与局部恢复控件，移除 `NoteEditor.tsx` 旧页尾保存/插图/导出组合和 Provider 常驻上传 picker，保留每栏 ViewToolbar 和公开 API；组件测试覆盖 paste/drop 失败仍可取消、模态失败保留选择、关闭在途无迟到插图、每栏保存/历史功能保持。
- [x] 3.4 为图像模态添加浏览器验证场景，覆盖明暗主题、320px pane、鼠标悬停、触屏、键盘、双视图目标变化及撤销重做，记录可访问性和未遮挡正文证据。

## 4. 兼容包与跨仓库交接

- [x] 4.1 对齐 WebBase 实际消费 3.2.0、当前源码 3.1.3-ham133.3 和列表交付 change 的公共 API 基线，提交版本/源码对照记录；通过公共类型消费 fixture 证明不遗漏当前宿主接口、不用降级替换新功能。
- [x] 4.2 执行库现有 `yarn typecheck`、`yarn test`、`yarn build` 及上项浏览器验证，保存结果；独立打包消费 fixture 验证 ESM/CJS/types/样式、新路径和旧 URL、Provider/独立编辑器均可使用，类型及运行不依赖私有源码。
- [ ] 4.3 在后续获得发布授权并交付可消费版本后记录源码 revision、版本和包完整性，向 WebBase 同名 change 提供接口/包证据；最终以 WebBase 的真实数据目录文件、MD5 去重、无旧缓存重开和 Web-only 验收结果确认闭环，不能以 mock 上传替代真实写入。
