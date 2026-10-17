# Formula Portal Composition Freeze P2

公式 portal 的组合输入冻结缺口已修复，待独立复验。PR #12：
https://github.com/HamsterNote/notes/pull/12

## 修复与范围

`src/lib/hnn/extensions.ts` 的 mini editor 现在跟踪 `compositionstart/end`。
组合期间 flush 返回 false，Controller 沿用明确的 `failure/pending-edit`，
不提交字符串、不移除 textarea、不产生 lease，也不消费 requestId。
正常 blur、外部 pointerdown、Escape、scroll/resize 关闭路径同样受保护，
避免宿主冻结按钮的默认交互提前提交组合态。compositionend 后不自动冻结，
调用方可用同 requestId 重试：只提交一次，随后正常 acquire/release。
NodeView 销毁仍清理 portal 和 composition 监听器，但不提交未完成输入。

审核附件 `01a14a82-8d8a-74cc-a0a2-960726949615` 已逐字落库为
`src/lib/editor/reviewPortalComposition.test.tsx`，未改任何原断言。
附件/仓库文件共同 SHA-256：
`08687d43473134d00dd7e3cba7b29268948a3e81ffade7565430645c13492633`。
`portal-reviewer-verbatim.log` 记录 cmp exit 0。

本轮修改从 PR head `1a2cc97` 开始，修复提交为
`945e41abfb7e7b6b22d7e8c294d6bca09371c2ff`。交付前发现并合入远端
`5fd82f71753dc654f83e1fe447ccb864fe954fc5`，保留另一轮 autosave 修复。
最终打包源码为合并提交 `a8c5c8ea48bd2cdd1212bcd5b349e68ddbee98f6`。
后续提交仅保存证据。增量 `portal-composition.patch` 基于 `5fd82f7`，
在该提交的独立干净 worktree 执行 `git apply --check` 通过，见 `portal-patch-apply.log`。

## 验证

环境：Linux、Node v24.15.0、Yarn 1.22.22、Chromium 148.0.7778.96。
所有日志由 `node scripts/capture-check.mjs <label> <command> ...` 完整保存。

| 验证 | 结果 | evidence/ 下原始日志 |
| --- | --- | --- |
| 审核原测试，修前 | exit 1；返回 applied、textarea 被移除，两处断言均失败 | portal-red.log |
| 原测试与 Provider 补充测试，修后 | 20/20，exit 0（合入 autosave 前） | portal-green.log |
| `corepack yarn test`，最终合并源码 | 38 文件、780/780，exit 0 | portal-integrated-tests.log |
| `corepack yarn typecheck` | exit 0 | portal-integrated-typecheck.log |
| `corepack yarn build` | exit 0 | portal-integrated-build.log |
| `corepack yarn lint` | exit 0 | portal-integrated-lint.log |
| 原双视图 Chromium 回归 | exit 0 | portal-integrated-shared-browser.log |
| 新公式 Chromium 桌面/手机合成 composition | exit 0 | portal-integrated-browser.log |
| 原历史反例集合 | 41 通过、1 已知选择性撤销失败，exit 1 | portal-integrated-historical.log |
| 本地 pack / 包身份与 145 条文件清单 | exit 0 | portal-integrated-pack.log、portal-integrated-pack-identity.log |
| 仓库外全新安装：ESM/CJS、类型、Vite、新旧组件保存 | exit 0 | portal-integrated-pack-consumer.log、consumer-*.log |
| 安装后声明检查 `--skipLibCheck false` | exit 0 | portal-consumer-declarations.log |
| 安装后包根公式 composition 桌面/手机回归 | exit 0 | portal-pack-browser.log |

补充正式测试覆盖块级/行内公式、组合期间零 onChange/dirty/lease、保留输入值、
多次失败后同请求成功重试、一次提交和 peer undo 回到 baseline，以及组合态卸载清理。
新浏览器脚本也在独立消费目录只导入实际安装包的根入口，验证相同失败/重试行为。
早期浏览器脚本的四次装载/路由/fixture 调试失败保留为 `portal-browser-harness-*.log`，
不计作通过；合并前的 `portal-*.log` 和临时 pack 检查仅是中间证据。
已有 sourcemap、peer、Node deprecation 和 demo chunk-size 警告保留在日志中。

## 最终包身份

包：`@hamster-note/notes@3.1.0`。
附件：`hamster-note-notes-3.1.0-portal-composition-fix.tgz`。
SHA-256：`ecd5326a9065de9b269218c61a5f1a00b58d6ec2b262a37e3c2db68588beb7c4`。
本包同时包含 autosave 与本次 portal 修复，替代旧原始/仅 autosave/中间 pack。
`pack-identity.json` 记录完整源码 commit、包清单及各入口/CSS hash；
`consumer-identity.json` 记录实际安装 tarball 的同一 hash 和完整消费 lockfile。
ESM 安装文件 hash 与 pack 记录均为
`958a90a9416ab36211bcf196567d4e3a8d57c27d5cdc14602c42e3569e125a64`。

安装：`corepack yarn add ./hamster-note-notes-3.1.0-portal-composition-fix.tgz`。
从 `@hamster-note/notes` 导入组件/类型，并导入 `styles.css` 与 `formula.css` 子路径。

未修改 WebBase、依赖、任务勾选、共享撤销语义或历史反例断言；未改 tombstone
生命周期/复杂度或整表复制扫描，未加 TTL。实体 IME、真实 WebBase bridge、远端
存储仍未验证。本轮未合并 PR、未发布 npm；HAM-36 保持 in_progress，2.1 继续等待复验。
