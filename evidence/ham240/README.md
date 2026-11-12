# HAM-240 notes apply 验证与版本对照

## 版本基线

- WebBase 实际消费：`@hamster-note/notes@3.2.0`，npm `gitHead` 为 `6c923ec841396b71fcfcd4a3429add2da7b525aa`（`v3.2.0`），integrity 为 `sha512-hnsFTamGXQSH7c+CY1+iQhHd1OVQ4/u1SdaTVVALbzj/i2RkZIcTq/hIoGi8uYUHGDQ4rjjcbYwdjaELapHeTw==`。
- 本 change 起始源码：`5237b9bd59ef768015c1310199dd4a23776297ab`；`git merge-base` 与 `v3.2.0` 均为 `6c923ec…`，即当前源码是已发布 3.2.0 的后代而非降级副本。
- 当前 `package.json` 仍写 `3.1.3-ham133.3`，这是落后的本地版本字段，不作为宿主兼容基线。源码保留 3.2.0 之后的 Provider/View、分栏工具栏和列表能力；`add-list-conversion-and-webbase-delivery` 的 M2/M3 发布任务仍未完成。
- 新增公开类型仅为 `PictureResolveContext`、`PictureResolveResult`、`PictureResolveHandler`；Provider 与独立 `NoteEditor` 都接受可选 `onPictureResolve`，旧宿主 props 保持可选兼容。
- 本次没有发布 npm、没有创建 release/tag，也没有修改 WebBase 为本地路径依赖。

## 执行结果

- `yarn typecheck`：exit 0。
- `yarn test --maxWorkers=1`：52 个测试文件、1020 项测试全部通过，exit 0。
- `yarn build`：库 ESM/CJS/types/CSS 与 demo 均构建成功，exit 0。
- `node scripts/check-picture-insertion-browser.mjs`：Chromium 148 通过悬停、触屏、键盘、明暗 320px 双栏、nodeId 目标移动、撤销重做及 Provider/独立编辑器场景；记录见 `browser.json` 和两张截图。
- `node scripts/verify-pack-consumer.mjs <ham240-tarball> 3.1.3-ham133.3 <fresh-absent-dir> evidence/ham240/pack-final`：在全新目录安装 tarball，install、ESM、CJS、typecheck、Vite build、公开 Provider/View/NoteEditor 浏览器图片均 exit 0；无私有源码 alias、dist patch 或运行时私有导入。日志与图片位于 `pack-final/`。

本地 tarball：`hamster-note-notes-3.1.3-ham133.3.tgz`，SHA-256 `3804d23e03826b89ec85c75cc316ec552da8f54c3237f8a43eaf56f1ac04a661`，158 个文件。它只是本次源码的独立消费验证物，不是已发布兼容新版本。

## 额外检查与未闭环项

额外执行旧 `public-host` 套件时，其既有 `.hn-editor-controls [role=status]` 双状态选择器等待超时；该结果未计为通过，也不属于上述正式通过项。

WebBase 的真实 MD5 文件写入、挂载读取与浏览器闭环仍需在获得发布授权后，用高于 3.2.0 且包含本 change 的正式 notes 包接入。本次不以 mock 上传替代该跨仓库验收。
