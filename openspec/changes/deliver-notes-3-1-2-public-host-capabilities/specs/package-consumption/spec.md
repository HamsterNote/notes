# Spec Delta

## Purpose

让下游以可追溯的源码和实际安装包验证 notes 3.1.2 的公开引用失效与 Provider 上传能力，并用完整旧入口回归、真实浏览器证据及干净副本消费，避免将规划、版本标签或私有源码接线误当作已实现的兼容交付。

## ADDED Requirements

### Requirement: 3.1.2 保持 3.1.1 消费契约

3.1.2 MUST 保留 3.1.1 既有根 ESM/CJS runtime、类型及 CSS 导出、NoteEditor/NoteSave 和 Provider/View/Controller 原有行为。旧 NoteEditor CAS 保存与 Provider 唯一队列保存 MUST 保持各自签名；A 共享 history、freeze lease 结果及旧判别联合 MUST 不被改写。旧入口回归失败 MUST 停止交付并回报，不得删除或弱化原断言以宣称兼容。

#### Scenario: 旧消费示例安装新包
- **WHEN** 仅将 3.1.1 消费 fixture 依赖改为 3.1.2
- **THEN** runtime/CSS 导入、类型编译、编辑保存、旧 CAS/conflict/revision、共享 A、freeze 和无上传 Provider 回归 MUST 继续通过

### Requirement: 3.1.2 包身份与干净消费证据

交付 MUST 附可安装 3.1.2 pack、完整源 commit、tarball SHA-256、文件清单、包内版本、包根 runtime 与 `.d.ts` 证据和安装说明。仓库外干净副本 MUST 只用指定 pack 及声明依赖完成新旧 API 的类型检查、构建与运行验证，不使用 workspace 链接、源码 alias、私有导入或 patch。合并及发布 SHALL 按本单已有授权及仓库发布流程执行，发布后 SHALL 核对 registry 精确 3.1.2 的 integrity、tarball hash、tag/commit 与已验收包的文件差异。

#### Scenario: 可独立重现的安装
- **WHEN** 下游安装交付 hash 对应的 pack
- **THEN** MUST 读到精确 3.1.2，并仅经根入口使用失效命令与 Provider 上传；ESM/CJS、`.d.ts`、CSS 均完整，证据可追溯到实际源提交

### Requirement: 正式测试与宿主验收如实交接

正式全量 test/typecheck/build/lint 与仓库既有发布契约守卫 MUST 通过。新增正式测试 MUST 覆盖候选级/文档级失效、保 history、旧 resolver 迟到、上传成功/失败/重试/取消/迟到及门禁交互；公共 Provider 真实浏览器用例 MUST 验证可见状态和最终 HNN。HAM-36 的 Reader 删除高亮 E2E 及宿主上传回归 SHALL 由 HAM-36 升级正式 3.1.2 后复跑，未取得结果不得宣称宿主验收通过；上游交付不得修改 WebBase 或 HAM-36 tasks。

#### Scenario: 区分上游完成和下游验收
- **WHEN** 上游交付报告与 3.1.2 包
- **THEN** MUST 列明正式检查结果、浏览器证据、原始日志、干净消费结果、未验证项目与宿主复跑入口；历史选择性撤销反例仍单列为 A 不承诺项，不计入全绿
