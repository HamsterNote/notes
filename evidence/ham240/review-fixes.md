HAM-240 评审修复（notes #29）

分支已从原 head `e6c3b4e2f16d10d78180a1aebf29c2061114d993` rebase 到 main `5758f85c26ea7469d4645bfd60982f9899ac166b`，保留 HAM-237 主线改动。

已展开的子菜单收到键盘焦点请求时调用统一的 focusFirst，跳过禁用项并维护 roving tabindex；鼠标悬停继续不抢焦点。新增 DOM 单测，以及真实 Chromium 中悬停后 ArrowRight → End → Enter 打开图像模态框的回归断言。

本轮验证：

- `yarn typecheck`：通过。
- `yarn test --maxWorkers=1`：1089 通过、1 超时；`quoteInteractions.test.ts` 的 full node budget 案例触发默认 5000ms 超时，无断言失败。
- `yarn test --maxWorkers=1 --testTimeout=30000`：1090 项全部通过。仅调整本次命令的超时参数，没有修改仓库测试配置。
- `yarn build`、`yarn lint`：通过。
- `node scripts/check-picture-insertion-browser.mjs`：Chromium 148.0.7778.96 通过；已更新 browser.json 和截图。

上述命令原始输出随 HAM-240 交付评论附件提供（包括首次超时）。本轮未发布包，跨仓库正式包升级和真实存储接线仍保持待办。
