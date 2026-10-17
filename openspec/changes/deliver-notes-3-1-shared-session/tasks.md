# Tasks

所有任务为后续 apply 阶段执行，本轮仅 propose，初始全部未勾选。正式库全量与历史研究探针的退出码分别报告；任何正式回归、兼容失败或缺失包身份均阻止交付。依赖顺序：1 → 2 → 3/4 → 5 → 6 → 7。各阶段未知失败先停止并报告，不以版本目标代替证据。

## 1. 兼容基线与历史证据

- [x] 1.1 固定 3.0.0 commit `2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c` 的根 runtime/type/CSS 清单与旧消费 fixture；运行旧 publicApi、publicApi.types、NoteEditor/session 回归，记录基线日志及退出码。
- [x] 1.2 从 HAM-36 附件取得已评审公共契约、原始选择性撤销反例、review-boundaries/freeze-lifecycle 测试，记录附件身份和 hash；原反例保留全部断言且不 skip/xfail，独立运行并如实报告已知不满足项，不能冒充正式新行为。
- [x] 1.3 增加根入口新旧接口共存的类型契约测试，覆盖完整 Provider props、Controller 方法和全部结果判别；确认新接口不暴露 PM/schema/session 且旧 NoteSave 类型无需修改。

## 2. Provider、View 与权威正文

- [x] 2.1 实现内部文档协调器和 Provider/Controller 的 identity、getState/subscribe、生命周期；通过严格非法 HNN/load-error、stale 命令、同 key props 不覆盖、合法新 load 与旧 controller 失效测试。
- [x] 2.2 实现单权威 doc/history 与双 View transaction router，逐 view 保存 selection/focus/stored marks；通过交错输入、stale 映射/原子拒绝、peer 选区映射、普通输入不 remount 与单次 onChange 测试。
- [x] 2.3 接入键盘/toolbar 的全局 undo/redo 和 view 切换分组边界；验证 `ABA→AA→原正文` 及 redo、同 view 分组/仅焦点切换、新编辑清 redo、非正文动作不入栈。
- [x] 2.4 实现 view detach/reopen 与实例令牌；验证 survivor 实例/选区保持、全部 detach 后 history 保留、新 view 可撤旧事件，显式合法新 load/dispose 才清历史。

## 3. Metadata 与保存

- [x] 3.1 实现 metadata 校验/防御拷贝和 body/host 双 dirty；测试安全整数、单调 changeId、同 id 同值 unchanged、倒退/同 id 异值 failure、metadata-only 与外部对象突变。
- [x] 3.2 实现唯一 600ms requestSave timer 和串行 drain/barrier，按钮/宿主保存复用；测试 inflight A/M1 后 B/M2、重复请求同 barrier、最大并发 1、真实 Promise 完成前不推进 baseline、只推进捕获快照。
- [x] 3.3 实现完整保存判别结果、completion 终结、preflight 与显式 retry；测试已保存 A 后编码失败 B 不放行、dirty 保留、failure 不自动重试、stale/not-ready/dispose/replaced，不产生第二 producer。

## 4. 请求归属 freeze

- [x] 4.1 实现 acquire/release 的 session/request/lease 校验和串行队列；测试非空白/128 code unit 边界、session 优先、入队参数拷贝、同请求幂等、异请求独立、错误归属/重复释放 stale-lease、结束后迟到 acquire request-ended、失败同请求可重试。
- [x] 4.2 在入口同步登记独立 pending acquire 计数，并与 dirty/draft/save/lease 组合替换门禁；验证最后 release/下一 acquire、通知内重入入队、单请求失败清理不清其他计数，inputFrozen=false 不等同于可替换。
- [x] 4.3 实现 composition/DOM 提交确认与全部输入窄命令 gate；测试 composition-commit/pending-edit、不丢快照/草稿/history、metadata blocked、多个 lease 最后一个才解锁，save/blocked/failure 不自动 release。
- [x] 4.4 实现通知后生命周期复核与 dispose 清理；逐字保存原 P2 探针，另加正式 Provider 获取和释放通知内同步卸载、queued/inflight 销毁测试，验证 abort/disposed、identity:null 且无旧 lease 成功回执。

## 5. 草稿与完整控件

- [x] 5.1 将 card/drawing 草稿归属接入 Provider 和公开状态；验证 phase/owner/changed 不含 payload、合法完成一次 transaction/onChange/history、取消零 transaction、validation 失败保留与焦点恢复。
- [x] 5.2 接入双正文 modal/undo 锁、portal freeze 叠加锁与 canDetachView；测试两种草稿保存/关闭 blocked、queue idle 时零 write、owner 禁 detach、peer 可 detach、无自动完成/取消。
- [x] 5.3 将真实 NodeView、块菜单/重排、clipboard、mark/表格/公式等已有节点装配到新 View；通过正式组件完整编辑回归和共享 history 测试，禁止用 prototype 页面代替。
- [x] 5.4 统一 Provider reference 三回调与异步窄命令，保留旧上传兼容；测试 session/view 重建、目标删除、迟到解析/上传、映射位置、freeze 拒绝插入及单次 onChange。

## 6. 正式验证与兼容硬门禁

- [x] 6.1 从 `src/lib/index.ts` 新增公共导出并增量扩展 API 允许列表；通过新旧根 runtime/type 消费、旧 saved/conflict/revision/CSS 回归；任一旧入口回归失败立即停止 3.1.0 并提出 major 重审。
- [x] 6.2 在真实双视图页面执行浏览器交错编辑/undo/redo/重开、草稿、freeze/异步失效与 React 生命周期验证，记录浏览器版本和原始日志；实体 IME 单独实测记录，未执行须标缺口而非通过，不声称真实 WebBase bridge 已验收。
- [x] 6.3 测量并记录长会话 mapping/history/tombstone 的操作量、保留项和资源预算；验证安全压缩后行为一致，不以 TTL/随意清理 tombstone 破坏 request-ended。
- [x] 6.4 运行实际脚本 `yarn test`、`yarn typecheck`、`yarn build`、`yarn lint`，保存完整日志/退出码与正式组件覆盖清单；另运行历史探针报告已知失败，正式集合必须全绿且无未归因失败。

## 7. Pack 与交付证据

- [ ] 7.1 在兼容门禁通过后将 package.version 设为精确 3.1.0，提交已验证源代码后用本地 pack 生成 tarball；记录完整 source commit、包内 version、tarball SHA-256、文件清单及 ESM/CJS/.d.ts/CSS/fonts 证据，不执行 npm 发布。
- [ ] 7.2 创建仓库外干净消费副本仅安装该 pack/声明依赖，验证根 ESM/CJS、新 Provider/双 View/Controller 的编辑保存、旧 NoteSave、类型检查与消费构建；保存安装解析、实际 hash、命令和日志，不使用 private imports、aliases 或 patch。
- [ ] 7.3 交付 pack、安装说明与兼容/正式/历史/IME/资源报告，清楚标明未跑的宿主验证和 pack source commit；提交并推送实现分支、开标题包含 HAM-36 的 PR，附可复核证据。证据不齐不得宣称兼容或推动 HAM-36 的依赖切换，不修改其任务勾选。
