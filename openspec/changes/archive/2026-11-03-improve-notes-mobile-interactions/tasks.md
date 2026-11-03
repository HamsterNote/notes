# Tasks

## 1. 共享命令与布局策略

- [x] 1.1 从 `blockMenu.ts` 提取内部可复用块命令描述，保留实时目标校验、无损转换、图片上传及上下移边界；以 `blockMenu.test.ts` 验证桌面菜单行为及失效目标无提交。
- [x] 1.2 增加内部 ≤840px 布局策略并对齐 CSS，跨断点取消临时交互；以 840/841px 和动态媒体查询组件测试验证，无新增公共 props。
- [x] 1.3 补齐基本格式命令和下划线封闭扩展装配，经现有预算事务提交；以 codec/extension 测试验证三格式组合、旧 HNN 可读、下划线往返及超预算无变更。
- [x] 1.4 修正 Markdown 对 underline 的保真判断并接入已有无损围栏路径；以 `markdown.test.ts` 验证导出再导入不丢下划线，未改变方言与默认保存流程。

## 2. 移动端正文长按排序

- [x] 2.1 在 `blockReorder.ts` 为移动布局块正文接入触摸/笔入口，按 pointerdown 前的焦点排除当前聚焦顶层块（保留原生文字选择），并排除内部交互控件和 IME；其他块/失焦视图保留的非空选区不得误杀未聚焦目标；以 `blockReorder.test.ts` 假时钟覆盖聚焦/未聚焦/其他块聚焦、按下后自然聚焦不改变意图、499/500ms、10px/超过10px、提前抬起、第二指针和 pointercancel。
- [x] 2.2 激活时复用源块高亮和落点线，添加可选单次10ms震动、pointer capture 和残余 click 抑制；从 pendingHold 到 active 临时禁止本视图 selectstart/选区生成（user-select、WebKit callout 保护），全部退出路径恢复原样；所有 contextmenu 放行，聚焦块原生选择不受影响；测试震动缺失/拒绝/抛错均可继续拖动，pending/active 取消后监听和样式恢复、contextmenu 放行及已有选区回归。
- [x] 2.3 pointerup 使用最终坐标计算落点，复用单事务重排和历史栅栏；以有效移动、原地、docChanged、freeze、跨断点、卸载测试验证节点身份保留、取消零正文事务、前后输入与排序分属撤销事件。

## 3. 两类文字 popover

- [x] 3.1 增加不夺焦的移动块 toolbar，按 specs 平铺七个文字按钮，在同一浮层展开横向转换/插入选项；组件测试验证焦点切块、原子块、首末块、无上传能力及无损转换禁用原因。
- [x] 3.2 实现非移动 TextSelection toolbar，仅含加粗/斜体/下划线；组件测试覆盖鼠标与键盘选区、全范围/混合格式切换、折叠光标、NodeSelection、CellSelection、代码和 IME 排除。
- [x] 3.3 两类 toolbar 共用选区保留、权限检查及生命周期协调；覆盖移动折叠光标设置后续输入格式、点击不丢范围、Escape 抑制重开、外部点击、断点切换和失效范围不提交的组件测试。
- [x] 3.4 在 `styles.css` 隐藏移动 handle/gutter 并实现横向滚动、主题和 pressed/disabled 状态，加入可见视口定位及键盘导航；组件几何/交互测试验证 320px 不溢出、下方不足翻转、锚点不可见关闭及左右键/Home/End/Enter/Space/Escape 可操作。

## 4. 会话集成与回归验证

- [x] 4.1 同时在 `session.ts` 和 `documentSession.ts` 的每个视图装配及清理交互；以单编辑器和 Provider 双视图测试验证共享格式/排序撤销、freeze、会话切换、视图卸载、迟到回调无副作用及无焦点抢占。
- [x] 4.2 执行 `yarn lint`、`yarn typecheck`、`yarn test`、`yarn build`，确认已有块菜单、HNN/Markdown、上传、选区和共享会话回归通过；记录实际结果，不以文档存在替代产品验收。
- [x] 4.3 使用仓库 Demo 和现有 Playwright 依赖编写/执行 Web 浏览器交互验证脚本，交付可复现脚本及结果；覆盖 320/390/840/841/1440px、明暗主题、鼠标和真实触摸事件序列的聚焦块原生长按选择、未聚焦块长按排序、pending/active 文字选择保护、contextmenu 放行、已有其他块选区及滚动取消，并提供 CDP 触摸起拖/落点重排前后对照、长文本、键盘导航及可见视口变化，确认排序、文字按钮、定位和页面无横向溢出。仓库没有现成 E2E script，不虚构 `test:e2e` 命令；浏览器不支持的震动仅验证降级及调用契约，不将模拟调用声称为硬件证据。
- [x] 4.4 更新 `DESIGN.md` 中本需求相关断点、popover 和顶层拖动说明，以及 README 的下划线持久化/旧消费者限制；对照三个 delta specs 逐项核验五项需求，记录开发验证为 Web 侧，不要求原生构建、模拟器或发布。
