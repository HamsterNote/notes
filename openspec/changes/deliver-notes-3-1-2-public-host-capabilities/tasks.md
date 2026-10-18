# Tasks

本表仅供后续 apply 使用，propose 交付时全部未执行。基线 `v3.1.1` / `e40ee779bf36b7f5c9f5d5fd10b622c66febbeb6`。不得修改 WebBase 或 HAM-36 tasks。

## 1. 公共契约与兼容基线

- [x] 1.1 固定 3.1.1 包根导出、CSS、旧 NoteEditor/NoteSave、Provider/Controller 的类型及 runtime 消费 fixture；记录 registry 版本/源 tag，验证未改依赖的新 fixture 在 3.1.1 通过。
- [x] 1.2 在 documentTypes/index 增加失效 scope/result 类型、兼容旧结构 mock 的可选 Controller 方法声明及 Provider 可选 onPictureUpload；根类型测试验证新调用、旧结构赋值、旧判别联合 exhaustive switch 和禁止私有句柄全部成立。

## 2. 引用失效

- [x] 2.1 扩展 hostReferences 内部 installer 的候选级/全部失效，沿用 kind/id 校验、abort/token 及状态通知；测试覆盖 resolved→missing、error/missing 恢复、loading 重入及忽略 abort 的旧结果不覆盖新值，无匹配零请求。
- [x] 2.2 DocumentSession Controller 始终提供失效方法并广播当前各 View，校验生命周期、expectedSessionId 和 scope；测试覆盖两个 View、同源重复节点、kind 隔离、文档级、无 View/重挂、stale/not-ready/disposed/invalid-scope 及同步回调内 dispose。
- [x] 2.3 用真实 Provider 加入“更换 resolver 后显式失效”和稳定函数读取外部数据的组件回归；断言 DOM missing/error/resolved、普通 rerender 不重复请求、HNN/onChange/onSave 不变、sessionId/metadata/dirty/选区/焦点和共享 undo/redo 保留，freeze 期间刷新不改正文。

## 3. Provider 图片上传

- [x] 3.1 在 DocumentSession/View 接通可增删更新的 pictureUpload installer 与 picker/paste/drop/menu；测试无 handler 零调用、增删再启用不 remount、替换函数只影响未来 attempt、内部拖拽不重复上传，沿用既有 URL/预算校验。
- [x] 3.2 将上传成功窄命令纳入共享权威提交确认，保留 decoration 锚点映射和单文件稳定 uploadId/递增 attempt；测试单次 onChange/历史事件、peer 同步及跨 View undo/redo、相邻编辑、同锚点多文件乱序完成，提交失败保持可重试/取消且零伪完成。
- [x] 3.3 接通用户可访问的失败/重试/取消 UI 及来源身份清理；组件测试覆盖同步 throw/reject/非法地址、锚点删除、View detach 后同 id 重开、callback 移除、Provider dispose、合法新会话及取消后迟到成功，验证 abort 和零陈旧插入。
- [x] 3.4 将 uploading/failed/待提交结果纳入替换与 freeze pending-edit 门禁；测试拒绝 acquire 不消费 requestId、完成/取消后同请求可重试、入队即禁止新上传/retry、多个 lease 行为保持、未 settle Promise 经取消不泄漏门禁。
- [x] 3.5 实现 card/drawing 草稿开放时的成功结果延迟提交与关闭后重校验；测试完成/取消草稿后恰好插入一次、两类历史分组独立、期间取消/卸载不回写。保存集成测试断言上传临时态/File/id 不进 HNN、唯一 barrier 保持且 saved 不等于可 freeze/离开。

## 4. 正式验证与文档

- [x] 4.1 沿 scripts/check-shared-browser.mjs 的实际 Vite/Playwright 方式补公共 Provider 浏览器用例；运行候选级/文档级删除后 missing、history 保留与图片成功/失败/重试/取消/迟到/草稿/freeze，断言双 View DOM、实际回调和保存 HNN，留原始命令、退出码、trace/截图，关闭脚本自建服务。
- [x] 4.2 README/CHANGELOG 补失效命令能力检测及最新 resolver 的调用顺序、上传 callback 配置和生命周期、上传中保存与导航边界；用根类型消费示例编译验证文档代码，明确普通 rerender 不自动失效、来源 View detach 取消上传。
- [x] 4.3 执行 yarn install --frozen-lockfile、yarn test、yarn typecheck、yarn build、yarn lint、yarn verify:tiptap-deps、yarn verify:legacy-api、yarn verify:phase1-scope 及 node --test scripts/phase1-ast-guards.test.mjs；记录全部原始结果并保持旧入口/旧断言，失败停止交付。历史选择性撤销探针单列，不能冒充正式全绿。
- [x] 4.4 执行本 change 的 openspec validate --strict 与状态检查；审查规格、实现、README 和 tasks 一致性，未完成项目保持未勾选，输出未验证边界及 HAM-36 的 hnn-references.spec.ts 复跑要求。

## 5. 包、PR 与授权发布

- [x] 5.1 在独立 staging 用 GITHUB_REF_NAME=v3.1.2 调用现有 release:prepare，再构建和 pack；记录精确 3.1.2、完整源 commit、SHA-256、文件清单、根 ESM/CJS/.d.ts/CSS 证据，确认未改变已发布 3.1.1。
- [x] 5.2 在仓库外干净消费副本仅安装该 pack 与声明依赖，跑新失效/上传公开入口与原 3.1.1 fixture 的类型检查、构建和运行；确认无 alias/私有导入/workspace 链接/patch，保存安装及消费原始日志，缺证据不得宣称兼容。
- [x] 5.3 提交推送实现及 change，开标题含 HAM-36 的 PR，附上报告、原始日志、pack/hash 和干净消费证据；通过远端 PR 元数据与 head commit 核对可评审交付，任何失败不得声称已满足验收。
- [ ] 5.4 在既有授权范围按 HAM-39/HAM-42 先例合并并发布 v3.1.2；核对合并树与验收树、tag、Release 结果、registry 精确版本/integrity/tarball hash 和逐文件差异，交付正式可安装包身份。未取得发布结果时如实标待确认，不宣称发布成功。
- [ ] 5.5 输出最终上游报告和 HAM-36 交接材料：安装命令、失效调用时序、上传成功/失败/迟到/取消的可复跑入口与包身份；明确 Reader 原失败 E2E 与真实宿主上传仍由 HAM-36 升级复跑，未复跑不得勾选宿主验收或放行 6.1。
