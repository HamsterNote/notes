import { Extension, getSchema, getTextSerializersFromSchema, Node, type Editor, type Extensions } from "@tiptap/core"
import Link from "@tiptap/extension-link"
import katex from "katex"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { Table, TableKit } from "@tiptap/extension-table"
import { closeHistory } from "@tiptap/pm/history"
import type { Node as PmNode } from "@tiptap/pm/model"
import StarterKit from "@tiptap/starter-kit"
import { HNN_CARD_EMPTY_DATA, parseCardPayload } from "./cardPayload"
import { deriveHnnDirectoryEntries } from "./directoryEntries"
import { HNN_DRAWING_EMPTY_DATA, parseDrawingPayload } from "./drawingPayload"
import { HNN_LIMITS } from "./limits"
import { installTableEdgeControls } from "./tableEdgeControls"
import { jsonStringBytes, utf8Bytes } from "./stringBytes"
import { collectHnnNodeIds, createHnnNodeIdPlugin, HNN_NODE_ID_TYPES, normalizeInitialHnnContent } from "./nodeId"
import { isSafeHnnUrl } from "./urlPolicy"

const nodeIdAttr = { default: null }
const persistentNodeTypes = [...HNN_NODE_ID_TYPES]
const CALLOUT_TONES = ["info", "success", "warning"] as const

/**
 * NodeView 控件提交 attr 更新：每次操作恰好一个 PM transaction；closeHistory
 * 令该事务与紧邻的正文输入、相邻控件操作切分为独立 undo step（一步撤销只撤本操作）。
 *
 * closeHistory 写在事务内只隔离“前序”；紧随其后同 tick 的正文输入仍会与本事务
 * 合并成一步（见 prosemirror-history：事务内 close 只重置 prevTime，随后带 step
 * 的事务又把它写回当前时刻）。因此 dispatch 后再补一条无 step 的空 close 事务作为
 * “后序栅栏”，把 prevTime 归零，令接下来的输入另起一个 undo step（与
 * budgetedTransaction/pictureUpload 的提交语义一致）。
 */
function commitNodeAttrs(editor: Editor, getPos: () => number | undefined, patch: Record<string, unknown>): void {
  if (typeof getPos !== "function") return
  const pos = getPos()
  if (typeof pos !== "number") return
  const current = editor.state.doc.nodeAt(pos)
  if (!current) return
  // 值未变化时不产生空事务，避免污染 dirty 基准与历史。
  if (Object.entries(patch).every(([key, value]) => current.attrs[key] === value)) return
  editor.commands.command(({ tr }) => {
    tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch })
    closeHistory(tr)
    return true
  })
  // 后序历史栅栏：空事务无 step，不改变 doc/dirty/onUpdate，只隔离紧随输入。
  if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr))
}

/** NodeView 自己管理的控件 DOM 事件不交给 ProseMirror；正文 contentDOM 事件保持默认处理。 */
function eventInside(element: HTMLElement, event: Event): boolean {
  return event.target instanceof window.Node && element.contains(event.target)
}

/** 运行时 attr 值窄化为字符串：非字符串一律回落默认值，绝不产出 "[object Object]"。 */
function attrString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

/** HTML clipboard attrs 仅接受闭合 schema 的原始字符串；过长/空值与危险 URL 均拒绝。 */
function clipboardString(element: HTMLElement, name: string, maxBytes: number, fallback?: string): string | false {
  const value = element.getAttribute(name)
  if (value === null) return fallback ?? false
  if (value.trim().length === 0 || utf8Bytes(value) > maxBytes || jsonStringBytes(value) > HNN_LIMITS.maxAttrBytes) return false
  return value
}

/** 剪贴板 HTML 的 nodeId 只是未受信任输入；transformPasted 会为每个持久节点重新生成。 */
function clipboardNodeId(element: HTMLElement): string | null {
  return element.getAttribute("nodeid")
}

type HnnClipboardNodeName =
  | "blockquote"
  | "callout"
  | "collapsible"
  | "codeBlock"
  | "formula"
  | "inlineFormula"
  | "picture"
  | "card"
  | "drawing"
  | "directory"
  | "mention"
  | "resource"
  | "externalItem"

export type HnnClipboardNode = Readonly<{
  name: HnnClipboardNodeName
  attrs: Record<string, unknown>
}>

const HNN_CLIPBOARD_TAGS: Record<HnnClipboardNodeName, string> = {
  blockquote: "blockquote",
  callout: "div",
  collapsible: "div",
  codeBlock: "pre",
  formula: "div",
  inlineFormula: "span",
  picture: "figure",
  card: "div",
  drawing: "div",
  directory: "div",
  mention: "span",
  resource: "span",
  externalItem: "div"
}

const HNN_CLIPBOARD_ATTRS: Record<HnnClipboardNodeName, readonly string[]> = {
  blockquote: ["author"],
  callout: ["tone", "title"],
  collapsible: ["title", "collapsed"],
  codeBlock: ["language", "filename"],
  formula: ["latex"],
  inlineFormula: ["latex"],
  picture: ["src", "alt"],
  card: ["data"],
  drawing: ["data"],
  directory: ["config"],
  mention: ["resourceid", "name"],
  resource: ["resourceid", "name"],
  externalItem: ["resourceid", "name"]
}

function hasOnlyClipboardAttrs(element: HTMLElement, name: HnnClipboardNodeName): boolean {
  // data-pm-slice 是 ProseMirror serializer 写在 clipboard 根元素的运输元数据，不属于
  // HNN attrs；除此以外 custom marker 上的任何额外属性都一律拒绝。
  const allowed = new Set(["data-hnn-node", "data-pm-slice", "nodeid", ...HNN_CLIPBOARD_ATTRS[name]])
  return element.getAttributeNames().every((attribute) => allowed.has(attribute.toLowerCase()))
}

/**
 * custom marker 的唯一 clipboard 入口。解析与 native paste guard 必须共享此函数，避免
 * renderHTML/parseHTML/预检三套 attrs 白名单漂移。nodeId 只作搬运，粘贴 plugin 会重建。
 */
export function parseHnnClipboardNode(element: HTMLElement): HnnClipboardNode | null {
  const marker = element.getAttribute("data-hnn-node") as HnnClipboardNodeName | null
  if (!marker || !(marker in HNN_CLIPBOARD_TAGS)) return null
  if (element.tagName.toLowerCase() !== HNN_CLIPBOARD_TAGS[marker] || !hasOnlyClipboardAttrs(element, marker)) return null
  const nodeId = clipboardNodeId(element)
  const base = nodeId === null ? {} : { nodeId }
  const required = (attribute: string, maxBytes: number): string | null => {
    const value = clipboardString(element, attribute, maxBytes)
    return value === false ? null : value
  }

  if (marker === "blockquote") {
    const author = element.getAttribute("author")
    if (author !== null && !validClipboardString(author, HNN_LIMITS.maxLabelBytes)) return null
    return { name: marker, attrs: { ...base, author } }
  }
  if (marker === "callout") {
    const tone = element.getAttribute("tone")
    const title = required("title", HNN_LIMITS.maxLabelBytes)
    return title === null || !CALLOUT_TONES.includes(tone as (typeof CALLOUT_TONES)[number]) ? null : { name: marker, attrs: { ...base, tone, title } }
  }
  if (marker === "collapsible") {
    const title = required("title", HNN_LIMITS.maxLabelBytes)
    const collapsed = element.getAttribute("collapsed")
    return title === null || (collapsed !== null && collapsed !== "true" && collapsed !== "false")
      ? null
      : { name: marker, attrs: { ...base, title, collapsed: collapsed === "true" } }
  }
  if (marker === "codeBlock") {
    const language = required("language", HNN_LIMITS.maxIdentifierBytes)
    const filename = required("filename", HNN_LIMITS.maxLabelBytes)
    return language === null || filename === null ? null : { name: marker, attrs: { ...base, language, filename } }
  }
  if (marker === "formula" || marker === "inlineFormula") {
    const latex = required("latex", HNN_LIMITS.maxAttrBytes)
    return latex === null ? null : { name: marker, attrs: { ...base, latex } }
  }
  if (marker === "picture") {
    const src = required("src", HNN_LIMITS.maxAttrBytes)
    const alt = required("alt", HNN_LIMITS.maxLabelBytes)
    return src === null || alt === null || !isSafePictureUrl(src) ? null : { name: marker, attrs: { ...base, src, alt } }
  }
  if (marker === "card" || marker === "drawing") {
    const data = required("data", HNN_LIMITS.maxAttrBytes)
    const payload = data === null ? null : marker === "card" ? parseCardPayload(data) : parseDrawingPayload(data)
    return !payload?.ok ? null : { name: marker, attrs: { ...base, data } }
  }
  if (marker === "directory") {
    const config = required("config", HNN_LIMITS.maxAttrBytes)
    return config === null ? null : { name: marker, attrs: { ...base, config } }
  }
  const resourceId = required("resourceid", HNN_LIMITS.maxIdentifierBytes)
  const resourceName = required("name", HNN_LIMITS.maxLabelBytes)
  return resourceId === null || resourceName === null ? null : { name: marker, attrs: { ...base, resourceId, name: resourceName } }
}

function validClipboardString(value: string, maxBytes: number): boolean {
  return value.trim().length > 0 && utf8Bytes(value) <= maxBytes && jsonStringBytes(value) <= HNN_LIMITS.maxAttrBytes
}

/**
 * Tiptap 会在 node parse rule 返回 attrs 后逐项调用 addAttributes.parseHTML；这里必须
 * 直接返回 shared validator 的原始 typed 值，避免默认 fromString 将 "0"/"true" 等
 * 合法持久字符串误转为 number/boolean。外部无 marker 仅使用明确安全默认值。
 */
function markerAwareClipboardAttr(name: HnnClipboardNodeName, attribute: string, fallback: unknown) {
  return {
    default: fallback,
    parseHTML: (element: HTMLElement): unknown => {
      if (!element.hasAttribute("data-hnn-node")) return fallback
      const parsed = parseHnnClipboardNode(element)
      return parsed?.name === name ? parsed.attrs[attribute] ?? fallback : fallback
    }
  }
}

/**
 * 控件提交前的 strict codec 等价预检（宽度表与 codec 共用 ./stringBytes，零口径漂移）：
 * 1. 原始 UTF-8 字节 ≤ maxRawBytes（对应 codec.requiredString 的逐字段上限）；
 * 2. JSON 字符串序列化字节（含外层引号与转义展开）≤ maxAttrBytes（对应编码期 attrValueBytes 检查）。
 * 双重限制均通过才允许 dispatch；失败返回可读错误消息，调用方必须零事务并恢复/保留最近持久值。
 */
function attrStringError(value: string, maxRawBytes: number, label: string): string | null {
  if (utf8Bytes(value) > maxRawBytes) return `${label}超出长度上限（最多 ${maxRawBytes} UTF-8 字节）`
  if (jsonStringBytes(value) > HNN_LIMITS.maxAttrBytes) return `${label}转义后超出长度上限（最多 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节）`
  return null
}

/**
 * 容器节点（callout/collapsible/blockquote）的纯文本序列化。
 *
 * Tiptap 的 getTextBetween 一旦命中某节点的 textSerializer 就 `return false`，
 * 跳过对该节点子内容的遍历。因此容器若只返回自身 attr（标题）或 node.textContent，
 * 会把正文以及正文内 atom 子节点（inlineFormula/mention/picture 等）的 toText
 * 全部吞掉，复制与 editor.getText() 输出不完整。
 *
 * 这里按 selection range 递归子节点，并复用 schema 上所有 toText（含 atom 子
 * serializer），得到与“未定义 renderText 时 getTextBetween 自然遍历”一致的正文
 * 纯文本。pos/range 均与 getTextBetween 传入的坐标系一致（相对同一起算节点）。
 */
function serializeContainerContent(node: PmNode, pos: number, range: { from: number; to: number } | undefined): string {
  const contentSize = node.content.size
  // range 为文档绝对坐标，pos 为该容器起点；换算成相对容器内容（pos+1 起）的局部坐标。
  const from = range ? Math.max(0, Math.min(contentSize, range.from - pos - 1)) : 0
  const to = range ? Math.max(0, Math.min(contentSize, range.to - pos - 1)) : contentSize
  if (from >= to) return ""
  const serializers = getTextSerializersFromSchema(node.type.schema)
  let text = ""
  node.nodesBetween(from, to, (child, childPos, parent, index) => {
    if (child.isBlock && childPos > from) text += "\n\n"
    const serializer = serializers[child.type.name]
    if (serializer) {
      // 子节点坐标相对本容器；把同一坐标系的局部 range 传下去，嵌套容器才能正确裁剪。
      text += serializer({ node: child, pos: childPos, parent: parent ?? node, index, range: { from, to } })
      return false
    }
    if (child.isText) text += child.text?.slice(Math.max(from, childPos) - childPos, to - childPos) ?? ""
    return undefined
  })
  return text
}

/**
 * 容器 renderText 的公共实现：标题前缀（仅当选区含容器起点或无 range 的上文场景）
 * + range-aware 正文。选中正文中部时不会把未选中的标题并入纯文本。
 */
function containerRenderText(prefix: (node: PmNode) => string) {
  return (props: { node: PmNode; pos: number }): string => {
    const { node, pos } = props
    const range = (props as { range?: { from: number; to: number } }).range
    const body = serializeContainerContent(node, pos, range)
    const includePrefix = range === undefined || range.from <= pos
    const title = includePrefix ? prefix(node) : ""
    if (title === "") return body
    if (body === "") return title
    return `${title}\n\n${body}`
  }
}

/* ===== card/drawing 数据编辑器 bridge（DESIGN.md §15 底部 Drawer） =====
 * NodeView 不直接渲染 Drawer：editor 侧 React 组件通过 registerHnnDataEditor
 * 注册打开/预检回调，NodeView 只提供最近持久 data 与唯一提交入口 commit。
 * 这样 extensions 不反向依赖 codec（整文档 encodeHnn 预检由 editor 侧实现）。
 */

export type HnnDataCommitResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

export interface HnnDataEditRequest {
  readonly kind: "card" | "drawing"
  /** 打开瞬间的最近持久 data（Drawer 草稿种子；编辑期间 PM 不发生任何事务）。 */
  readonly data: string
  /** 触发入口（预览按钮）；Drawer 关闭后焦点还原到它。 */
  readonly anchor: HTMLElement
  /**
   * Drawer 完成按钮的唯一提交入口：值未变化时零事务直接成功；否则构建带
   * closeHistory 的 candidate 事务，先经 validateCandidate 预检整文档，
   * 失败则不 dispatch 并返回可读消息（Drawer 保持开启、草稿保留）。
   */
  readonly commit: (candidateData: string) => HnnDataCommitResult
  /** Drawer 关闭后回调（无论是否提交），用于复位触发入口的 aria-expanded。 */
  readonly onClosed?: () => void
}

export interface HnnDataEditorBridge {
  readonly open: (request: HnnDataEditRequest) => void
  /** 预检未 dispatch 的 candidate 整文档（editor 侧用 encodeHnn 实现）；通过返回 null。 */
  readonly validateCandidate: (candidateDoc: PmNode) => string | null
}

const hnnDataEditorBridges = new WeakMap<Editor, HnnDataEditorBridge>()

/** 每个 editor 实例至多一个数据编辑器；返回注销函数（只注销自己那次注册）。 */
export function registerHnnDataEditor(editor: Editor, bridge: HnnDataEditorBridge): () => void {
  hnnDataEditorBridges.set(editor, bridge)
  return () => {
    if (hnnDataEditorBridges.get(editor) === bridge) hnnDataEditorBridges.delete(editor)
  }
}

/** 把 schema renderHTML 产出的属性落到 NodeView 根元素；空值与对象值不落属性。 */
function applyDomAttrs(dom: HTMLElement, HTMLAttributes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(HTMLAttributes)) {
    if (value === null || value === undefined) continue
    if (typeof value === "string") dom.setAttribute(key, value)
    else if (typeof value === "number" || typeof value === "boolean") dom.setAttribute(key, String(value))
  }
}

/**
 * KaTeX 安全渲染：renderToString 默认转义用户输入（strict warn、不信任任何
 * \href/\htmlClass 之类的 trust 指令），产物再经 DOMParser 解析为节点后
 * importNode 挂载——全程不经 innerHTML、不执行脚本；任何异常退化为纯文本源码，
 * 保证非法 LaTeX 仍然可见、可编辑。
 */
function renderLatexInto(target: HTMLElement, latex: string, displayMode: boolean): void {
  try {
    const html = katex.renderToString(latex, { displayMode, throwOnError: false, strict: "warn" })
    const parsed = new DOMParser().parseFromString(html, "text/html")
    target.replaceChildren(...Array.from(parsed.body.childNodes, (child) => document.importNode(child, true)))
  } catch {
    target.textContent = latex
  }
}

/** 图片 src 渲染策略：在 codec URL 白名单之上再限定 http/https，mailto:/hnmagic: 不进入 <img>。 */
function isSafePictureUrl(value: string): boolean {
  return /^https?:/i.test(value) && isSafeHnnUrl(value)
}

/** 原子节点最小弹出编辑器的配置。 */
interface HnnMiniEditorSpec {
  /** 触发入口（按钮）；Escape 关闭时焦点还原到它。 */
  anchor: HTMLElement
  /** 弹出层与输入框共用的可访问名称。 */
  label: string
  value: string
  rows?: number
  placeholder?: string
  /** 草稿变化时的即时预览（只改 DOM，不产生事务）。 */
  onDraft?: (value: string) => void
  /** 关闭提交前的校验：返回错误消息则放弃提交（零事务），由 onInvalid 呈现。 */
  validate?: (value: string) => string | null
  /** 校验通过且值有变化时调用一次（调用方负责归一并走 commitNodeAttrs）。 */
  onCommit: (value: string) => void
  /** 校验失败的关闭：不得提交；调用方恢复持久值呈现并给出可访问错误。 */
  onInvalid?: (message: string) => void
  /** 关闭后回调（无论是否提交），用于释放 NodeView 的打开态。 */
  onClosed?: () => void
}

/**
 * 原子节点的最小弹出编辑器（DESIGN.md §11 公式编辑器的封闭实现，card/drawing
 * 数据编辑复用同一形态）：深色 popover + textarea，固定定位在锚点下方；
 * Escape（焦点还原到锚点）、外部 pointerdown、scroll/resize、失焦都会
 * 提交并关闭。坐标只在打开时计算一次，滚动/缩放即关闭以避免陈旧定位。
 * 所有监听器随关闭移除；NodeView destroy 时应调用返回的 close 释放资源。
 */
function openHnnMiniEditor(spec: HnnMiniEditorSpec): () => void {
  const popover = document.createElement("div")
  popover.className = "hn-editor-mini-popover"
  popover.setAttribute("role", "dialog")
  popover.setAttribute("aria-label", spec.label)
  const textarea = document.createElement("textarea")
  textarea.className = "hn-editor-mini-textarea"
  textarea.setAttribute("aria-label", spec.label)
  textarea.rows = spec.rows ?? 3
  if (spec.placeholder !== undefined) textarea.placeholder = spec.placeholder
  textarea.value = spec.value
  popover.append(textarea)

  const rect = spec.anchor.getBoundingClientRect()
  popover.style.top = `${rect.bottom + 6}px`
  popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`

  let closed = false
  const close = (restoreFocus: boolean): void => {
    if (closed) return
    closed = true
    document.removeEventListener("keydown", onKeyDown, true)
    document.removeEventListener("pointerdown", onPointerDown, true)
    window.removeEventListener("scroll", onWindowChange, true)
    window.removeEventListener("resize", onWindowChange)
    // 关闭即提交一次；值未变或校验失败都不产生事务，保证每次编辑会话最多一条历史步。
    if (textarea.value !== spec.value) {
      const failure = spec.validate?.(textarea.value) ?? null
      if (failure === null) spec.onCommit(textarea.value)
      else spec.onInvalid?.(failure)
    }
    popover.remove()
    spec.onClosed?.()
    if (restoreFocus) spec.anchor.focus()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return
    // 阻止继续传播，避免编辑器或其它控件重复响应同一个 Escape。
    event.stopPropagation()
    close(true)
  }
  const onPointerDown = (event: Event): void => {
    if (event.target instanceof window.Node && !popover.contains(event.target)) close(false)
  }
  const onWindowChange = (): void => close(false)

  textarea.addEventListener("input", () => spec.onDraft?.(textarea.value))
  // 失焦同样提交关闭；外部 pointerdown 的捕获监听会先触发，两条路径幂等。
  textarea.addEventListener("blur", () => close(false))
  document.addEventListener("keydown", onKeyDown, true)
  document.addEventListener("pointerdown", onPointerDown, true)
  window.addEventListener("scroll", onWindowChange, true)
  window.addEventListener("resize", onWindowChange)
  document.body.append(popover)
  textarea.focus()
  textarea.select()
  return () => close(false)
}

/* ===== 代码块安全高亮 =====
 * 只用 document.createElement + textContent 构造 token，绝不拼接 HTML 字符串；
 * 正式 LSP 级高亮不越出 Phase 6.1，这里提供可读的最小语法着色。
 */
const HNN_CODE_LANGUAGES = [
  "plaintext", "bash", "c", "cpp", "csharp", "css", "go", "html", "java", "javascript",
  "json", "kotlin", "markdown", "php", "python", "ruby", "rust", "sql", "swift", "typescript", "yaml"
] as const

const CODE_TOKEN_PATTERN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|for|while|import|export|from|default|class|new|typeof|type|interface|enum|extends|implements|async|await|try|catch|finally|throw|switch|case|break|continue|def|fn|struct|impl|pub|use|match|print|echo|null|true|false|undefined|this|self|void)\b/g

function codeTokenClass(match: RegExpMatchArray): string {
  if (match[1] !== undefined) return "hljs-comment"
  if (match[2] !== undefined) return "hljs-string"
  return /^\d/.test(match[0]) ? "hljs-number" : "hljs-keyword"
}

function renderCodeHighlight(target: HTMLElement, code: string): void {
  const fragment = document.createDocumentFragment()
  let lastIndex = 0
  for (const match of code.matchAll(CODE_TOKEN_PATTERN)) {
    if (match.index > lastIndex) fragment.append(document.createTextNode(code.slice(lastIndex, match.index)))
    const span = document.createElement("span")
    span.className = codeTokenClass(match)
    span.textContent = match[0]
    fragment.append(span)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < code.length) fragment.append(document.createTextNode(code.slice(lastIndex)))
  target.replaceChildren(fragment)
}

function buildHnnExtensions(includeUndoRedo: boolean): Extensions {
  // HNN 只持久化 href，不能让 Link 的 HTML 展示 attrs 进入 PM JSON。
  const HnnLink = Link.extend({
    addAttributes() {
      return {
        href: { default: null }
      }
    }
  }).configure({
    autolink: false,
    linkOnPaste: false,
    openOnClick: false,
    protocols: ["hnmagic"],
    isAllowedUri: (url: string) => isSafeHnnUrl(url)
  })

  const HnnCodeBlock = Node.create({
    name: "codeBlock",
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    addAttributes() {
      return {
        language: markerAwareClipboardAttr("codeBlock", "language", "plaintext"),
        filename: markerAwareClipboardAttr("codeBlock", "filename", "untitled")
      }
    },
    renderHTML({ HTMLAttributes }) {
      return ["pre", { ...HTMLAttributes, "data-hnn-node": "codeBlock" }, ["code", 0]]
    },
    parseHTML() {
      return [{
        tag: "pre",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          if (element.hasAttribute("data-hnn-node")) {
            const parsed = parseHnnClipboardNode(element)
            return parsed?.name === "codeBlock" ? parsed.attrs : false
          }
          // 外部标准 <pre><code> 只取得文本内容，使用固定安全默认 attrs。
          return { language: "plaintext", filename: "untitled" }
        }
      }]
    },
    addNodeView() {
      // 封闭代码块卡片：语言 combobox + 文件名 textbox + 安全高亮层 + 透明文本编辑层。
      return ({ node, HTMLAttributes, getPos, editor }) => {
        const dom = document.createElement("div")
        applyDomAttrs(dom, HTMLAttributes)
        dom.classList.add("hn-editor-code-card")

        const meta = document.createElement("div")
        meta.className = "hn-editor-code-meta"
        const langSelect = document.createElement("select")
        langSelect.className = "hn-editor-code-lang"
        langSelect.setAttribute("aria-label", "代码语言")
        for (const language of HNN_CODE_LANGUAGES) {
          const option = document.createElement("option")
          option.value = language
          option.textContent = language
          langSelect.append(option)
        }
        const ensureLanguageOption = (language: string): void => {
          // 持久化的任意 language 值都要能在 combobox 中回显。
          if ([...langSelect.options].some((option) => option.value === language)) return
          const option = document.createElement("option")
          option.value = language
          option.textContent = language
          langSelect.append(option)
        }
        const filenameInput = document.createElement("input")
        filenameInput.type = "text"
        filenameInput.className = "hn-editor-code-filename"
        filenameInput.setAttribute("aria-label", "代码文件名")
        filenameInput.placeholder = "untitled"
        // 可访问校验错误（role=alert 即 aria-live=assertive），空时由 CSS 隐藏。
        const error = document.createElement("span")
        error.className = "hn-editor-field-error"
        error.setAttribute("role", "alert")
        meta.append(langSelect, filenameInput, error)

        const editing = document.createElement("div")
        editing.className = "hn-editor-code-editing"
        const highlightPre = document.createElement("pre")
        highlightPre.className = "hn-editor-code-highlight"
        highlightPre.setAttribute("aria-hidden", "true")
        const highlightCode = document.createElement("code")
        highlightPre.append(highlightCode)
        const editorPre = document.createElement("pre")
        editorPre.className = "hn-editor-code-editor"
        const editorCode = document.createElement("code")
        editorPre.append(editorCode)
        editing.append(highlightPre, editorPre)
        dom.append(meta, editing)

        const syncFromNode = (current: typeof node): void => {
          const language = String(current.attrs["language"] ?? "plaintext")
          ensureLanguageOption(language)
          if (langSelect.value !== language) langSelect.value = language
          const filename = String(current.attrs["filename"] ?? "")
          if (filenameInput.value !== filename) filenameInput.value = filename
          if (highlightCode.textContent !== current.textContent) renderCodeHighlight(highlightCode, current.textContent)
        }
        // update 时同步刷新；所有恢复路径以最近持久节点为准，绝不退回初始 node。
        let currentNode = node
        syncFromNode(currentNode)

        langSelect.addEventListener("change", () => {
          commitNodeAttrs(editor, getPos, { language: langSelect.value })
        })
        filenameInput.addEventListener("input", () => { error.textContent = "" })
        filenameInput.addEventListener("change", () => {
          // codec 要求 filename 为非空字符串；清空输入回落到默认值。
          const filename = filenameInput.value.trim()
          const next = filename === "" ? "untitled" : filename
          // 与 codec codeBlock.filename（maxLabelBytes）等价预检：失败零事务、恢复最近持久输入。
          const overLimit = attrStringError(next, HNN_LIMITS.maxLabelBytes, "代码文件名")
          if (overLimit !== null) {
            error.textContent = overLimit
            syncFromNode(currentNode)
            return
          }
          error.textContent = ""
          commitNodeAttrs(editor, getPos, { filename: next })
        })

        return {
          dom,
          contentDOM: editorCode,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            currentNode = updatedNode
            syncFromNode(updatedNode)
            return true
          },
          stopEvent: (event) => eventInside(meta, event),
          ignoreMutation: (mutation) => !editorCode.contains(mutation.target)
        }
      }
    }
  })

  /* ===== Phase 6.2 自定义块界面 =====
   * 全部为封闭 NodeView：attrs 只经 commitNodeAttrs 单事务提交（独立 undo step）；
   * 原子节点整体可选中/删除；渲染只用 createElement/textContent 与 KaTeX 安全路径，
   * 绝不拼接 HTML。mention/resource/externalItem 是宿主引用（DESIGN.md §14/§16），
   * 保持只读呈现；card/drawing 的正式底部 Drawer 与拖拽上传属后续 lane，这里只提供
   * 清晰、可选择且可触达的最小编辑入口/预览。
   */

  const CALLOUT_TONE_LABELS: Record<(typeof CALLOUT_TONES)[number], string> = {
    info: "信息",
    success: "成功",
    warning: "警告"
  }

  const HnnCallout = Node.create({
    name: "callout",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes: () => ({
      tone: markerAwareClipboardAttr("callout", "tone", "info"),
      title: markerAwareClipboardAttr("callout", "title", "Callout")
    }),
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-hnn-node": "callout" }, 0]
    },
    parseHTML() {
      return [{
        tag: 'div[data-hnn-node="callout"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const parsed = parseHnnClipboardNode(element)
          return parsed?.name === "callout" ? parsed.attrs : false
        }
      }]
    },
    renderText: containerRenderText((node) => attrString(node.attrs["title"], "")),
    addNodeView() {
      // 提示块：色调 combobox + 标题 textbox + 正文 contentDOM。
      return ({ node, HTMLAttributes, getPos, editor }) => {
        const dom = document.createElement("div")
        applyDomAttrs(dom, HTMLAttributes)
        dom.setAttribute("data-hnn-node", "callout")
        dom.classList.add("hn-editor-callout")

        const header = document.createElement("div")
        header.className = "hn-editor-callout-header"
        const toneSelect = document.createElement("select")
        toneSelect.className = "hn-editor-callout-tone"
        toneSelect.setAttribute("aria-label", "提示类型")
        for (const tone of CALLOUT_TONES) {
          const option = document.createElement("option")
          option.value = tone
          option.textContent = CALLOUT_TONE_LABELS[tone]
          toneSelect.append(option)
        }
        const titleInput = document.createElement("input")
        titleInput.type = "text"
        titleInput.className = "hn-editor-callout-title"
        titleInput.setAttribute("aria-label", "提示标题")
        titleInput.placeholder = "提示标题"
        header.append(toneSelect, titleInput)
        // 可访问校验错误（role=alert 即 aria-live=assertive），空时由 CSS 隐藏。
        const error = document.createElement("span")
        error.className = "hn-editor-field-error"
        error.setAttribute("role", "alert")
        const body = document.createElement("div")
        body.className = "hn-editor-callout-body"
        dom.append(header, error, body)

        // update 时同步刷新；所有恢复路径都以最近持久节点为准，绝不退回初始 node。
        let currentNode = node
        const syncFromNode = (current: typeof node): void => {
          // 运行时 attr 可能来自任意事务：超出枚举的 tone 一律回退到 info 呈现。
          const rawTone = String(current.attrs["tone"] ?? "info")
          const tone = (CALLOUT_TONES as readonly string[]).includes(rawTone) ? rawTone : "info"
          for (const candidate of CALLOUT_TONES) dom.classList.toggle(`hn-editor-callout--${candidate}`, candidate === tone)
          if (toneSelect.value !== tone) toneSelect.value = tone
          const title = attrString(current.attrs["title"], "")
          if (titleInput.value !== title) titleInput.value = title
        }
        syncFromNode(currentNode)

        toneSelect.addEventListener("change", () => {
          commitNodeAttrs(editor, getPos, { tone: toneSelect.value })
        })
        titleInput.addEventListener("input", () => { error.textContent = "" })
        titleInput.addEventListener("change", () => {
          // codec 要求 title 为非空字符串：清空是失败提交——零事务、恢复最近持久值、写可访问错误。
          const title = titleInput.value.trim()
          if (title === "") {
            error.textContent = "提示标题不得为空"
            syncFromNode(currentNode)
            return
          }
          // 超限零事务：恢复最近持久值并给出可访问错误。
          const overLimit = attrStringError(title, HNN_LIMITS.maxLabelBytes, "提示标题")
          if (overLimit !== null) {
            error.textContent = overLimit
            syncFromNode(currentNode)
            return
          }
          error.textContent = ""
          commitNodeAttrs(editor, getPos, { title })
        })

        return {
          dom,
          contentDOM: body,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            currentNode = updatedNode
            syncFromNode(updatedNode)
            return true
          },
          stopEvent: (event) => eventInside(header, event),
          ignoreMutation: (mutation) => !body.contains(mutation.target)
        }
      }
    }
  })

  const HnnCollapsible = Node.create({
    name: "collapsible",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes: () => ({
      title: markerAwareClipboardAttr("collapsible", "title", "Details"),
      collapsed: markerAwareClipboardAttr("collapsible", "collapsed", false)
    }),
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-hnn-node": "collapsible" }, 0]
    },
    parseHTML() {
      return [{
        tag: 'div[data-hnn-node="collapsible"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const parsed = parseHnnClipboardNode(element)
          return parsed?.name === "collapsible" ? parsed.attrs : false
        }
      }]
    },
    renderText: containerRenderText((node) => attrString(node.attrs["title"], "")),
    addNodeView() {
      // 折叠块：可访问折叠开关（aria-expanded）+ 标题 textbox + 正文 contentDOM。
      return ({ node, HTMLAttributes, getPos, editor }) => {
        const dom = document.createElement("div")
        applyDomAttrs(dom, HTMLAttributes)
        dom.setAttribute("data-hnn-node", "collapsible")
        dom.classList.add("hn-editor-collapsible")

        const header = document.createElement("div")
        header.className = "hn-editor-collapsible-header"
        const toggle = document.createElement("button")
        toggle.type = "button"
        toggle.className = "hn-editor-collapsible-toggle"
        toggle.setAttribute("aria-label", "展开或折叠内容")
        const caret = document.createElement("span")
        caret.className = "hn-editor-collapsible-caret"
        caret.setAttribute("aria-hidden", "true")
        caret.textContent = "▶"
        toggle.append(caret)
        const titleInput = document.createElement("input")
        titleInput.type = "text"
        titleInput.className = "hn-editor-collapsible-title"
        titleInput.setAttribute("aria-label", "折叠块标题")
        titleInput.placeholder = "折叠块标题"
        header.append(toggle, titleInput)
        // 可访问校验错误（role=alert 即 aria-live=assertive），空时由 CSS 隐藏。
        const error = document.createElement("span")
        error.className = "hn-editor-field-error"
        error.setAttribute("role", "alert")
        const body = document.createElement("div")
        body.className = "hn-editor-collapsible-body"
        dom.append(header, error, body)

        // update 时同步刷新；所有恢复路径都以最近持久节点为准，绝不退回初始 node。
        let currentNode = node
        const syncFromNode = (current: typeof node): void => {
          const collapsed = current.attrs["collapsed"] === true
          dom.classList.toggle("is-collapsed", collapsed)
          toggle.setAttribute("aria-expanded", String(!collapsed))
          const title = attrString(current.attrs["title"], "")
          if (titleInput.value !== title) titleInput.value = title
        }
        syncFromNode(currentNode)

        toggle.addEventListener("click", () => {
          commitNodeAttrs(editor, getPos, { collapsed: !(currentNode.attrs["collapsed"] === true) })
        })
        titleInput.addEventListener("input", () => { error.textContent = "" })
        titleInput.addEventListener("change", () => {
          // codec 要求 title 为非空字符串：清空是失败提交——零事务、恢复最近持久值、写可访问错误。
          const title = titleInput.value.trim()
          if (title === "") {
            error.textContent = "折叠块标题不得为空"
            syncFromNode(currentNode)
            return
          }
          // 超限零事务：恢复最近持久值并给出可访问错误。
          const overLimit = attrStringError(title, HNN_LIMITS.maxLabelBytes, "折叠块标题")
          if (overLimit !== null) {
            error.textContent = overLimit
            syncFromNode(currentNode)
            return
          }
          error.textContent = ""
          commitNodeAttrs(editor, getPos, { title })
        })

        return {
          dom,
          contentDOM: body,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            currentNode = updatedNode
            syncFromNode(updatedNode)
            return true
          },
          stopEvent: (event) => eventInside(header, event),
          ignoreMutation: (mutation) => !body.contains(mutation.target)
        }
      }
    }
  })

  /** 公式块/行内公式共用的 NodeView 构造：预览按钮 + KaTeX 渲染 + 最小弹出编辑器。 */
  const createFormulaNodeView = (displayMode: boolean, label: string, renderedClass: string) =>
    ({ node, HTMLAttributes, getPos, editor }: {
      node: { type: { name: string }; attrs: Record<string, unknown> }
      HTMLAttributes: Record<string, unknown>
      getPos: () => number | undefined
      editor: Editor
    }) => {
      const dom = document.createElement(displayMode ? "div" : "button")
      if (!displayMode) (dom as HTMLButtonElement).type = "button"
      applyDomAttrs(dom, HTMLAttributes)
      dom.setAttribute("data-hnn-node", node.type.name)
      dom.classList.add(displayMode ? "hn-editor-formula" : "hn-editor-inline-formula")
      // 原子节点整体不可进入文本编辑；点击/删除按整块处理。
      dom.setAttribute("contenteditable", "false")
      const preview = displayMode ? document.createElement("button") : dom
      if (displayMode) {
        ;(preview as HTMLButtonElement).type = "button"
        preview.classList.add("hn-editor-formula-preview")
      }
      preview.setAttribute("aria-label", label)
      const rendered = document.createElement("span")
      rendered.className = renderedClass
      preview.append(rendered)
      // 可访问校验错误（role=alert 即 aria-live=assertive），空时由 CSS 隐藏。
      const error = document.createElement("span")
      error.className = "hn-editor-field-error"
      error.setAttribute("role", "alert")
      if (displayMode) dom.append(preview, error)
      else dom.append(error)

      // latex 始终是最近持久值（update 时同步刷新），所有恢复路径以它为准。
      let latex = attrString(node.attrs["latex"], "0")
      const renderPreview = (value: string): void => renderLatexInto(rendered, value, displayMode)
      renderPreview(latex)

      let closeEditor: (() => void) | null = null
      preview.addEventListener("click", () => {
        if (closeEditor !== null) return
        error.textContent = ""
        closeEditor = openHnnMiniEditor({
          anchor: preview as HTMLElement,
          label: "LaTeX 源码",
          value: latex,
          rows: displayMode ? 3 : 1,
          placeholder: "例如 x^2 + y^2 = z^2",
          onDraft: renderPreview,
          validate: (value) => attrStringError(value.trim(), HNN_LIMITS.maxAttrBytes, "公式源码"),
          onCommit: (value) => {
            const next = value.trim()
            // codec 要求 latex 为非空字符串：清空是失败提交——零事务、恢复持久预览、写可访问错误。
            if (next === "") {
              error.textContent = "公式源码不得为空"
              renderPreview(latex)
              return
            }
            error.textContent = ""
            commitNodeAttrs(editor, getPos, { latex: next })
          },
          onInvalid: (message) => {
            // 零事务：恢复最近持久值的预览并给出可访问错误。
            error.textContent = message
            renderPreview(latex)
          },
          onClosed: () => { closeEditor = null }
        })
      })

      return {
        dom,
        update(updatedNode: typeof node) {
          if (updatedNode.type !== node.type) return false
          latex = attrString(updatedNode.attrs["latex"], "0")
          renderPreview(latex)
          return true
        },
        // 预览按钮的点击只打开编辑器，不交给 PM；其余区域（块级容器）保持默认。
        stopEvent: (event: Event) => displayMode && event.target === dom ? false : eventInside(preview as HTMLElement, event),
        ignoreMutation: () => true,
        destroy() {
          closeEditor?.()
        }
      }
    }

  const HnnFormula = Node.create({
    name: "formula",
    group: "block",
    atom: true,
    addAttributes: () => ({ latex: markerAwareClipboardAttr("formula", "latex", "0") }),
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-hnn-node": "formula" }, String(HTMLAttributes["latex"] ?? "")]
    },
    parseHTML() {
      return [{
        tag: 'div[data-hnn-node="formula"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const parsed = parseHnnClipboardNode(element)
          return parsed?.name === "formula" ? parsed.attrs : false
        }
      }]
    },
    renderText({ node }) {
      return node.attrs["latex"] as string
    },
    addNodeView() {
      return createFormulaNodeView(true, "编辑公式", "hn-editor-formula-rendered")
    }
  })

  const HnnInlineFormula = Node.create({
    name: "inlineFormula",
    group: "inline",
    inline: true,
    atom: true,
    marks: "",
    addAttributes: () => ({ latex: markerAwareClipboardAttr("inlineFormula", "latex", "0") }),
    renderHTML({ HTMLAttributes }) {
      return ["span", { ...HTMLAttributes, "data-hnn-node": "inlineFormula" }, String(HTMLAttributes["latex"] ?? "")]
    },
    parseHTML() {
      return [{
        tag: 'span[data-hnn-node="inlineFormula"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const parsed = parseHnnClipboardNode(element)
          return parsed?.name === "inlineFormula" ? parsed.attrs : false
        }
      }]
    },
    renderText({ node }) {
      return node.attrs["latex"] as string
    },
    addNodeView() {
      return createFormulaNodeView(false, "编辑行内公式", "hn-editor-inline-formula-rendered")
    }
  })

  const HnnPicture = Node.create({
    name: "picture",
    group: "block",
    atom: true,
    addAttributes: () => ({
      src: markerAwareClipboardAttr("picture", "src", "https://example.invalid/"),
      alt: markerAwareClipboardAttr("picture", "alt", "Image")
    }),
    renderHTML({ HTMLAttributes }) {
      // 剪贴板 HTML 同样不落危险 src。
      const attrs: Record<string, unknown> = { ...HTMLAttributes, "data-hnn-node": "picture" }
      if (typeof attrs["src"] !== "string" || !isSafePictureUrl(attrs["src"])) delete attrs["src"]
      return ["figure", attrs as Record<string, string>]
    },
    parseHTML() {
      return [{
        tag: 'figure[data-hnn-node="picture"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const parsed = parseHnnClipboardNode(element)
          return parsed?.name === "picture" ? parsed.attrs : false
        }
      }]
    },
    renderText({ node }) {
      return node.attrs["alt"] as string
    },
    addNodeView() {
      // 图片块：安全 src 才进入 <img>，否则只显占位；alt 由 textbox 持久化。
      return ({ node, HTMLAttributes, getPos, editor }) => {
        const dom = document.createElement("figure")
        applyDomAttrs(dom, HTMLAttributes)
        dom.setAttribute("data-hnn-node", "picture")
        dom.classList.add("hn-editor-picture")
        dom.setAttribute("contenteditable", "false")

        const frame = document.createElement("div")
        frame.className = "hn-editor-picture-frame"
        const image = document.createElement("img")
        image.className = "hn-editor-picture-img"
        const placeholder = document.createElement("div")
        placeholder.className = "hn-editor-picture-placeholder"
        placeholder.textContent = "图片不可用"
        frame.append(image, placeholder)
        const altInput = document.createElement("input")
        altInput.type = "text"
        altInput.className = "hn-editor-picture-alt"
        altInput.setAttribute("aria-label", "图片描述")
        altInput.placeholder = "描述这张图片"
        // 可访问校验错误（role=alert 即 aria-live=assertive），空时由 CSS 隐藏。
        const error = document.createElement("span")
        error.className = "hn-editor-field-error"
        error.setAttribute("role", "alert")
        dom.append(frame, altInput, error)

        // update 时同步刷新；所有恢复路径都以最近持久节点为准，绝不退回初始 node。
        let currentNode = node
        const syncFromNode = (current: typeof node): void => {
          const src = attrString(current.attrs["src"], "")
          const alt = attrString(current.attrs["alt"], "")
          if (isSafePictureUrl(src)) {
            if (image.getAttribute("src") !== src) image.setAttribute("src", src)
            image.alt = alt
            image.hidden = false
            placeholder.hidden = true
          } else {
            // 危险或不可渲染的 src 绝不落进 <img>。
            image.removeAttribute("src")
            image.hidden = true
            placeholder.hidden = false
          }
          if (altInput.value !== alt) altInput.value = alt
        }
        syncFromNode(currentNode)

        altInput.addEventListener("input", () => { error.textContent = "" })
        altInput.addEventListener("change", () => {
          // codec 要求 alt 为非空字符串：清空是失败提交——零事务、恢复最近持久值、写可访问错误。
          const alt = altInput.value.trim()
          if (alt === "") {
            error.textContent = "图片描述不得为空"
            syncFromNode(currentNode)
            return
          }
          // 超限零事务：恢复最近持久值并给出可访问错误。
          const overLimit = attrStringError(alt, HNN_LIMITS.maxLabelBytes, "图片描述")
          if (overLimit !== null) {
            error.textContent = overLimit
            syncFromNode(currentNode)
            return
          }
          error.textContent = ""
          commitNodeAttrs(editor, getPos, { alt })
        })

        return {
          dom,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            currentNode = updatedNode
            syncFromNode(updatedNode)
            return true
          },
          // alt 输入框事件自管；img 点击交给 PM 产生 NodeSelection。
          stopEvent: (event) => eventInside(altInput, event),
          ignoreMutation: () => true
        }
      }
    }
  })

  const DATA_BLOCK_LABELS = {
    card: { title: "卡片", editLabel: "编辑卡片" },
    drawing: { title: "画板", editLabel: "编辑画板" }
  } as const

  // 默认值来自纯 payload 模块，保证新原子节点不产生无法解析或编码的 "{}" data。
  const DATA_BLOCK_DEFAULTS: Record<keyof typeof DATA_BLOCK_LABELS, string> = {
    card: HNN_CARD_EMPTY_DATA,
    drawing: HNN_DRAWING_EMPTY_DATA
  }

  /** 预览元信息只描述最近持久 data：合法 payload 报内容规模，非法旧数据明确提示（绝不自动重置）。 */
  const DATA_BLOCK_DESCRIBERS: Record<keyof typeof DATA_BLOCK_LABELS, (value: string) => string> = {
    card: (value) => {
      const parsed = parseCardPayload(value)
      return parsed.ok ? `${parsed.value.cards.length} 张卡片` : "数据无效"
    },
    drawing: (value) => {
      const parsed = parseDrawingPayload(value)
      return parsed.ok ? `${parsed.value.strokes.length} 条笔画` : "数据无效"
    }
  }

  /**
   * card/drawing 预览块：完整编辑界面是 editor 侧注册的底部 Drawer（DESIGN.md §15），
   * 预览按钮是唯一交互层；点击经 bridge 打开 Drawer，提交只走 commit（单事务 + closeHistory +
   * 未 dispatch candidate 整文档预检）。未注册 bridge（无头会话）时预览保持惰性。
   */
  const createHnnDataBlock = (kind: keyof typeof DATA_BLOCK_LABELS): Node =>
    Node.create({
      name: kind,
      group: "block",
      atom: true,
      addAttributes: () => ({ data: markerAwareClipboardAttr(kind, "data", DATA_BLOCK_DEFAULTS[kind]) }),
      renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-hnn-node": kind }, `[${kind}]`]
      },
      parseHTML() {
        return [{
          tag: `div[data-hnn-node="${kind}"]`,
          getAttrs: (element) => {
            if (!(element instanceof HTMLElement)) return false
            const parsed = parseHnnClipboardNode(element)
            return parsed?.name === kind ? parsed.attrs : false
          }
        }]
      },
      renderText({ node }) {
        return `[${kind}] ${node.attrs["data"] as string}`
      },
      addNodeView() {
        const labels = DATA_BLOCK_LABELS[kind]
        const describe = DATA_BLOCK_DESCRIBERS[kind]
        return ({ node, HTMLAttributes, getPos, editor }) => {
          const dom = document.createElement("div")
          applyDomAttrs(dom, HTMLAttributes)
          dom.setAttribute("data-hnn-node", kind)
          dom.classList.add("hn-editor-data-block", `hn-editor-data-block--${kind}`)
          dom.setAttribute("contenteditable", "false")

          const preview = document.createElement("button")
          preview.type = "button"
          preview.className = "hn-editor-data-preview"
          preview.setAttribute("aria-label", labels.editLabel)
          preview.setAttribute("aria-haspopup", "dialog")
          const title = document.createElement("span")
          title.className = "hn-editor-data-title"
          title.textContent = labels.title
          const meta = document.createElement("span")
          meta.className = "hn-editor-data-meta"
          const hint = document.createElement("span")
          hint.className = "hn-editor-data-hint"
          hint.textContent = "点击编辑"
          preview.append(title, meta, hint)
          dom.append(preview)

          // data 始终是最近持久值（update 时同步刷新）；Drawer 草稿以打开瞬间的它为种子。
          let data = attrString(node.attrs["data"], DATA_BLOCK_DEFAULTS[kind])
          meta.textContent = describe(data)

          preview.addEventListener("click", () => {
            const bridge = hnnDataEditorBridges.get(editor)
            if (!bridge) return
            preview.setAttribute("aria-expanded", "true")
            bridge.open({
              kind,
              data,
              anchor: preview,
              commit: (candidateData) => {
                if (typeof getPos !== "function") return { ok: false, message: "块位置不可用，未保存更改" }
                const pos = getPos()
                if (typeof pos !== "number") return { ok: false, message: "块位置不可用，未保存更改" }
                const current = editor.state.doc.nodeAt(pos)
                if (!current) return { ok: false, message: "块已不存在，未保存更改" }
                const previous = attrString(current.attrs["data"], DATA_BLOCK_DEFAULTS[kind])
                // 值未变化零事务（不污染 dirty 基准与历史），但 Drawer 可正常关闭。
                if (previous === candidateData) return { ok: true }
                // 先构建未 dispatch 的 candidate 事务：closeHistory 令其成为独立 undo step；
                // editor 侧预检整文档可 encodeHnn 后才 dispatch，失败则整事务丢弃。
                const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, data: candidateData })
                closeHistory(tr)
                const failure = bridge.validateCandidate(tr.doc)
                if (failure !== null) return { ok: false, message: failure }
                editor.view.dispatch(tr)
                return { ok: true }
              },
              onClosed: () => preview.setAttribute("aria-expanded", "false")
            })
          })

          return {
            dom,
            update(updatedNode) {
              if (updatedNode.type !== node.type) return false
              data = attrString(updatedNode.attrs["data"], DATA_BLOCK_DEFAULTS[kind])
              meta.textContent = describe(data)
              return true
            },
            // 预览按钮事件自管；点击块体其余部分交给 PM 产生 NodeSelection。
            stopEvent: (event) => eventInside(preview, event),
            ignoreMutation: () => true
          }
        }
      }
    })

  const HnnDirectory = Node.create({
    name: "directory",
    group: "block",
    atom: true,
    addAttributes: () => ({ config: markerAwareClipboardAttr("directory", "config", "headings") }),
    renderHTML({ HTMLAttributes }) {
      // 序列化只携带 nodeId/config：条目绝不持久化，渲染时由正文 heading 重新派生。
      return ["div", { ...HTMLAttributes, "data-hnn-node": "directory" }, `[directory]`]
    },
    parseHTML() {
      return [{
        tag: 'div[data-hnn-node="directory"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const parsed = parseHnnClipboardNode(element)
          return parsed?.name === "directory" ? parsed.attrs : false
        }
      }]
    },
    renderText() {
      return "[directory]"
    },
    addNodeView() {
      // 目录（Phase 6.4）：只读派生界面。条目唯一来源是当前 editor.state.doc 经
      // deriveHnnDirectoryEntries 的实时派生（editor "update" 事件驱动重渲染）；
      // 点击条目只定位/临时高亮对应 heading（纯 DOM 操作），绝不产生 PM 事务、
      // history 步骤或 dirty。条目文本只走 textContent，不含未信任 HTML。
      return ({ node, HTMLAttributes, editor }) => {
        const dom = document.createElement("div")
        applyDomAttrs(dom, HTMLAttributes)
        dom.setAttribute("data-hnn-node", "directory")
        dom.setAttribute("role", "group")
        dom.setAttribute("aria-label", "目录")
        dom.classList.add("hn-editor-directory")
        dom.setAttribute("contenteditable", "false")

        const title = document.createElement("span")
        title.className = "hn-editor-directory-title"
        title.textContent = "目录"
        const configLine = document.createElement("span")
        configLine.className = "hn-editor-directory-config"
        const list = document.createElement("ul")
        list.className = "hn-editor-directory-list"
        list.setAttribute("aria-label", "标题条目")
        dom.append(title, configLine, list)

        // 临时高亮只存在于 DOM 层（PM MutationObserver 对 class 变化的调和结果
        // 与 state 一致，不会回写事务）；超时/下次定位/销毁时清理。
        let highlighted: HTMLElement | null = null
        let highlightTimer: ReturnType<typeof setTimeout> | null = null
        const clearHighlight = (): void => {
          if (highlightTimer !== null) {
            clearTimeout(highlightTimer)
            highlightTimer = null
          }
          if (highlighted) {
            highlighted.classList.remove("hn-editor-directory-target")
            highlighted = null
          }
        }

        /** 定位并临时高亮条目对应 heading；纯 DOM 操作，零 PM 事务。 */
        const locateHeading = (nodeId: string): void => {
          // 激活瞬间重新派生：position 永远对当前 doc 有效，绝不使用渲染期快照。
          const entry = deriveHnnDirectoryEntries(editor.state.doc).find((item) => item.nodeId === nodeId)
          if (!entry) return
          const target = editor.view.nodeDOM(entry.position)
          if (!(target instanceof HTMLElement)) return
          clearHighlight()
          // jsdom 无 scrollIntoView 实现：可选调用，测试以 prototype mock 断言。
          target.scrollIntoView?.({ block: "start" })
          target.classList.add("hn-editor-directory-target")
          highlighted = target
          highlightTimer = setTimeout(clearHighlight, 1500)
        }

        const renderEntries = (): void => {
          const entries = deriveHnnDirectoryEntries(editor.state.doc)
          list.replaceChildren()
          if (entries.length === 0) {
            const empty = document.createElement("li")
            empty.className = "hn-editor-directory-empty"
            empty.textContent = "暂无标题"
            list.append(empty)
            return
          }
          for (const entry of entries) {
            const item = document.createElement("li")
            item.className = "hn-editor-directory-item"
            item.setAttribute("data-level", String(entry.level))
            const button = document.createElement("button")
            button.type = "button"
            button.className = "hn-editor-directory-entry"
            button.textContent = entry.text
            button.addEventListener("click", () => locateHeading(entry.nodeId))
            item.append(button)
            list.append(item)
          }
        }

        const syncFromNode = (current: typeof node): void => {
          configLine.textContent = `配置：${String(current.attrs["config"] ?? "headings")}`
        }
        syncFromNode(node)
        renderEntries()
        // heading 增删改都属于 doc 事务："update" 事件即实时派生信号。任何 update
        // 都必须先撤下当前 heading 高亮并清理 1.5s timer，再按最新 doc 重派生——
        // 高亮目标可能已被改写/删除，残留高亮或迟到 timer 不得触碰陈旧 DOM。
        // 具名 listener 保证 on/off 对称；destroy（含 session 切换卸载）同样清理。
        const handleEditorUpdate = (): void => {
          clearHighlight()
          renderEntries()
        }
        editor.on("update", handleEditorUpdate)

        return {
          dom,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            syncFromNode(updatedNode)
            return true
          },
          // 条目按钮事件自管；点击块体其余部分交给 PM 产生 NodeSelection。
          stopEvent: (event) => eventInside(list, event),
          ignoreMutation: () => true,
          destroy() {
            editor.off("update", handleEditorUpdate)
            clearHighlight()
          }
        }
      }
    }
  })

  /** mention/resource 行内宿主引用 pill：只读呈现，NodeSelection 整体可选。 */
  const createHnnInlineRef = (name: "mention" | "resource", className: string, text: (attrs: Record<string, unknown>) => string): Node =>
    Node.create({
      name,
      group: "inline",
      inline: true,
      atom: true,
      marks: "",
      addAttributes: () => ({
        resourceId: markerAwareClipboardAttr(name, "resourceId", "resource"),
        name: markerAwareClipboardAttr(name, "name", "Resource")
      }),
      renderHTML({ HTMLAttributes }) {
        return ["span", { ...HTMLAttributes, "data-hnn-node": name }, text(HTMLAttributes)]
      },
      parseHTML() {
        return [{
          tag: `span[data-hnn-node="${name}"]`,
          getAttrs: (element) => {
            if (!(element instanceof HTMLElement)) return false
            const parsed = parseHnnClipboardNode(element)
            return parsed?.name === name ? parsed.attrs : false
          }
        }]
      },
      renderText({ node }) {
        return text(node.attrs)
      },
      addNodeView() {
        return ({ node, HTMLAttributes }) => {
          const dom = document.createElement("span")
          applyDomAttrs(dom, HTMLAttributes)
          dom.setAttribute("data-hnn-node", name)
          dom.classList.add(className)
          dom.setAttribute("contenteditable", "false")
          const syncFromNode = (current: typeof node): void => {
            dom.textContent = text(current.attrs)
            // mention 按 DESIGN.md §14 携带链接 id；resource 暴露资源 id 供宿主映射。
            const idKey = name === "mention" ? "data-note-link-id" : "data-resource-id"
            dom.setAttribute(idKey, String(current.attrs["resourceId"] ?? ""))
          }
          syncFromNode(node)
          return {
            dom,
            update(updatedNode) {
              if (updatedNode.type !== node.type) return false
              syncFromNode(updatedNode)
              return true
            },
            ignoreMutation: () => true
          }
        }
      }
    })

  const HnnExternalItem = Node.create({
    name: "externalItem",
    group: "block",
    atom: true,
    addAttributes: () => ({
      resourceId: markerAwareClipboardAttr("externalItem", "resourceId", "external"),
      name: markerAwareClipboardAttr("externalItem", "name", "External item")
    }),
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-hnn-node": "externalItem" }, String(HTMLAttributes["name"] ?? "")]
    },
    parseHTML() {
      return [{
        tag: 'div[data-hnn-node="externalItem"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const parsed = parseHnnClipboardNode(element)
          return parsed?.name === "externalItem" ? parsed.attrs : false
        }
      }]
    },
    renderText({ node }) {
      return node.attrs["name"] as string
    },
    addNodeView() {
      // 外部条目：宿主引用只读呈现（DESIGN.md §16 虚线下划线）；点击交互属宿主回调。
      return ({ node, HTMLAttributes }) => {
        const dom = document.createElement("div")
        applyDomAttrs(dom, HTMLAttributes)
        dom.setAttribute("data-hnn-node", "externalItem")
        dom.classList.add("hn-editor-external-item")
        dom.setAttribute("contenteditable", "false")
        const label = document.createElement("span")
        label.className = "hn-editor-external-item-name"
        dom.append(label)
        const syncFromNode = (current: typeof node): void => {
          label.textContent = String(current.attrs["name"] ?? "")
          dom.setAttribute("data-resource-id", String(current.attrs["resourceId"] ?? ""))
        }
        syncFromNode(node)
        return {
          dom,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            syncFromNode(updatedNode)
            return true
          },
          ignoreMutation: () => true
        }
      }
    }
  })

  const HnnBlockquote = Node.create({
    name: "blockquote",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
      return {
        // nodeId 统一由 HnnNodeIds global attribute 定义，避免同一节点双 parse getter 覆盖。
        // 外部 quote 的 author 一律丢弃；只有闭合 HNN marker 可通过 shared validator 运输。
        author: {
          default: null,
          parseHTML: (element) => markerAwareClipboardAttr("blockquote", "author", null).parseHTML(element) as string | null
        }
      }
    },
    renderHTML({ HTMLAttributes }) {
      return ["blockquote", { ...HTMLAttributes, "data-hnn-node": "blockquote" }, 0]
    },
    parseHTML() {
      return [{
        tag: "blockquote",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          if (element.hasAttribute("data-hnn-node")) {
            const parsed = parseHnnClipboardNode(element)
            return parsed?.name === "blockquote" ? parsed.attrs : false
          }
          // 外部标准引用没有 HNN marker，不允许携带 author/nodeId 等持久 attrs。
          return { author: null }
        }
      }]
    },
    renderText: containerRenderText(() => ""),
    addNodeView() {
      // 封闭引用块：正文 contentDOM 保持 ProseMirror 编辑，署名输入单独提交 attr。
      return ({ node, HTMLAttributes, getPos, editor }) => {
        const dom = document.createElement("blockquote")
        applyDomAttrs(dom, HTMLAttributes)
        const body = document.createElement("div")
        body.className = "hn-editor-quote-body"
        const footer = document.createElement("footer")
        footer.className = "hn-editor-quote-footer"
        const authorInput = document.createElement("input")
        authorInput.type = "text"
        authorInput.className = "hn-editor-quote-author"
        authorInput.setAttribute("aria-label", "引用署名")
        authorInput.placeholder = "署名"
        // 可访问校验错误（role=alert 即 aria-live=assertive），空时由 CSS 隐藏。
        const error = document.createElement("span")
        error.className = "hn-editor-field-error"
        error.setAttribute("role", "alert")
        footer.append(authorInput, error)
        dom.append(body, footer)

        // update 时同步刷新；所有恢复路径以最近持久节点为准，绝不退回初始 node。
        let currentNode = node
        const syncFromNode = (current: typeof node): void => {
          const author = typeof current.attrs["author"] === "string" ? current.attrs["author"] : ""
          if (authorInput.value !== author) authorInput.value = author
        }
        syncFromNode(currentNode)

        authorInput.addEventListener("input", () => { error.textContent = "" })
        authorInput.addEventListener("change", () => {
          // codec 允许 author 为 null 或缺省；空输入归一为 null，绝不写入空字符串。
          const author = authorInput.value.trim()
          // 与 codec blockquote author（maxLabelBytes）等价预检：失败零事务、恢复最近持久输入。
          if (author !== "") {
            const overLimit = attrStringError(author, HNN_LIMITS.maxLabelBytes, "引用署名")
            if (overLimit !== null) {
              error.textContent = overLimit
              syncFromNode(currentNode)
              return
            }
          }
          error.textContent = ""
          commitNodeAttrs(editor, getPos, { author: author === "" ? null : author })
        })

        return {
          dom,
          contentDOM: body,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            currentNode = updatedNode
            syncFromNode(updatedNode)
            return true
          },
          stopEvent: (event) => eventInside(footer, event),
          ignoreMutation: (mutation) => !body.contains(mutation.target)
        }
      }
    }
  })

  const HnnTable = Table.extend({
    addNodeView() {
      // 表格行/列结构与操作入口（DESIGN.md §10）：单元格边界 + 控件、焦点行/列
      // 操作控件（in-menu 两步删除 + 拖动重排，中点推进插入边界、实线预览精确落线）
      // 全部由 tableEdgeControls 承担。结构判断以 TableMap 逻辑网格为准（colspan/
      // rowspan 感知，绝不用 childCount）；所有变更只透传 TableKit/prosemirror-tables
      // 命令，每个完整手势恰好一个 PM transaction（closeHistory 切分 undo step）；
      // 只读模式不渲染、不响应。
      return ({ node, HTMLAttributes, getPos, editor }) => {
        const dom = document.createElement("div")
        applyDomAttrs(dom, HTMLAttributes)
        dom.classList.add("hn-editor-table-wrapper")
        const table = document.createElement("table")
        const tbody = document.createElement("tbody")
        table.append(tbody)
        dom.append(table)

        const controls = installTableEdgeControls({
          editor,
          wrapper: dom,
          table,
          tbody,
          getPos: () => (typeof getPos === "function" ? getPos() : undefined),
          tableNodeType: node.type
        })

        return {
          dom,
          contentDOM: tbody,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            controls.refresh()
            return true
          },
          // 控件 DOM 事件不交给 ProseMirror；单元格正文事件保持默认处理。
          stopEvent: (event) => eventInside(dom, event) && !eventInside(tbody, event),
          ignoreMutation: (mutation) => !tbody.contains(mutation.target),
          destroy() {
            controls.destroy()
          }
        }
      }
    }
  }).configure({ resizable: false })

  const HnnNodeIds = Extension.create({
    name: "hnnNodeIds",
    priority: 10_000,
    addGlobalAttributes() {
      return [{
        types: persistentNodeTypes,
        attributes: {
          nodeId: {
            ...nodeIdAttr,
            parseHTML: (element: HTMLElement) => {
              const parsed = element.hasAttribute("data-hnn-node") ? parseHnnClipboardNode(element) : null
              return parsed?.attrs["nodeId"] ?? null
            }
          }
        }
      }]
    },
    addProseMirrorPlugins() {
      return [createHnnNodeIdPlugin(() => collectHnnNodeIds(this.editor.state.doc))]
    },
    onBeforeCreate() {
      // 此时 Tiptap 尚未创建 EditorState；直接替换 JSON 避免初始文档产生修复历史。
      this.editor.options.content = normalizeInitialHnnContent(this.editor.options.content)
    }
  })

  return [
    StarterKit.configure({
      codeBlock: false,
      blockquote: false,
      link: false,
      dropcursor: false,
      gapcursor: false,
      // codec schema 不需要 history；编辑会话仅通过此封闭装配启用官方 UndoRedo。
      undoRedo: includeUndoRedo ? {} : false,
      underline: false,
      trailingNode: false
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Table 本体由 HnnTable 提供（带封闭行/列控件 NodeView）；Kit 只补 row/cell/header。
    TableKit.configure({ table: false }),
    HnnTable,
    HnnBlockquote,
    HnnLink,
    HnnCodeBlock,
    HnnCallout,
    HnnCollapsible,
    HnnFormula,
    HnnInlineFormula,
    HnnPicture,
    createHnnDataBlock("card"),
    createHnnDataBlock("drawing"),
    HnnDirectory,
    createHnnInlineRef("mention", "hn-editor-mention", (attrs) => `@${attrString(attrs["name"], "")}`),
    createHnnInlineRef("resource", "hn-editor-resource", (attrs) => attrString(attrs["name"], "")),
    HnnExternalItem,
    HnnNodeIds
  ]
}

/** 只包含未来 HNN v1 可持久化结构的封闭 runtime extension 集合。 */
export function createHnnExtensions(): Extensions {
  return buildHnnExtensions(false)
}

/** 编辑会话专用的闭合装配；宿主没有扩展、schema 或 history 注入入口。 */
export function createHnnEditorExtensions(): Extensions {
  return buildHnnExtensions(true)
}

/** schema 只可从同一封闭 runtime extension 集合取得。 */
export const hnnRuntimeSchema = getSchema(createHnnExtensions())

export const HNN_NODE_TYPES = new Set(Object.keys(hnnRuntimeSchema.nodes))
export const HNN_MARK_TYPES = new Set(Object.keys(hnnRuntimeSchema.marks))
