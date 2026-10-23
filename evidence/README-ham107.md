# HAM-107 标题回归修正

审核复现成立：旧版 `3.1.3-ham107.0` 排除了装饰节点 margin，但仍以普通段落的
固定行高平移手柄。320px 混合文档的非首块 H1/H2/H3 分别上偏约
21.51/17.35/14.23px，首块 H1 上偏约 3.92px。失败记录见
`ham107-heading-before.json`；新增用例在该版本断言失败。

`3.1.3-ham107.1` 在原有块重排插件的 view 生命周期内测量块实际首行位置，包含
块顶边距、边框、内边距和计算后的行高；按编辑区的实际缩放比例换算坐标。
widget 使用 `translateY(-50%)` 适应两种手柄尺寸。编辑更新、ResizeObserver、
窗口 resize 和字体加载触发合帧刷新，卸载时取消帧并释放监听。坐标相对正文，
滚动无需注册第二套监听。仅修改 widget 的样式，不派发文档事务。

验证命令：

- `corepack yarn typecheck`：通过。
- `corepack yarn test`：40 文件、811 项通过。
- `corepack yarn build:lib`：通过。
- `node scripts/check-block-handle-browser.mjs`：通过。

浏览器用例使用真实公开 Provider/View，11 个块、双共享视图，包含首块标题、
H1/H2/H3 与段落混排、长标题、空标题和空段落；同一页面动态调整
320/390/768/1440px 与 CSS zoom 1/2，再改变标题的 margin、padding、border、
行高及字号，并通过键盘转换标题级别。共 10 组、220 个块记录，最大中心偏差
0.013125 CSS px（阈值 2px）。纯布局更新不改变 onChange 计数，标题转换同步至
另一视图。完整 JSON 和四宽度截图见 `ham107-handles*`，动态排版截图见
`ham107-headings-dynamic.png`。CSS zoom 不等同于浏览器 UI 缩放或系统 IME。
