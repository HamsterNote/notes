HAM-172 仍未修复。HAM-213 证明模拟器会多出空段落；用户在同一服务上观察到的真机重复正文仍然成立。当前证据不能确定两者是否命中了同一个 DOM 分支。

## 真实日志能确定什么

输入证据为 HAM-172 评论所附 `HAM213-evidence.zip`，不是本次脚本制造的数据。三份 Safari 日志分别为 49/54/54 条，无截断；带 trusted 字段的事件全为 true。原记录器 SHA256：`e8934115e6a217c7d46e8c0614a17e59e2b0d3257cac35f26473fdacb84dd485`。

- 点选、空格、回车位三个样本，在确认阶段都**没有 keydown Enter**，也没有 `insertParagraph`。因此旧的“compositionend 后普通 Enter”实验及其 500 ms guard 不能解释这些真实样本，不能作为修复采用。
- 点选日志 #40–46：`deleteCompositionText` 前为 `["你好"]`，input 时直属 P 列表为空，紧接着 mutation 时为 `["", ""]`，然后 `insertFromComposition("你好")` 写入第二个 P，最后 compositionend。
- 回车日志 #40 的 `compositionupdate.data` 已经是 `nihao`；#41 `beforeinput:insertCompositionText`、#47 `beforeinput:insertFromComposition`、#50 `compositionend` 也都是 `nihao`。这些输入事件未被阻止。中文并不是被应用转换成拼音，也没有一份中文提交被日志显示为丢弃。
- 拼音键盘“确认”提交原文与“选定”选择候选可能有意不同。现有证据只支持“原生输入事件提供了拼音”，不足以把回车位定性为编辑器缺陷；需同一输入法的普通输入框对照，不能让应用猜测或翻译成中文。
- Expo 只有截图/AX，不能把 Safari 的事件序列当作 Expo 已取得的原始数据。

旧记录器的 `paragraphs` 只查询直属 `p/h1/h2/h3`。`[]` 不等于 DOM 空、正文删除成功；里面可能还有 DIV、BR、文本或 widget。selection 只记 nodeName，不能区分编辑器根 DIV 与内层 DIV。mutation 只记目标节点名称，也不能知道谁增加了 P。

## 已定位到的代码机制，及其证据边界

`prosemirror-view/src/domchange.ts:177–187` 的 `readDOMChange` 在结构差异满足 `looksLikeEnter` 时，会直接调用 `handleKeyDown(keyEvent(13, "Enter"))`。这个条件不要求收到真实 Enter，也没有排除 `view.composing`。`looksLikeEnter` 在同文件 `:334` 检查差异区的空文本块。实际部署包 3.2.0 的同段代码在 `dist/index.js:9127`，source map 中为 `../node_modules/prosemirror-view/dist/index.js:5204–5213`。

调用链为 DOMObserver.flush（`domobserver.ts:248`）→ readDOMChange → 合成 Enter keymap → splitBlock → `documentSession.ts:336` 应用 transaction → `:346` 更新 view。注意它在旧模型上运行 splitBlock；DOM 中临时消失的组合文字可能因此从模型被重新渲染。这是可独立重建的机制，**还不是原输入法命中该机制的证据**。

本次新增 `scripts/probe-composition-delete-browser.mjs`，在裸 Provider/View 中，仅重建 deleteCompositionText 后的不同 DOM。它不发 Enter，不注入最终中文提交，不经过 WebBase 桥接。WebKit 26.4 下，发布包 3.2.0 与当前 notes 源码结果一致：

| 旧模型正文 | 手工给定的删除后 DOM | 解析后结果 | 处理分支 |
| --- | --- | --- | --- |
| 你好 | `<div><br></div>` 或根 `<br>` | `["你好", ""]` | 合成 Enter，splitBlock 保留模型旧文字 |
| 空 | 同上 | `["", ""]` | 合成 Enter，splitBlock |
| 你好 | `<div><br></div><div><br></div>` | `["", ""]` | 普通 DOM replace，未合成 Enter |
| 你好 | 空 DOM | `[""]` | 普通 DOM replace |
| 你好 | `<div>你好</div><div><br></div>` | `["你好", ""]` | 直接解析两个块，未合成 Enter |

仅在夹具中让 `someProp("handleKeyDown")` 不提供 keymap 时，第一行样本变为 `[""]`；两个 DIV 的样本仍为两个 P。因此额外段落至少有两条能与旧记录器相容的路径，不能从 `[] → ["", ""]` 唯一反推出 splitBlock，更不能反推出真机没有 deleteCompositionText。这个跳过 keymap 的对照**没有改产品代码，不是候选修复**。

完整 JSON 含每次中间 DOM、旧/新模型、transaction steps、调用栈，随本轮 Multica 评论的诊断包交付；仓库保留精简的 [60 样本摘要](./delete-replay-summary.json)，避免提交重复快照。`one-div` 样本中有 structure=true 的 replace split 步；模型 `你好` 没被删除，而分裂后多一个空 P。初始模型为空的对照说明：模型状态和中间 DOM 不同，确实能造成“空第一段”或“残留文字第一段”的差别；这只解释可能性，不能断言模拟器与真机的实际差异就是它。

## notes、宿主与 HAM-173

- `src/lib/hnn/nodeId.ts:109` 的 appendTransaction 只通过 `setNodeMarkup` 修复身份/marks（`:137`），没有增加段落的操作。`extensions.ts:1659` 已禁用 StarterKit trailingNode。它们不直接制造额外 P。
- `src/lib/editor/documentSession.ts:322–365` 按 transaction 应用和通知宿主。WebBase `useHnnNotesDocument.ts:150–157` 保存正文快照，`HnnDocumentSession.tsx:49–56` 绑定 Provider；Provider 在 documentId/loadKey 不变时只更新回调（`NoteDocumentProvider.tsx:27`）。这些已检查路径未发现 compositionend 又 append 正文的代码。
- 裸 notes 夹具也能产生上述异常，不需要宿主重复写入。但仍缺真机 trace，尚不能排除实际宿主另有影响，或将原始缺陷唯一归责于某层。
- 当前服务仍为 WebBase `90c41a0`、已安装 `@hamster-note/notes@3.2.0`，6218/6217/6219；不是因为合并 notes main 就自动使用源码包。
- 诊断分支已合入包含 PR #22 的 notes main（`2cc136b`，诊断 HEAD 基线 `5845fcc`）。当前源码的 `blockReorder.ts:643,673` 在 composing 时不开始长按；本次包含 PR #22 的源码和发布包结果一致。这足以说明 PR #22 不是该受控异常的必要条件或修复；真机触摸与焦点交互仍须原始 trace 判断。
- 没有依据认定是 WebBase 升级或 notes 某次版本升级回归。此前历史结论仍成立：HAM-107 没有修复输入引擎，HAM-76 的候选同步修复也未采用。

## 下一份证据需要记录什么

已升级 `scripts/capture-hnn-ime-events.js` 为 schemaVersion 2，仍是本地观察器，不修改 DOM/选区、不取消输入、不联网。新增：完整 editor HTML、选区 anchor/focus 的子节点路径、beforeinput targetRanges、mutation 新增/删除节点与旧文本、事件后的 microtask 快照；有 Tiptap 实例时订阅现成 transaction 通知，记录前后模型、steps、composition meta、调用栈。所有尺寸上限显式报告截断。mutation 的节点内容是在 observer 回调时序列化，不能误当作原生修改瞬间的快照。

在出现问题的空白测试笔记、实际 HNN iframe 中执行新版本（覆盖旧记录器），用真机输入 `nihao` 并执行原来会重复的候选确认操作，停止前保留两行结果：

```js
ham172Ime.download() // 或 ham172Ime.stop()，返回完整 JSON
```

优先取得能复现的手机 Safari 样本；如能连接 Expo 的 WebView Inspector，再补 Expo 样本。请同时记录设备/OS、浏览器或 Expo 版本、键盘/输入法、具体确认操作。模拟器用同版本记录器补一份相同操作，才能对比以下事实：

1. 两端是否都发生 deleteCompositionText；targetRanges 指向哪里、删除后完整 DOM 和模型各是什么。
2. 第一个新增段落的 transaction 是 splitBlock，还是直接 DOM replace，是否在 composing 期间。
3. 最终 insertFromComposition 对哪个 P 写入；是否还有来自宿主/重新装载的额外 transaction。
4. 单独用同一键盘在普通输入框测试“确认”与“选定”，判断 Return 提交拼音是否符合输入法本身行为。

若真机取不到 Inspector，截图/录屏仍能证实用户现象，但无法填补上述 DOM/transaction 缺口。当前“模拟器不重复正文”的原因只能说它最终没有保留第一段文字，不能说明真机是少发事件、时序不同还是宿主双写。

观察器的序列化有运行开销；若注入后不再复现，请同时保留未注入时的结果，不能把有记录器时的不复现作为修复证明。

## 验证与重跑

```sh
node --check scripts/capture-hnn-ime-events.js
node --check scripts/probe-composition-delete-browser.mjs
node scripts/probe-composition-delete-browser.mjs
node scripts/probe-composition-delete-browser.mjs --skip-synthetic-keymap --output=evidence/ham172/delete-replay-source-no-keymap.json
node scripts/probe-composition-delete-browser.mjs --initial= --output=evidence/ham172/delete-replay-source-empty.json
# 发布包对照：每条命令加 --consumer=../WebBase/webview，并换 output 文件名
```

六组各 10 个样本，共 60 个受控样本；断言模型/DOM 结果及 v2 记录字段、transaction 可用、beforeinput 未被取消、stop 后数据冻结及重复 stop 稳定。Linux 上通过已有 Ubuntu 容器运行 WebKit 26.4；所有本次浏览器和临时 Vite 均在 finally 中关闭。无运行时代码改动，不把历史全量测试冒充为本轮重跑。开发服务保持可用。
