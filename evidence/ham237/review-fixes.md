HAM-237 / PR #26 复审修复证据

受测源码 SHA：`adb7ffa91db09abca1ed5e2d946b0b89e4b9fa92`。其后的证据提交只更新本文、README、原始日志和截图，不修改源码或测试。范围仍为 M1；M2 npm 发布和 M3 WebBase 集成未执行。

P1：`transactionPermission.ts` 将正文 editable 与会话授权的文档事务分开。`DocumentSession` 为每个视图注册内部授权回调，在 commitDraft 的同步提交窗口内，来源和对端视图可以应用合法事务，正文输入继续锁定；detach 时清理回调。`listInteractions.ts` 保留完整 codec/预算校验，普通草稿期间及 freeze 的事务仍拒绝。`extensions.ts` 在 dispatch 后确认候选文档已生效；过滤器或会话拒绝时返回失败，抽屉保留草稿和错误，可重试。

P2：`listCommands.ts` 的空项退出只处理折叠光标。跨项选区先精确删除选区，再在隔离候选上拆分，合并为一个经过预算校验的事务。覆盖全部文字被选中时的空项拆分；显式拆分、历史恢复和对端复制不再被 Tiptap 的通用 select-all 删除清理改写。新待办项 checked=false，正反向选区均能单次撤销和重做。

新增 27 项回归，名称及位置如下（参数矩阵中的每个实例名见完整原始输出）：

| 文件 | 测试名称 | 覆盖 |
| --- | --- | --- |
| `src/lib/editor/listDrafts.test.tsx` | `$kind draft alongside $type commits once while body stays locked, synchronizes peers, undoes/redoes and survives save/reopen` | 卡片/画板 × 三类列表，6 项；真实 Drawer/NodeView/共享会话链路，双视图锁定、提交、历史、保存和重开；绘图库指针引擎在此用有效 stroke 回调替代 |
| 同上 | `%s rejected transaction reports failure and retains the drawer draft for retry` | 2 项；过滤器拒绝时保留原文档、dirty/history、抽屉内容与错误，移除拒绝后原草稿可成功提交 |
| 同上 | `%s draft authorization retains strict list budget and freeze rejection` | 2 项；绕过抽屉预检的超预算事务仍被列表过滤器拒绝，freeze 不执行提交回调 |
| 同上 | `Enter replacing a %s selection of all list text preserves both views through shared undo/redo` | 正反向 2 项；两个视图各自保留完整选区，空列表拆分及共享历史一致 |
| `src/lib/editor/listCommands.test.ts` | `Enter deletes a $direction selection from an empty $type item through character $end before splitting, with one undo` | 3 类型 × 2 方向 × 部分/全部删除，共 12 项；删除 abc 后只留 def，或删光，保留列表、合法 ID、新任务 false、一次撤销还原原方向选区、重做还原 |
| 同上 | `Enter replaces selected text in one $type item with two empty items` | 3 项；同一项全部选中文字也遵循删除并拆分 |

验证结果：

```text
$ yarn test src/lib/editor/listDrafts.test.tsx src/lib/editor/listCommands.test.ts --maxWorkers=2 --reporter=verbose
Test Files  2 passed (2)
Tests  59 passed (59)

$ yarn test --maxWorkers=2 --reporter=verbose
Test Files  47 passed (47)
Tests  982 passed (982)
```

以上为结果摘录，未删改的完整 stdout/stderr 在 `review-fixes-targeted.txt` 和 `review-fixes-verification.txt`。后者记录受测 SHA、环境、每条命令及退出码；lint、typecheck、Tiptap 依赖、legacy API、Phase 1 范围、AST 守卫、库/Demo 构建、OpenSpec strict、diff 检查均 exit 0。

`node scripts/check-lists-browser.mjs` 使用公开 Provider/View fixture，Chromium 1440px / 390px 均通过原列表场景及新增真实卡片、直线绘图与列表共存场景：正文保持锁定、两个视图的文档一致、共享撤销重做、保存并重开数据一致。浏览器原始输出也在完整验证日志中，独立副本为 `review-fixes-browser.txt`。

修复前的初始回归集在 `f0c1d438093496d777c791cd2dce6b12f7531a56` 源码上运行：48 项中 14 项失败、34 项通过，覆盖 P1 的提交丢失/抽屉误关及 P2 的正反向选区误退出。原始输出保留于 `review-fixes-before.txt`；之后扩展了全部删除、同项全选和共享历史边界用例。

环境：Linux `7.0.0-31-generic x86_64`，Node `v24.15.0`，Yarn `1.22.22`，Git `2.53.0`，OpenSpec `1.13.1`，Vitest `4.1.10`，Playwright `1.60.0`，Chromium `148.0.7778.96`。与上次相同，完整套件限制为两个 worker，没有放宽超时或断言。

剩余风险：真实画笔（pen）输出的点携带 `timestamp`，现行 `drawingPayload.ts` 的点白名单拒绝该字段，显示 `/strokes/0/points/0/timestamp：不允许字段 timestamp`，发生在事务提交之前。失败原始输出见 `review-fixes-pen-risk.txt`。该校验、Drawer 和 painting 依赖相对修复前 SHA 均无修改（完整日志末尾有 diff 命令和空输出）；本轮没有扩展持久格式来修复这一既有兼容问题。浏览器成功验证的绘图工具为直线，不代表画笔问题已解决。

浏览器 fixture 仍通过 Vite alias 消费当前源码；390px 是 Chromium 移动布局，不是实体设备、系统软键盘或真实 IME。未进行正式 npm 包消费、WebBase 或 native 验收。
