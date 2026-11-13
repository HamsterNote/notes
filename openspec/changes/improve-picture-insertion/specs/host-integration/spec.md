# Spec Delta

## MODIFIED Requirements

### Requirement: 宿主提供仅图片上传回调

库的上传能力 SHALL 仅处理 `picture` 节点图片，不覆盖卡片、画板或其他资源。库 SHALL 以图片文件及 `{ uploadId, attempt, signal }` 调用宿主图片上传回调；每文件 uploadId MUST 在 retry 间不变，首次 attempt MUST 为 1、每次 retry MUST 递增。宿主 MUST 按 uploadId 幂等，并仅在真实存储成功且可读后返回安全 HTTP(S) src 或 note-document-format 定义的封闭托管图片路径及可选 alt。库 MUST NOT 直接访问真实存储；路径形式必须配套公开图片解析能力。

#### Scenario: 上传图片成功
- **WHEN** 用户确认插图并完成宿主真实存储
- **THEN** 宿主返回安全 HTTP(S) src 或封闭托管图片路径及可选 alt
- **AND** 文档以一次 transaction 写入真实图片取代临时态，实际资源由宿主解析

#### Scenario: 重试保持幂等上传标识
- **WHEN** 同文件首次上传失败后重试
- **THEN** 库以相同 uploadId 和递增 attempt 调用宿主，宿主按同一逻辑上传幂等处理

#### Scenario: 保存时不持久化临时态
- **WHEN** 图片仍在上传临时态时触发保存
- **THEN** 保存快照不包含上传临时态、File、字节或预览/解析 blob URL

#### Scenario: 上传被取消或会话切换
- **WHEN** 用户取消、documentId/loadKey 变化或编辑器卸载
- **THEN** 库 abort 对应独立 signal 并忽略迟到结果，宿主负责正确处理已收到请求及资源归属

## ADDED Requirements

### Requirement: 宿主提供图片路径解析与资源释放

库 SHALL 公开可选的 `onPictureResolve(src, { signal, documentId, loadKey })`，返回 `{ url, dispose? }`，url 仅允许安全 HTTP(S) 或运行时 blob。托管图片路径 SHALL 经该回调解析；普通外链在未提供回调时 SHALL 继续直接显示，提供回调时 SHALL 可由宿主兼容处理旧托管 URL。无解析能力、文件缺失或失败 SHALL 显示可重试占位而非修改原引用。回调结果 MUST NOT 进入正文；替换、取消或销毁 SHALL 丢弃陈旧结果并恰当释放资源，dispose 每结果至多调用一次。

#### Scenario: 路径显示与重新打开
- **WHEN** 加载含合法托管路径的 HNN 且宿主解析成功
- **THEN** 图片显示真实内容，持久 src 保持原路径，解析不改变 dirty、历史或其他视图焦点

#### Scenario: 缺少能力与迟到结果
- **WHEN** 无 resolver、resolver 失败，或旧请求在 src/会话变化后才返回
- **THEN** 前两者显示缺图及恢复入口，迟到结果不覆盖当前图片且其资源被释放

#### Scenario: 节点销毁释放资源
- **WHEN** 解析后的图片被删除、源引用替换或视图卸载
- **THEN** 对旧请求 abort，对旧结果至多调用一次 dispose，正文没有运行时 URL 残留
