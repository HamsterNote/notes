# Spec Delta

## MODIFIED Requirements

### Requirement: History 由库内封闭扩展维护

编辑内核 MUST 使用库内装配的封闭 history 扩展维护撤销/重做；宿主 MUST NOT 注册、替换或直接取得 schema、extensions 或 history 实例。会话重建时 history MUST 清空。未配置宿主历史回调时，独立编辑器 SHALL 使用既有本地历史，共享同一文档会话的视图 SHALL 使用唯一全局历史栈，按正文操作时间顺序撤销/重做，不建立视图私有历史。

macOS Cmd+Z SHALL 撤销，Cmd+Shift+Z SHALL 重做；Windows Ctrl+Z SHALL 撤销，Ctrl+Shift+Z SHALL 重做；既有 Mod+Y 重做兼容入口 SHALL 保留。快捷键和同视图工具栏 SHALL 使用同一历史所有者与动作语义。若配置既有宿主历史请求回调，快捷键 SHALL 仅调用一次该回调，传递正确方向与当前会话身份；无论返回已处理或未处理 MUST NOT 再回落本地历史。宿主回调只委托方向处理，不提供 schema、extensions 或 history 实例注入；宿主通过既有受控文档更新契约同步结果。

正文快捷键 SHALL 仅作用于实际拥有编辑焦点的正文视图，不抢占编辑器外部、NodeView 表单、其他 input/textarea、确认层或配置输入的原生撤销。只读/freeze/IME 或 229 组合事件 SHALL 不发起正文历史请求；Alt 混合修饰键 SHALL 不作为上述快捷键。有效正文快捷键 SHALL 一次最多执行一个历史动作并消费事件，即使历史栈为空或宿主回调返回未处理，也 MUST NOT 继续浏览器原生正文撤销。正文以外的输入与组合输入 SHALL 保持其原有键盘处理。

有效撤销/重做 SHALL 同步共享文档所有视图，保留其他视图焦点，并遵守现有选区书签恢复、正文通知、保存 baseline 和 dirty 计算契约；MUST NOT 自动宣称保存成功。撤销后新编辑 SHALL 清空重做分支；文档标识或 loadKey 变化 SHALL 清空旧会话 history，不跨文档撤销。本次引用换行、确认删除和斜杠转换 SHALL 各为独立单步历史事件，不与前后输入合并；菜单开关、取消、主题变化和被拒绝的操作 SHALL 不增加正文历史。

#### Scenario: 宿主无法定制 history 或扩展

- **WHEN** 宿主尝试传入 schema、extensions 或 history 配置
- **THEN** 编辑内核 SHALL 不提供接受该配置的公共入口
- **AND** 会话重建后撤销/重做 SHALL 不包含先前会话的操作

#### Scenario: macOS 和 Windows 标准快捷键
- **WHEN** 正文有焦点且有可撤销操作，macOS 使用 Cmd+Z/Cmd+Shift+Z，Windows 使用 Ctrl+Z/Ctrl+Shift+Z
- **THEN** SHALL 分别撤销和重做一次，与同视图工具栏行为一致，且不触发第二次浏览器原生正文历史

#### Scenario: 跨共享视图全局撤销
- **WHEN** 共享会话的视图 A 和 B 先后编辑，A 再按撤销快捷键
- **THEN** SHALL 撤销全局最后一次正文操作，两个视图同步，B 的焦点不被抢占

#### Scenario: 宿主接管历史
- **WHEN** 独立 Provider 配置既有宿主历史请求回调并在当前正文按一次撤销或重做
- **THEN** SHALL 仅向宿主发送一次正确方向和会话身份，不另执行本地历史；回调返回未处理时也不进行本地 fallback

#### Scenario: 受限上下文和表单输入
- **WHEN** 在只读/freeze/IME、弹层输入、NodeView 表单或编辑器外按上述快捷键
- **THEN** SHALL 不修改正文历史；输入框保留自身撤销行为，不调用正文或宿主历史请求

#### Scenario: 空历史和分支清理
- **WHEN** 正文空历史时按快捷键，或撤销后进行新正文编辑，再尝试重做
- **THEN** SHALL 不发生浏览器原生正文回退；新编辑之后旧重做分支不可恢复，不产生伪保存成功状态

#### Scenario: 新结构操作可独立撤销
- **WHEN** 在输入文字之后执行引用退出、确认删除或斜杠转换，之后继续输入，再逐次撤销
- **THEN** 每个结构动作 SHALL 独占一步，前后输入不被该结构步骤同时撤销，菜单取消或主题切换不占用历史步骤

## ADDED Requirements

### Requirement: 底部栏完整跟随视图明暗主题

笔记底部工具栏 SHALL 使用所属编辑视图当前主题，覆盖撤销/重做、文件入口及其弹层、保存、状态文字、图标、背景、边框和 hover/pressed/focus-visible/disabled 状态；MUST NOT 出现夜间白底白字或不可辨认的操作。普通文字与背景对比度 SHALL 不低于 4.5:1，启用控件的必要视觉边界和焦点指示 SHALL 不低于 3:1；禁用态 SHALL 可辨认且禁用操作不可执行。

主题 SHALL 随视图主题运行时变化，不要求重新装载；同页明暗分屏 SHALL 彼此隔离。渲染到正文视图之外的文件菜单等弹层 SHALL 继承发起视图主题，不从全局主题或其他视图取色。既有 inline 工具栏及浮动底栏布局、桌面及移动断点 SHALL 一致适配，不因修复主题改变原有布局占位或功能入口。主题切换 SHALL 不重建会话、不改正文、选区、dirty、保存 baseline 或历史。

#### Scenario: 夜间底栏与文件菜单
- **WHEN** 在 1440px 和 390px 布局使用暗色视图底栏，打开文件菜单并以指针及键盘操作
- **THEN** 底栏、状态文字和菜单 SHALL 使用暗色主题，交互态/焦点可辨认，符合对比度要求，无白底白字

#### Scenario: 明暗切换和分屏隔离
- **WHEN** 同页两个视图分别为明暗主题，独立切换其中一个视图主题并打开其底栏菜单
- **THEN** 仅所属视图及其弹层 SHALL 更新主题，另一视图不串色；会话身份、正文、选区、dirty 和历史保持不变

#### Scenario: 保持底栏功能及布局
- **WHEN** 分别使用 inline 与浮动底栏布局，在主题切换前后执行撤销、重做、文件选择和保存
- **THEN** 入口、布局占位和既有行为契约 SHALL 保持，主题修复不改变历史或保存所有权
