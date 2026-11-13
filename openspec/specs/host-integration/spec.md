# host-integration Specification

## Purpose

定义笔记库对外公开的编解码、编辑器与保存状态界面契约，以及宿主必须提供的真实输入输出、资源上传与引用解析回调；同时规定保存状态的对外可观察语义，包括脏标记、保存中、错误与冲突，以及会话切换、卸载、上传临时态与冲突处理时对宿主回调的约束。

## Requirements

### Requirement: 库公开 HNN 编解码、Markdown 编解码、编辑器与保存状态界面
笔记库 SHALL 对外公开 HNN 编解码能力、Markdown 编解码能力、编辑器组件以及可嵌入的保存状态界面，使宿主能够在不接触内部实现的前提下完成装载、编辑、保存与导出。

#### Scenario: 宿主调用 HNN 编解码
- **WHEN** 宿主使用库公开的 HNN 编解码能力处理文档
- **THEN** 宿主能够在不引入库内部私有依赖的情况下完成编码与解码

#### Scenario: 宿主嵌入编辑器与保存状态界面
- **WHEN** 宿主在页面中渲染库公开的编辑器与保存状态界面
- **THEN** 二者可协同工作并对外呈现编辑内容与当前保存状态

### Requirement: 宿主提供真实输入输出
笔记库 SHALL 通过宿主提供的保存回调执行真实写出，库本身 MUST NOT 假设或自行访问宿主的存储介质；MUST 将待持久化的内容以快照方式交给宿主回调。编辑器输入的 `initialRevision?` MUST 与同次初始 HNN 及 `loadKey` 一起构成保存基线。

#### Scenario: 触发保存
- **WHEN** 编辑器发起一次保存
- **THEN** 库以当前内容的快照调用宿主提供的保存回调，由宿主决定实际写出位置与方式

### Requirement: 保存使用宿主 CAS 与判别结果
保存回调 SHALL 接收 `onSave(snapshot, { documentId, baseRevision?, signal })`，并返回判别结果 `{ kind: 'saved', revision?: string }` 或 `{ kind: 'conflict' }`。宿主 MUST 使用 `documentId` 与 `baseRevision?` 对实际存储执行 CAS；库内中止或忽略陈旧结果只保护库内状态，不能阻止已发出的旧请求覆盖宿主存储。

#### Scenario: CAS 保存成功
- **WHEN** 编辑器以当前 document baseline 的 `baseRevision?` 发起保存且宿主 CAS 成功
- **THEN** 宿主返回 `{ kind: 'saved', revision? }`
- **AND** 库仅将该次 snapshot 设为新的文档 baseline
- **AND** 返回 `revision` 时库 SHALL 将其设为新的 revision baseline，未返回时 SHALL 清除 revision baseline

#### Scenario: CAS 检测到版本冲突
- **WHEN** 宿主发现 `baseRevision?` 不符合当前存储版本
- **THEN** 宿主返回 `{ kind: 'conflict' }`
- **AND** 宿主 SHALL NOT 以该请求覆盖当前存储内容

#### Scenario: 保存已在进行
- **WHEN** 同一编辑会话已有一次保存尚未完成又触发保存
- **THEN** 库 SHALL 保持单飞，不得为该会话发起第二个并发保存回调

#### Scenario: 宿主未提供保存回调
- **WHEN** 宿主未提供保存回调而用户触发保存
- **THEN** 库不自行写出任何内容，并以可观察的方式表明保存不可执行

### Requirement: 宿主提供仅图片上传回调
库的上传能力 SHALL 仅处理 `picture` 节点的图片文件，不覆盖卡片、画板或其他资源。库 SHALL 以图片文件及 `{ uploadId, attempt, signal }` 调用宿主图片上传回调；每个文件的 `uploadId` MUST 在 retry 间保持不变，首次 `attempt` MUST 为 1、每次 retry MUST 递增。宿主 MUST 按 `uploadId` 实施幂等，并在成功时返回可持久化的 `http` 或 `https` `src` 及可选 `alt`；库 MUST NOT 直接访问真实存储。

#### Scenario: 上传图片成功
- **WHEN** 用户插入一张图片并完成宿主上传
- **THEN** 宿主返回 `http` 或 `https` `src` 及可选 `alt`
- **AND** 文档中以一次 transaction 写入真实图片取代先前显示的临时态
- **AND** 该真实资源可由宿主存储解析

#### Scenario: 重试保持幂等上传标识
- **WHEN** 同一个图片文件的首次上传失败后用户选择重试
- **THEN** 库 SHALL 以相同 `uploadId` 和递增的 `attempt` 调用宿主
- **AND** 宿主 SHALL 将其视为同一逻辑上传的幂等重试

#### Scenario: 保存时不持久化临时态
- **WHEN** 某资源仍处于上传临时态时用户触发保存
- **THEN** 交给宿主的快照中不包含该临时态作为持久内容

#### Scenario: 上传被取消或会话切换
- **WHEN** 用户取消图片上传，或 `documentId`、`loadKey` 变化或编辑器卸载
- **THEN** 库 SHALL abort 该上传独立的 `AbortSignal` 并在库内忽略陈旧结果
- **AND** 宿主仍负责正确处理已收到的请求与 signal

### Requirement: 宿主提供提及与资源的候选、激活与解析回调
对于提及与资源引用，库 SHALL 通过宿主提供的回调获得候选项、处理激活并解析引用；文档内只保存资源标识与展示所需的最小信息，真实内容 MUST 由宿主回调解析。

#### Scenario: 输入触发候选
- **WHEN** 用户输入触发提及或资源引用的候选场景
- **THEN** 候选列表来自宿主提供的回调，且用户选中后文档中仅记录所引用的资源标识

#### Scenario: 激活提及
- **WHEN** 用户点击一个已存在的提及
- **THEN** 激活行为交由宿主提供的回调处理，库不自行跳转或解析外部内容

#### Scenario: 解析失败
- **WHEN** 宿主解析资源引用失败或返回空
- **THEN** 文档中该引用以占位方式呈现且结构不被破坏

### Requirement: 保存状态界面可观察脏、保存中、错误与冲突
保存状态界面 SHALL 对外可观察地区分脏、保存中、错误与冲突状态，使用户或宿主能够依据当前状态采取行动。

#### Scenario: 未保存修改
- **WHEN** 文档相对最近一次成功保存的快照发生了修改
- **THEN** 保存状态界面呈现为脏

#### Scenario: 保存进行中
- **WHEN** 一次保存已经发起但尚未得到结果
- **THEN** 保存状态界面呈现为保存中

#### Scenario: 保存失败
- **WHEN** 一次保存返回失败
- **THEN** 保存状态界面呈现为错误且不呈现为已保存

#### Scenario: 检测到冲突
- **WHEN** 检测到外部内容已变化并与当前文档存在冲突
- **THEN** 保存状态界面呈现为冲突，等待用户或宿主决策

### Requirement: 脏等于当前文档与最近成功保存快照不同
脏状态 MUST 由当前文档与最近一次成功保存的快照之间的结构差异决定；初始装载完成后 MUST 视为非脏；保存成功后方可将所保存的快照更新为新的比较基准。

#### Scenario: 初始装载后非脏
- **WHEN** 文档刚完成装载且未发生任何编辑
- **THEN** 状态为非脏，且不呈现未保存提示

#### Scenario: 编辑后变脏
- **WHEN** 用户在已保存的文档上做出结构改变
- **THEN** 状态变为脏

#### Scenario: 保存成功后恢复非脏
- **WHEN** 一次保存成功完成且其后没有新的编辑
- **THEN** 状态变为非脏

### Requirement: 保存期间编辑保持脏
在保存进行期间发生的编辑 MUST 继续使文档保持为脏，MUST NOT 因在途保存尚未返回而提前清除脏状态。

#### Scenario: 保存期间继续输入
- **WHEN** 用户在保存进行中继续编辑文档
- **THEN** 保存完成后状态仍为脏，因为存在尚未保存的新修改

### Requirement: 保存失败不清除脏
保存失败时 MUST 保持文档为脏，且 MUST 保留先前的比较基准，MUST NOT 将失败的内容视为已保存。

#### Scenario: 保存返回失败后继续编辑
- **WHEN** 一次保存失败后用户继续编辑
- **THEN** 状态仍为脏，且后续保存以未成功保存的内容为待写出内容

### Requirement: 会话切换与卸载中止或忽略陈旧回调
当编辑会话被替换、装载标识变化或组件卸载时，库 MUST 中止在途保存与上传，并在库内忽略其陈旧结果；陈旧回调 MUST NOT 写入新会话的文档。每个会话令牌及每个异步操作的 `AbortSignal` MUST 不可复用。宿主仍 MUST 用 CAS 防止陈旧保存请求在存储端生效。

#### Scenario: 保存中切换会话
- **WHEN** 一次保存尚在途中时发生了会话切换或装载标识变化
- **THEN** 该次保存的结果被忽略，不写入新的会话文档

#### Scenario: 上传中卸载编辑器
- **WHEN** 资源上传尚在途中时编辑器被卸载
- **THEN** 上传被中止，其结果不影响任何会话文档

### Requirement: 冲突不自动合并
检测到冲突时，笔记库 MUST NOT 自动合并内容，也 MUST NOT 静默覆盖任一侧；MUST 将冲突暴露给宿主或用户进行决策。冲突不得替换当前文档、document/revision baseline、选择或 history。

#### Scenario: 外部变化与本地编辑冲突
- **WHEN** 本地文档与外部内容在保存前均发生变化
- **THEN** 编辑器不自动合并也不静默覆盖，而是呈现冲突并等待决策

#### Scenario: 宿主采用远端或保留本地
- **WHEN** 宿主在冲突后决定采用远端
- **THEN** 宿主 SHALL 以新的 `initialDocument` 与新的 `loadKey` 使编辑器重载远端内容
- **WHEN** 宿主决定保留本地
- **THEN** 当前会话 SHALL 保持不变
- **AND** 宿主 SHALL 通过后续保存策略处理该本地内容

### Requirement: 图片上传失败可重试或取消且临时态不持久化
图片上传失败时用户 SHALL 能够重试或取消；每个图片文件 SHALL 对应一个不可持久化的 decoration placeholder。上传状态、`uploadId`、`attempt` 与文件数据 MUST NOT 进入 HNN；重试成功或取消后文档 MUST 进入确定的图片状态。

#### Scenario: 重试上传
- **WHEN** 一次上传失败而用户选择重试
- **THEN** 对该图片以相同 `uploadId` 和递增 `attempt` 重新发起上传
- **AND** 成功后以单个 transaction 的真实图片替换对应临时态

#### Scenario: 取消上传
- **WHEN** 一次上传失败或进行中而用户选择取消
- **THEN** 对应临时态从文档中移除，且不产生任何持久化的图片记录

### Requirement: 文档文件打开界面由宿主提供
笔记库 MUST NOT 提供新建空白文档、选择文档文件或将 Markdown/HNN 文档文件拖入编辑器的界面；宿主 SHALL 负责提供内容或已解析的文档并决定其打开流程。库提供的图片等资源插入交互不构成文档文件打开界面。

#### Scenario: 宿主装载已解析文档
- **WHEN** 宿主将已解析的 Markdown 或 HNN 文档传给编辑器
- **THEN** 编辑器载入该文档并允许编辑，而无需在库内打开文件选择器或接收文档文件拖入

#### Scenario: 用户尝试拖入文档文件
- **WHEN** 用户将 Markdown 或 HNN 文档文件拖到编辑器区域
- **THEN** 库不自行读取、解析或打开该文件，宿主可在编辑器外提供其定义的打开流程

### Requirement: 视图工具栏接收宿主文件导航与按栏布局
`NoteEditorView` SHALL 接受可选的 `files`、`currentFileKey`、`paneId`、`busy`、`onSelectFile`、`onRequestRemove` 与 `layout`。文件入口 SHALL 位于撤销/重做之后；未提供 `files` 时 MUST 隐藏入口，最后一项 MUST NOT 可移除。选择与移除 SHALL 只发起带 `paneId` 与 `requestId` 的异步请求，当前项 MUST 由宿主快照更新，库 MUST NOT 自行枚举或修改列表、导航或建立第二套历史/保存会话。`layout` 提供时 SHALL 按 `edge` 在所属栏边缘渲染工具栏，`headerContentInset` 与 `insets.top` 取最大值且每条屏幕边只消费一次，并通过占用空间回调为正文预留空间；仅改变 `layout` MUST NOT 重建文档、会话或历史。

#### Scenario: 注入列表与移除
- **WHEN** 宿主为两个 View 注入 A/B 与各自 `paneId`
- **THEN** 每个 View 的文件入口列出同序文件并标记当前项，选择只请求发起栏，移除最后一项不可用

#### Scenario: 左右与上下分屏
- **WHEN** 左右分屏两栏均传 bottom，或上下分屏上栏传 top、下栏传 bottom 并携带安全区
- **THEN** 工具栏按栏停靠且内容按占用空间预留，切换 edge 后原文档、历史与草稿保持

### Requirement: notes 发布包为 WebBase 的列表能力交付单元
交付 SHALL 先通过 notes 库验证和独立打包消费验证，再发布包含列表能力且兼容宿主现有公开接口的 `@hamster-note/notes` 正式 npm 版本。WebBase SHALL 在 `webview` 使用已发布的精确版本和提交的锁文件，通过公开导出及 `styles.css` / `formula.css` 消费；MUST NOT 以源码复制、私有路径导入或本地 link 作为最终集成。版本选择 SHALL 以宿主现用 3.2.0 和实际发布基线核对为前置条件，不丢失宿主已有 API。交付记录 SHALL 包含源码 revision、tag、npm 版本、包完整性及 WebBase 解析版本，发布失败时不得宣称集成完成。

#### Scenario: 独立安装公开包
- **WHEN** 干净消费环境安装该已发布精确版本并加载公开组件与样式
- **THEN** 可使用三类列表及互转、勾选，类型声明可用且无需仓库私有源文件

#### Scenario: 无法取得正式包
- **WHEN** 目标版本未发布、不可安装或不兼容宿主已用公开 API
- **THEN** 保持原可用依赖，报告发布或兼容性阻碍，不以本地 link 通过代替最终验收

### Requirement: WebBase 保存重开完整保留列表语义
WebBase SHALL 继续以现有宿主 .hnn 外壳的 `notes` 字段承载 notes HNN v1，通过既有文档会话和保存回调保存；元数据和其他字段不因列表编辑而改变。真实 Web 编辑流程 SHALL 支持三种列表创建、六向互转、嵌套编辑、勾选、撤销重做、保存、关闭重开及同文档分屏同步；只读不能勾选或转换，失败和冲突沿用既有保护，MUST NOT 显示虚假的保存成功。

#### Scenario: 主应用保存关闭重开
- **WHEN** 在 WebBase 的 HNN 编辑器创建混合嵌套三类列表、勾选部分任务、执行互转后成功保存并关闭重开
- **THEN** 类型、层级、编号、文字和完成状态与保存快照一致，宿主元数据及非列表内容保持，列表样式正确

#### Scenario: 分屏同步及失败重试
- **WHEN** 同一 HNN 在两栏显示，一栏勾选并保存失败后重试成功
- **THEN** 两栏同步该勾选且不相互抢焦点，失败时仍为脏且保留内容，重试成功后重开得到对应状态

### Requirement: 增量编辑能力随同正式包进入宿主验收
本 change 的新增自动层级编号、引用快捷输入和链接配置 SHALL 在 M1 增量验证后纳入 M2 包消费验证，再进入 M3 WebBase Web-only 验收；不得绕过既有发布版本确认或将本轮规划视为发布授权。宿主 SHALL 通过同一公开包和样式获得这些能力，保存重开保留结构、start/type、author、显示文字和 href，分屏共享文档保持一致；配置层取消、非法 URL、陈旧选择及权限拒绝 MUST NOT 导致宿主误报已保存或改写文件。

#### Scenario: 三项增量端到端交付
- **WHEN** 正式包在 WebBase 被精确锁版后，通过 Web 编辑器建立五层列表、快捷引用并创建/编辑/移除链接，再保存关闭重开
- **THEN** 层级样式、编号、引用与链接结果一致，元数据和非目标内容不变，两个分屏不相互抢焦点
