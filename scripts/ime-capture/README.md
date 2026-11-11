# HNN 开发环境取证页（HAM-219）

仅取证工具，无生产影响。不修改编辑器、composition 处理或宿主输入桥接，不启用历史 experimental guard。使用原版 `scripts/capture-hnn-ime-events.js`，SHA-256：`a27dd515a994cbd4105afa089b2e6f15ce6cb74a2c6599d5102788a415311ec3`。

现有开发服务入口：

- 局域网：`http://192.168.0.145:6218/__ime-capture`
- ZeroTier：`http://192.168.192.30:6218/__ime-capture`

打开后在下方新建测试笔记，等待“正在记录”，输入 `nihao` 并点选候选，再点“导出”。可复制、下载 `ham172-ime-events.json`，或在复制不可用时全选文本后长按复制。“开始记录”会丢弃当前记录重新开始；导出会停止当前记录，重复导出保持同一份快照。

## 接入现有开发服务

在**本地开发启动配置**（不要提交到生产应用入口）中引入插件：

```js
import hostConfig from '/absolute/path/to/WebBase/webview/vite.config.ts'
import { imeCapturePlugin } from '/absolute/path/to/notes/scripts/ime-capture/plugin.mjs'

export default {
  ...hostConfig,
  plugins: [...hostConfig.plugins, imeCapturePlugin({ gatewayPort: 6218 })],
}
```

编辑器 Vite 仍在 `WebBase/webview` 目录启动，增加 `--config /path/to/local-config.mjs`，使用 `--host 0.0.0.0 --port 6219 --strictPort`。原 gateway 的启动命令替换为：

```sh
GATEWAY_PORT=6218 METRO_HOST=127.0.0.1 METRO_PORT=6217 \
  node /path/to/notes/scripts/ime-capture/gateway.mjs /path/to/WebBase
```

如更换编辑器端口，另设 `IME_CAPTURE_EDITOR_PORT`，并保持宿主现有编辑器 URL 配置与其一致。网关继续复用 WebBase 的原代理与 WebDAV 处理器，只有 `/__ime-capture` 由诊断工具响应。Metro 无需更改。

页面通过 `postMessage` 发现嵌套编辑器。编辑器桥接仅接受来自顶层、相同 hostname 与指定 gateway 端口的消息；取证页验证来源窗口、编辑器 origin、会话与导出请求 ID。普通 dev 页面中的桥接保持休眠，仅取证页触发后才加载记录器；不影响其他页面已有的控制台取证。

## 生产隔离与记录格式

- 插件 `apply: 'serve'`，仅 `configureServer` 提供脚本，生产 build/preview 不注册该插件或端点。
- 网关脚本在 `NODE_ENV=production` 直接拒绝启动；不导入任何生产应用入口。
- npm `files` 白名单只有原有库产物，脚本不进入 npm 包。库和 demo 的生产构建都不引用诊断脚本。
- 导出不包装、不筛选、不裁剪 v2 `read/stop` 返回值。v2 **原有** 1000 事件及字段长度上限保留，任何超限仍带原来的 `truncated` 标记；工具不宣称无限记录。请使用空白测试笔记和一次短输入。
- 完整 DOM、模型、选区、targetRanges、mutation 新旧节点、transaction steps/调用栈留在浏览器内存，只有用户主动复制/下载才离开页面。Mutation 节点在 observer 回调时序列化；不代表原生变动瞬间快照。
- 页面刷新会丢失尚未导出的记录；打开后需等待编辑器显示“正在记录”。

## 验证

已启动服务后运行：

```sh
node scripts/check-ime-capture-browser.mjs
BROWSER_ENGINE=webkit node scripts/check-ime-capture-browser.mjs
```

可设置 `IME_CAPTURE_URL`、`CHROMIUM_PATH` 或 `WEBKIT_PATH`。脚本创建独立测试笔记，覆盖自动加载、重新开始、字段、复制后实际读取剪贴板并逐字比较、下载逐字比较、全选兜底和停止后快照冻结。

Chromium 使用 CDP composition API；Linux WebKit 使用合成 composition 事件与 `keyboard.insertText`。这两种都只验证取证入口，**不代表手机系统输入法，也不证明 HAM-172 已修复**。证据在 `evidence/ham219`，WebKit 单列在 `webkit/`。

当前服务由既有 tmux `ham172-dev` 保留（尽力持续，不保证重启后存活）。停止整个既有开发服务：`tmux kill-session -t ham172-dev`。撤下取证工具时恢复原 gateway 启动命令，并移除本地 Vite 配置中的插件即可。
