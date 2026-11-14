PR #32：已选文件 hover / active 配色回归

基线为 PR 分支 `agent/agent/885619567cf3` 的 `94ebfb1`。没有恢复或重新生成已归档的 OpenSpec change。

修复只给已选项增加 hover/active 选择器，继续使用 `--hn-text` 背景、`--hn-bg` 前景；未修改通用 hover/active 规则。新增选择器优先级高于通用交互态，前景/背景始终配对。

浏览器脚本使用实际指针悬停与 mouse.down 按住鼠标，并确认 `:hover` / `:active` 确实匹配。逐项断言被选按钮本身的 computed 前景、背景和文字对比度 ≥4.5:1，覆盖明暗两主题、inline/浮动底栏、1440/390px，共 16 组。

| 主题 | 状态 | 修前前景 / 背景 | 修前对比度 | 修后前景 / 背景 | 修后对比度 |
| --- | --- | --- | --- | --- | --- |
| light | hover、active | rgb(255,255,255) / rgb(241,245,249) | 1.10:1 | rgb(255,255,255) / rgb(30,41,59) | 14.63:1 |
| dark | hover、active | rgb(15,23,42) / rgb(32,43,63) | 1.26:1 | rgb(15,23,42) / rgb(241,245,249) | 16.30:1 |

两种布局、两种宽度所得数值一致。新增断言在修前全部采样后失败，原始失败输出保留于 `before.txt`；修后脚本完整通过，见 `browser.txt`。

环境：Linux x64，Node 24.15.0、Yarn 1.22.22、Chromium 148.0.7778.96。

| 命令 | 结果 | 完整原始输出 |
| --- | --- | --- |
| `node scripts/check-pane-toolbar-browser.mjs`（修前） | 预期失败，复现错误配色 | `before.txt` |
| `node scripts/check-pane-toolbar-browser.mjs`（修后） | 全部通过，原有布局/上传/主题切换检查亦通过 | `browser.txt` |
| `yarn test` | 60 文件 / 1153 测试全部通过 | `test.txt` |
| `yarn typecheck` | 通过 | `typecheck.txt` |
| `yarn lint` | 通过 | `lint.txt` |
| `yarn build` | 库和 demo 构建通过 | `build.txt` |

原始日志保留第三方 sourcemap、jsdom scrollBy、Node 弃用和大 chunk 告警。无最终检查失败；本轮使用 Linux Chromium 自动化验证上述配色，未新增其他系统/浏览器验证结论。
