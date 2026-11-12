# Spec Delta

## ADDED Requirements

### Requirement: 图片专属稳定托管路径

picture.src SHALL 在原安全 HTTP(S) 图片 URL 之外接受精确形式 `hamster_note_data/images/<32位小写十六进制md5>.<png|jpg|webp>` 的挂载相对引用。该形式 SHALL 仅用于图片，不作为普通链接协议白名单的放宽。路径 MUST NOT 包含前导斜杠、点段、反斜杠、百分号编码、query、fragment、scheme 或其他目录。其他 HNN 外壳、版本、节点身份、非空 alt、属性/外壳预算及结构安全约束 SHALL 保持。data/blob/file URL MUST NOT 作为持久图片地址。

#### Scenario: 路径往返
- **WHEN** 对含合法托管路径的图片进行 HNN 编解码及保存重开
- **THEN** 路径、alt 与 nodeId 结构等价，schemaVersion 仍为 1，不写入原图字节或临时 URL

#### Scenario: 路径绕过拒绝
- **WHEN** picture.src 含 `../`、编码点段、反斜杠、绝对文件路径、query 或非允许后缀
- **THEN** 编解码以可定位错误拒绝，不返回替代文档、不读取资源、不覆盖原输入

#### Scenario: 普通链接及旧图片
- **WHEN** 普通 link 使用上述相对路径，或旧 picture 使用安全 HTTP(S)
- **THEN** 普通 link 继续按原 URL 规则拒绝相对路径，旧图片保持兼容

#### Scenario: Markdown 保留引用
- **WHEN** 导出并重新导入含托管路径的图片
- **THEN** 通过合法图片语法或已有无损围栏保留路径与描述，不能静默丢图或替换为运行时 URL；导出不声称已复制资源文件
