# @hamster-note/notes

一个基于 React 19 和 Vite 的笔记组件库，编辑内核为 TipTap/ProseMirror，持久化格式为 HNN，并支持 GFM + HamsterNote 围栏的 Markdown 导入/导出。包含可本地预览的 Demo 页面，以及基于 Git Tag 的 GitHub Actions 发布流程。

**[在线 Demo](https://hamsternote.github.io/notes/)**

## 特性

- React 19 组件库入口，包名为 `@hamster-note/notes`
- 以 TipTap/ProseMirror 为唯一文档与交互内核：原生选区、剪贴板、撤销/重做
- HNN 持久化：`{ schemaVersion: 1, data: <ProseMirror JSON> }`，严格校验、无损往返
- 封闭 schema：不向宿主开放自定义扩展/schema 注入
- 使用 Vite 构建库产物和 Demo 页面
- TypeScript 6 beta 严格类型检查，ESLint + Prettier
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

## 公共 API

### 3.1.2 宿主引用失效与图片上传

`NoteDocumentProvider` 新增可选 `onPictureUpload?: PictureUploadHandler`。提供回调后，各 View 的图片选择、图片粘贴、外部拖入与失败重试/取消均可用；内部拖动不会重复上传。无回调保留原有行为。有到有的回调替换只影响未来 attempt；移除回调会 abort 并清理全部占位，再次提供无需重挂 Provider。

```tsx
import type { NoteDocumentController, PictureUploadHandler } from "@hamster-note/notes"

export function refreshHighlight(controller: NoteDocumentController, resourceId: string) {
  const expectedSessionId = controller.getState().identity?.sessionId
  if (!expectedSessionId) return
  if (!controller.invalidateReferences) throw new Error("Requires notes >= 3.1.2")
  // 先更新宿主数据；若更换 React resolver prop，须在其提交后调用。
  for (const kind of ["mention", "resource"] as const) {
    const result = controller.invalidateReferences({ expectedSessionId,
      scope: { kind: "reference", reference: { kind, resourceId } } })
    if (result.kind !== "accepted") throw new Error(JSON.stringify(result))
  }
  // 全文：controller.invalidateReferences({ expectedSessionId, scope: { kind: "document" } })
}

export const upload: PictureUploadHandler = async (file, { uploadId, attempt, signal }) => {
  const response = await fetch("/images", { method: "POST", body: file, signal,
    headers: { "X-Upload-Id": uploadId, "X-Upload-Attempt": String(attempt) } })
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
  // 示例宿主端点通过 Location 返回已上传图片的 http/https URL。
  return { src: response.headers.get("Location") ?? "", alt: file.name }
}
```

`invalidateReferences` 在 3.1.2 创建的 Controller 上始终存在；类型上可选以兼容旧结构 adapter。结果为 `accepted`、`noop(stale|not-ready)`、`abort(disposed)` 或 `failure(invalid-scope)`，携带 sessionId。`accepted` 仅表示已受理，异步终态见引用 DOM 的 `data-hnn-resolve-status`：null 为 missing，异常为 error，合法 label 为 resolved。按 kind/resourceId 精确失效或刷新当前文档全部引用；无匹配不发请求，无 View 时安全受理。旧请求收到 abort，忽略 signal 的迟到结果也无效。普通 rerender 或 resolver 函数身份变化不会自动重拉；稳定函数读取外部 store 时，更新 store 后可直接显式失效。

刷新只改变运行时引用展示，保留 session、HNN、metadata、dirty、选区、焦点、共享 history 与保存基线，不触发 onChange/onSave；freeze 期间同样可刷新。不得靠 remount 或正文改写刷新引用。

上传回调接收原始 File 和 `{ uploadId, attempt, signal }`，返回 Promise<{src, alt?}>。成功只接受经过 URL 与 HNN 预算校验的 http/https 地址；结果通过共享正文提交一次，peer 可 undo/redo。失败或非法地址显示失败，用户可重试（同 uploadId、递增 attempt、新 signal）或取消。取消、锚点删除、来源 View detach（即使同 viewId 重开）、Provider dispose、移除回调都会 abort；宿主忽略 signal 的迟到结果仍被隔离，远端资源回收由宿主处理。

上传期间可保存已有持久正文，占位/File/uploadId/attempt 不进入 HNN；saved/clean **不代表上传完成，也不代表可以离开**。存在 uploading、failed 或待提交结果时会话替换被拒绝，freeze acquire 返回既有 failure/pending-edit 且不消费 requestId。完成或取消后可重试同请求；acquire 入队与持有任何 lease 期间禁止新上传/retry。card/drawing 草稿期间也禁止新上传/retry，但先前请求可返回：合法成功结果延后到草稿关闭后重新校验锚点并恰好提交一次，不重新上传；期间取消或卸载可清理。受控导航仍须成功取得自身 freeze lease 并等待保存；强制卸载不保证远端上传资源清理或未完成写入持久化。

公共浏览器契约：`node scripts/check-public-host-browser.mjs`。同一根入口 fixture 也由 `node scripts/verify-pack-consumer.mjs <tarball> 3.1.2 <fresh-directory> --public-host` 在无源码 alias/私有导入的干净安装中运行。HAM-36 仍须升级正式包、接通失效调用后复跑 `hnn-references.spec.ts` 和真实宿主上传；本库验证不代替 Reader 验收。

> ⚠️ **不兼容变更**：本版本整体替换了旧编辑内核。旧的 `NoteContent`、`NoteBlock` 等块模型 API、受限 HTML 渲染、自研 DOM 选区与专有剪贴板 MIME 已从包入口移除，且**不提供旧格式迁移或兼容层**。

3.0.0 的公共入口继续保留，并新增共享文档会话：

- 组件：`NoteEditor`、`NoteSaveStatus`、`MarkdownExport`
- 共享编辑：`NoteDocumentProvider`、`NoteEditorView`，以及 `NoteDocumentController` 等公共契约类型
- 编解码：`decodeHnn`、`encodeHnn`、`HnnCodecError`、`importMarkdown`、`exportMarkdown`
- 类型：新组件 props、HNN/Markdown codec 类型，以及宿主回调契约（`NoteSave*`、`InitialLoadError*`、`EditorSession*`、`PictureUpload*`、`HostReference*`、`HostCandidate*` 等）

```ts
import {
  NoteEditor,
  decodeHnn,
  encodeHnn,
  HnnCodecError,
  importMarkdown,
  exportMarkdown,
  type HnnDocument,
} from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"
```

### 装载与编辑

`NoteEditor` 由 `documentId` 与 `loadKey` 共同定义一次编辑会话。`initialDocument` 的类型是 `unknown`：宿主只需传入 HNN 外壳（`{ schemaVersion: 1, data }`），**严格校验由库自身完成**，无需（也不应）在宿主侧预先构造内部文档。

```tsx
import { NoteEditor, type HnnDocument, type NoteSave } from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"

// 合法最小 HNN：schemaVersion 固定为 1，data 为 ProseMirror JSON；持久节点带合法 UUID nodeId。
const document: HnnDocument = {
  schemaVersion: 1,
  data: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" },
        content: [{ type: "text", text: "你好" }],
      },
    ],
  },
}

function Editor({
  documentId,
  loadKey,
  revision,
  onSave,
}: {
  documentId: string
  loadKey: string | number
  revision?: string
  onSave: NoteSave
}) {
  return (
    <NoteEditor
      documentId={documentId}
      loadKey={loadKey}
      initialDocument={document}
      initialRevision={revision}
      onSave={onSave}
      onChange={(snapshot) => {
        // 每次文档变化都会收到完整 HNN 快照（仅通知，不代表已保存）
      }}
      onInitialLoadError={(error, { documentId, loadKey }) => {
        // 初始 HNN 严格校验失败：库不会用损坏输入构造降级会话
      }}
      theme="light"
    />
  )
}
```

从任意外部输入得到可传入的 HNN：

```ts
import { decodeHnn, encodeHnn } from "@hamster-note/notes"

// decodeHnn 是公开编解码函数，返回经严格校验的 ProseMirror doc，而不是 HNN 外壳；
// 需要可持久化 / 可装载的 HNN 时，必须再 encode 一次：
const hnn = encodeHnn(decodeHnn(unknownInput)) // 类型为 HnnDocument，可传 NoteEditor.initialDocument
```

会话语义：

- 同一 `documentId` 与 `loadKey` 下，后续 `initialDocument` **与 `initialRevision`** 的变化都会被忽略，不会覆盖用户当前编辑。
- 任一 `documentId` 或 `loadKey` 变化，都会以当次已验证 HNN 重建整个会话（文档、选区、撤销历史、baseline 全部重置）。
- 若新 `documentId`/`loadKey` 对应的初始 HNN 校验失败，**当前会话保持不变**（不会切到损坏文档），错误经 `onInitialLoadError` 通知宿主。
- 撤销/重做由库内封闭装配的 history 提供，宿主不能注入或替换 schema/extensions/history。

### 保存（宿主 CAS）

```ts
import type { NoteSave } from "@hamster-note/notes"

const onSave: NoteSave = async (snapshot, { documentId, baseRevision, signal }) => {
  // 宿主必须以 documentId + baseRevision 实施 CAS，并对真实存储负责。
  const result = await host.writeIfUnchanged(documentId, snapshot, baseRevision)
  return result.conflict ? { kind: "conflict" } : { kind: "saved", revision: result.revision }
}
```

- 保存回调签名：`onSave(snapshot, { documentId, baseRevision?, signal })`，返回 `{ kind: "saved", revision? }` 或 `{ kind: "conflict" }`。
- 每个会话同时最多一个在途保存（单飞）。
- `signal`/abort **只隔离库内状态**，不能替代宿主的原子存储事务；即使宿主忽略了 abort，陈旧请求仍可能落盘，因此必须靠宿主的 CAS 防御。
- 冲突不自动合并：库只暴露冲突态，由宿主以新的 `initialDocument` + 新 `loadKey` 重载远端，或按自身策略重试本地保存。
- Demo 宿主的 `hostStore` 演示了一个真实原子实现：每次保存与「模拟另一客户端写入」都在**同一个持久化 key 的排他 Web Lock 内**完成 read→compare→write；`saveWithCas`/`overwriteExternal` 因此是异步 API。
- Web Locks 仅在**安全上下文（HTTPS 或 localhost）**且浏览器支持时可用。若运行环境不提供 Web Locks，宿主**fail closed**：抛出显式错误且**绝不写入**，绝不降级为「read-check-write」这种非原子的伪 CAS。在线 Demo 即为 HTTPS/localhost 场景。

### 3.1 共享文档

```tsx
import { useRef } from "react"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController } from "@hamster-note/notes"

function SharedNote({ hnn, write }) {
  const controller = useRef<NoteDocumentController>(null)
  return <NoteDocumentProvider
    documentId="note-1" loadKey={1} initialDocument={hnn}
    initialHostSnapshot={{ changeId: 0, value: { title: "笔记", summary: "" } }}
    controllerRef={controller}
    onChange={(document, identity) => { /* 只通知，不回灌 initialDocument */ }}
    onSave={async (payload, context) => { await write(payload, context.signal) }}
  >
    <NoteEditorView key="left" viewId="left" />
    <NoteEditorView key="right" viewId="right" />
  </NoteDocumentProvider>
}
```

Provider 的 `onSave` 返回 `Promise<void>`，与旧 `NoteSave` 的 CAS/saved/conflict 协议分别使用。
正文与 title/summary 分别跟踪 dirty；600ms 自动保存、按钮和宿主请求共用一个串行 barrier。
真实写入完成后才推进捕获快照的 baseline，期间的新编辑继续串行保存。失败保留 dirty，显式重试才恢复。

任意栏 undo/redo 操作全会话最近正文事件，可以撤销另一栏的动作；metadata 不进入正文历史。
选区和 stored marks 独立，重开甚至全部暂时关闭 view 都保留共享历史。各 pane 使用稳定 React key；
只有合法新 load 或 Provider 卸载清空历史。同 documentId/loadKey 的初始输入更新不覆盖编辑。
dirty、草稿、保存、排队 acquire 或活动 lease 存在时，新 load 被拒绝，活动 identity 保持不变。

关闭流程先捕获 sessionId/requestId，再 `setInputFrozen(true, { expectedSessionId, requestId })`。
只有 `applied/acquired` 或 `noop/already-owned` 表示拥有 lease；再调用 `requestSave` 并等待 pending 的
completion。宿主须核对相同 session、自己的 lease、`saved/clean` 以及真实导航完成；请求明确结束后
使用同一 session/request/lease 释放。超时不等于远端写入或导航已经取消。最后一个 lease 释放才解锁，
迟到 acquire 返回 request-ended，无 TTL 自动释放。强制卸载会 abort 本地操作，但不能撤销远端写入。

card/drawing 草稿锁两侧正文和 undo，保存返回 blocked；用户完成才提交一次正文事务，取消零事务。
使用 `canDetachView` 检查 pane，草稿 owner 禁止关闭。freeze 同时锁草稿 portal 与 metadata。
Controller 仅公开状态、身份和判别结果，不公开 schema/Editor/transaction；reference 三回调配置在 Provider。

双视图示例：开发环境访问 `/shared.html`。实体 IME 和 WebBase bridge 的验证边界见交付报告。
历史选择性撤销探针单独运行 `corepack yarn test --config vitest.historical.config.ts`，保留一个已知失败；
它不属于当前 A 契约，不得把该非零退出报告为全量通过。

### HNN 文档格式

```ts
import { decodeHnn, encodeHnn, HnnCodecError } from "@hamster-note/notes"

try {
  decodeHnn(unknownInput) // 严格校验
} catch (error) {
  if (error instanceof HnnCodecError) {
    // 未知 schemaVersion / 未知节点 / 未知 mark / 非法 attrs / 结构非法 一律硬错误
  }
}
```

- 完整 HNN v1 外壳的 UTF-8 编码上限为 **512 KiB**；此外还受树深度、节点总数、单 attr 大小等限制。
- 遇到未知 `schemaVersion`、未知节点类型、未知 mark、非法 attrs 或不满足 schema 的结构，一律抛出 `HnnCodecError`，**不提供降级或静默覆盖**；失败时不产生可保存的替代文档，原文保持不变。

### Markdown 导入 / 导出

```ts
import { importMarkdown, exportMarkdown } from "@hamster-note/notes"

const imported = importMarkdown(markdownText)
if (imported.document !== undefined) {
  // 转成 HNN 可编辑文档；default 保存始终是 HNN
  const hnn = imported.document
} else {
  // imported.failure: "input-too-large" | "conversion-failed"
  // 导入失败绝不替换源 Markdown；调用方保留原始输入
}

const exported = exportMarkdown(hnnDocument)
// exported.markdown 为 GFM + HamsterNote 围栏方言
// exported.diagnostics 列出无法无损表达而发生的降级；诊断非空时必须由用户显式确认后才交给宿主写出
```

- 导入：Markdown → ProseMirror doc；导出为可选能力，无法无损表达时**必须产出降级诊断**，不得静默降级。
- 保存默认始终写 HNN，Markdown 导出仅在用户显式触发并经诊断确认后调用宿主写出回调。

### 图片上传（仅 `picture`）

```tsx
<NoteEditor
  documentId={documentId}
  loadKey={loadKey}
  initialDocument={document}
  onPictureUpload={async (file, { uploadId, attempt, signal }) => {
    // 宿主必须按 uploadId 幂等；retry 时 uploadId 不变、attempt 递增
    const uploaded = await host.uploadImage(file, { uploadId, attempt, signal })
    return { src: uploaded.httpsUrl, alt: uploaded.alt } // src 必须是 http/https
  }}
/>
```

- 每个文件一个稳定 `uploadId`，首次 `attempt` 为 1，retry 只递增 `attempt`；宿主应据此去重。
- 成功时宿主返回可持久化的 `http`/`https` `src` 与可选 `alt`；库仅以一个 transaction 写入图片。
- 上传临时态、文件、`uploadId`、`attempt` 均为内存/DOM 桥状态，**绝不进入 HNN**；失败可重试或取消。

### 宿主引用（mention / resource / externalItem）

文档只持久 `resourceId` 与展示 `name`（绝不写入解析内容），真实内容由宿主在运行时解析：

```tsx
<NoteEditor
  documentId={documentId}
  loadKey={loadKey}
  initialDocument={document}
  onReferenceCandidates={async (kind, query, { documentId, signal }) =>
    host.searchReferences(kind, query, { documentId, signal }) // [{ resourceId, name }]
  }
  onReferenceActivate={(reference, { documentId, signal }) => {
    host.openReference(reference, { documentId, signal }) // 库不会自行跳转
  }}
  onReferenceResolve={async ({ kind, resourceId }, { documentId, signal }) =>
    host.resolveReference(kind, resourceId, { documentId, signal }) // { label, description? } | null
  }
/>
```

- 解析结果只用于运行时占位展示（`loading`/`resolved`/`missing`/`error`），**不写入文档、不接受 HTML**。
- 无回调时受控为空/缺失占位，不破坏文档；文档/baseline/history 不受影响。

### 主题与公式样式

```tsx
<NoteEditor ... theme="dark" />
```

`theme` 仅切换 `hn-*` token 修饰类。公式渲染所需的 KaTeX 样式按需导入：

```tsx
import "@hamster-note/notes/formula.css"
```

## Demo

### 在线 Demo

访问 [https://hamsternote.github.io/notes/](https://hamsternote.github.io/notes/) 查看在线演示。

### 本地运行 Demo

```bash
yarn install
yarn dev
```

默认会在 `0.0.0.0:9235` 启动 Demo 页面。

## 发布规则

- 推送 `v1.0.0` 这类正式标签时，发布到 npm 的 `latest`
- 推送 `v1.0.0-beta.1` 这类预发布标签时，发布到 npm 的 `beta`

发布工作流使用 GitHub Actions OIDC trusted publishing，请先在 npm 包设置中配置对应仓库的 trusted publisher。
