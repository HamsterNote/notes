# A 口径迁移执行计划

2026-10-17，HAM-36，供评审。修勾已批准双 pane 共享撤销栈 A；本计划更新契约、design/tasks，不开始正式实现或 WebBase apply。原 21 个任务 ID 保留，1.1 调查报告已交付，**1/21 完成、20 项待实施**。计划获评审结论前不修改依赖、不勾实施任务、不发布包。

## 1. 版本与进入实施的条件

| 层次 | 固定身份/目标 | 当前证据与用途 |
| --- | --- | --- |
| WebBase 现状 | notes 精确 2.0.0；本次前 HEAD `1984b7d7462762c1d25a85897844d79a04232870` | 生产代码、package/lock 保持原状；本次只改 change |
| 上游格式基线 | notes v3.0.0，`2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c` | 有严格 HNN v1 codec，但现有公开 props 不足以满足三门禁 |
| 隔离研究基线 | notes `378aba1b6b95fa338a873eaa7d592ef27280f99f` | 有 shared history 与 freeze lease 原型；不是正式根导出或可消费包 |
| 计划消费版本 | **`@hamster-note/notes@3.1.0`，精确版本，不用 ^/~** | 2026-10-17 npm 仅列 2.0.0、3.0.0，latest=3.0.0；3.1.0 尚未实现/发布 |

3.1.0 的范围是新增公共 `NoteDocumentProvider`、`NoteEditorView`、`NoteDocumentController` 及相关状态/结果类型，保留 3.0.0 NoteEditor/NoteSave/codec 等入口兼容。新 Provider 采用新的 onSave Promise<void>，不改变旧 NoteEditor 的回调签名。如果无法 additive 地提供此能力，停止实施并重新评审 major 版本，不能把破坏兼容隐藏在本次小版本。包名/版本确定不等于包已存在，也不授权发布。

实施须依次满足：

1. **计划评审与实现授权**：owner 接受本文依赖与移除项。A 批准已经完成，不再重复询问 A/B；freeze `378aba1` 两项 P2 也已独立复验通过（评论 `01a14a10-162d-73ee-be89-2323757c33c2`），24/24 定向测试通过，范围限定于隔离原型生命周期。
2. **正式上游实现与验证（1.3）**：公共 Provider 生命周期、完整 NodeView/卡片/画板/reference、shared history、保存/草稿状态与 freeze 契约有正式代码和 Web 证据；不能直接把 PrototypeSession 导出充数。原 3.0.0 公共入口有兼容回归。
3. **可消费包证据**：记录 source commit、package.version=3.1.0、包根 runtime 和 .d.ts 导出、完整打包文件、tarball SHA-256 及独立消费构建/类型检查。先做本地包验证须在获实现/验证授权后；公开发布另需批准。最终生产依赖使用经批准的不可变包解析与 integrity，不保留 file:/动态分支。
4. **宿主实施与验收**：才开始 2.1 的版本/锁切换；父级验证 owner 最终执行四个 Web 入口，三门禁均有真实宿主证据才关闭。任一版本/包能力不匹配立即停，不能回退到 3.0.0 私有导入或包 patch。

3.1.0 前置能力由后续获授权的上游实施负责人交付；本文不发起新任务派发、不替发布负责人批准发布。freeze 复验结论来自代码审核员的独立副本，未覆盖全量/浏览器/实体 IME/真实 WebBase bridge，不以它代替正式集成证据。

## 2. A 的行为与验收修订

一个 Provider 在同文件 split 上方，一个正文和一个全局 history，双 pane 均可编辑、选区独立。任意 pane 的 undo/redo 面向**全会话最近正文历史事件**；可撤另一栏动作。A 插入 AA、B 中间插 B：`ABA共享正文 → undo → AA共享正文 → undo → 共享正文`，两次 redo 恢复 ABA。切换编辑 view 关闭分组，同 view 连续输入沿用 PM 分组。

metadata 不在正文历史里；草稿完成一次事件，取消无事件；草稿开放和持有 lease 时禁正文撤销。pane 重开及全部 view detach 保留会话栈，Provider 新 load/dispose 才清空，刷新后只恢复已保存正文而非 history。执行 pane 使用历史选区，peer 选区映射，普通输入不 remount。

| 原要求 | A 下的处理 | 理由/证据要求 |
| --- | --- | --- |
| 每 pane 独立选择性撤销，A undo 必须保留插入范围中的 B | **从当前验收移除**，不承诺达成 | 普通 PM 逆向删除会包含 peer 插入；通用来源追踪超出 MVP。用户已选择 A |
| 重开 pane 得空 localhistory | **改验收**：重开沿用 Provider 全局栈 | 历史属于文档会话，不属于 pane；survivor 仍须保实例/选区 |
| 用精确 3.0.0 公开 props 完成三门禁 | **无法达成**，版本改为精确 3.1.0 | 缺公共保存状态、草稿和共享 Provider；先交正式上游能力 |
| 仅布尔 freeze，异步回执 inputFrozen 即放行 | **改验收**：session/request/lease 归属及导航核验 | 不同请求不能互相解锁；入队至完成、通知内 dispose 均有明确安全结果 |
| 保存/旧坏文件拒绝/双侧可编辑/Reader 引用/无 CAS | **保留** | A 只调整 history 归属，不放宽保存安全或删除 split |

`notes/src/prototype/session.test.ts` 的原选择性撤销反例原样保留并加历史说明，断言正常运行、仍失败，不做 skip/xfail 或改预期。它是被移出 A 的 B 契约探针，须在全量报告中单列；A 必须另有正向断言。正式库/宿主回归集合按 A 建立，不能拿旧探针失败掩盖新的正式回归，也不能把一次全量非零退出写成全绿。

当前历史证据：`378aba1` 的全量 769 通过/1 个旧反例失败，浏览器 17 项通过/1 个同类失败；它们只证明隔离原型，不是本文新运行结果。A 正向原型测试位于 `round2.test.ts`，freeze 原样复现与边界测试位于 `review-boundaries.test.ts` / `freeze-lifecycle.test.ts`。

## 3. 20 项剩余任务与依赖

全部保持未勾选。表中“可达成”表示有明确实施路径，不是已通过；上游未交包时不能消除这项依赖。原任务 1.1 只交付调查报告，不再计入下表。

| 任务 | 处理/工作 | 必要前置 | 退出证据（未来执行） |
| --- | --- | --- | --- |
| 1.3 | 改验收：正式 3.1.0 三门禁/A/lease/旧入口兼容及包身份 | 计划评审、实现授权；原型 freeze 两项 P2 独立复验已通过 | 正式上游 Web 测试与可消费包，完整 NodeView/reference，根导出/类型/版本/hash |
| 1.2 | 保留：根入口真实覆盖 WebView 类型与单测 | 计划评审、宿主实施授权；可与 1.3 开发并行 | typecheck/test:run 输出确实收集 WebView 与宿主，不只检查根 exclude 外文件 |
| 2.1 | 改版本：精确 3.1.0 与必要 lock 解析 | 1.3、1.2 | 实际包 version/integrity、公共新导出与 1.3 包身份一致，保留 Reader patch；全应用 typecheck/build 在适配后的 6.1 收口 |
| 2.2 | 保留：宿主外壳与严格 codec/旧坏文件拒绝 | 2.1 | hnn-document 测试覆盖旧空/非空、未知版本/节点/URL/UUID/限额/metadata 污染 |
| 2.3 | 保留：宿主/WebView/PDF 新文件工厂 | 2.2 | 各入口合法 UUID 空段落，首次写入即合法，不依赖首开转换 |
| 2.4 | 保留：start-learning 禁止旧名补写，只有 notFound 新建 | 2.2、2.3 | 旧坏超限零写、manifest 不变，现有 study/file_map 语义 |
| 3.2 | 保留：loader 正规化和失败生命周期 | 2.2 | 只在合法成功 load 后创建会话/保存；重试/切文件旧回调不污染新会话 |
| 3.6 | 保留：笔记文本树与 metadata 搜索读取 | 2.2 | hnn-notes-data/search 相邻测试，不启用 Web LAN，不加入旧格式编辑 |
| 3.1 | 改 API：新 Provider/View 与 metadata/主题 | 2.3、2.4、3.2 | 真实组件、合法文档路径/loadKey、普通输入无 remount/失焦 |
| 3.3 | 改保存接线：唯一 requestSave/drain，host adapter await 真写 | 3.1 | 编码失败不放行旧 A、metadata-only、串行 barrier/显式 retry、坏目标拒写、无第二 timer/producer |
| 3.5 | 改验收：split 上方同一 Provider、A 全局 history | 3.1 | A 的交错输入/选区/键盘与 toolbar/redo 分支/重开保栈，不能关 split |
| 3.4 | 改关闭接线：请求归属 lease→保存→bridge/导航→释放 | 3.3、3.5 | same-session/own lease/saved-clean，最后 release/下一 acquire、重入 dispose、超时/旧回执、草稿 blocked |
| 4.1 | 保留：Reader 高亮映射为 mention/resource 候选 | 2.2 | 去重、query、名称/标识限额、无 externalItem 候选 |
| 4.2 | 保留：公共 Provider reference 回调与受控激活 | 4.1、3.1；完整退出依赖 3.4/3.5 | 当前 Reader/resourceId、signal、缺失 null、点击/键盘回跳、异步窄插入/冻结安全 |
| 4.3 | 保留：移除旧 imperative/外拖接线与 mock | 4.2 | typecheck 无旧导出；sidecar JSON 合并及笔记原始字节不变 |
| 5.1 | 扩验收：新版真实宿主存储主链路 + A/lease/草稿 | 3.4、3.5、3.6 | fresh build E2E，新建/返回/刷新/双 pane/失败与旧回执，diagnostics 无运行错误 |
| 5.2 | 保留：旧坏超限辅助文件拒绝/刷新零写 | 2.4、3.2、3.4 | 真实存储逐字节对比，主链路仍通过 UI 创建，不加生产种子后门 |
| 5.3 | 保留：学习分栏真实候选/保存/激活/删除缺失 | 4.3、5.1 | UI 与存储 resourceId/name、Reader 定位，无错误导航 |
| 6.1 | 按 A 总验收：父级四项 Web 命令及三门禁 | 1.2–5.3 全部完成 | pnpm typecheck/test:run/build:web/test:e2e:web 实际覆盖与版本、真实宿主证据齐，无未归因失败 |
| 6.2 | 扩说明：A 行为/精确版本/旧格式与无 CAS 边界 | 6.1 | 中文升级/回退/限制与实际验证一致，旧选择性撤销明确移除 |

推荐交付阶段：上游能力与可消费包 → 覆盖/版本/模型/拒绝 → Provider/A/保存/bridge → 引用与真实 E2E → 父级 Web-only 收口。阶段内可并行的 1.2、3.6、4.1 不改变后续依赖，也不授权当前提前编码。每阶段失败保留工作副本与证据，不越级勾任务。

## 4. 无法承诺的项目与停止点

- **当前 3.0.0 或隔离 patch 直接交付正式迁移：不可行。** 缺公共根导出、完整组件/NodeView 与包身份，先完成 1.3；不得私有导入/包 patch。
- **每 pane 选择性撤销：A 明确不提供。** 若将来重新要求 B，需单独算法研究/产品变更，不把它藏进本轮剩余 20 项。
- **实体 IME、真实 WebBase bridge、完整异步 reference/NodeView 的正确性：尚未证明。** 正式上游与宿主阶段分别提供 Web 证据，不能以合成 composition 或隔离 localStorage 替代；不因此声称 native 验收必需。
- **跨标签/设备 CAS、撤销已写远端、强制卸载防丢：不能保证。** adapter 没有条件写入，宿主必须遵守门禁；现有同路径串行写保留但不是 CAS。
- **旧文件转换、降级转换器、原 Reader 外拖手势、Markdown 导出 UI、新上传接入：不在本轮范围。** 旧文件拒绝编辑且零写；候选替代外拖。对已有上游上传能力的保留/冻结回归属于上游兼容证明，不等于给 WebBase 新增上传功能。
- **3.1.0 包未就绪、兼容入口破坏、三门禁或正式 freeze/其他回归不通过：停止消费/实施推进。** 返回明确证据，不自动换版本、砍 split、丢草稿或转写旧快照。原型 freeze 两项 P2 的已通过复验不再作为待办。

## 5. 本次交付与验收边界

交付 A 契约、design/tasks/proposal/specs 一致性修订与本文；保留历史门禁记录并注明最新决定。notes 仅同步契约/README 和反例注释，冻结实现与撤销实现不变。任务完成数仍 1/21，WebBase 代码及依赖不变，整体迁移未完成。

本轮仅运行 OpenSpec 结构校验和文档/改动范围一致性检查；**未执行 WebBase 四项实现验收**，不复用原型结果宣称它们通过。开发时验收为 Web-only；Android/iOS、Maestro、native build/EAS、模拟器/真机均非本次判据，原生专项与发布脚本保留。
