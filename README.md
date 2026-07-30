# @hamster-note/notes

一个基于 React 19 和 Vite 的笔记内容组件库项目，包含可本地预览的 Demo 页面，以及基于 Git Tag 的 GitHub Actions 发布流程。

## 特性

- React 19 组件库入口，包名为 `@hamster-note/notes`
- 使用 Vite 构建库产物和 Demo 页面
- TypeScript 6 beta 严格类型检查
- ESLint + Prettier 代码质量与格式化
- 局域网可访问的本地开发服务器，端口 `9235`
- GitHub CI 校验 + Tag 驱动 npm 发布

## 本地开发

```bash
yarn install
yarn dev
```

默认会在 `0.0.0.0:9235` 启动 Demo 页面。

## 构建

```bash
yarn build
```

- `yarn build:lib` 生成组件库产物到 `dist/`
- `yarn build:demo` 生成 Demo 静态站点到 `dist/demo/`

## 使用方式

```tsx
import { NoteContent } from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"
```

如果使用公式块，再按需导入 KaTeX 样式：

```tsx
import "@hamster-note/notes/formula.css"
```

## 撤销 / 恢复

`NoteContent` 的撤销/恢复历史由 `use-undo` 驱动，组件本身仍然保持受控语义。消费者可以使用 `useNoteContentUndoRedo` hook 管理标题、摘要和 blocks 的历史，并把控制器与组件 ref 绑定：

```tsx
import { useRef } from "react"
import {
  NoteContent,
  useNoteContentUndoRedo,
  type NoteContentUndoRedoHandle,
} from "@hamster-note/notes"

const undoRedo = useNoteContentUndoRedo({
  title: "Example",
  summary: "Editable summary",
  blocks: initialBlocks,
})

const noteRef = useRef<NoteContentUndoRedoHandle>(null)

return (
  <>
    <button disabled={!undoRedo.canUndo} onClick={() => noteRef.current?.undo()}>
      Undo
    </button>
    <button disabled={!undoRedo.canRedo} onClick={() => noteRef.current?.redo()}>
      Redo
    </button>
    <NoteContent
      ref={noteRef}
      undoRedoController={undoRedo.controller}
      editable
      title={undoRedo.present.title}
      summary={undoRedo.present.summary}
      blocks={undoRedo.present.blocks}
      onTitleChange={undoRedo.setTitle}
      onSummaryChange={undoRedo.setSummary}
      onBlocksChange={undoRedo.setBlocks}
      onNoteTransaction={({ snapshot }) => undoRedo.commitTransaction(snapshot)}
    />
  </>
)
```

该 hook 只管理 `NoteContent` 负责渲染的内容字段（`title`、`summary`、`blocks`）。Demo 中使用了自定义的全文档控制器，用来把 `tagLabel` 等外层字段也纳入同一份历史。

## 连续文本选区

标题、摘要和正文按阅读顺序组成同一条笔记文本流。普通富文本按字符参与选择；图片、画板、卡片、目录、独立公式块和表格行作为不可拆分的原子选择单元参与。代码块在笔记文本流中以纯文本参与，但仍通过独立的原生文本区域编辑，因此行内格式不会写入代码内容。

`onNoteTransaction` 接收一次操作后的完整 `{ title, summary, blocks }` 快照和操作元数据。跨标题、摘要或正文字段的删除、剪切、替换和格式化只调用该回调一次，以保证宿主只观察到一个状态变化，并可将操作记为一个 undo/redo 历史项。未提供该回调时：

- 跨字段选择和复制仍然可用，但跨字段修改会被阻止。
- 仅涉及正文的连续修改会降级为一次 `onBlocksChange` 调用。
- 单一区域编辑继续使用 `onTitleChange`、`onSummaryChange` 或 `onBlocksChange`。

标题、摘要和正文富文本均使用字段级白名单净化的受限 HTML。标题和摘要支持粗体、斜体、下划线、删除线及行内代码；正文还支持安全链接、颜色和 HamsterNote 行内公式、mention 元数据。危险元素、事件属性和不安全 URL 会在渲染与提交边界移除。

连续选区复制会同时写入：

- `text/plain`
- `text/html`
- `application/x-hamsternote-fragment+json`

内部 MIME 当前版本为 v2，按阅读顺序保存富文本内容块、代码块、原子选择单元和表格行。粘贴到另一个 HamsterNote 实例时会保留中间结构、重建持久化 ID，并将首尾文本片段与目标残片融合；外部剪贴板则使用净化后的 HTML 或转义的纯文本。

## 发布规则

- 推送 `v1.0.0` 这类正式标签时，发布到 npm 的 `latest`
- 推送 `v1.0.0-beta.1` 这类预发布标签时，发布到 npm 的 `beta`

发布工作流使用 GitHub Actions OIDC trusted publishing，请先在 npm 包设置中配置对应仓库的 trusted publisher。
