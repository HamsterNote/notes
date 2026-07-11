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
pnpm install
pnpm dev
```

默认会在 `0.0.0.0:9235` 启动 Demo 页面。

## 构建

```bash
pnpm build
```

- `pnpm build:lib` 生成组件库产物到 `dist/`
- `pnpm build:demo` 生成 Demo 静态站点到 `dist/demo/`

## 使用方式

```tsx
import { NoteContent } from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"
```

## 发布规则

- 推送 `v1.0.0` 这类正式标签时，发布到 npm 的 `latest`
- 推送 `v1.0.0-beta.1` 这类预发布标签时，发布到 npm 的 `beta`

发布工作流使用 GitHub Actions OIDC trusted publishing，请先在 npm 包设置中配置对应仓库的 trusted publisher。
