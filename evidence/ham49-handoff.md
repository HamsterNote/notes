# HAM-36 消费交接

## 安装与身份

正式消费使用 `yarn add --exact @hamster-note/notes@3.1.2`（WebBase 按自身包管理器用 `pnpm add --save-exact @hamster-note/notes@3.1.2`）。不得使用源码 alias、workspace link、私有 import 或包 patch。验收 pack 的源提交为 `cc4564dd1ccf64ba20a08e41d5d68d55ccce5814`；3.1.2 tag 指向 merge commit `6c6ac2a700a333f1d98b373bebe5b7752dbf8ba4`，其产品源码、README、scripts 与验收源完全一致。registry 身份见最终 registry-identity.json；本地验收包见 ham49-pack-identity.json。

## 引用失效时序

1. 升级精确 3.1.2，保留原 Provider 会话、共享 history 与 HNN。
2. 删除高亮并完成 sidecar/store 更新。若 resolver 是读取 store 的稳定闭包，可随后直接调用；若更换 React callback prop，先等新 prop 提交再调用。
3. 能力检测 `controller.invalidateReferences`；缺失需报版本能力不符。读取当前 `controller.getState().identity.sessionId`，然后分别传 `{ expectedSessionId, scope: { kind: "reference", reference: { kind: "mention", resourceId } } }` 和 resource 对应 scope；文档级用 `{ kind: "document" }`。
4. accepted 仅代表失效受理；等对应 DOM `data-hnn-resolve-status` 成为 missing/error/resolved。旧 controller、错误身份、未 ready 和非法 scope 需按判别结果处理，不忽略失败。
5. 保留 `hnn-references.spec.ts` 原删除高亮后的 missing 断言、HNN 字节不变和真实 Reader 定位断言，复跑完整链路。3.1.1 的“只换 resolver”最小诊断不会在新版本自动转绿，因为自动刷新不是契约；另加显式失效调用，不能把旧诊断直接删掉冒充修复。

## 图片上传与导航

将宿主 PictureUploadHandler 传入公共 Provider 的 onPictureUpload。回调使用 File 与 `{uploadId, attempt, signal}`，返回 http/https src 及可选 alt；同文件重试保持 uploadId、增加 attempt、新 signal。失败/取消控件由 View 提供，取消、来源 View detach、移除 handler 或 dispose 后，忽略 signal 的迟到结果也不能插入。

上传占位不是 HNN。普通保存只保存持久正文；saved/clean 不能放行导航。宿主先 acquire 自身 freeze lease；pending upload、failed 或待提交结果返回 failure/pending-edit，不消费 requestId。完成/取消后可用原 requestId 重试，再等待唯一保存 barrier；finally 只释放自己取得的 lease。不得重建 Provider 丢失 pending upload 以绕过门禁。

先开始上传、再打开 card/drawing 草稿时，成功结果会保留到草稿关闭后重校验提交。草稿期间不重传、不穿透锁，取消/卸载仍能清理。一次合法上传只触发一次共享正文 onChange，peer 可 undo/redo，临时态绝不写入存储。

## 可复跑证据与未验证项

- 源码契约：`yarn test`（正式 811/811），新增 referenceInvalidation/providerUploads 测试与旧 public API 全保留。
- 源码 Chromium：`node scripts/check-public-host-browser.mjs`。
- 干净 pack：`node scripts/verify-pack-consumer.mjs <pack.tgz> 3.1.2 <不存在的新目录> --public-host <evidence-dir>`；实际安装包完成旧入口、ESM/CJS、类型/README 示例、构建和同一新公共浏览器套件。
- 公共 fixture 只用根入口；受控 resolver 和 Promise uploader 用于确定成功、失败、重试、取消、迟到、草稿和 freeze 交错。真实宿主网络、存储错误和 Reader sidecar 接线由 HAM-36 覆盖。
- 本单未改 WebBase 和 HAM-36 tasks，未复跑 Reader 原失败 E2E，不代勾选宿主 4.2/5.3/6.1。实体 IME/native/真实远端上传不在本次证据内。历史选择性撤销反例仍为 41 passed / 1 failed，未计入正式测试通过数。
