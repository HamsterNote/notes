HAM-172 的两份用户真机记录均指向 notes / ProseMirror 的 DOM 解析：原生组合删除移除了整个文本块，解析器误判为 Enter，在旧模型上 splitBlock，随后上屏进入第二段。当前修复已覆盖第二份记录及 HAM-224 的两个审核缺口。真机复验尚未收到，受控回放不能作为真机验收。

## 真实证据

第一份记录来自 HAM-172 评论 `01a1c608-52c1-747a-ae5e-f27bcc664566`：模型里的 `ni\u2006hao` 仍在，整段 deleteCompositionText 后 DOM 只剩根级 BR，随后 splitBlock 留下拼音和空段，空 compositionend 后的 insertText 将中文插入第二段。

第二份记录来自评论 `01a1cac7-35bc-7926-84c2-c42b105d51fd`，是 `fe56c2d` 的同机复验失败记录：

| 事件 id | 事实 |
| --- | --- |
| #53 / #55 | insertCompositionText 已把组合内容同步为“你好”，模型只有一个段落。 |
| #61 | beforeinput deleteCompositionText 的 targetRanges 指向整段“你好”。 |
| #65 | DOM observer 已触发结构拆分事务；旧正文被恢复到第一段。 |
| #67 | input deleteCompositionText 到达时已经是两段，DOM 选区在 P 上。 |
| #70 / #72 | insertFromComposition 再插入“你好”，最终成为两段相同中文。 |
| #76 | compositionend。 |

因此在 input 才识别 BR 已经太晚，要求选区锚在编辑器根也不成立。此前回放没有覆盖 observer 早于 input 的顺序，不能支持“只差真机确认”的结论。

HAM-224 独立审核又复现了：同 task 提交会替换 BR，使绑定旧 BR 的 WeakMap 标记失效；H2 退化为 paragraph、nodeId 改成新 UUID。compositionend 早于删除事件时，composing 判断或 clear 也会丢掉有效删除上下文。

故障路径是 `prosemirror-view/src/domobserver.ts` 的 flush → `domchange.ts` 的 `!inlineChange && looksLikeEnter(...)` → 合成 Enter → splitBlock。没有证据表明宿主双写正文；不能从已有记录确定是哪次历史依赖升级首次引入。模拟器选中了整个预编辑范围，所以同一误拆段还可能先 deleteSelection，留下空首段。

## 当前实现

`src/lib/hnn/compositionDeletion.ts` 在 beforeinput 验证完整顶层文本块范围、DOM/模型文本一致，保存原文档、块类型/属性/nodeId、块 DOM 和相邻 DOM 对象。它不依赖 input，也不检查选区必须位于根。

正常 observer 解析到根时，只有文档未变、原块确实消失、原槽位两侧 DOM 身份完整且替换内容结构受限，才恢复该槽位的文本块语义。中间部分可以是 BR、原生 inline 文本，或一个新 P/H1–H6；BR 被同 task 提交替换也不影响识别。前、中、后三段分别交给原 DOMParser，重用 widget/NodeView 规则，并将原 DOM 的选区位置映射回恢复的块中。既不移动/克隆原生节点，也不强行派发事务。

compositionend 不撤销已验证的上下文；compositionstart、明确的新用户操作、无关 beforeinput、blur、文档变化和单次解析消费限制生命周期。不以 compositionend 的 data 猜测最终文字，不设置宽限时间。普通部分删除、跨块范围、嵌套/list/table、过期文档及不明确的替换结构回落原解析路径。

删除和提交依然使用已有事务、共享视图、保存、历史和编码流程。没有 preventDefault、Enter 抑制、计时吞事件或补写中文。浏览器若提交 `nihao` 就保留原文。

## 本轮验证（2026-11-11）

- 类型检查、定向 ESLint、`yarn build:lib` 通过。
- 42 文件 / 910 单测通过；compositionDeletion 定向 17 项，其中新增 13 项覆盖中间段落/H2、两侧邻接块、observer 先于 input、提前 end、同 task 文本/新 P、无后续提交及选区位置，另检查代码块提交的换行、缩进及属性。
- 新入口 `scripts/check-composition-deletion-browser.mjs` 在 Chromium 148 与 WebKit 26.4 各运行 14 个场景：P/H2 × 七种事件顺序。`fe56c2d` 对照每组 14 项均复现错误；修复后每组 14 项均通过。覆盖 insertCompositionText(你好) → 整段删除 → insertFromComposition(你好)，同 task 文本/新 P/浏览器 execCommand 提交，编码往返、undo/redo、原 nodeId 和 H2 level，以及随后真实 Enter。
- 原有六条 WebKit Provider/View 回放通过，包含空 end + insertText、原文提交等路径，共享视图、保存和历史一致。一次冷加载超时后完整重跑六条成功。
- 实际 WebBase 取证页面通过新序列：在 input 前先等待 observer 解析，原段被清空且 nodeId 不变，insertFromComposition 后只有一段“你好”；导出无拆段事务，保存重开仍正确。此为 Chromium 合成集成验证，非真机。
- 原始 JSON、日志和宿主集成记录通过 issue 附件交付，不追加提交全部历史快照。

重跑新增场景（需要对应 Playwright 浏览器及系统库）：

```sh
node scripts/check-composition-deletion-browser.mjs --browser=chromium
node scripts/check-composition-deletion-browser.mjs --browser=webkit
```

前后对照在独立 `fe56c2d` worktree 使用同一脚本及 `--baseline` 生成；该参数只记录错误而不终止，不会更换源码。当前机器通过已有 Ubuntu 24.04 WebKit 容器提供系统库，未改系统依赖或项目锁文件。

## 真机验收与入口

已收到的最新真机记录仍是上面那份失败记录。本轮无权访问用户同一台 iPhone，不能伪造“修复后真机通过”；须取得新构建的同机 JSON 后再判断是否合并，PR 保持 Draft。

原取证入口：`http://192.168.0.145:6218/__ime-capture`；ZeroTier：`http://192.168.192.30:6218/__ime-capture`。开发 alias 加载本分支重新构建的 `dist`，未发布 npm 包或更换 WebBase 生产依赖。请同一手机、同一浏览器刷新入口，新建笔记输入 nihao，点选候选“你好”后导出 JSON。服务保留原 tmux `ham172-dev`，存活属 best effort；日志由原 devserver 目录保存，停止命令为 `tmux kill-session -t ham172-dev`。

早期 `HAM213-analysis.md`、experimental-guard.patch 和历史截图属于调查材料，不能作为当前实现或验收结论。HAM-224 的可选归档建议保留，合并前可另行整理。
