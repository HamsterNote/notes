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
    />
  </>
)
```

该 hook 只管理 `NoteContent` 负责渲染的内容字段（`title`、`summary`、`blocks`）。Demo 中使用了自定义的全文档控制器，用来把 `tagLabel` 等外层字段也纳入同一份历史。

## 发布规则

- 推送 `v1.0.0` 这类正式标签时，发布到 npm 的 `latest`
- 推送 `v1.0.0-beta.1` 这类预发布标签时，发布到 npm 的 `beta`

发布工作流使用 GitHub Actions OIDC trusted publishing，请先在 npm 包设置中配置对应仓库的 trusted publisher。
