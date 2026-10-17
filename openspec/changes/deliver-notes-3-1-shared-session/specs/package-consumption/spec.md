# Spec Delta

## Purpose

使下游能够根据不可变的源码与包身份验证 notes 3.1.0 的真实能力，并通过旧入口兼容回归和独立安装检查确认可消费性，避免把版本号、隔离原型或源码私有导入误当成正式包交付。

## ADDED Requirements

### Requirement: 3.0.0 兼容硬门禁

3.1.0 MUST 保留 3.0.0 根 runtime、类型与 CSS 导出以及 NoteEditor/NoteSave 行为；新保存签名 MUST 仅属于新增 Provider。若旧入口兼容回归失败 MUST 停止 3.1.0 交付并重审 major，不得通过删改原有断言掩盖失败。

#### Scenario: 旧消费者继续工作
- **WHEN** 3.0.0 消费示例改装目标 pack
- **THEN** 原 runtime/CSS 导入、类型编译、NoteSave 的 saved/conflict/revision 行为 MUST 继续通过

### Requirement: 精确包身份与根入口独立消费

交付 MUST 包含 package.version=3.1.0 的 pack、完整 source commit、tarball SHA-256、pack 文件清单、根 ESM/CJS runtime 与 .d.ts 证据、安装说明和原始验证日志。干净独立项目 MUST 仅安装该 pack 与声明依赖，通过包根装配 Provider/双 View/Controller 并完成编辑保存、旧入口回归、类型检查及构建；不得使用源码别名、私有路径或 package patch。npm 发布 MUST 等待独立人类授权。

#### Scenario: 干净消费成功
- **WHEN** 在仓库外干净副本安装指定 hash 的 pack
- **THEN** MUST 确认包内精确 3.1.0、根 runtime/type/CSS 完整，新增和旧接口均可用，报告能追溯到实际 source commit

### Requirement: 正式证据与历史失败分开报告

正式测试、typecheck、build MUST 通过，A、lease、save、draft、NodeView/异步失效 MUST 有正式组件证据。原型与合成 composition MUST NOT 替代正式库、实体 IME 或真实宿主验收。原选择性撤销反例 MUST 保留原断言且不 skip/xfail，单列为 A 不承诺的历史探针；历史探针运行非零退出 MUST 如实报告，不得写成全量全绿或掩盖正式回归。

#### Scenario: 下游门禁交接
- **WHEN** 上游提交交付报告
- **THEN** MUST 分别列出正式测试结果、历史探针失败及未跑的宿主/实体 IME 验证；包身份与独立消费证据未齐前不得宣称兼容已实现或允许 HAM-36 切换依赖
