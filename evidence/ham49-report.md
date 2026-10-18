# HAM-49 / notes 3.1.2

## 实现与边界

基线为已发布 v3.1.1，源 `e40ee779bf36b7f5c9f5d5fd10b622c66febbeb6`，提案提交 `6d80a73c5ed9476becf61e2659bfedd87d96b2dd`。读取了 HAM-36 原阶段报告和 `save-stage-reference-repro.log`：公开 resolver 替换仍 resolved 的诊断是旧缓存行为。此版本提供显式失效，普通 rerender 继续保持缓存。

- `documentTypes.ts` / 包根新增 ReferenceInvalidationScope / Result 与可选 Controller 方法（旧结构 adapter 兼容）；实际 Controller 始终提供方法。先校验 lifecycle、expectedSessionId、scope，防御复制 kind/id，区分 accepted / stale / not-ready / disposed / invalid-scope。
- `hostReferences.ts` 按候选或全文作废 token、abort 并使用最新 resolver；重复节点按 kind/id 去重，跨 View 各自解析。保留正文、history、选区、metadata、dirty、保存基线。同步 abort/订阅重入与旧 Promise 迟到均有回归。
- Provider 可选 onPictureUpload，沿用 PictureUploadHandler、旧上传插件与 UI，接通 picker/paste/drop/menu，handler 热更新及移除/重启。成功必须获共享 authority 接受，失败不会伪完成；同锚点乱序完成保序，映射锚点与共享 undo/redo 保留。
- 上传绑定来源 View 实例与 attempt。取消、锚点跨越删除、detach/重开、移除 handler、dispose 和合法会话替换隔离旧结果。草稿期间成功结果待提交，关闭后重新校验，取消/卸载可清理；所有临时态不进入 HNN。
- uploading/failed/待提交结果阻止会话替换与 freeze；acquire 入队即阻止新上传/retry。保存仍仅保存持久正文，saved/clean 不等于可离开。已有 A / lease / 旧 NoteEditor CAS 签名与结果联合未变。

导出守卫只新增两个获批类型条目，所有旧导出/来源与原断言保留。README 的新增示例由 `scripts/fixtures/public-host/host-usage.tsx` 编译消费，旧消费 fixture 原样保留。

## 正式验证

所有命令由 capture-check.mjs 记录命令、Node、退出码和完整 stdout/stderr。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| yarn install --frozen-lockfile | exit 0，lock 未改 | ham49-install.log |
| yarn test | 40 文件 / 811 项全部通过 | ham49-tests-complete.log |
| yarn typecheck | exit 0 | ham49-types-fourth.log |
| yarn build | 库 + demo，exit 0 | ham49-build.log |
| yarn lint | exit 0 | ham49-lint-final.log |
| verify:tiptap-deps | exit 0 | ham49-deps.log |
| verify:legacy-api | exit 0 | ham49-legacy-final.log |
| verify:phase1-scope | exit 0 | ham49-phase1.log |
| node --test scripts/phase1-ast-guards.test.mjs | 2/2 | ham49-ast.log |
| openspec validate ... --strict | exit 0 | ham49-openspec.log |
| 新增契约 + 旧 installer / 根类型定向 | 72/72 | ham49-targeted-final.log |
| 3.1.1 registry/独立安装基线 | ESM/CJS/类型/build/浏览器均通过 | ham49-baseline-registry.log、ham49-baseline-consumer.log、ham49-baseline/ |
| 公共 Provider Chromium | 候选/全文 missing、保栈、双 View、上传成功/失败/retry/cancel/late、草稿、freeze、HNN 与桌面/手机通过 | ham49-browser-first.log、ham49-public-host-trace.zip、截图 |
| 原共享 Chromium 回归 | 原生交错、undo/redo、重开、freeze、草稿、save 通过 | ham49-old-browser.log |

初跑失败日志保留：新测试夹具中 externalItem 误放 inline、JSDOM focus 延迟同步与严格 TS/lint 诊断已修正；全量前两次分别因两个新增类型尚未登记到两份明确导出清单而失败，最后 811/811 为一次完整执行，不合并多轮结果冒充全绿。

独立历史原型 `yarn test --config vitest.historical.config.ts`：41 passed / 1 failed（`src/prototype/session.test.ts:151`，期望 B共享正文而实际共享正文）。这是 A 已声明不承诺的历史选择性撤销反例，保留原断言，未计入正式通过数。日志 `ham49-historical.log`。

## 包与下游交接

验收 pack 精确为 `@hamster-note/notes@3.1.2`，从独立 staging 的 `cc4564dd1ccf64ba20a08e41d5d68d55ccce5814` 源树经 GITHUB_REF_NAME=v3.1.2 / release:prepare、yarn build、npm pack 生成。SHA-256：`e72e98b28ecf801c6bef030c6741c5dd2198b7a49e5b0e041d1defbf25eae53f`。138 个文件，根 ESM/CJS/.d.ts/CSS 和 60 个字体齐全；精确清单与各入口摘要见 `ham49-pack-identity.json`，未改变已发布 3.1.1。

仓库外全新 `consumer-3-1-2` 只安装此 pack 和声明的 React/开发依赖：安装、ESM/CJS 精确 runtime 清单、旧 fixture 与新 Controller/Provider 类型（含 README 用法）、Vite 生产构建，以及旧 NoteEditor CAS/revision 与新 Provider 双 View 保存均通过。随后在该消费副本的构建产物上运行完整公共能力浏览器套件，全部通过。无源码 alias、workspace 链接、私有导入或 patch；见 `ham49-clean-consumer.log`、`ham49-consumer/consumer-identity.json`、逐步日志、`ham49-consumer-trace.zip` 和桌面/手机截图。源码浏览器脚本中的 alias 只用于源码回归，干净消费者不含任何 alias。

本地 pack 与干净消费已通过；正式发布身份另见发布核对材料。不可仅凭本地 pack 宣称 registry 已发布。

HAM-36 接入顺序：精确安装 3.1.2；先更新 sidecar/store 或提交新的 resolver，再对同 session 调用 invalidateReferences；删除高亮应同时失效对应 mention/resource，全文变更可使用 document scope。缺少方法需报告版本能力不符，不能静默当作成功。

上传配置参见 README，复跑入口为 public-host fixture 和 check-public-host-browser.mjs / verify-pack-consumer.mjs 的 --public-host。库侧的受控 callback 验证不等于真实远端存储上传已验收。

不修改 WebBase 或 HAM-36 tasks。HAM-36 升级正式包后仍需复跑 `webview/e2e-app/hnn-references.spec.ts` 中原删除高亮 missing 断言与真实宿主上传。不得放宽原断言、用 remount/私有 API/正文改写/patch 绕过，不代勾选 4.2/5.3/6.1。不声明 Reader 宿主 E2E、实体 IME、native 或真实远端上传已通过；强制卸载不保证远端资源回收/未完成写入持久化。
