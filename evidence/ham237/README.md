HAM-237 M1 验证证据

本次仅交付 notes 的列表编辑闭环。M2 npm 正式发布、独立正式包消费和 M3 WebBase 集成保持待办。

规划来源：`1fbe2fc6901ac93720f0c3bfdc924eb49f5b9d01`，在工作分支 cherry-pick 为 `914ef50`。原代码基线：`53f82c8e947fa1c9d603b6f628aa4996cae97dd5`。

实现提交：`42a24ebf6498c9e449b8432f9bcf4b9c8fc45e7c`；文本中间拆待办项的状态修复及最终受测 revision：`0c59c2ab721c5ccb28597d9485e679eff488e82a`。最终验证的命令、原始 stdout/stderr 和退出码见 `verification.txt`。正式套件 46 个文件、955 项通过；AST 守卫 2 项通过。截图为 `lists-1440.png`、`lists-390.png`。

| tasks.md | 实现与断言位置 | 验证命令及证据 |
| --- | --- | --- |
| 1.1 | `src/lib/editor/listCommands.ts`；`listCommands.test.ts` 的 M1.1：单项、连续项、半开端点、跨层/容器禁用、块菜单独立目标 | `yarn test`；最终全量结果见 verification.txt |
| 1.2 | M1.2：三种创建、九格矩阵（六向转换及三种同类型 no-op）、marks、mention、多个段落、混合后代、ID 编码验证 | 同上 |
| 1.3 | M1.3：5/bullet/7 → 5/1/7、type 保留/清除、checked 转出删除/转回 false、撤销恢复 true | 同上；浏览器也验证 5/1/7 |
| 1.4 | M1.4 + `interactionToolbar.test.ts`：整容器菜单、局部工具栏、390/1000px、跨容器禁用正文/列表、受限父结构拒绝解包、子列表保留 | 同上；`node scripts/check-lists-browser.mjs` |
| 1.5 | M1.5：末尾及文本中间拆项、新项 false、空项退出/提升、无前项拒绝、整子树移动、不同类型外层列表的提升、引用内编号、独立撤销 | 同上；浏览器真实键盘 Enter/Tab/Shift+Tab 和缩进按钮 |
| 1.6 | M1.6：checkbox 本项变化、父子不联动、撤销；`listInteractions.ts` 原生 checkbox NodeView | `node scripts/check-lists-browser.mjs`：Space、点击、390px touch tap、无 reorder 事件，截图 |
| 1.7 | M1.7：只读、composition、真实 512 KiB（包括 true→false 多 1 byte）、32 层、512 节点拒绝，不改文档/选区/history/dirty；Provider freeze | `yarn test`；浏览器 freeze 操作保持不变 |
| 1.8 | `src/lib/hnn/listPersistence.test.ts`：混合 HNN 树、非法 checked 路径、普通项 checked 拒绝、旧有效 v1、GFM `[X]`/编号、特殊编号无损围栏 | `yarn test`；复用现行 codec/Markdown，无新增格式 |
| 1.9 | `src/lib/editor/listProvider.test.tsx`：公开 Provider/View 两栏勾选/转换/历史、焦点独立、freeze、失败保留 dirty、重试保存、重开 | `yarn test`；浏览器保存和共享历史也覆盖 |
| 1.10 | 库门禁及浏览器验证入口 `yarn check:lists` | 下述完整命令，原始输出与 exit code 均在 verification.txt |

门禁命令：

```sh
yarn lint
yarn typecheck
yarn test
yarn verify:tiptap-deps
yarn verify:legacy-api
yarn verify:phase1-scope
node --test scripts/phase1-ast-guards.test.mjs
yarn build
node scripts/check-lists-browser.mjs
openspec validate add-list-conversion-and-webbase-delivery --strict
git diff --check
```

环境：Linux 7.0.0-31-generic x86_64，Node v24.15.0，Yarn 1.22.22，Git 2.53.0，OpenSpec 1.13.1，Playwright 1.60.0 / Chromium 148.0.7778.96；具体运行输出见日志。

重试记录：`verification-attempt-42a24eb.txt` 保留了一次未通过的默认并发全量运行：既有 Markdown 大输入测试超过默认 5000ms，其他 953 项通过。未修改断言、超时或排除测试；最终全量命令使用 `yarn test --maxWorkers=2 --reporter=verbose` 控制并发，逐条测试输出在 `verification.txt`。最终结果以该日志各命令退出码为准。

验证边界：浏览器 fixture 通过公开 Provider/View 与编解码 API 挂载，Vite alias 指向当前 notes 源码。390px 是 Chromium 移动布局、touch tap 与键盘自动化，不是实体设备或系统软键盘/真实 IME 验收；组合输入拒绝由受控回归覆盖。不是正式 npm 包消费、WebBase 集成或原生验收。既有历史选择性撤销探针不属于当前正式测试入口，本次没有据此宣称该探针通过。

原始日志保留了已有依赖 sourcemap 缺失、Node url.parse 弃用和构建体积等提示；以每条命令实际退出码为准，不将警告改写为失败或删除。
