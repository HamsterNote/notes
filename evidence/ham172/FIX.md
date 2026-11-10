HAM-172 的用户真机样本已确认根因。修复在 notes 内处理原生组合删除的 DOM 解析，不拦截 Enter、不使用超时、不缓存/猜测最终中文。代码与本地回归已完成；仍需用户用同一手机、同一取证入口录制修复后的记录，不能把下述受控回放当作真机验收。

## 观察到的真实序列

用户在 HAM-172 评论 `01a1c608-52c1-747a-ae5e-f27bcc664566` 粘贴了 75 条 v2 事件，`truncated=false`、transactionObservation 可用，带 trusted 的原生事件均为 true。粘贴经过富文本 Markdown 转义；读取时仅去掉一层 Markdown 转义、还原 HTML entities，再进行 JSON 解码，未补造事件。选取字段见 `device-simulator-sequence.json`；完整粘贴仍以原评论为准。

以下编号是 JSON 的 `id` 字段，而不是数组下标：

- #51：模型内容 `ni\u2006hao`，模型选区已折叠为 `7..7`；DOM 仍选中整段组合文字。
- #52：`beforeinput:deleteCompositionText`，targetRanges 为该文本的 `0..6`，对应模型 `1..7`。
- #54：`input:deleteCompositionText` 后，只剩块把手 widget 加根级 `<br>`，P 确实已被浏览器移除，DOM 选区为根 DIV offset 1。
- #57：不是文本删除，而是 `replace 7→7`、`structure=true`、`openStart/openEnd=1`，插入两个 paragraph 边界——即 splitBlock。拼音从旧模型重新渲染回来。随后 replaceAround 只修复第二个 P 的 nodeId，并非宿主再追加一次正文。
- #58：DOM 已为 `["ni\u2006hao", ""]`。
- #60：`compositionend.data=""`。
- #63–67：`keydown(229)` → `beforeinput:insertText("你好")`（目标为第二个 P）→ 普通插入事务，最终 `["ni\u2006hao", "你好"]`。

这份样本确认了 notes 内部的故障点；无需假设 WebBase 和 notes 各 append 一次。原生 DOM 已执行删除，但框架把变化误当拆段，旧模型里的文字因而复活。最后的中文提交本身可以沿标准 insertText 处理，不需要针对空 compositionend 人工补写。

UA 为 iPhone / Safari 27.2；其中 `iPhone OS 18_7` 是兼容 UA 字段，不能据它确定手机实际系统版本。

## 为什么模拟器只留空首段

HAM-218 的 `sim-formal-events.json` 提供了 83 条 v2 对照，所有截断标记为 false。它不是“完全没有命中拆段”的另一条路径：

- #58–61 先把预编辑文字换为 `你好`；此时模型选区是 `1..3`，包含整段文字。
- #64/66 同样发送 deleteCompositionText 并移除 P。
- #69 的 keymap 事务含两步：先 `replace 1→3` 删除已选文字，再 splitBlock。因此得到 `["", ""]`。
- #72–78 再以 insertFromComposition 提交中文，得到 `["", "你好"]`。

真机 #57 没有第一步 deleteSelection，因为模型选区已折叠。**两者的提交事件类型确有差异，但“首段是否残留文字”还取决于误拆段之前的模型选区。** 不能仅因模拟器用 insertFromComposition 就推断它未命中同一故障。该差异由两份真实 transaction steps 直接支持；不推测系统为何在两个环境中产生不同选区时序。

回车位的模拟器记录在原生 `insertFromComposition.data` 中就提交了 `nihao`。现有证据支持“浏览器提交了原文”，不能归因为 notes 把中文改回拼音；修复会保留浏览器实际提交的 `nihao`，不猜测候选。若同机回车位期望中文，仍需对应真机记录确认输入法提供的数据。

## 具体代码与修复

故障链：`prosemirror-view/src/domobserver.ts:248` 的 flush → `domchange.ts:183–184` 的 `!inlineChange && looksLikeEnter(...)` → 合成 Enter keymap → splitBlock。该分支没有要求真实 Enter；实际包 3.2.0 的对应代码为 `dist/index.js:9127`。用户调用栈的 `x9` 正是这段 readDOMChange。`documentSession.ts:336–346` 正常应用该错误事务并更新视图；宿主回调保存快照，不是本次拆段的起点。

新增 `src/lib/hnn/compositionDeletion.ts`，由 HNN 封闭扩展装配启用：

1. beforeinput 仅识别 deleteCompositionText，验证 targetRanges 指向当前模型中完整的顶层文本块、文本与 DOM 一致，并记下原节点身份。
2. input 后，只有原块确实消失、光标在根级 BR 附近、模型未发生其他修改，才给该**特定 BR 对象**做一次性解析标记。
3. 正常 DOM observer 解析时，将该 BR 按“原类型、原属性的空文本块”读取，其余 widget/NodeView/schema 规则完整委托给原解析器。这样 diff 是删除组合文字，失去误判成 Enter 的结构差异。
4. 删除与最终上屏都由既有事务、共享视图、保存及历史管线处理；不在原生 input 中强行 dispatch 或写 DOM。不阻止输入，也不假设最终提交来自 insertText 还是 insertFromComposition。

解析标记以 BR 对象为键，消费一次即移除；即使 compositionend 与删除同一任务到达，也不会提前丢失。模型变更后旧标记失效。部分文字删除、嵌套/list/table 文本块、没有有效 targetRanges 的事件继续走默认解析。

依赖注意：ProseMirror 的 `ruleFromNode` parser option 被声明为 internal；本扩展保留 view 传来的原规则，只为确认过的 BR 提供规则。没有修改 node_modules 或依赖锁文件。升级 TipTap/ProseMirror 时应保留本回归验证。

包含 HAM-173 / PR #22 的源码与发布包均可重现该故障；该长按改动不是本次错误拆段的必要条件。仍没有历史证据证明是哪次版本升级首次引入，不能把 HAM-107 的布局改动当成已经修过输入引擎。

## 验证

- `yarn typecheck` 通过；42 文件 / 897 单测通过。新增 4 项覆盖保留原段落身份、有前置段落、普通块内删除与过期 target range。
- 修改的 TS 文件定向 ESLint、脚本语法、diff 检查通过；`yarn build:lib` 通过。
- `scripts/check-composition-commit-browser.mjs`：WebKit 26.4 上共 18 个受控样本，分别运行未修复发布包 3.2.0、修复源码、修复构建产物，每组 6 条路径。精简结果见 `commit-replay-summary.json`，完整 JSON/截图随本轮评论附件交付。
- 6 条路径：真机的空 end + insertText、end 在 observer 前到达、insertFromComposition、模拟器已选候选模型、已转换中文但模型选区折叠、拼音原文提交。未修复版本分别留下旧文字或空首段；修复版均只剩一个目标段落。同步视图和保存 payload 一致，undo/redo、提交后立刻正常 Enter 均通过。
- 实际 WebBase 取证入口已用开发配置 alias 指向本分支的 `dist`；已检查页面加载 `hnnCompositionDeletion` 扩展，并在实际 iframe 受控回放删除/上屏，导出 JSON 确认无拆段事务，保存重开为单段 `你好`，无页面异常。宿主 Chromium 需要为合成事件显式提供旧 WebKit inputType，故此项仍是合成集成测试。生产依赖与锁文件保持 notes 3.2.0，未发布 npm 包。
- 冷启动回放曾有一次第六页加载超时；重新运行完整源码/产物两组后均通过，计数来自完整成功的三份 JSON。
- 本轮没有原生构建/模拟器自动验收；真实手机仍由用户操作，修复后同机记录尚未收到。

重跑（需 WebKit Playwright 系统依赖）：

```sh
node scripts/check-composition-commit-browser.mjs --consumer=../WebBase/webview --expect-split --output=evidence/ham172/commit-replay-before.json
node scripts/check-composition-commit-browser.mjs
node scripts/check-composition-commit-browser.mjs --entry=/dist/index.js --output=evidence/ham172/commit-replay-built.json
```

已保留的 `HAM213-analysis.md`、旧探针与 experimental-guard.patch 属于早期调查记录。当前结论由本报告及真实 v2 对照取代；旧 patch 未启用。

当前开发入口：`http://192.168.0.145:6218/__ime-capture`；ZeroTier 为 `http://192.168.192.30:6218/__ime-capture`。请同一手机刷新页面、新建笔记，用相同输入法输入并导出修复后的 JSON；点候选/空格位/回车位分别记录，避免把“提交原文”与“正文重复”混为一项。服务由 tmux `ham172-dev` 保持，停止命令 `tmux kill-session -t ham172-dev`，机器重启后不保证存活。
