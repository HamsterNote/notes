# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-16

### Added

- NoteContent 组件库，支持富文本编辑、块操作（增删改拖拽）、撤销/恢复
- 七种块类型：段落、标题（H1-H5）、代码、引用、清单、图片、表格
- 块操作菜单（BlockActionMenu）：支持块类型转换、复制、删除、拖拽排序
- 选区 Popover（SelectionPopover）：选中文本时弹出富文本工具栏
- 表格块（NoteTableBlock）：支持行列插入/删除、拖拽移动、键盘导航
- 语法高亮（syntaxHighlight）：代码块支持语言标记高亮
- Markdown 文档数据层（markdownDocument）：支持从 Markdown 源码与 NoteBlock[] 双向转换
- 主题支持（theme prop）：明暗主题及 CSS 变量驱动
- 撤销/恢复系统（useNoteContentUndoRedo / noteContentUndoRedo）
- 图片上传菜单与占位块（PictureUploadMenuItem / NotePictureBlock）
- 块格式转换系统（blockSourceConversion）：在 Markdown、HTML 和 NoteBlock 间转换
- 块编辑系统（blockEditing / NoteBlockEditingControls）：内联编辑、键盘快捷键、Shift+Enter 软换行
- 焦点管理系统（NoteBlockFocus / useBlockEditing）
- 表格拖拽预览与目标吸附（tableDragPreview / tableDragTarget）
- 表格操作菜单（useTableOperationMenus / TableOperationMenu）
- Demo 页面：完整的可交互演示，包含所有块类型编辑、撤销/恢复控制、Markdown 源码查看

### Changed

- 将版本号重置为 0.1.0（项目从 1.0.0 降级为遵循语义化版本初始发布）

### Fixed

- 修复表格行列插入位置和 ref 类型兼容性问题
- 修复容器左右 padding 不足以露出加号按钮的问题
- 修复块 handle 可见性标识
- 修复 PR review 和 CI 相关问题

### Refactored

- 将块编辑逻辑抽取为专注组件，支持语法高亮

### CI

- 配置 GitHub Actions 验证工作流（lint + typecheck + test + build）
- 配置 Tag 驱动的 npm 发布工作流（v* 标签触发）
