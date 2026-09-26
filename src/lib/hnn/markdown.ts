import { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type {
  BlockContent,
  Content,
  ListItem,
  PhrasingContent,
  Root,
  TableCell
} from "mdast"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import type { Position } from "unist"
import { decodeHnn, encodeHnn, HnnCodecError, type HnnDocument } from "./codec"
import { HNN_LIMITS, HNN_TABLE_LIMITS, UUID_V4_PATTERN } from "./limits"
import { createHnnNodeId } from "./nodeId"
import { HNN_MARK_TYPES, HNN_NODE_TYPES, hnnSchema } from "./schema"
import { isSafeHnnUrl } from "./urlPolicy"

/** Markdown codec 的诊断只描述转换结果，不执行写文件或任何宿主 I/O。 */
export interface MarkdownDiagnostic {
  code: string
  message: string
  line?: number
  column?: number
  offset?: number
  path?: string
  nodeId?: string
}

export type MarkdownImportResult =
  | { document: HnnDocument; diagnostics: MarkdownDiagnostic[] }
  | {
      document?: never
      diagnostics: MarkdownDiagnostic[]
      failure: "input-too-large" | "conversion-failed"
    }

export interface MarkdownExportResult {
  markdown: string
  diagnostics: MarkdownDiagnostic[]
}

type HnnJsonNode = Record<string, unknown>
type MarkdownPosition = { line?: number; column?: number; offset?: number }
type FallbackPlan = { language: string; segments: readonly string[] }
const FALLBACK_PLAN = Symbol("fallbackPlan")
// JSON-b64 节点在全局预算通过前保留解析出的只读 payload；物化时才移除旧 ID 并分配新 ID。
const JSON_FENCE_PLAN = Symbol("jsonFencePlan")
// 每个计划节点都保留最深的 Markdown 来源。它只参与导入期账本与诊断，绝不能进入 HNN JSON。
const PLAN_SOURCE = Symbol("planSource")
// callout/collapsible 的正文先作为候选计划保留。只有完整包装节点通过账本后，才提交其
// Markdown 预算；若包装节点容量失败，则能回滚正文诊断并仅替换这个围栏。
const NESTED_FENCE_PLAN = Symbol("nestedFencePlan")

const markdownParser = unified().use(remarkParse).use(remarkGfm)
const markdownStringifier = unified().use(remarkStringify).use(remarkGfm)
const MARK_RANK = new Map(
  Object.keys(hnnSchema.marks).map((type, rank) => [type, rank])
)
// 合法 HNN JSON 经 base64url 会膨胀到约 4/3。额外预算覆盖每个 JSON-b64 fence
// 的围栏与 meta，因此合法的接近 512 KiB HNN 仍可完成导出再导入。
const MAX_MARKDOWN_BYTES =
  Math.ceil(HNN_LIMITS.maxShellBytes / 3) * 4 + HNN_LIMITS.maxNodes * 128
const MAX_MARKDOWN_LINES = 8_192
const MAX_MARKDOWN_BLOCKS = HNN_LIMITS.maxNodes * 4
const MAX_MARKDOWN_DEPTH = HNN_LIMITS.maxDepth
const MAX_LEXICAL_WORK = HNN_LIMITS.maxNodes * 32
const MAX_CONVERSION_NODES = HNN_LIMITS.maxNodes
const MAX_MARKDOWN_CANDIDATES = HNN_LIMITS.maxNodes
// base64url 字符均不含反引号或波浪号，固定三反引号 fence 不会因 payload 膨胀。
const BASE64URL_CHUNK_CHARS = HNN_LIMITS.maxAttrBytes - 256
const HN_FENCE_LANGUAGES = new Set([
  "math",
  "directory",
  "collapsible",
  "hamster-note-card",
  "hamster-note-drawing",
  "callout",
  "picture",
  "mention",
  "resource",
  "external-item",
  "hamster-note-json-b64"
])
// 只放行不带 title、无空白 destination 的完整独占 image 外观；Remark 随后仍须确认它确实是单一 image paragraph。
const EXCLUSIVE_GFM_IMAGE_CANDIDATE =
  /^ {0,3}!\[[^\]\r\n]*\]\((?:<[^>\r\n]*>|[^\s()\r\n]+(?:\([^\s()\r\n]*\)[^\s()\r\n]*)*)\)[ \t]*$/u

function utf8Bytes(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

/**
 * 逐码元计数并在超限时立即停止，避免仅为拒绝超大 Markdown 而分配完整 UTF-8 字节数组。
 * 未配对 surrogate 与 TextEncoder 一样按 replacement character 的三个字节计算。
 */
function isUtf8WithinLimit(value: string, limit: number): boolean {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
    if (bytes > limit) return false
  }
  return true
}

/** 与 HNN codec 的 attrSize 对齐，计算 JSON 字符串后的 UTF-8 大小且不分配转义结果。 */
function isHnnStringAttrWithinLimits(
  value: string,
  semanticLimit: number
): boolean {
  if (!isUtf8WithinLimit(value, semanticLimit)) return false
  let bytes = 2 // JSON opening and closing quotes
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (
      unit === 0x22 ||
      unit === 0x5c ||
      unit === 0x08 ||
      unit === 0x09 ||
      unit === 0x0a ||
      unit === 0x0c ||
      unit === 0x0d
    )
      bytes += 2
    else if (unit < 0x20) bytes += 6
    else if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 6
    } else if (unit >= 0xdc00 && unit <= 0xdfff) bytes += 6
    else bytes += 3
    if (bytes > HNN_LIMITS.maxAttrBytes) return false
  }
  return true
}

function position(value: {
  position?: Position | undefined
}): MarkdownPosition {
  const start = value.position?.start
  return {
    ...(start?.line === undefined ? {} : { line: start.line }),
    ...(start?.column === undefined ? {} : { column: start.column }),
    ...(start?.offset === undefined ? {} : { offset: start.offset })
  }
}

function importDiagnostic(
  diagnostics: MarkdownDiagnostic[],
  value: { position?: Position | undefined },
  code: string,
  message: string
): void {
  diagnostics.push({ code, message, ...position(value) })
}

/** 嵌套正文的 mdast 位置相对于 fence body；成功后统一指向外层 opening 的全局位置。 */
function rebaseDiagnostics(
  diagnostics: readonly MarkdownDiagnostic[],
  source: MarkdownPosition
): void {
  for (const diagnostic of diagnostics) {
    delete diagnostic.line
    delete diagnostic.column
    delete diagnostic.offset
    Object.assign(diagnostic, source)
  }
}

/** 仅删除某个围栏分支实际创建的诊断，保留同一容器里其余 sibling 的诊断。 */
function removeDiagnostics(
  target: MarkdownDiagnostic[],
  owned: readonly MarkdownDiagnostic[]
): void {
  if (owned.length === 0) return
  const removed = new Set(owned)
  for (let index = target.length - 1; index >= 0; index -= 1) {
    if (removed.has(target[index]!)) target.splice(index, 1)
  }
}

/** 预算错误必须跳过通用 conversion-failed 分支，避免把可预期的拒绝误报为 codec 故障。 */
class InputTooLargeError extends Error {
  readonly diagnostics: readonly MarkdownDiagnostic[]

  constructor(diagnostics: MarkdownDiagnostic | readonly MarkdownDiagnostic[]) {
    const normalized: readonly MarkdownDiagnostic[] =
      "code" in diagnostics ? [diagnostics] : diagnostics
    super(normalized.map((diagnostic) => diagnostic.message).join("; "))
    this.diagnostics = normalized
  }
}

/**
 * 导入阶段先创建不含 nodeId 的转换计划，而不是最终 HNN JSON。计划完成并通过统一预算前，
 * 不得调用 createHnnNodeId；这使每一条失败路径都没有部分 UUID 分配副作用。
 */
function planNode(
  type: string,
  attrs: Record<string, unknown> = {},
  content?: HnnJsonNode[]
): HnnJsonNode {
  const result: HnnJsonNode = { type }
  if (type !== "doc" && type !== "text") result["attrs"] = attrs
  if (content && content.length > 0) result["content"] = content
  return result
}

function text(value: string, marks?: HnnJsonNode[]): HnnJsonNode {
  const result: HnnJsonNode = { type: "text", text: value }
  if (marks && marks.length > 0) {
    // 每个文本计划拥有 marks/attrs 的独立副本。递归 Markdown 会复用 inherited
    // 数组；若只复制数组，link attrs 仍可能在归一化或最终编码时彼此串写。
    result["marks"] = marks
      .map((mark): HnnJsonNode => ({
        ...mark,
        ...(mark["attrs"]
          ? { attrs: { ...(mark["attrs"] as Record<string, unknown>) } }
          : {})
      }))
      .sort(
        (left, right) =>
          (MARK_RANK.get(String(left["type"])) ?? 0) -
          (MARK_RANK.get(String(right["type"])) ?? 0)
      )
  }
  return result
}

function paragraph(content: HnnJsonNode[]): HnnJsonNode {
  return planNode("paragraph", {}, content)
}

function planSource(value: HnnJsonNode): MarkdownPosition | undefined {
  return Object.getOwnPropertyDescriptor(value, PLAN_SOURCE)?.value as
    MarkdownPosition | undefined
}

function laterPosition(
  left: MarkdownPosition | undefined,
  right: MarkdownPosition | undefined
): MarkdownPosition | undefined {
  if (!left) return right
  if (!right) return left
  if ((right.offset ?? -1) >= (left.offset ?? -1)) return right
  return left
}

/**
 * 计划中的父节点采用其子树最深来源，容量在一个容器中首次溢出时即可精确指出
 * 真正导致增长的 fence/table/行内节点，而不是笼统地回落到外层 list 或 quote。
 */
function annotatePlanSources(
  nodes: readonly HnnJsonNode[],
  fallback: { position?: Position | undefined }
): HnnJsonNode[] {
  const source = position(fallback)
  const visit = (node: HnnJsonNode): MarkdownPosition => {
    let deepest = planSource(node) ?? source
    const content = node["content"]
    if (Array.isArray(content))
      for (const child of content as HnnJsonNode[])
        deepest = laterPosition(deepest, visit(child)) ?? deepest
    Object.defineProperty(node, PLAN_SOURCE, {
      value: deepest,
      configurable: true
    })
    return deepest
  }
  for (const node of nodes) visit(node)
  return nodes as HnnJsonNode[]
}

function utf8CodePointBytes(value: number): number {
  if (value <= 0x7f) return 1
  if (value <= 0x7ff) return 2
  if (value <= 0xffff) return 3
  return 4
}

/** 按最终 codeBlock 的 UTF-8 分片边界计数，但不复制任何原始内容。 */
function jsonStringByteLength(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (
      unit === 0x22 ||
      unit === 0x5c ||
      unit === 0x08 ||
      unit === 0x09 ||
      unit === 0x0a ||
      unit === 0x0c ||
      unit === 0x0d
    )
      bytes += 2
    else if (unit < 0x20) bytes += 6
    else if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index += 1
    } else if (unit >= 0xd800 && unit <= 0xdfff) bytes += 6
    else bytes += 3
  }
  return bytes
}

function fallbackChunkStats(
  segments: readonly string[],
  maxBytes = HNN_LIMITS.maxAttrBytes - 128
): {
  chunks: number
  nonEmptyChunks: number
  textJsonBytes: number
  chunkTextJsonBytes: number[]
} {
  let chunks = 0
  let nonEmptyChunks = 0
  let bytes = 0
  let textJsonBytes = 0
  let currentJsonBytes = 2
  const chunkTextJsonBytes: number[] = []
  for (const segment of segments) {
    for (let index = 0; index < segment.length;) {
      const point = segment.codePointAt(index)
      if (point === undefined) break
      const width = point > 0xffff ? 2 : 1
      const characterBytes = utf8CodePointBytes(point)
      if (bytes > 0 && bytes + characterBytes > maxBytes) {
        chunks += 1
        nonEmptyChunks += 1
        textJsonBytes += currentJsonBytes
        chunkTextJsonBytes.push(currentJsonBytes)
        bytes = 0
        currentJsonBytes = 2
      }
      bytes += characterBytes
      currentJsonBytes +=
        jsonStringByteLength(segment.slice(index, index + width)) - 2
      index += width
    }
  }
  if (bytes > 0) chunkTextJsonBytes.push(currentJsonBytes)
  return {
    chunks: chunks + 1,
    nonEmptyChunks: nonEmptyChunks + (bytes > 0 ? 1 : 0),
    textJsonBytes: textJsonBytes + currentJsonBytes,
    chunkTextJsonBytes
  }
}

function materializeFallback(plan: FallbackPlan): HnnJsonNode[] {
  // 将短 segments 一次拼接会额外制造大字符串；按流式 UTF-8 分片直接生成最终 text。
  const chunks: string[] = []
  let current = ""
  let bytes = 0
  for (const segment of plan.segments) {
    for (let index = 0; index < segment.length;) {
      const point = segment.codePointAt(index)
      if (point === undefined) break
      const width = point > 0xffff ? 2 : 1
      const character = segment.slice(index, index + width)
      const characterBytes = utf8CodePointBytes(point)
      if (bytes > 0 && bytes + characterBytes > HNN_LIMITS.maxAttrBytes - 128) {
        chunks.push(current)
        current = ""
        bytes = 0
      }
      current += character
      bytes += characterBytes
      index += width
    }
  }
  chunks.push(current)
  return chunks.map((chunk) =>
    planNode(
      "codeBlock",
      { language: plan.language, filename: "untitled" },
      chunk.length > 0 ? [text(chunk)] : undefined
    )
  )
}

/** 创建惰性 fallback 计划；统一预算通过前绝不拆分或复制其原始文本。 */
function fallbackCode(
  language: string,
  value: string | readonly string[],
  diagnostics?: MarkdownDiagnostic[],
  source?: { position?: Position | undefined }
): HnnJsonNode[] {
  const segments = typeof value === "string" ? [value] : value
  const chunks = fallbackChunkStats(segments).chunks
  if (chunks > 1 && diagnostics && source) {
    importDiagnostic(
      diagnostics,
      source,
      "code-block-split",
      "超长 code fence 已按 HNN 属性上限拆分为多个代码内容块"
    )
  }
  // Symbol 不会进入 JSON；它让计划预算按最终分片精确计数，而实际字符串仅在预算通过后创建。
  const placeholder = planNode("codeBlock", {
    language: language || "plaintext",
    filename: "untitled"
  })
  Object.defineProperty(placeholder, FALLBACK_PLAN, {
    value: {
      language: language || "plaintext",
      segments
    } satisfies FallbackPlan,
    enumerable: true
  })
  return [placeholder]
}

function readableCodeFence(
  language: string,
  meta: string | null | undefined,
  value: string
): string {
  return `\`\`\`${language}${meta ? ` ${meta}` : ""}\n${value}\n\`\`\``
}

function originalFence(
  value: Extract<Content, { type: "code" }>
): readonly string[] {
  // 保持围栏的三个原始片段，预算失败前不为大 payload 拼接第二份完整字符串。
  return [
    "```" + `${value.lang ?? ""}${value.meta ? ` ${value.meta}` : ""}\n`,
    value.value,
    "\n```"
  ]
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function parseMetadata(value: string): {
  metadata?: Record<string, unknown>
  body: string
} {
  const separator = value.indexOf("\n\n")
  const raw = separator === -1 ? value : value.slice(0, separator)
  try {
    const metadata: unknown = JSON.parse(raw)
    return metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? {
          metadata: metadata as Record<string, unknown>,
          body: separator === -1 ? "" : value.slice(separator + 2)
        }
      : { body: value }
  } catch {
    return { body: value }
  }
}

function invalidFence(
  value: Extract<Content, { type: "code" }>,
  diagnostics: MarkdownDiagnostic[],
  message: string
): HnnJsonNode[] {
  importDiagnostic(
    diagnostics,
    value,
    "invalid-hn-fence",
    `${message}，已作为代码保留`
  )
  return fallbackCode("markdown", originalFence(value), diagnostics, value)
}

/** HNN attr 超限仅降级当前围栏，绝不把其误报为整份 Markdown 输入超限。 */
function oversizedFence(
  value: Extract<Content, { type: "code" }>,
  diagnostics: MarkdownDiagnostic[],
  label: string,
  limit: number
): HnnJsonNode[] {
  importDiagnostic(
    diagnostics,
    value,
    "attr-too-large",
    `${label} 超过 ${limit} UTF-8 字节，已作为代码保留`
  )
  return fallbackCode("markdown", originalFence(value), diagnostics, value)
}

function marksFor(value: PhrasingContent): HnnJsonNode[] | undefined {
  if (value.type === "strong") return [{ type: "bold" }]
  if (value.type === "emphasis") return [{ type: "italic" }]
  if (value.type === "delete") return [{ type: "strike" }]
  return undefined
}

/** Markdown AST 的嵌套标记可能重复同一 type；HNN 要求按 schema rank 唯一、有序。 */
function accumulatedMarks(marks: readonly HnnJsonNode[]): HnnJsonNode[] {
  const unique = new Map<string, HnnJsonNode>()
  for (const mark of marks) {
    const type = mark["type"]
    if (typeof type !== "string" || unique.has(type)) continue
    unique.set(type, {
      ...mark,
      ...(mark["attrs"]
        ? { attrs: { ...(mark["attrs"] as Record<string, unknown>) } }
        : {})
    })
  }
  return [...unique.values()].sort(
    (left, right) =>
      (MARK_RANK.get(String(left["type"])) ?? 0) -
      (MARK_RANK.get(String(right["type"])) ?? 0)
  )
}

function inlineNodes(
  values: readonly PhrasingContent[],
  diagnostics: MarkdownDiagnostic[],
  inherited: HnnJsonNode[] = []
): HnnJsonNode[] {
  const output: HnnJsonNode[] = []
  for (const value of values) {
    const outputStart = output.length
    if (value.type === "text")
      output.push(text(value.value, accumulatedMarks(inherited)))
    else if (value.type === "break") output.push(planNode("hardBreak"))
    else if (value.type === "inlineCode") {
      const link = inherited.find((mark) => mark["type"] === "link")
      if (link) {
        // code 不能与 link 共存。不能静默丢弃 URL：保留 code 文本及可读 href。
        importDiagnostic(
          diagnostics,
          value,
          "excluded-mark-fallback",
          "code 与 link mark 不可组合，已保留代码文本与链接 URL"
        )
        output.push(text(value.value, [{ type: "code" }]))
        output.push(
          text(
            ` (${String((link["attrs"] as Record<string, unknown>)["href"])})`,
            accumulatedMarks(
              inherited.filter((mark) => mark["type"] !== "link")
            )
          )
        )
      } else output.push(text(value.value, [{ type: "code" }]))
    } else if (
      value.type === "strong" ||
      value.type === "emphasis" ||
      value.type === "delete"
    )
      output.push(
        ...inlineNodes(
          value.children,
          diagnostics,
          accumulatedMarks([...inherited, ...marksFor(value)!])
        )
      )
    else if (value.type === "link") {
      if (!isSafeHnnUrl(value.url)) {
        importDiagnostic(
          diagnostics,
          value,
          "unsafe-url",
          `危险链接 ${value.url} 未被导入为 link mark`
        )
        output.push(...inlineNodes(value.children, diagnostics, inherited))
        output.push(
          text(
            ` (${value.url}${value.title ? ` ${value.title}` : ""})`,
            inherited
          )
        )
      } else {
        output.push(
          ...inlineNodes(
            value.children,
            diagnostics,
            accumulatedMarks([
              ...inherited,
              { type: "link", attrs: { href: value.url } }
            ])
          )
        )
        if (value.title !== null && value.title !== undefined) {
          importDiagnostic(
            diagnostics,
            value,
            "link-title-fallback",
            "链接 title 无法持久化，已保留可读文本"
          )
          output.push(text(` (${value.title})`, inherited))
        }
      }
    } else if (value.type === "image") {
      importDiagnostic(
        diagnostics,
        value,
        value.title !== null && value.title !== undefined
          ? "image-title-fallback"
          : "inline-image-fallback",
        "混合图片或图片 title 已降级为可读替代文本"
      )
      output.push(
        text(
          `${value.alt || value.url} (${value.url}${value.title ? ` ${value.title}` : ""})`,
          inherited
        )
      )
    } else if (value.type === "linkReference") {
      importDiagnostic(
        diagnostics,
        value,
        "reference-link-fallback",
        "引用式链接无法无损解析，已保留可见文字与 label"
      )
      output.push(...inlineNodes(value.children, diagnostics, inherited))
      output.push(text(` [${value.label || value.identifier}]`, inherited))
    } else if (value.type === "imageReference") {
      importDiagnostic(
        diagnostics,
        value,
        "reference-image-fallback",
        "引用式图片无法无损解析，已保留可读 alt 与 label"
      )
      output.push(
        text(
          `${value.alt || value.label || value.identifier} [${value.label || value.identifier}]`,
          inherited
        )
      )
    } else if (value.type === "html") {
      importDiagnostic(
        diagnostics,
        value,
        "html-fallback",
        "HTML 已按可读文本导入"
      )
      output.push(text(value.value, inherited))
    } else if ("children" in value && Array.isArray(value.children))
      output.push(...inlineNodes(value.children, diagnostics, inherited))
    else {
      importDiagnostic(
        diagnostics,
        value,
        "unsupported-inline",
        `不支持的行内 Markdown ${value.type} 已降级为文本`
      )
      output.push(text(String(value.type), inherited))
    }
    // 一个 mdast inline 可展开为多个 HNN text/mark 事件；它们都带着各自原始位置。
    annotatePlanSources(output.slice(outputStart), value)
  }
  return output
}

function paragraphNode(
  value: Extract<Content, { type: "paragraph" }>,
  diagnostics: MarkdownDiagnostic[]
): HnnJsonNode[] {
  if (value.children.length === 1 && value.children[0]?.type === "image") {
    const image = value.children[0]
    // preflight 对完整独占 image 候选的窄例外必须在这里闭合：无论图片是否还能映射为 picture，
    // 超限 src/alt 都仅降级当前图片，不能让之后的 paragraph text 触发整份文档失败。
    if (!isHnnStringAttrWithinLimits(image.url, HNN_LIMITS.maxAttrBytes)) {
      importDiagnostic(
        diagnostics,
        image,
        "attr-too-large",
        `图片 src 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节，已作为可读 Markdown 保留`
      )
      return fallbackCode("markdown", `![${image.alt}](${image.url})`)
    }
    if (
      typeof image.alt === "string" &&
      !isHnnStringAttrWithinLimits(image.alt, HNN_LIMITS.maxLabelBytes)
    ) {
      importDiagnostic(
        diagnostics,
        image,
        "attr-too-large",
        `图片 alt 超过 ${HNN_LIMITS.maxLabelBytes} UTF-8 字节，已作为可读 Markdown 保留`
      )
      return fallbackCode("markdown", `![${image.alt}](${image.url})`)
    }
    const validPicture =
      (image.title === null || image.title === undefined) &&
      isSafeHnnUrl(image.url) &&
      typeof image.alt === "string" &&
      image.alt.trim().length > 0
    if (validPicture)
      return [planNode("picture", { src: image.url, alt: image.alt })]
    importDiagnostic(
      diagnostics,
      image,
      image.title !== null && image.title !== undefined
        ? "image-title-fallback"
        : "picture-fallback",
      "不安全、含 title 或缺少 alt 的图片已保留为可读文本"
    )
    return [
      paragraph([
        text(
          `${image.alt || image.url} (${image.url}${image.title ? ` ${image.title}` : ""})`
        )
      ])
    ]
  }
  return [paragraph(inlineNodes(value.children, diagnostics))]
}

type SequenceConverter = (
  nodes: readonly Content[],
  account?: boolean
) => HnnJsonNode[]

function listItem(
  value: ListItem,
  diagnostics: MarkdownDiagnostic[],
  unterminated: Set<number>,
  budget: MarkdownBudget,
  convert: SequenceConverter
): HnnJsonNode {
  const content = convert(value.children, false)
  const childContent =
    content.length > 0 && content[0]?.["type"] === "paragraph"
      ? content
      : [paragraph([]), ...content]
  return annotatePlanSources(
    [
      planNode(
        typeof value.checked === "boolean" ? "taskItem" : "listItem",
        typeof value.checked === "boolean" ? { checked: value.checked } : {},
        childContent
      )
    ],
    value
  )[0]!
}

function listNodes(
  value: Extract<Content, { type: "list" }>,
  diagnostics: MarkdownDiagnostic[],
  unterminated: Set<number>,
  budget: MarkdownBudget,
  convert: SequenceConverter
): HnnJsonNode[] {
  const result: HnnJsonNode[] = []
  let group: ListItem[] = []
  let task: boolean | undefined
  const flush = () => {
    if (group.length === 0 || task === undefined) return
    const type = task
      ? "taskList"
      : value.ordered
        ? "orderedList"
        : "bulletList"
    const attrs = task
      ? {}
      : value.ordered
        ? { start: value.start ?? 1, type: null }
        : {}
    result.push(
      planNode(
        type,
        attrs,
        group.map((item) =>
          listItem(
            task ? item : { ...item, checked: undefined },
            diagnostics,
            unterminated,
            budget,
            convert
          )
        )
      )
    )
    group = []
  }
  for (const item of value.children) {
    const isTask = typeof item.checked === "boolean"
    if (task !== undefined && task !== isTask) flush()
    task = isTask
    group.push(item)
  }
  flush()
  return annotatePlanSources(result, value)
}

function tableCell(
  value: TableCell,
  header: boolean,
  diagnostics: MarkdownDiagnostic[],
  align: string | null
): HnnJsonNode {
  return annotatePlanSources(
    [
      planNode(
        header ? "tableHeader" : "tableCell",
        { colspan: 1, rowspan: 1, colwidth: null, align },
        [paragraph(inlineNodes(value.children, diagnostics))]
      )
    ],
    value
  )[0]!
}

/**
 * mdast table 在创建任何 HNN nodeId 前先限制几何。行内 markdown 的实际展开受统一
 * PlanLedger 逐事件精确结算；这里不能以保守估算提前拒绝，否则会丢失真正跨限 link
 * 的位置，也会与文本归一化后的最终节点数不一致。
 */
function preflightTable(value: Extract<Content, { type: "table" }>): void {
  const rows = value.children.length
  const columns = value.children[0]?.children.length ?? 0
  const grid = rows * columns
  for (const row of value.children) {
    if (row.children.length !== columns) {
      throw new InputTooLargeError({
        code: "input-too-large",
        message: "Markdown 表格各行列数必须一致",
        ...position(value)
      })
    }
  }
  if (
    rows > HNN_TABLE_LIMITS.maxRows ||
    columns > HNN_TABLE_LIMITS.maxColumns ||
    grid > HNN_TABLE_LIMITS.maxGridCells
  ) {
    throw new InputTooLargeError({
      code: "input-too-large",
      message: "Markdown 表格超过 HNN 行、列、网格或节点安全预算",
      ...position(value)
    })
  }
}

type MarkdownPreflight =
  | { unterminatedFenceLines: Set<number>; budget: MarkdownBudget }
  | { failure: "input-too-large"; diagnostic: MarkdownDiagnostic }
type MarkdownBudget = {
  lines: number
  blocks: number
  lexicalWork: number
  candidates: number
  astNodes: number
}
type NestedFencePlan = {
  baseBudget: MarkdownBudget
  budget: MarkdownBudget
  // 诊断对象由围栏正文的这次转换独占；回滚时按对象删除，不能误删随后 sibling 的诊断。
  diagnostics: MarkdownDiagnostic[]
  fence: Extract<Content, { type: "code" }>
  message: string
}
type MarkdownContainerPrefix =
  | { type: "quote"; token: string }
  | { type: "list"; continuationIndent: number }
type MarkdownContainer = { body: string; prefixes: MarkdownContainerPrefix[] }
type ActiveFence = {
  marker: string
  line: number
  hnn: boolean
  prefixes: MarkdownContainerPrefix[]
}

/** CommonMark 的 tab 在容器前缀中按 4 列 tab stop 消费，而不是按一个字符消费。 */
function leadingVisualIndent(value: string): { columns: number; end: number } {
  let columns = 0
  let end = 0
  while (end < value.length) {
    const character = value[end]
    if (character === " ") columns += 1
    else if (character === "\t") columns += 4 - (columns % 4)
    else break
    end += 1
  }
  return { columns, end }
}

/**
 * 预检仅需识别容器与 fence，不会把扫描结果回写 Markdown。先将整行 tab 按原始行
 * 的绝对 visual column 展开，后续任意 body slice 都不会错误地把 tab stop 重置为 0。
 */
function expandTabsForFenceScan(value: string): string {
  let columns = 0
  let expanded = ""
  for (const character of value) {
    if (character === "\t") {
      const spaces = 4 - (columns % 4)
      expanded += " ".repeat(spaces)
      columns += spaces
    } else {
      expanded += character
      columns += 1
    }
  }
  return expanded
}

function consumeVisualIndent(value: string, columnsToConsume: number): number {
  let columns = 0
  let end = 0
  while (end < value.length && columns < columnsToConsume) {
    const character = value[end]
    if (character === " ") columns += 1
    else if (character === "\t") columns += 4 - (columns % 4)
    else break
    end += 1
  }
  return end
}

function quotePrefix(value: string): string | undefined {
  const indent = leadingVisualIndent(value)
  if (indent.columns > 3 || value[indent.end] !== ">") return undefined
  let end = indent.end + 1
  if (value[end] === " ") end += 1
  // `>\t- item` 中 tab 从 quote marker 后的 visual column 推进；对后续 list/fence
  // 识别它等价于 quote 的可选间距，不能把 `-` 误留在 root 空白之后。
  else if (value[end] === "\t") end += 1
  return value.slice(0, end)
}

function listPrefix(
  value: string
): { token: string; continuationIndent: number; end: number } | undefined {
  const indent = leadingVisualIndent(value)
  if (indent.columns > 3) return undefined
  const match = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+)/u.exec(
    value.slice(indent.end)
  )
  if (!match) return undefined
  const token = match[0]
  // marker 后的 tab 从 marker 实际结束列推进到下一个 4 列 stop。
  let columns = indent.columns
  for (const character of token)
    columns += character === "\t" ? 4 - (columns % 4) : 1
  return { token, continuationIndent: columns, end: indent.end + token.length }
}

/**
 * list continuation 的缩进只在上一行已建立相应容器时才有语义。扫描器保留该上下文，
 * 使多层 list 内仅写 continuation indent 的 quote/fence 不会被误认成 root 文本。
 */
function containerIdentity(
  line: string,
  continuationPrefixes: readonly MarkdownContainerPrefix[] = []
): MarkdownContainer {
  let body = line
  const prefixes: MarkdownContainerPrefix[] = []
  for (const prefix of continuationPrefixes) {
    if (prefix.type === "quote") {
      const quote = quotePrefix(body)
      if (!quote) {
        // 内层 quote/list 结束时保留已经匹配的外层前缀；后续 token 仍须在该外层
        // 容器中解释，不能把整行错误退回 root。
        break
      }
      prefixes.push(prefix)
      body = body.slice(quote.length)
      continue
    }
    const indent = leadingVisualIndent(body)
    if (body.trim().length > 0 && indent.columns < prefix.continuationIndent) {
      // 仅退出当前不匹配的内层 list，保留最长已匹配外层前缀。
      break
    }
    prefixes.push(prefix)
    body = body.slice(consumeVisualIndent(body, prefix.continuationIndent))
  }
  while (true) {
    const quote = quotePrefix(body)
    if (quote) {
      // quote 的空格是可选语法，prefix 只保留实际的 `>` token；顺序仍由 prefixes
      // 保证，因而 list -> quote 与 quote -> list 不会混淆。
      prefixes.push({ type: "quote", token: ">" })
      body = body.slice(quote.length)
      continue
    }
    const list = listPrefix(body)
    if (list) {
      // CommonMark list continuation 必须越过完整 marker（含多位 ordered 编号）的内容缩进。
      prefixes.push({
        type: "list",
        continuationIndent: list.continuationIndent
      })
      body = body.slice(list.end)
      continue
    }
    break
  }
  return { body, prefixes }
}

type ActiveFenceBody = {
  body: string
  prefixes: MarkdownContainerPrefix[]
  complete: boolean
}

/**
 * 返回 active fence 在当前行按顺序匹配到的最长容器前缀。内层容器结束并不意味着
 * 外层也结束：调用方据此诊断旧 fence，再以该外层上下文重新解释同一行。
 */
function activeFenceBody(line: string, active: ActiveFence): ActiveFenceBody {
  let body = line
  const prefixes: MarkdownContainerPrefix[] = []
  for (const prefix of active.prefixes) {
    if (prefix.type === "quote") {
      // quote token 不能跨越 list/quote 顺序被重新解释；这会阻止 list -> quote 等
      // 混合容器中的 closing 错误关闭原 fence。
      const quote = quotePrefix(body)
      if (!quote || !quote.includes(prefix.token))
        return { body, prefixes, complete: false }
      body = body.slice(quote.length)
      prefixes.push(prefix)
      continue
    }
    const indent = leadingVisualIndent(body)
    // 空行在 list fence 中仍属于其正文；非空行必须保留该层实际 continuation indent。
    if (body.trim().length > 0 && indent.columns < prefix.continuationIndent)
      return { body, prefixes, complete: false }
    body = body.slice(consumeVisualIndent(body, prefix.continuationIndent))
    prefixes.push(prefix)
  }
  return { body, prefixes, complete: true }
}

/** 显式 link/image 与 bare autolink 都会放大成多个 mdast/HNN 节点，预先共享预算。 */
function countMarkdownCandidates(value: string): number {
  const explicit = /!?\[[^\]\n]*\]\([^\n)]*\)/gu
  const autolink = /<(?:https?|mailto):[^\s<>]+>/giu
  const bareAutolink = /(?:https?|mailto):[^\s<>]+/giu
  let count = 0
  for (const pattern of [explicit, autolink, bareAutolink]) {
    pattern.lastIndex = 0
    while (pattern.exec(value)) count += 1
  }
  return count
}

/**
 * 单行预算通常会在 Markdown parser 前拒绝输入。此处只为完整的独占 image 候选留出窄例外，
 * 使图片 src 的 attr 校验可以局部可读降级；普通超长行仍在 preflight 中拒绝。
 */
function isExclusiveGfmImageCandidate(value: string): boolean {
  return EXCLUSIVE_GFM_IMAGE_CANDIDATE.test(value)
}

/** 在 parse 前单遍扫描：限制工作、候选节点与容器，并以实际 continuation indent 匹配 closing。 */
function preflightMarkdown(
  markdown: string,
  budget: MarkdownBudget = {
    lines: 0,
    blocks: 0,
    lexicalWork: 0,
    candidates: 0,
    astNodes: 0
  }
): MarkdownPreflight {
  const unterminatedFenceLines = new Set<number>()
  let active: ActiveFence | undefined
  let continuationPrefixes: MarkdownContainerPrefix[] = []
  let lineNumber = 0
  let lineStart = 0
  let previousBlank = true
  for (let cursor = 0; cursor <= markdown.length; cursor += 1) {
    if (cursor !== markdown.length && markdown.charCodeAt(cursor) !== 10)
      continue
    const rawLine = expandTabsForFenceScan(
      markdown.slice(lineStart, cursor).replace(/\r$/u, "")
    )
    lineStart = cursor + 1
    lineNumber += 1
    budget.lines += 1
    if (budget.lines > MAX_MARKDOWN_LINES)
      return {
        failure: "input-too-large",
        diagnostic: {
          code: "input-too-large",
          message: `Markdown 行数超过 ${MAX_MARKDOWN_LINES}`
        }
      }
    // 只有确认已经退出 active 容器，才把当前行重新作为新的 list item/root 解释。
    let justClosedFence = false
    while (active) {
      const activeBody = activeFenceBody(rawLine, active)
      if (!activeBody.complete) {
        if (active.hnn) unterminatedFenceLines.add(active.line)
        active = undefined
        continuationPrefixes = activeBody.prefixes
        continue
      }
      const closing = new RegExp(
        `^ {0,3}${active.marker[0] === "`" ? "`" : "~"}{${active.marker.length},}\\s*$`,
        "u"
      )
      if (closing.test(activeBody.body)) {
        continuationPrefixes = active.prefixes
        active = undefined
        justClosedFence = true
      }
      break
    }
    if (active || justClosedFence) continue
    // 任何普通可持久化 text 最终都受同一 attr 上限约束；围栏正文由 customFence
    // 逐 attr 检查并可局部可读降级，因此不能在这里把整份输入提前硬拒绝。
    if (
      utf8Bytes(rawLine) > HNN_LIMITS.maxAttrBytes &&
      !isExclusiveGfmImageCandidate(rawLine)
    )
      return {
        failure: "input-too-large",
        diagnostic: {
          code: "input-too-large",
          message: `Markdown 单行超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`,
          line: lineNumber
        }
      }
    const container = containerIdentity(rawLine, continuationPrefixes)
    if (container.prefixes.length > MAX_MARKDOWN_DEPTH)
      return {
        failure: "input-too-large",
        diagnostic: {
          code: "input-too-large",
          message: `Markdown 容器深度超过 ${MAX_MARKDOWN_DEPTH}`,
          line: lineNumber
        }
      }
    // CommonMark 允许没有 info string 的 fenced code；该正文同样必须绕过普通文本词法扫描。
    const opening = /^ {0,3}(`{3,}|~{3,})\s*(?:([^\s`~]+)(?:\s.*)?)?$/u.exec(
      container.body
    )
    if (opening) {
      const language = opening[2] ?? ""
      active = {
        marker: opening[1]!,
        line: lineNumber,
        prefixes: container.prefixes,
        hnn:
          HN_FENCE_LANGUAGES.has(language) ||
          language.startsWith("hamster-note-")
      }
      budget.blocks += 1
    } else {
      for (let index = 0; index < container.body.length; index += 1) {
        const unit = container.body[index]
        if (
          unit === "|" ||
          unit === "[" ||
          unit === "!" ||
          unit === "*" ||
          unit === "_" ||
          unit === "~" ||
          unit === "`"
        )
          budget.lexicalWork += 1
      }
      budget.lexicalWork += container.prefixes.length
      budget.candidates += countMarkdownCandidates(container.body)
      if (container.body.trim().length > 0 && previousBlank) budget.blocks += 1
    }
    if (budget.lexicalWork > MAX_LEXICAL_WORK)
      return {
        failure: "input-too-large",
        diagnostic: {
          code: "input-too-large",
          message: `Markdown 词法工作超过 ${MAX_LEXICAL_WORK}`,
          line: lineNumber
        }
      }
    if (budget.candidates > MAX_MARKDOWN_CANDIDATES)
      return {
        failure: "input-too-large",
        diagnostic: {
          code: "input-too-large",
          message: `Markdown link/image/autolink 候选超过 ${MAX_MARKDOWN_CANDIDATES}`,
          line: lineNumber
        }
      }
    if (budget.blocks > MAX_MARKDOWN_BLOCKS)
      return {
        failure: "input-too-large",
        diagnostic: {
          code: "input-too-large",
          message: `Markdown 潜在内容块超过 ${MAX_MARKDOWN_BLOCKS}`,
          line: lineNumber
        }
      }
    previousBlank = container.body.trim().length === 0
    // 空行可存在于 list item 内；保留上一个有效容器，使其后的 continuation 能继续
    // 正确归属。root 非空行则明确清空遗留的 list 上下文。
    if (container.prefixes.length > 0) continuationPrefixes = container.prefixes
    else if (container.body.trim().length > 0) continuationPrefixes = []
  }
  if (active?.hnn) unterminatedFenceLines.add(active.line)
  return { unterminatedFenceLines, budget }
}

/** 已通过预算的转换计划在此处才物化为严格 HNN，并为每个非 text/doc 节点分配 UUID。 */
function materializePlan(value: HnnJsonNode): HnnJsonNode {
  const copy: HnnJsonNode = { ...value }
  const stack: Array<{
    source: HnnJsonNode
    target: HnnJsonNode
    replaceIds: boolean
  }> = [
    {
      source: value,
      target: copy,
      replaceIds: Boolean(
        Object.getOwnPropertyDescriptor(value, JSON_FENCE_PLAN)
      )
    }
  ]
  while (stack.length > 0) {
    const frame = stack.pop()
    if (!frame) break
    if (frame.source["type"] !== "doc" && frame.source["type"] !== "text") {
      const sourceAttrs = {
        ...(frame.source["attrs"] as Record<string, unknown>)
      }
      if (frame.replaceIds) delete sourceAttrs["nodeId"]
      frame.target["attrs"] = { nodeId: createHnnNodeId(), ...sourceAttrs }
    }
    const sourceContent = frame.source["content"] as HnnJsonNode[] | undefined
    if (!Array.isArray(sourceContent)) continue
    const targetContent = sourceContent.map((child) => ({
      ...child
    })) as HnnJsonNode[]
    frame.target["content"] = targetContent
    for (let index = targetContent.length - 1; index >= 0; index -= 1)
      stack.push({
        source: sourceContent[index] as HnnJsonNode,
        target: targetContent[index]!,
        replaceIds:
          frame.replaceIds ||
          Boolean(
            Object.getOwnPropertyDescriptor(
              sourceContent[index] as HnnJsonNode,
              JSON_FENCE_PLAN
            )
          )
      })
  }
  return copy
}

function base64urlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

function base64urlDecode(value: string): string | undefined {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return undefined
  try {
    const padded =
      value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (value.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    )
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function jsonChunks(value: string): string[] {
  const encoded = base64urlEncode(value)
  const chunks: string[] = []
  for (let start = 0; start < encoded.length; start += BASE64URL_CHUNK_CHARS)
    chunks.push(encoded.slice(start, start + BASE64URL_CHUNK_CHARS))
  return chunks.length > 0 ? chunks : [""]
}

function isBudgetCodecError(error: unknown): boolean {
  return (
    error instanceof HnnCodecError &&
    error.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "shell-too-large" ||
        diagnostic.code === "node-limit" ||
        diagnostic.code === "depth-limit" ||
        diagnostic.code === "attr-too-large" ||
        diagnostic.code === "snapshot-work-limit" ||
        diagnostic.code === "snapshot-depth-limit"
    )
  )
}

type JsonFenceGroup = {
  first: Extract<Content, { type: "code" }>
  members: Extract<Content, { type: "code" }>[]
  next: number
}

/**
 * 分片必须先整体确认连续的 code fence 结构，再读取 payload 或推进消费位置。这样插入
 * 在分片之间的普通 Markdown 不会被误当成 code，也不会被静默吞掉。
 */
function jsonFenceGroupAt(
  nodes: readonly Content[],
  index: number
): JsonFenceGroup | undefined {
  const first = nodes[index]
  if (!first || first.type !== "code" || first.lang !== "hamster-note-json-b64")
    return undefined
  const match = /^(\d+)\/(\d+)$/u.exec(first.meta ?? "")
  if (!match) return undefined
  const total = Number(match[2])
  // 合法导出通常只会有约 89 段；这里允许到 AST 节点预算，是为了把“段数非规范”
  // 的完整组也作为一个整体保留，而不是在尚未验证结构时逐段吞掉相邻内容。
  if (!Number.isSafeInteger(total) || total < 1 || total > MAX_CONVERSION_NODES)
    return undefined
  const members: Extract<Content, { type: "code" }>[] = []
  for (let offset = 0; offset < total; offset += 1) {
    const current = nodes[index + offset]
    const expected = `${offset + 1}/${total}`
    if (
      !current ||
      current.type !== "code" ||
      current.lang !== "hamster-note-json-b64" ||
      current.meta !== expected
    ) {
      return undefined
    }
    members.push(current)
  }
  return { first, members, next: index + total }
}

function jsonFenceFallbackSegments(group: JsonFenceGroup): string[] {
  const segments: string[] = []
  for (let index = 0; index < group.members.length; index += 1) {
    if (index > 0) segments.push("\n\n")
    const member = group.members[index]!
    segments.push(
      "```" + `${member.lang ?? ""}${member.meta ? ` ${member.meta}` : ""}\n`,
      member.value,
      "\n```"
    )
  }
  return segments
}

type PendingJsonFenceFallback = {
  pending: true
  group: JsonFenceGroup
  message: string
  next: number
}
type JsonFenceParseResult =
  { nodes: HnnJsonNode[]; next: number } | PendingJsonFenceFallback

function fallbackPlanOf(value: HnnJsonNode): FallbackPlan | undefined {
  return Object.getOwnPropertyDescriptor(value, FALLBACK_PLAN)?.value as
    FallbackPlan | undefined
}

const PLAN_UUID = "00000000-0000-4000-8000-000000000000"

function jsonFieldByteLength(key: string, valueBytes: number): number {
  return jsonStringByteLength(key) + 1 + valueBytes
}

function jsonObjectByteLength(fields: readonly number[]): number {
  return (
    2 +
    fields.reduce((total, field) => total + field, 0) +
    Math.max(0, fields.length - 1)
  )
}

function jsonArrayByteLength(values: readonly number[]): number {
  return (
    2 +
    values.reduce((total, value) => total + value, 0) +
    Math.max(0, values.length - 1)
  )
}

/** 对已解析的纯 JSON 精确计数，不经 JSON.stringify 生成临时 shell。 */
function jsonValueByteLength(
  value: unknown,
  limit = HNN_LIMITS.maxShellBytes
): number | undefined {
  const sizes: number[] = []
  const operations: Array<
    { value: unknown } | { array: number } | { object: string[] }
  > = [{ value }]
  while (operations.length > 0) {
    const operation = operations.pop()
    if (!operation) break
    if ("value" in operation) {
      const current = operation.value
      if (current === null) sizes.push(4)
      else if (typeof current === "boolean") sizes.push(current ? 4 : 5)
      else if (typeof current === "number" && Number.isFinite(current))
        sizes.push(String(current).length)
      else if (typeof current === "string")
        sizes.push(jsonStringByteLength(current))
      else if (Array.isArray(current)) {
        operations.push({ array: current.length })
        for (let index = current.length - 1; index >= 0; index -= 1)
          operations.push({ value: current[index] })
      } else if (current && typeof current === "object") {
        const record = current as Record<string, unknown>
        const keys = Object.keys(record)
        operations.push({ object: keys })
        for (let index = keys.length - 1; index >= 0; index -= 1)
          operations.push({ value: record[keys[index]!] })
      } else return undefined
      continue
    }
    if ("array" in operation) {
      const items = sizes.splice(
        sizes.length - operation.array,
        operation.array
      )
      const size = jsonArrayByteLength(items)
      if (size > limit) return undefined
      sizes.push(size)
      continue
    }
    const items = sizes.splice(
      sizes.length - operation.object.length,
      operation.object.length
    )
    const fields = operation.object.map((key, index) =>
      jsonFieldByteLength(key, items[index]!)
    )
    const size = jsonObjectByteLength(fields)
    if (size > limit) return undefined
    sizes.push(size)
  }
  return sizes.length === 1 && sizes[0]! <= limit ? sizes[0] : undefined
}

type PlanStats = { bytes: number; nodes: number; depth: number }

function planAttrsByteLength(
  value: Record<string, unknown> | undefined,
  replaceNodeId: boolean
): number | undefined {
  const attrs = value ?? {}
  const fields: number[] = []
  let hasNodeId = false
  for (const key of Object.keys(attrs)) {
    hasNodeId ||= key === "nodeId"
    const item = key === "nodeId" && replaceNodeId ? PLAN_UUID : attrs[key]
    const itemBytes = jsonValueByteLength(item)
    if (itemBytes === undefined) return undefined
    fields.push(jsonFieldByteLength(key, itemBytes))
  }
  if (!hasNodeId && replaceNodeId)
    fields.push(jsonFieldByteLength("nodeId", jsonStringByteLength(PLAN_UUID)))
  return jsonObjectByteLength(fields)
}

/**
 * 仅按最终 canonical JSON 的字段大小结算计划。这里既不创建 synthetic node，也不把
 * 任意计划树 JSON.stringify；fallback 仍停留在 segments，直到账本确认可持久化。
 */
function planNodeStats(value: HnnJsonNode): PlanStats | undefined {
  const fallback = fallbackPlanOf(value)
  if (fallback) {
    const split = fallbackChunkStats(fallback.segments)
    const attrsBytes = planAttrsByteLength(
      { language: fallback.language, filename: "untitled" },
      true
    )
    if (attrsBytes === undefined) return undefined
    const codeBase = [
      jsonFieldByteLength("type", jsonStringByteLength("codeBlock")),
      jsonFieldByteLength("attrs", attrsBytes)
    ]
    const emptyBytes = jsonObjectByteLength(codeBase)
    let bytes = 0
    for (let index = 0; index < split.chunks; index += 1) {
      const textJsonBytes = split.chunkTextJsonBytes[index]
      const codeBytes =
        textJsonBytes === undefined
          ? emptyBytes
          : jsonObjectByteLength([
              ...codeBase,
              jsonFieldByteLength(
                "content",
                jsonArrayByteLength([
                  jsonObjectByteLength([
                    jsonFieldByteLength("type", jsonStringByteLength("text")),
                    jsonFieldByteLength("text", textJsonBytes)
                  ])
                ])
              )
            ])
      bytes += (index > 0 ? 1 : 0) + codeBytes
    }
    // 每个非空 fallback chunk 最终是 codeBlock -> text；空 chunk 则仅为 codeBlock。
    return {
      bytes,
      nodes: split.chunks + split.nonEmptyChunks,
      depth: split.nonEmptyChunks > 0 ? 2 : 1
    }
  }
  const type = value["type"]
  if (typeof type !== "string") return undefined
  const fields = [jsonFieldByteLength("type", jsonStringByteLength(type))]
  let nodes = 1
  let depth = 1
  if (type === "text") {
    const textValue = value["text"]
    if (typeof textValue !== "string") return undefined
    fields.push(jsonFieldByteLength("text", jsonStringByteLength(textValue)))
  } else if (type !== "doc") {
    // 无 ID 的普通计划与保留旧 ID 的 JSON-b64 payload 都以等长的计划 UUID 计费。
    const attrsBytes = planAttrsByteLength(
      value["attrs"] as Record<string, unknown> | undefined,
      true
    )
    if (attrsBytes === undefined) return undefined
    fields.push(jsonFieldByteLength("attrs", attrsBytes))
  }
  const marks = value["marks"]
  if (marks !== undefined) {
    const markBytes = jsonValueByteLength(marks)
    if (markBytes === undefined) return undefined
    fields.push(jsonFieldByteLength("marks", markBytes))
  }
  const content = value["content"]
  if (Array.isArray(content)) {
    const children: number[] = []
    for (const child of content) {
      const childStats = planNodeStats(child as HnnJsonNode)
      if (!childStats) return undefined
      children.push(childStats.bytes)
      nodes += childStats.nodes
      depth = Math.max(depth, childStats.depth + 1)
    }
    fields.push(jsonFieldByteLength("content", jsonArrayByteLength(children)))
  }
  return { bytes: jsonObjectByteLength(fields), nodes, depth }
}

/** 账本前的轻量严格校验，覆盖普通 Markdown 与 JSON-b64 的共同持久化约束。 */
function validatePlannedNodes(nodes: readonly HnnJsonNode[]): void {
  const stack: Array<{
    node: HnnJsonNode
    parent?: string
    index: number
    depth: number
  }> = nodes.map((node, index) => ({ node, index, depth: 2 })).reverse()
  let count = 1 // doc
  while (stack.length > 0) {
    const frame = stack.pop()!
    const type = frame.node["type"]
    const source = planSource(frame.node)
    const fail = (message: string): never => {
      const error = new InputTooLargeError({
        code: "input-too-large",
        message,
        ...source
      }) as InputTooLargeError & { planNode?: HnnJsonNode }
      // 让父 ledger transaction 能回滚拥有真实失败节点的 nested fence。
      error.planNode = frame.node
      throw error
    }
    const fallback = fallbackPlanOf(frame.node)
    if (fallback) {
      // placeholder 会在 UUID 分配前展开为多个 codeBlock/text。必须按最终节点数及
      // 实际 text 子层深度验证，不能等 materialize 后再让 PM codec 发现超限。
      const split = fallbackChunkStats(fallback.segments)
      count += split.chunks + split.nonEmptyChunks
      if (count > HNN_LIMITS.maxNodes)
        fail(`Markdown 转换计划节点超过 ${HNN_LIMITS.maxNodes}`)
      if (split.nonEmptyChunks > 0 && frame.depth + 1 > HNN_LIMITS.maxDepth)
        fail(`Markdown 转换计划深度超过 ${HNN_LIMITS.maxDepth}`)
      continue
    }
    count += 1
    if (count > HNN_LIMITS.maxNodes)
      fail(`Markdown 转换计划节点超过 ${HNN_LIMITS.maxNodes}`)
    if (frame.depth > HNN_LIMITS.maxDepth)
      fail(`Markdown 转换计划深度超过 ${HNN_LIMITS.maxDepth}`)
    if (typeof type !== "string" || !HNN_NODE_TYPES.has(type))
      fail("Markdown 转换计划包含未知 HNN 节点")
    const nodeType = type as string
    if (
      frame.parent &&
      !jsonFenceChildAllowed(frame.parent, nodeType, frame.index)
    )
      fail("Markdown 转换计划包含不允许的 HNN 嵌套")
    if (nodeType === "text") {
      const value = frame.node["text"]
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        !isHnnStringAttrWithinLimits(value, HNN_LIMITS.maxAttrBytes)
      )
        fail(`Markdown text 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节或不合法`)
      const marks = frame.node["marks"]
      if (marks !== undefined) {
        if (!Array.isArray(marks)) fail("Markdown text marks 不合法")
        const seen = new Set<string>()
        let rank = -1
        for (const mark of marks as HnnJsonNode[]) {
          const markType = mark["type"]
          const markRank = MARK_RANK.get(String(markType)) ?? -1
          if (
            typeof markType !== "string" ||
            !HNN_MARK_TYPES.has(markType) ||
            seen.has(markType) ||
            markRank <= rank
          )
            fail("Markdown text marks 不合法")
          seen.add(markType as string)
          rank = markRank
          if (jsonValueByteLength(mark, HNN_LIMITS.maxAttrBytes) === undefined)
            fail("Markdown mark attr 超过 HNN 上限")
          if (markType === "link") {
            const href = (
              mark["attrs"] as Record<string, unknown> | undefined
            )?.["href"]
            if (
              typeof href !== "string" ||
              !isSafeHnnUrl(href) ||
              !isHnnStringAttrWithinLimits(href, HNN_LIMITS.maxAttrBytes)
            )
              fail("Markdown link URL 不合法或过大")
          }
        }
        if (seen.has("code") && seen.size !== 1)
          fail("Markdown code mark 不可组合")
      }
      continue
    }
    const attrs = frame.node["attrs"]
    if (nodeType !== "doc") {
      if (!attrs || typeof attrs !== "object" || Array.isArray(attrs))
        fail("Markdown HNN attrs 不合法")
      for (const value of Object.values(attrs as Record<string, unknown>)) {
        if (jsonValueByteLength(value, HNN_LIMITS.maxAttrBytes) === undefined)
          fail("Markdown attr 超过 HNN 上限")
      }
    }
    const content = frame.node["content"]
    if (PLAN_ATOM_TYPES.has(nodeType)) {
      if (content !== undefined) fail("Markdown 原子节点不可包含 content")
      continue
    }
    if (content === undefined && PLAN_EMPTY_CONTENT_TYPES.has(nodeType))
      continue
    if (!Array.isArray(content) || content.length === 0)
      fail("Markdown 节点 content 不合法")
    const childNodes = content as HnnJsonNode[]
    for (let index = childNodes.length - 1; index >= 0; index -= 1)
      stack.push({
        node: childNodes[index]!,
        parent: nodeType,
        index,
        depth: frame.depth + 1
      })
  }
}

/** 逐源节点的全局账本，只保存已通过预算的实际计划节点。 */
class PlanLedger {
  readonly content: HnnJsonNode[] = []
  private contentBytes = 0
  private nodeCount = 1 // doc

  get bytes(): number {
    const dataBytes = jsonObjectByteLength([
      jsonFieldByteLength("type", jsonStringByteLength("doc")),
      jsonFieldByteLength("content", 2 + this.contentBytes)
    ])
    return jsonObjectByteLength([
      jsonFieldByteLength("schemaVersion", 1),
      jsonFieldByteLength("data", dataBytes)
    ])
  }

  get nodes(): number {
    return this.nodeCount
  }

  snapshot(): {
    contentLength: number
    contentBytes: number
    nodeCount: number
  } {
    return {
      contentLength: this.content.length,
      contentBytes: this.contentBytes,
      nodeCount: this.nodeCount
    }
  }

  restore(snapshot: {
    contentLength: number
    contentBytes: number
    nodeCount: number
  }): void {
    this.content.length = snapshot.contentLength
    this.contentBytes = snapshot.contentBytes
    this.nodeCount = snapshot.nodeCount
  }

  private projected(
    nodes: readonly HnnJsonNode[]
  ): { bytes: number; nodes: number } | undefined {
    let bytes = 0
    let nodeCount = 0
    for (const node of nodes) {
      const stats = planNodeStats(node)
      if (!stats) return undefined
      bytes += (bytes > 0 ? 1 : 0) + stats.bytes
      nodeCount += stats.nodes
    }
    const contentBytes =
      this.contentBytes + (this.contentBytes > 0 && bytes > 0 ? 1 : 0) + bytes
    const projectedNodes = this.nodeCount + nodeCount
    const projectedData = jsonObjectByteLength([
      jsonFieldByteLength("type", jsonStringByteLength("doc")),
      jsonFieldByteLength("content", 2 + contentBytes)
    ])
    return {
      nodes: projectedNodes,
      bytes: jsonObjectByteLength([
        jsonFieldByteLength("schemaVersion", 1),
        jsonFieldByteLength("data", projectedData)
      ])
    }
  }

  add(nodes: readonly HnnJsonNode[]):
    | {
        bytes: number
        nodes: number
        source?: MarkdownPosition
        node?: HnnJsonNode
      }
    | undefined {
    validatePlannedNodes(nodes)
    const projected = this.projected(nodes)
    if (!projected) return undefined
    if (
      projected.bytes > HNN_LIMITS.maxShellBytes ||
      projected.nodes > MAX_CONVERSION_NODES
    ) {
      // 用 preorder 的每个实际计划节点重放一遍本次 source。partial tree 始终保留父
      // 容器及已经出现的 sibling，因此 bytes/nodes 与最终 JSON 完全同口径；首个跨限
      // 事件不再错误归因到 table/blockquote 的根节点。
      const events: HnnJsonNode[] = []
      const collect = (value: HnnJsonNode): void => {
        events.push(value)
        if (fallbackPlanOf(value)) return
        const content = value["content"]
        if (Array.isArray(content))
          for (const child of content as HnnJsonNode[]) collect(child)
      }
      for (const node of nodes) collect(node)
      const partial = (limit: number): HnnJsonNode[] => {
        let seen = 0
        const copy = (value: HnnJsonNode): HnnJsonNode | undefined => {
          if (seen >= limit) return undefined
          seen += 1
          const result: HnnJsonNode = { ...value }
          const content = value["content"]
          if (!fallbackPlanOf(value) && Array.isArray(content)) {
            const children: HnnJsonNode[] = []
            for (const child of content as HnnJsonNode[]) {
              const childCopy = copy(child)
              if (!childCopy) break
              children.push(childCopy)
            }
            if (children.length > 0) result["content"] = children
            else delete result["content"]
          }
          return result
        }
        const result: HnnJsonNode[] = []
        for (const node of nodes) {
          const nodeCopy = copy(node)
          if (!nodeCopy) break
          result.push(nodeCopy)
        }
        return result
      }
      for (let index = 1; index <= events.length; index += 1) {
        const eventProjected = this.projected(partial(index))
        if (
          eventProjected &&
          (eventProjected.bytes > HNN_LIMITS.maxShellBytes ||
            eventProjected.nodes > MAX_CONVERSION_NODES)
        ) {
          const source = planSource(events[index - 1]!)
          return source
            ? { ...eventProjected, source, node: events[index - 1]! }
            : { ...eventProjected, node: events[index - 1]! }
        }
      }
      const node = events.at(-1)
      const source = node && planSource(node)
      return node
        ? source
          ? { ...projected, source, node }
          : { ...projected, node }
        : projected
    }
    const statsBytes = projected.bytes
    let addedContentBytes = 0
    let addedNodes = 0
    for (const node of nodes) {
      const stats = planNodeStats(node)!
      addedContentBytes += (addedContentBytes > 0 ? 1 : 0) + stats.bytes
      addedNodes += stats.nodes
    }
    this.contentBytes +=
      (this.contentBytes > 0 && addedContentBytes > 0 ? 1 : 0) +
      addedContentBytes
    this.nodeCount += addedNodes
    this.content.push(...nodes)
    void statsBytes
    return undefined
  }
}

function materializeFallbacks(value: HnnJsonNode): HnnJsonNode {
  const fallback = fallbackPlanOf(value)
  if (fallback) {
    // 顶层 fallback 可有多个 codeBlock；调用方会在父 content 中展开这个标记。
    throw new Error("fallback plan must be expanded by its parent")
  }
  const copy: HnnJsonNode = { ...value }
  // 该递归复制发生在 fallback 解包时，但 JSON-b64 的“替换历史 nodeId”标记仍必须
  // 传到下一阶段 materializePlan；否则两个相同旧 ID payload 会在 codec 才失败。
  if (Object.getOwnPropertyDescriptor(value, JSON_FENCE_PLAN))
    Object.defineProperty(copy, JSON_FENCE_PLAN, { value: true })
  if (Object.getOwnPropertyDescriptor(value, PLAN_SOURCE))
    Object.defineProperty(copy, PLAN_SOURCE, {
      value: planSource(value),
      configurable: true
    })
  const content = value["content"] as HnnJsonNode[] | undefined
  if (!Array.isArray(content)) return copy
  const expanded: HnnJsonNode[] = []
  for (const child of content) {
    const childFallback = fallbackPlanOf(child)
    if (childFallback) {
      const source = planSource(child)
      expanded.push(
        ...materializeFallback(childFallback).map((chunk) => {
          if (source)
            Object.defineProperty(chunk, PLAN_SOURCE, {
              value: source,
              configurable: true
            })
          return chunk
        })
      )
    } else expanded.push(materializeFallbacks(child))
  }
  if (expanded.length > 0) copy["content"] = expanded
  return copy
}

/** 计划 JSON 的 synthetic UUID 与真实 UUID 等长，因此可精确计算最终 HNN 外壳字节。 */
const PLAN_INLINE_TYPES = new Set([
  "text",
  "hardBreak",
  "inlineFormula",
  "mention"
])
const PLAN_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "taskList",
  "callout",
  "collapsible",
  "formula",
  "picture",
  "card",
  "drawing",
  "directory",
  "externalItem"
])
const PLAN_ATOM_TYPES = new Set([
  "horizontalRule",
  "formula",
  "picture",
  "card",
  "drawing",
  "directory",
  "resource",
  "externalItem",
  "hardBreak",
  "inlineFormula",
  "mention"
])
const PLAN_EMPTY_CONTENT_TYPES = new Set(["paragraph", "heading", "codeBlock"])

function jsonFenceFailure(message: string): never {
  throw new Error(message)
}

function jsonFenceString(
  value: unknown,
  maxBytes: number,
  label: string,
  required = true
): value is string {
  if (
    typeof value !== "string" ||
    (required && value.trim().length === 0) ||
    !isHnnStringAttrWithinLimits(value, maxBytes)
  )
    jsonFenceFailure(`${label} 不合法`)
  return true
}

function jsonFenceAttrs(type: string, raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    jsonFenceFailure(`${type} attrs 不合法`)
  const attrs = raw as Record<string, unknown>
  const expected = Object.keys(hnnSchema.nodes[type]?.spec.attrs ?? {})
  if (Object.keys(attrs).some((key) => !expected.includes(key)))
    jsonFenceFailure(`${type} attrs 包含未知字段`)
  if (type !== "doc" && type !== "text") {
    const id = attrs["nodeId"]
    // JSON-b64 可由不带 ID 的历史 payload 导入，最终在预算通过后统一补充；带 ID 必须严格。
    if (
      id !== undefined &&
      (!jsonFenceString(id, HNN_LIMITS.maxIdentifierBytes, "nodeId") ||
        !UUID_V4_PATTERN.test(id))
    )
      jsonFenceFailure("nodeId 不合法")
  }
  if (
    type === "heading" &&
    !(
      Number.isInteger(attrs["level"]) &&
      Number(attrs["level"]) >= 1 &&
      Number(attrs["level"]) <= 6
    )
  )
    jsonFenceFailure("heading level 不合法")
  const orderedType = attrs["type"]
  if (
    type === "orderedList" &&
    !(
      Number.isInteger(attrs["start"]) &&
      Number(attrs["start"]) >= 1 &&
      (orderedType === undefined ||
        orderedType === null ||
        (typeof orderedType === "string" &&
          ["1", "a", "A", "i", "I"].includes(orderedType)))
    )
  )
    jsonFenceFailure("orderedList attrs 不合法")
  if (type === "taskItem" && typeof attrs["checked"] !== "boolean")
    jsonFenceFailure("taskItem checked 不合法")
  if (
    type === "blockquote" &&
    attrs["author"] !== undefined &&
    attrs["author"] !== null
  )
    jsonFenceString(
      attrs["author"],
      HNN_LIMITS.maxLabelBytes,
      "blockquote author"
    )
  if (type === "collapsible") {
    jsonFenceString(
      attrs["title"],
      HNN_LIMITS.maxLabelBytes,
      "collapsible title"
    )
    if (typeof attrs["collapsed"] !== "boolean")
      jsonFenceFailure("collapsible collapsed 不合法")
  }
  if (type === "callout") {
    if (!["info", "success", "warning"].includes(String(attrs["tone"])))
      jsonFenceFailure("callout tone 不合法")
    jsonFenceString(attrs["title"], HNN_LIMITS.maxLabelBytes, "callout title")
  }
  if (type === "codeBlock") {
    jsonFenceString(
      attrs["language"],
      HNN_LIMITS.maxIdentifierBytes,
      "codeBlock language"
    )
    jsonFenceString(
      attrs["filename"],
      HNN_LIMITS.maxLabelBytes,
      "codeBlock filename"
    )
  }
  if (type === "formula" || type === "inlineFormula")
    jsonFenceString(attrs["latex"], HNN_LIMITS.maxAttrBytes, "latex")
  if (type === "picture") {
    jsonFenceString(attrs["src"], HNN_LIMITS.maxAttrBytes, "picture src")
    if (!isSafeHnnUrl(String(attrs["src"])))
      jsonFenceFailure("picture src 不安全")
    jsonFenceString(attrs["alt"], HNN_LIMITS.maxLabelBytes, "picture alt")
  }
  if (type === "card" || type === "drawing" || type === "directory")
    jsonFenceString(
      attrs[type === "directory" ? "config" : "data"],
      HNN_LIMITS.maxAttrBytes,
      `${type} data`
    )
  if (type === "mention" || type === "resource" || type === "externalItem") {
    jsonFenceString(
      attrs["resourceId"],
      HNN_LIMITS.maxIdentifierBytes,
      "resourceId"
    )
    jsonFenceString(attrs["name"], HNN_LIMITS.maxLabelBytes, "name")
  }
  if (type === "tableCell" || type === "tableHeader") {
    const colspan = attrs["colspan"] ?? 1
    const rowspan = attrs["rowspan"] ?? 1
    const colwidth = attrs["colwidth"] ?? null
    if (!(
      Number.isInteger(colspan) &&
      Number(colspan) >= 1 &&
      Number(colspan) <= HNN_TABLE_LIMITS.maxSpan &&
      Number.isInteger(rowspan) &&
      Number(rowspan) >= 1 &&
      Number(rowspan) <= HNN_TABLE_LIMITS.maxSpan
    ))
      jsonFenceFailure("table span 不合法")
    if (!(
      colwidth === null ||
      (Array.isArray(colwidth) &&
        colwidth.length === colspan &&
        colwidth.every(
          (width) =>
            Number.isInteger(width) &&
            Number(width) > 0 &&
            Number(width) <= HNN_TABLE_LIMITS.maxColumnWidth
        ))
    ))
      jsonFenceFailure("table colwidth 不合法")
    const align = attrs["align"]
    if (!(
      align === undefined ||
      align === null ||
      (typeof align === "string" && ["left", "right", "center"].includes(align))
    ))
      jsonFenceFailure("table align 不合法")
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (jsonValueByteLength(value, HNN_LIMITS.maxAttrBytes) === undefined)
      jsonFenceFailure(`${key} attr 过大或不合法`)
  }
}

function jsonFenceMarks(value: unknown): void {
  if (!Array.isArray(value)) jsonFenceFailure("marks 不合法")
  const seen = new Set<string>()
  let previousRank = -1
  for (const mark of value) {
    if (!mark || typeof mark !== "object" || Array.isArray(mark))
      jsonFenceFailure("mark 不合法")
    const record = mark as Record<string, unknown>
    const type = record["type"]
    if (typeof type !== "string" || !HNN_MARK_TYPES.has(type) || seen.has(type))
      jsonFenceFailure("mark type 不合法")
    const rank = MARK_RANK.get(type) ?? -1
    if (rank <= previousRank) jsonFenceFailure("mark 顺序不合法")
    previousRank = rank
    seen.add(type)
    if (type === "link") {
      const attrs = record["attrs"]
      if (
        !attrs ||
        typeof attrs !== "object" ||
        Array.isArray(attrs) ||
        Object.keys(attrs).length !== 1 ||
        typeof (attrs as Record<string, unknown>)["href"] !== "string" ||
        !isSafeHnnUrl((attrs as Record<string, unknown>)["href"] as string) ||
        !isHnnStringAttrWithinLimits(
          (attrs as Record<string, unknown>)["href"] as string,
          HNN_LIMITS.maxAttrBytes
        )
      )
        jsonFenceFailure("link mark 不合法")
    } else if (Object.keys(record).length !== 1)
      jsonFenceFailure("mark attrs 不合法")
  }
  if (seen.has("code") && seen.size !== 1)
    jsonFenceFailure("code mark 不可组合")
}

function jsonFenceChildAllowed(
  parent: string,
  child: string,
  index: number
): boolean {
  if (
    [
      "doc",
      "blockquote",
      "callout",
      "collapsible",
      "tableCell",
      "tableHeader"
    ].includes(parent)
  )
    return PLAN_BLOCK_TYPES.has(child)
  if (parent === "bulletList" || parent === "orderedList")
    return child === "listItem"
  if (parent === "taskList") return child === "taskItem"
  if (parent === "listItem" || parent === "taskItem")
    return index === 0 ? child === "paragraph" : PLAN_BLOCK_TYPES.has(child)
  if (parent === "table") return child === "tableRow"
  if (parent === "tableRow")
    return child === "tableHeader" || child === "tableCell"
  if (parent === "paragraph" || parent === "heading")
    return PLAN_INLINE_TYPES.has(child) || child === "resource"
  return parent === "codeBlock" && child === "text"
}

/** 在 PM/TableMap 前以固定列状态验证 JSON-b64 表格，避免 span 形成非法或巨型网格。 */
function validateJsonFenceTableGeometry(rows: readonly HnnJsonNode[]): void {
  if (rows.length > HNN_TABLE_LIMITS.maxRows)
    jsonFenceFailure("table rows 过大")
  const active = new Array<number>(HNN_TABLE_LIMITS.maxColumns).fill(0)
  let width: number | undefined
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex]?.["content"]
    if (!Array.isArray(cells)) jsonFenceFailure("table row 不合法")
    const next = active.map((span) => Math.max(0, span - 1))
    let column = 0
    let rowWidth = 0
    for (const cell of cells) {
      while (column < HNN_TABLE_LIMITS.maxColumns && active[column] !== 0)
        column += 1
      const attrs = (cell as HnnJsonNode)["attrs"] as
        Record<string, unknown> | undefined
      const colspan = attrs?.["colspan"] ?? 1
      const rowspan = attrs?.["rowspan"] ?? 1
      if (!(
        Number.isInteger(colspan) &&
        Number.isInteger(rowspan) &&
        Number(colspan) >= 1 &&
        Number(rowspan) >= 1 &&
        column + Number(colspan) <= HNN_TABLE_LIMITS.maxColumns
      ))
        jsonFenceFailure("table span 不合法")
      for (let offset = 0; offset < Number(colspan); offset += 1) {
        if (active[column + offset] !== 0)
          jsonFenceFailure("table rowspan 重叠")
        next[column + offset] = Number(rowspan) - 1
      }
      column += Number(colspan)
      rowWidth = Math.max(rowWidth, column)
    }
    for (let index = 0; index < HNN_TABLE_LIMITS.maxColumns; index += 1)
      if (active[index] !== 0) rowWidth = Math.max(rowWidth, index + 1)
    if (width === undefined) width = rowWidth
    if (
      width === 0 ||
      rowWidth !== width ||
      width > HNN_TABLE_LIMITS.maxColumns ||
      (rowIndex + 1) * width > HNN_TABLE_LIMITS.maxGridCells
    )
      jsonFenceFailure("table 必须是有界矩形")
    for (let index = 0; index < width; index += 1)
      if (next[index] === 0 && active[index] === 0 && index >= column)
        jsonFenceFailure("table 存在未覆盖坐标")
    active.splice(0, active.length, ...next)
  }
  if (active.some((span) => span !== 0))
    jsonFenceFailure("table rowspan 超出末行")
}

/** codec 会补齐这些 v1 默认 attrs；计划也必须先补齐，账本才与最终 canonical shell 等价。 */
function normalizeJsonFenceDefaults(root: HnnJsonNode): void {
  const stack: HnnJsonNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    const attrs = node["attrs"]
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
      const record = attrs as Record<string, unknown>
      if (node["type"] === "orderedList" && !("type" in record))
        record["type"] = null
      if (node["type"] === "blockquote" && !("author" in record))
        record["author"] = null
      if (node["type"] === "tableCell" || node["type"] === "tableHeader") {
        if (!("colspan" in record)) record["colspan"] = 1
        if (!("rowspan" in record)) record["rowspan"] = 1
        if (!("colwidth" in record)) record["colwidth"] = null
        if (!("align" in record)) record["align"] = null
      }
    }
    const content = node["content"]
    if (Array.isArray(content))
      for (const child of content) stack.push(child as HnnJsonNode)
  }
}

/** JSON-b64 专用、有界纯 JSON 严格验证，故预算失败前不触发 PM codec 或 UUID 创建。 */
function validateJsonFencePlan(root: HnnJsonNode): void {
  const stack: Array<{
    value: unknown
    parent?: string
    index: number
    depth: number
  }> = [{ value: root, index: 0, depth: 2 }]
  let nodes = 1 // 外层 doc
  while (stack.length > 0) {
    const frame = stack.pop()!
    nodes += 1
    if (nodes > HNN_LIMITS.maxNodes || frame.depth > HNN_LIMITS.maxDepth)
      jsonFenceFailure("JSON-b64 节点或深度超过 HNN 预算")
    if (
      !frame.value ||
      typeof frame.value !== "object" ||
      Array.isArray(frame.value)
    )
      jsonFenceFailure("JSON-b64 node 不合法")
    const node = frame.value as HnnJsonNode
    const type = node["type"]
    if (
      typeof type !== "string" ||
      !HNN_NODE_TYPES.has(type) ||
      type === "doc" ||
      (!frame.parent && !PLAN_BLOCK_TYPES.has(type)) ||
      (frame.parent && !jsonFenceChildAllowed(frame.parent, type, frame.index))
    )
      jsonFenceFailure("JSON-b64 node nesting 不合法")
    const allowed =
      type === "text" ? ["type", "text", "marks"] : ["type", "attrs", "content"]
    if (Object.keys(node).some((key) => !allowed.includes(key)))
      jsonFenceFailure("JSON-b64 node 包含未知字段")
    if (type === "text") {
      if (!jsonFenceString(node["text"], HNN_LIMITS.maxAttrBytes, "text"))
        jsonFenceFailure("text 不合法")
      if (node["marks"] !== undefined) {
        if (frame.parent === "codeBlock")
          jsonFenceFailure("codeBlock text 不可包含 marks")
        jsonFenceMarks(node["marks"])
      }
      continue
    }
    jsonFenceAttrs(type, node["attrs"])
    const content = node["content"]
    if (PLAN_ATOM_TYPES.has(type)) {
      if (content !== undefined) jsonFenceFailure("原子节点不可包含 content")
      continue
    }
    if (content === undefined && PLAN_EMPTY_CONTENT_TYPES.has(type)) continue
    if (!Array.isArray(content) || content.length === 0)
      jsonFenceFailure("node content 不合法")
    if (type === "table") {
      const rows = content as HnnJsonNode[]
      validateJsonFenceTableGeometry(rows)
    }
    for (let index = content.length - 1; index >= 0; index -= 1)
      stack.push({
        value: content[index],
        parent: type,
        index,
        depth: frame.depth + 1
      })
  }
}

function parseJsonFenceGroup(
  nodes: readonly Content[],
  index: number
): JsonFenceParseResult | undefined {
  const group = jsonFenceGroupAt(nodes, index)
  if (!group) return undefined
  const chunks: string[] = []
  for (const current of group.members) {
    // 导出器保证每段均不超过此限制。导入时先逐段限制，不能让单段膨胀绕过重组后的 HNN 校验。
    if (current.value.length > BASE64URL_CHUNK_CHARS) {
      return {
        pending: true,
        group,
        message: "分块 HamsterNote JSON payload 超过单段上限",
        next: group.next
      }
    }
    chunks.push(current.value)
  }
  try {
    const decoded = base64urlDecode(chunks.join(""))
    if (decoded === undefined) throw new Error("invalid base64url")
    // JSON.parse 前先限制 UTF-8 字节，避免 payload 在 ID 重建前耗尽 shell 预算。
    if (utf8Bytes(decoded) > HNN_LIMITS.maxShellBytes)
      throw new Error("decoded payload exceeds shell budget")
    const parsed: unknown = JSON.parse(decoded)
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof (parsed as HnnJsonNode)["type"] !== "string"
    )
      throw new Error("root is not a node")
    const payload = parsed as HnnJsonNode
    validateJsonFencePlan(payload)
    // 严格验证观察原始 payload；兼容的 v1 默认值只在通过后补齐，账本才能与最终 codec
    // canonical shell 精确一致，且不会把非规范字段在验证前悄悄改写为合法输入。
    normalizeJsonFenceDefaults(payload)
    // JSON.parse 的结果是本函数独占的纯 JSON；标记不进入最终 HNN JSON，也不需要复制
    // payload。全局 ledger 通过后 materializePlan 才会删除旧 nodeId、创建新的 UUID。
    Object.defineProperty(payload, JSON_FENCE_PLAN, { value: true })
    Object.defineProperty(payload, PLAN_SOURCE, {
      value: position(group.first),
      configurable: true
    })
    return { nodes: [payload], next: group.next }
  } catch {
    // 围栏 payload 自身失效只影响该完整组；fallback 的全局容量由序列账本统一预检。
    return {
      pending: true,
      group,
      message: "分块 HamsterNote JSON 无法解析",
      next: group.next
    }
  }
}

/**
 * callout/collapsible 正文先在独立预算分支内转换。嵌套失败不能消耗外层的 AST、词法
 * 或候选配额，也不能遗留内部诊断；调用者会把完整原围栏作为一个惰性 fallback 结算。
 */
function nestedFenceContent(
  body: string,
  diagnostics: MarkdownDiagnostic[],
  budget: MarkdownBudget,
  fence: Extract<Content, { type: "code" }>
):
  | {
      content: HnnJsonNode[]
      baseBudget: MarkdownBudget
      budget: MarkdownBudget
      diagnostics: MarkdownDiagnostic[]
    }
  | undefined {
  const branchBudget: MarkdownBudget = { ...budget }
  const diagnosticStart = diagnostics.length
  try {
    const nestedPreflight = preflightMarkdown(body, branchBudget)
    if ("failure" in nestedPreflight)
      throw new InputTooLargeError(nestedPreflight.diagnostic)
    const nestedRoot = markdownParser.parse(body)
    if (!withinAstBudget(nestedRoot, branchBudget))
      throw new InputTooLargeError({
        code: "input-too-large",
        message: `Markdown AST 节点超过 ${MAX_CONVERSION_NODES}`
      })
    // callout/collapsible 包装节点与其正文必须在调用方的真实 ledger 中一起校验；此处
    // 若提前以局部 ledger 判定，会把 sibling 中实际失败的内层 fence 错替换为外层 fence。
    const content = convertBlockSequence(
      nestedRoot.children,
      diagnostics,
      nestedPreflight.unterminatedFenceLines,
      branchBudget
    )
    // 没有父 ledger 的递归不得提交或删除更深层计划。祖先必须看到完整树，才能在
    // quote/list 额外深度令包装节点越界时回滚到准确的原始围栏。
    const ownedDiagnostics = diagnostics.slice(diagnosticStart)
    rebaseDiagnostics(ownedDiagnostics, position(fence))
    return {
      content,
      baseBudget: { ...budget },
      budget: branchBudget,
      diagnostics: ownedDiagnostics
    }
  } catch (error) {
    removeDiagnostics(diagnostics, diagnostics.slice(diagnosticStart))
    if (error instanceof InputTooLargeError) return undefined
    throw error
  }
}

type NestedFenceEntry = { node: HnnJsonNode; plan: NestedFencePlan }

function nestedFencePlans(nodes: readonly HnnJsonNode[]): NestedFenceEntry[] {
  const plans: NestedFenceEntry[] = []
  const stack = [...nodes].reverse()
  while (stack.length > 0) {
    const node = stack.pop()!
    const plan = Object.getOwnPropertyDescriptor(node, NESTED_FENCE_PLAN)
      ?.value as NestedFencePlan | undefined
    if (plan) plans.push({ node, plan })
    const content = node["content"]
    if (Array.isArray(content))
      for (let index = content.length - 1; index >= 0; index -= 1)
        stack.push(content[index] as HnnJsonNode)
  }
  return plans
}

function applyMarkdownBudget(
  target: MarkdownBudget,
  source: MarkdownBudget
): void {
  target.lines = source.lines
  target.blocks = source.blocks
  target.lexicalWork = source.lexicalWork
  target.candidates = source.candidates
  target.astNodes = source.astNodes
}

/**
 * 只在所有 nested plan 的增量都可合入时才修改预算和删除标记。返回值精确指出失败
 * 围栏，使 ledger 事务能以该围栏的完整原文 fallback 后重新结算。
 */
function commitNestedFencePlans(
  target: MarkdownBudget,
  plans: readonly NestedFenceEntry[]
): NestedFenceEntry | undefined {
  let next = { ...target }
  for (const entry of plans) {
    const { plan } = entry
    next = {
      lines: next.lines + plan.budget.lines - plan.baseBudget.lines,
      blocks: next.blocks + plan.budget.blocks - plan.baseBudget.blocks,
      lexicalWork:
        next.lexicalWork +
        plan.budget.lexicalWork -
        plan.baseBudget.lexicalWork,
      candidates:
        next.candidates + plan.budget.candidates - plan.baseBudget.candidates,
      astNodes: next.astNodes + plan.budget.astNodes - plan.baseBudget.astNodes
    }
    if (
      next.lines > MAX_MARKDOWN_LINES ||
      next.blocks > MAX_MARKDOWN_BLOCKS ||
      next.lexicalWork > MAX_LEXICAL_WORK ||
      next.candidates > MAX_MARKDOWN_CANDIDATES ||
      next.astNodes > MAX_CONVERSION_NODES
    ) {
      return entry
    }
  }
  applyMarkdownBudget(target, next)
  // 子分支一旦归入最近账本，就成为其父分支预算的一部分；删除标记避免祖先账本重复结算。
  for (const { node } of plans) Reflect.deleteProperty(node, NESTED_FENCE_PLAN)
  return undefined
}

/** 只替换触发事务回滚的包装节点；quote/list 等祖先仍按原 Markdown 结构保留。 */
function replaceNestedFencePlan(
  nodes: readonly HnnJsonNode[],
  target: HnnJsonNode,
  fallback: readonly HnnJsonNode[]
): HnnJsonNode[] {
  const replace = (node: HnnJsonNode): HnnJsonNode[] => {
    if (node === target) return [...fallback]
    const content = node["content"]
    if (!Array.isArray(content)) return [node]
    const replaced = content.flatMap((child) => replace(child as HnnJsonNode))
    const copy = { ...node, content: replaced }
    if (Object.getOwnPropertyDescriptor(node, JSON_FENCE_PLAN))
      Object.defineProperty(copy, JSON_FENCE_PLAN, { value: true })
    if (Object.getOwnPropertyDescriptor(node, PLAN_SOURCE))
      Object.defineProperty(copy, PLAN_SOURCE, {
        value: planSource(node),
        configurable: true
      })
    if (Object.getOwnPropertyDescriptor(node, NESTED_FENCE_PLAN))
      Object.defineProperty(copy, NESTED_FENCE_PLAN, {
        value: Object.getOwnPropertyDescriptor(node, NESTED_FENCE_PLAN)?.value,
        configurable: true
      })
    return [copy]
  }
  return nodes.flatMap(replace)
}

function containsPlannedNode(node: HnnJsonNode, target: HnnJsonNode): boolean {
  if (node === target) return true
  const content = node["content"]
  return (
    Array.isArray(content) &&
    content.some((child) => containsPlannedNode(child as HnnJsonNode, target))
  )
}

/**
 * 内层回滚新增的诊断也是所有包裹它的 nested fence 的临时产物。将同一对象交给严格
 * 祖先，后续祖先回滚即可精确清理失效后代诊断，且不会触及并列 sibling 的诊断。
 */
function nestedFencePlanAncestors(
  plans: readonly NestedFenceEntry[],
  target: HnnJsonNode
): NestedFenceEntry[] {
  return plans.filter(
    (entry) => entry.node !== target && containsPlannedNode(entry.node, target)
  )
}

/** 返回包含账本首个跨限事件的最内层 fenced plan，绝不依赖数组末项猜测。 */
function nestedFencePlanForNode(
  plans: readonly NestedFenceEntry[],
  target: HnnJsonNode | undefined
): NestedFenceEntry | undefined {
  if (!target) return undefined
  let result: NestedFenceEntry | undefined
  for (const plan of plans)
    if (containsPlannedNode(plan.node, target)) result = plan
  return result
}

/** 嵌套围栏只能在包装节点通过 ledger 后把候选/AST 工作提交给父分支。 */
function nestedFenceNode(
  type: "callout" | "collapsible",
  attrs: Record<string, unknown>,
  nested: {
    content: HnnJsonNode[]
    baseBudget: MarkdownBudget
    budget: MarkdownBudget
    diagnostics: MarkdownDiagnostic[]
  },
  value: Extract<Content, { type: "code" }>,
  message: string
): HnnJsonNode {
  const node = planNode(
    type,
    attrs,
    nested.content.length > 0 ? nested.content : [paragraph([])]
  )
  Object.defineProperty(node, NESTED_FENCE_PLAN, {
    value: {
      budget: nested.budget,
      baseBudget: { ...nested.baseBudget },
      diagnostics: nested.diagnostics,
      fence: value,
      message
    } satisfies NestedFencePlan,
    configurable: true
  })
  return node
}

function customFence(
  value: Extract<Content, { type: "code" }>,
  diagnostics: MarkdownDiagnostic[],
  unterminated: Set<number>,
  budget: MarkdownBudget
): HnnJsonNode[] {
  const language = value.lang ?? ""
  if (
    (HN_FENCE_LANGUAGES.has(language) ||
      language.startsWith("hamster-note-")) &&
    unterminated.has(value.position?.start.line ?? -1)
  ) {
    importDiagnostic(
      diagnostics,
      value,
      "unterminated-hn-fence",
      `HamsterNote 围栏 ${language} 未闭合，已作为代码保留`
    )
    return fallbackCode("markdown", originalFence(value), diagnostics, value)
  }
  // 成功的分组会在序列适配层中先被消费；其余同名 fence 绝不能落入通用 metadata 分支并生成未知 HNN node。
  if (language === "hamster-note-json-b64")
    return invalidFence(
      value,
      diagnostics,
      "hamster-note-json-b64 围栏未能完成重组"
    )
  if (!HN_FENCE_LANGUAGES.has(language)) {
    if (language.startsWith("hamster-note-")) {
      importDiagnostic(
        diagnostics,
        value,
        "unknown-hn-fence",
        `未知 HamsterNote 围栏 ${language} 已作为代码保留`
      )
      return fallbackCode("markdown", originalFence(value), diagnostics, value)
    } else if (
      utf8Bytes(language) > HNN_LIMITS.maxIdentifierBytes ||
      (value.meta && utf8Bytes(value.meta) > HNN_LIMITS.maxLabelBytes)
    ) {
      importDiagnostic(
        diagnostics,
        value,
        "code-language-fallback",
        "code fence language 或 meta 过长，已保留完整围栏"
      )
      return fallbackCode("markdown", originalFence(value), diagnostics, value)
    } else if (value.meta && value.meta.trim().length > 0) {
      importDiagnostic(
        diagnostics,
        value,
        "code-filename-fallback",
        "标准 Markdown code fence 的 filename 无法无损映射，已保留完整围栏"
      )
      return fallbackCode(
        "markdown",
        readableCodeFence(language || "plaintext", value.meta, value.value),
        diagnostics,
        value
      )
    }
    return fallbackCode(
      language || "plaintext",
      value.value,
      diagnostics,
      value
    )
  }
  if (value.meta && value.meta.trim().length > 0)
    return invalidFence(value, diagnostics, `${language} 围栏不得包含 meta`)
  if (language === "math") {
    if (value.value.length === 0)
      return invalidFence(value, diagnostics, "math 围栏不能为空")
    return isHnnStringAttrWithinLimits(value.value, HNN_LIMITS.maxAttrBytes)
      ? [planNode("formula", { latex: value.value })]
      : oversizedFence(
          value,
          diagnostics,
          "math latex",
          HNN_LIMITS.maxAttrBytes
        )
  }
  if (language === "directory")
    return value.value.trim().length === 0
      ? [planNode("directory", { config: "headings" })]
      : invalidFence(value, diagnostics, "directory 围栏不得包含正文")
  if (language === "hamster-note-card" || language === "hamster-note-drawing") {
    if (value.value.length === 0)
      return invalidFence(
        value,
        diagnostics,
        `${language} 围栏 metadata 不合法`
      )
    return isHnnStringAttrWithinLimits(value.value, HNN_LIMITS.maxAttrBytes)
      ? [
          planNode(language === "hamster-note-card" ? "card" : "drawing", {
            data: value.value
          })
        ]
      : oversizedFence(
          value,
          diagnostics,
          `${language} data`,
          HNN_LIMITS.maxAttrBytes
        )
  }
  const { metadata, body } = parseMetadata(value.value)
  if (!metadata)
    return invalidFence(
      value,
      diagnostics,
      `${language} 围栏首行必须是 JSON metadata`
    )
  if (language === "collapsible") {
    if (
      !hasOnlyKeys(metadata, ["title", "collapsed"]) ||
      typeof metadata["title"] !== "string" ||
      metadata["title"].trim().length === 0 ||
      typeof metadata["collapsed"] !== "boolean"
    )
      return invalidFence(value, diagnostics, "collapsible metadata 不合法")
    if (
      !isHnnStringAttrWithinLimits(metadata["title"], HNN_LIMITS.maxLabelBytes)
    )
      return oversizedFence(
        value,
        diagnostics,
        "collapsible title",
        HNN_LIMITS.maxLabelBytes
      )
    const nested = nestedFenceContent(body, diagnostics, budget, value)
    if (!nested) {
      importDiagnostic(
        diagnostics,
        value,
        "nested-content-fallback",
        "collapsible 嵌套正文超过安全预算，已完整作为代码保留"
      )
      return fallbackCode("markdown", originalFence(value), diagnostics, value)
    }
    return [
      nestedFenceNode(
        "collapsible",
        { title: metadata["title"], collapsed: metadata["collapsed"] },
        nested,
        value,
        "collapsible 嵌套正文超过安全预算，已完整作为代码保留"
      )
    ]
  }
  if (language === "callout") {
    if (
      !hasOnlyKeys(metadata, ["tone", "title"]) ||
      !["info", "success", "warning"].includes(metadata["tone"] as string) ||
      typeof metadata["title"] !== "string" ||
      metadata["title"].trim().length === 0
    )
      return invalidFence(value, diagnostics, "callout metadata 不合法")
    if (
      !isHnnStringAttrWithinLimits(metadata["title"], HNN_LIMITS.maxLabelBytes)
    )
      return oversizedFence(
        value,
        diagnostics,
        "callout title",
        HNN_LIMITS.maxLabelBytes
      )
    const nested = nestedFenceContent(body, diagnostics, budget, value)
    if (!nested) {
      importDiagnostic(
        diagnostics,
        value,
        "nested-content-fallback",
        "callout 嵌套正文超过安全预算，已完整作为代码保留"
      )
      return fallbackCode("markdown", originalFence(value), diagnostics, value)
    }
    return [
      nestedFenceNode(
        "callout",
        { tone: metadata["tone"], title: metadata["title"] },
        nested,
        value,
        "callout 嵌套正文超过安全预算，已完整作为代码保留"
      )
    ]
  }
  if (language === "picture") {
    if (
      !hasOnlyKeys(metadata, ["src", "alt"]) ||
      body.length > 0 ||
      typeof metadata["src"] !== "string" ||
      !isSafeHnnUrl(metadata["src"]) ||
      typeof metadata["alt"] !== "string" ||
      metadata["alt"].trim().length === 0
    )
      return invalidFence(value, diagnostics, "picture metadata 或正文不合法")
    if (!isHnnStringAttrWithinLimits(metadata["src"], HNN_LIMITS.maxAttrBytes))
      return oversizedFence(
        value,
        diagnostics,
        "picture src",
        HNN_LIMITS.maxAttrBytes
      )
    if (!isHnnStringAttrWithinLimits(metadata["alt"], HNN_LIMITS.maxLabelBytes))
      return oversizedFence(
        value,
        diagnostics,
        "picture alt",
        HNN_LIMITS.maxLabelBytes
      )
    return [planNode("picture", { src: metadata["src"], alt: metadata["alt"] })]
  }
  if (
    !hasOnlyKeys(metadata, ["resourceId", "name"]) ||
    body.length > 0 ||
    typeof metadata["resourceId"] !== "string" ||
    metadata["resourceId"].trim().length === 0 ||
    typeof metadata["name"] !== "string" ||
    metadata["name"].trim().length === 0
  )
    return invalidFence(value, diagnostics, `${language} metadata 或正文不合法`)
  if (
    !isHnnStringAttrWithinLimits(
      metadata["resourceId"],
      HNN_LIMITS.maxIdentifierBytes
    )
  )
    return oversizedFence(
      value,
      diagnostics,
      `${language} resourceId`,
      HNN_LIMITS.maxIdentifierBytes
    )
  if (!isHnnStringAttrWithinLimits(metadata["name"], HNN_LIMITS.maxLabelBytes))
    return oversizedFence(
      value,
      diagnostics,
      `${language} name`,
      HNN_LIMITS.maxLabelBytes
    )
  if (language === "external-item")
    return [
      planNode("externalItem", {
        resourceId: metadata["resourceId"],
        name: metadata["name"]
      })
    ]
  return [
    paragraph([
      planNode(language, {
        resourceId: metadata["resourceId"],
        name: metadata["name"]
      })
    ])
  ]
}

function blockNodes(
  value: Content,
  diagnostics: MarkdownDiagnostic[],
  unterminated: Set<number>,
  budget: MarkdownBudget,
  convert: SequenceConverter
): HnnJsonNode[] {
  switch (value.type) {
    case "paragraph":
      return paragraphNode(value, diagnostics)
    case "heading":
      return [
        planNode(
          "heading",
          { level: value.depth },
          inlineNodes(value.children, diagnostics)
        )
      ]
    case "thematicBreak":
      return [planNode("horizontalRule")]
    case "blockquote":
      return annotatePlanSources(
        [
          planNode(
            "blockquote",
            { author: null },
            convert(value.children, false)
          )
        ],
        value
      )
    case "list":
      return listNodes(value, diagnostics, unterminated, budget, convert)
    case "code":
      return customFence(value, diagnostics, unterminated, budget)
    case "table":
      preflightTable(value)
      return [
        planNode(
          "table",
          {},
          value.children.map((row, rowIndex) =>
            planNode(
              "tableRow",
              {},
              row.children.map((cell, cellIndex) =>
                tableCell(
                  cell,
                  rowIndex === 0,
                  diagnostics,
                  value.align?.[cellIndex] ?? null
                )
              )
            )
          )
        )
      ]
    case "html":
      importDiagnostic(
        diagnostics,
        value,
        "html-fallback",
        "HTML 块已作为可读代码保留"
      )
      return fallbackCode("html", value.value)
    case "definition":
      importDiagnostic(
        diagnostics,
        value,
        "definition-fallback",
        "Markdown definition 已作为可读代码保留"
      )
      return fallbackCode(
        "markdown",
        `[${value.label || value.identifier}]: ${value.url}${value.title ? ` "${value.title}"` : ""}`
      )
    default:
      importDiagnostic(
        diagnostics,
        value,
        "unsupported-block",
        `不支持的 Markdown ${value.type} 已作为可读代码保留`
      )
      return fallbackCode("markdown", String(value.type))
  }
}

/**
 * 所有 block 序列（root、quote、list item、callout/collapsible body）共用同一递归适配层。
 * 只有 root 调用传入账本；嵌套序列仍在此处解析 JSON-b64 与来源，随后作为所属外层
 * 节点的一部分一次性结算，因而不会在中间阶段创建 UUID 或调用 codec。
 */
function convertBlockSequence(
  nodes: readonly Content[],
  diagnostics: MarkdownDiagnostic[],
  unterminated: Set<number>,
  budget: MarkdownBudget,
  ledger?: PlanLedger,
  account = true
): HnnJsonNode[] {
  const output: HnnJsonNode[] = []
  const convert: SequenceConverter = (children, childAccount = false) =>
    convertBlockSequence(
      children,
      diagnostics,
      unterminated,
      budget,
      undefined,
      childAccount
    )
  for (let index = 0; index < nodes.length;) {
    const reassembled = parseJsonFenceGroup(nodes, index)
    const source = nodes[index]!
    const entry = reassembled
    const diagnosticStart = diagnostics.length
    const rawNodes = entry
      ? "pending" in entry
        ? fallbackCode("markdown", jsonFenceFallbackSegments(entry.group))
        : entry.nodes
      : blockNodes(source, diagnostics, unterminated, budget, convert)
    let entryDiagnostics =
      entry && "pending" in entry
        ? [
            {
              code: "invalid-hn-fence",
              message: `${entry.message}，已作为代码保留`,
              ...position(entry.group.first)
            }
          ]
        : diagnostics.slice(diagnosticStart)
    let entryNodes = annotatePlanSources(
      rawNodes.map(normalizeTextRuns),
      entry && "pending" in entry ? entry.group.first : source
    )
    // 每个 mdast 源节点完成分类后立刻记账；不保存 entries，也不构造整棵 synthetic JSON。
    let overflow: ReturnType<PlanLedger["add"]>
    for (;;) {
      const nestedPlans = nestedFencePlans(entryNodes)
      const ledgerSnapshot = ledger?.snapshot()
      const budgetSnapshot = { ...budget }
      // ledger 与 Markdown budget 是一个不可分割的事务。非记账递归保留 plan 标记，让
      // 最近的 ledger 看见最终 quote/list/callout 树的真实深度后再统一提交。
      let validationNode: HnnJsonNode | undefined
      try {
        overflow = ledger && account ? ledger.add(entryNodes) : undefined
      } catch (error) {
        if (!(error instanceof InputTooLargeError)) throw error
        validationNode = (
          error as InputTooLargeError & { planNode?: HnnJsonNode }
        ).planNode
        overflow = {
          bytes: HNN_LIMITS.maxShellBytes + 1,
          nodes: MAX_CONVERSION_NODES + 1
        }
      }
      const budgetFailure =
        !overflow && ledger && account
          ? commitNestedFencePlans(budget, nestedPlans)
          : undefined
      const nested =
        budgetFailure ??
        nestedFencePlanForNode(nestedPlans, validationNode ?? overflow?.node)
      if (!overflow && !budgetFailure) break
      if (nested) {
        if (ledgerSnapshot && ledger) ledger.restore(ledgerSnapshot)
        applyMarkdownBudget(budget, budgetSnapshot)
        removeDiagnostics(diagnostics, nested.plan.diagnostics)
        const fallbackDiagnosticStart = diagnostics.length
        importDiagnostic(
          diagnostics,
          nested.plan.fence,
          "nested-content-fallback",
          nested.plan.message
        )
        const fallback = fallbackCode(
          "markdown",
          originalFence(nested.plan.fence),
          diagnostics,
          nested.plan.fence
        )
        const fallbackDiagnostics = diagnostics.slice(fallbackDiagnosticStart)
        for (const ancestor of nestedFencePlanAncestors(
          nestedPlans,
          nested.node
        ))
          ancestor.plan.diagnostics.push(...fallbackDiagnostics)
        entryDiagnostics = diagnostics.slice(diagnosticStart)
        entryNodes = annotatePlanSources(
          replaceNestedFencePlan(entryNodes, nested.node, fallback).map(
            normalizeTextRuns
          ),
          entry && "pending" in entry ? entry.group.first : source
        )
        continue
      }
      // nested fence/table 的实际 mdast 节点可能位于 list/quote 源节点内部。账本已
      // 精确记录首个跨限计划节点，必须优先使用它，不能被后续 sibling 的分类诊断覆盖。
      const failedOverflow = overflow!
      const diagnosticPosition =
        failedOverflow.source ??
        entryDiagnostics.at(-1) ??
        planSource(entryNodes.at(-1)!)
      throw new InputTooLargeError([
        ...entryDiagnostics,
        {
          code: "input-too-large",
          message:
            entry && "pending" in entry
              ? "损坏或非规范 hamster-note-json-b64 围栏无法连同原始分片和其余可识别内容完整保留在 512 KiB HNN 上限内"
              : `Markdown 转换计划超过 HNN ${failedOverflow.nodes > MAX_CONVERSION_NODES ? "节点" : "512 KiB 外壳"}安全预算`,
          ...(diagnosticPosition
            ? {
                ...(diagnosticPosition.line === undefined
                  ? {}
                  : { line: diagnosticPosition.line }),
                ...(diagnosticPosition.column === undefined
                  ? {}
                  : { column: diagnosticPosition.column }),
                ...(diagnosticPosition.offset === undefined
                  ? {}
                  : { offset: diagnosticPosition.offset })
              }
            : position(
                entry && "pending" in entry ? entry.group.first : source
              ))
        }
      ])
    }
    if (entry && "pending" in entry) diagnostics.push(...entryDiagnostics)
    output.push(...entryNodes)
    index += entry ? entry.next - index : 1
  }
  return ledger && account ? ledger.content : output
}

/** 对 Remark 产生的相邻同 marks 文本片段预先规范化，使其符合 ProseMirror 的 text node 形式。 */
function normalizeTextRuns(value: HnnJsonNode): HnnJsonNode {
  const content = value["content"] as HnnJsonNode[] | undefined
  if (!content) return value
  const normalized: HnnJsonNode[] = []
  for (const child of content.map(normalizeTextRuns)) {
    const previous = normalized.at(-1)
    // 不得写入 entries/AST 所引用的原 node；合并时以新对象替换末项，确保后续
    // fallback 预算、最终 import 与调用方持有的输入均看到各自独立的文本节点。
    if (
      previous?.["type"] === "text" &&
      child["type"] === "text" &&
      JSON.stringify(previous["marks"] ?? []) ===
        JSON.stringify(child["marks"] ?? [])
    ) {
      normalized[normalized.length - 1] = {
        ...previous,
        text: `${String(previous["text"])}${String(child["text"])}`
      }
    } else normalized.push(child)
  }
  if (normalized.length === 0) return value
  const result = { ...value, content: normalized }
  // 非枚举标记仅在计划期传递给 materializePlan；绝不能随对象展开进入严格 HNN JSON。
  if (Object.getOwnPropertyDescriptor(value, JSON_FENCE_PLAN))
    Object.defineProperty(result, JSON_FENCE_PLAN, { value: true })
  if (Object.getOwnPropertyDescriptor(value, PLAN_SOURCE))
    Object.defineProperty(result, PLAN_SOURCE, {
      value: planSource(value),
      configurable: true
    })
  if (Object.getOwnPropertyDescriptor(value, NESTED_FENCE_PLAN))
    Object.defineProperty(result, NESTED_FENCE_PLAN, {
      value: Object.getOwnPropertyDescriptor(value, NESTED_FENCE_PLAN)?.value,
      configurable: true
    })
  return result
}

/** 在生成任何 nodeId 前限制 mdast 访问数，避免小字节高碎片输入放大成对象洪泛。 */
function withinAstBudget(root: Root, budget: MarkdownBudget): boolean {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    if (!value || typeof value !== "object") continue
    budget.astNodes += 1
    if (budget.astNodes > MAX_CONVERSION_NODES) return false
    // GFM table 有独立的小网格/节点预检；在这里按其所有 cell 计数会使通用 AST
    // 预算抢先拒绝，丢失应由 table 本身携带的位置诊断。
    if ((value as { type?: unknown }).type === "table") continue
    const children = (value as { children?: unknown }).children
    if (Array.isArray(children)) for (const child of children) stack.push(child)
  }
  return true
}

/** 超过持久化预算时不编造可保存文档，调用方必须显式处理失败结果。 */
export function importMarkdown(markdown: string): MarkdownImportResult {
  // UTF-8 字节数不少于 UTF-16 code unit 数；先以 O(1) 下界拒绝超大 ASCII，避免 50MB
  // 这类输入为了计算字节数而额外分配同等大小的 Uint8Array。
  if (
    markdown.length > MAX_MARKDOWN_BYTES ||
    !isUtf8WithinLimit(markdown, MAX_MARKDOWN_BYTES)
  )
    return {
      failure: "input-too-large",
      diagnostics: [
        {
          code: "input-too-large",
          message: `Markdown 超过 ${MAX_MARKDOWN_BYTES} UTF-8 字节上限`
        }
      ]
    }
  const preflight = preflightMarkdown(markdown)
  if ("failure" in preflight)
    return { failure: preflight.failure, diagnostics: [preflight.diagnostic] }
  const diagnostics: MarkdownDiagnostic[] = []
  try {
    const root = markdownParser.parse(markdown)
    if (!withinAstBudget(root, preflight.budget))
      return {
        failure: "input-too-large",
        diagnostics: [
          {
            code: "input-too-large",
            message: `Markdown AST 节点超过 ${MAX_CONVERSION_NODES}`
          }
        ]
      }
    // convertBlockSequence 会构建无 nodeId 的转换计划，并在一个统一预算内结算所有输出形态。
    const ledger = new PlanLedger()
    const content = convertBlockSequence(
      root.children,
      diagnostics,
      preflight.unterminatedFenceLines,
      preflight.budget,
      ledger
    )
    if (content.length === 0) {
      content.push(paragraph([]))
      diagnostics.push({
        code: "empty-input",
        message: "空 Markdown 已导入为空文档"
      })
    }
    // fallback 的 Symbol 计划只可在账本通过后展开；随后才分配 UUID，确保容量失败路径
    // 不会分片、不会把内部元数据交给 codec、更不会产生随机 ID。
    return {
      document: encodeHnn(
        materializePlan(
          materializeFallbacks(normalizeTextRuns({ type: "doc", content }))
        )
      ),
      diagnostics
    }
  } catch (error) {
    if (error instanceof InputTooLargeError || isBudgetCodecError(error)) {
      return {
        failure: "input-too-large",
        diagnostics:
          error instanceof InputTooLargeError
            ? [...error.diagnostics]
            : [
                ...diagnostics,
                {
                  code: "input-too-large",
                  message: "Markdown 转换结果超过 HNN 安全预算"
                }
              ]
      }
    }
    diagnostics.push({
      code: "conversion-failed",
      message:
        error instanceof Error ? error.message : "Markdown 无法转换为 HNN"
    })
    return { failure: "conversion-failed", diagnostics }
  }
}

function pointer(path: string, key: string | number): string {
  return `${path}/${String(key).replace(/~/gu, "~0").replace(/\//gu, "~1")}`
}

function attrs(value: HnnJsonNode): Record<string, unknown> {
  return value["attrs"] as Record<string, unknown>
}
function children(value: HnnJsonNode): HnnJsonNode[] {
  return (value["content"] as HnnJsonNode[] | undefined) ?? []
}
function exportDiagnostic(
  diagnostics: MarkdownDiagnostic[],
  value: HnnJsonNode,
  path: string,
  code: string,
  message: string
): void {
  const nodeId = attrs(value)["nodeId"]
  diagnostics.push({
    code,
    message,
    path,
    ...(typeof nodeId === "string" ? { nodeId } : {})
  })
}

function phrasing(
  values: HnnJsonNode[],
  diagnostics: MarkdownDiagnostic[],
  path: string
): PhrasingContent[] | undefined {
  const output: PhrasingContent[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!
    const valuePath = pointer(path, index)
    if (value["type"] === "hardBreak") output.push({ type: "break" })
    else if (value["type"] === "text") {
      let current: PhrasingContent = {
        type: "text",
        value: typeof value["text"] === "string" ? value["text"] : ""
      }
      const marks = (value["marks"] as HnnJsonNode[] | undefined) ?? []
      if (marks.some((mark) => mark["type"] === "code") && marks.length > 1)
        return undefined
      for (const mark of [...marks].reverse()) {
        if (mark["type"] === "code")
          current = {
            type: "inlineCode",
            value: typeof value["text"] === "string" ? value["text"] : ""
          }
        else if (mark["type"] === "bold")
          current = { type: "strong", children: [current] }
        else if (mark["type"] === "italic")
          current = { type: "emphasis", children: [current] }
        else if (mark["type"] === "strike")
          current = { type: "delete", children: [current] }
        else if (mark["type"] === "link") {
          const href = (mark["attrs"] as Record<string, unknown>)["href"]
          if (typeof href !== "string" || !isSafeHnnUrl(href)) return undefined
          current = { type: "link", url: href, children: [current] }
        }
      }
      output.push(current)
    } else {
      exportDiagnostic(
        diagnostics,
        value,
        valuePath,
        "inline-fallback",
        `行内节点 ${String(value["type"])} 无法由标准 GFM 表达`
      )
      return undefined
    }
  }
  return output
}

function jsonFence(value: HnnJsonNode): Content[] {
  const chunks = jsonChunks(JSON.stringify(value))
  return chunks.map((chunk, index) => ({
    type: "code",
    lang: "hamster-note-json-b64",
    meta: `${index + 1}/${chunks.length}`,
    value: chunk
  }))
}

function namedFence(language: string, value: string): Content[] {
  return [{ type: "code", lang: language, value }]
}

function fallbackNode(
  value: HnnJsonNode,
  diagnostics: MarkdownDiagnostic[],
  path: string,
  code: string,
  message: string
): Content[] {
  exportDiagnostic(diagnostics, value, path, code, message)
  return jsonFence(value)
}

/** 仅忽略每个 HNN 节点 attrs 中重建的 nodeId，其余结构、attrs、文本和 marks 必须完全一致。 */
function structurallyEquivalentIgnoringNodeIds(
  left: unknown,
  right: unknown
): boolean {
  const stack: Array<{ left: unknown; right: unknown; attrs: boolean }> = [
    { left, right, attrs: false }
  ]
  while (stack.length > 0) {
    const pair = stack.pop()
    if (!pair) break
    if (Object.is(pair.left, pair.right)) continue
    if (Array.isArray(pair.left) && Array.isArray(pair.right)) {
      if (pair.left.length !== pair.right.length) return false
      for (let index = 0; index < pair.left.length; index += 1)
        stack.push({
          left: pair.left[index],
          right: pair.right[index],
          attrs: false
        })
      continue
    }
    if (
      !pair.left ||
      !pair.right ||
      typeof pair.left !== "object" ||
      typeof pair.right !== "object" ||
      Array.isArray(pair.left) ||
      Array.isArray(pair.right)
    )
      return false
    const leftRecord = pair.left as Record<string, unknown>
    const rightRecord = pair.right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord)
      .filter((key) => !(pair.attrs && key === "nodeId"))
      .sort()
    const rightKeys = Object.keys(rightRecord)
      .filter((key) => !(pair.attrs && key === "nodeId"))
      .sort()
    if (leftKeys.length !== rightKeys.length) return false
    for (let index = 0; index < leftKeys.length; index += 1) {
      const key = leftKeys[index]
      if (key === undefined || key !== rightKeys[index]) return false
      stack.push({
        left: leftRecord[key],
        right: rightRecord[key],
        attrs: key === "attrs"
      })
    }
  }
  return true
}

function simpleList(value: HnnJsonNode): boolean {
  return children(value).every((item) => {
    const content = children(item)
    const first = content[0]
    return (
      content.length === 1 &&
      first?.["type"] === "paragraph" &&
      phrasing(children(first), [], "") !== undefined
    )
  })
}

function standardBlock(
  value: HnnJsonNode,
  diagnostics: MarkdownDiagnostic[],
  path: string
): Content[] | undefined {
  const nodeAttrs = attrs(value)
  const child = children(value)
  if (value["type"] === "paragraph") {
    if (child.length === 0) return undefined
    const phrasingNodes = phrasing(child, diagnostics, pointer(path, "content"))
    return phrasingNodes
      ? [{ type: "paragraph", children: phrasingNodes }]
      : undefined
  }
  if (value["type"] === "heading") {
    const phrasingNodes = phrasing(child, diagnostics, pointer(path, "content"))
    const depth = nodeAttrs["level"]
    const validDepth =
      typeof depth === "number" &&
      Number.isInteger(depth) &&
      depth >= 1 &&
      depth <= 6
    return phrasingNodes && validDepth
      ? [
          {
            type: "heading",
            depth: depth as 1 | 2 | 3 | 4 | 5 | 6,
            children: phrasingNodes
          }
        ]
      : undefined
  }
  if (value["type"] === "horizontalRule") return [{ type: "thematicBreak" }]
  if (value["type"] === "picture") {
    const src = nodeAttrs["src"]
    const alt = nodeAttrs["alt"]
    if (
      typeof src === "string" &&
      isSafeHnnUrl(src) &&
      typeof alt === "string" &&
      alt.trim().length > 0
    )
      return [
        { type: "paragraph", children: [{ type: "image", url: src, alt }] }
      ]
    return undefined
  }
  if (
    value["type"] === "codeBlock" &&
    nodeAttrs["filename"] === "untitled" &&
    !HN_FENCE_LANGUAGES.has(String(nodeAttrs["language"])) &&
    !String(nodeAttrs["language"]).startsWith("hamster-note-")
  )
    return [
      {
        type: "code",
        lang: String(nodeAttrs["language"]),
        value: child
          .map((item) => (typeof item["text"] === "string" ? item["text"] : ""))
          .join("")
      }
    ]
  if (value["type"] === "blockquote" && nodeAttrs["author"] === null) {
    const blocks = child.map((item, index) =>
      standardBlock(item, diagnostics, pointer(pointer(path, "content"), index))
    )
    if (blocks.some((blocks) => blocks === undefined)) return undefined
    const flattened = blocks.flatMap((blocks) => blocks ?? []) as BlockContent[]
    return [{ type: "blockquote", children: flattened }]
  }
  if (
    (value["type"] === "bulletList" ||
      value["type"] === "orderedList" ||
      value["type"] === "taskList") &&
    simpleList(value) &&
    (value["type"] !== "orderedList" || nodeAttrs["type"] === null)
  ) {
    const task = value["type"] === "taskList"
    return [
      {
        type: "list",
        ordered: value["type"] === "orderedList",
        start:
          value["type"] === "orderedList"
            ? Number(nodeAttrs["start"])
            : undefined,
        children: child.map((item) => ({
          type: "listItem",
          checked: task ? Boolean(attrs(item)["checked"]) : null,
          children: [
            {
              type: "paragraph",
              children: phrasing(
                children(children(item)[0]!),
                diagnostics,
                path
              )!
            }
          ]
        }))
      }
    ]
  }
  if (value["type"] === "table") {
    const firstRow = child[0]
    const columnAlign: Array<unknown> = []
    const valid =
      firstRow !== undefined &&
      child.length > 0 &&
      child.every((row, rowIndex) =>
        children(row).every((cell, cellIndex) => {
          const cellAttrs = attrs(cell)
          const content = children(cell)
          if (rowIndex === 0 && cell["type"] !== "tableHeader") return false
          if (rowIndex > 0 && cell["type"] !== "tableCell") return false
          if (rowIndex === 0) columnAlign[cellIndex] = cellAttrs["align"]
          else if (columnAlign[cellIndex] !== cellAttrs["align"]) return false
          return (
            cellAttrs["colspan"] === 1 &&
            cellAttrs["rowspan"] === 1 &&
            cellAttrs["colwidth"] === null &&
            content.length === 1 &&
            content[0]?.["type"] === "paragraph" &&
            children(content[0]).length > 0 &&
            phrasing(children(content[0]), diagnostics, path) !== undefined
          )
        })
      )
    if (!valid) return undefined
    return [
      {
        type: "table",
        align: columnAlign as Array<"left" | "right" | "center" | null>,
        children: child.map((row) => ({
          type: "tableRow",
          children: children(row).map((cell) => ({
            type: "tableCell",
            children: phrasing(children(children(cell)[0]!), diagnostics, path)!
          }))
        }))
      }
    ]
  }
  return undefined
}

function exportNode(
  value: HnnJsonNode,
  diagnostics: MarkdownDiagnostic[],
  path: string
): Content[] {
  const nodeAttrs = attrs(value)
  if (value["type"] === "formula") {
    const latex = String(nodeAttrs["latex"])
    if (/\\begin|\\left|\n/u.test(latex))
      exportDiagnostic(
        diagnostics,
        value,
        path,
        "complex-formula-fallback",
        "复杂公式以 math 围栏导出，可能无法由所有目标忠实表达"
      )
    return namedFence("math", latex)
  }
  if (value["type"] === "directory") {
    exportDiagnostic(
      diagnostics,
      value,
      path,
      "directory-fallback",
      "目录以 HamsterNote 围栏导出，条目仍由文档标题派生"
    )
    return namedFence("directory", "")
  }
  if (value["type"] === "card") {
    if (/[`~]/u.test(String(nodeAttrs["data"])))
      return fallbackNode(
        value,
        diagnostics,
        path,
        "fence-payload-fallback",
        "卡片数据含围栏定界符，已改用可重组 base64url 围栏"
      )
    exportDiagnostic(
      diagnostics,
      value,
      path,
      "card-fallback",
      "卡片以 HamsterNote 数据围栏导出，需要目标支持该方言"
    )
    return namedFence("hamster-note-card", String(nodeAttrs["data"]))
  }
  if (value["type"] === "drawing") {
    if (/[`~]/u.test(String(nodeAttrs["data"])))
      return fallbackNode(
        value,
        diagnostics,
        path,
        "fence-payload-fallback",
        "画板数据含围栏定界符，已改用可重组 base64url 围栏"
      )
    exportDiagnostic(
      diagnostics,
      value,
      path,
      "drawing-fallback",
      "画板以 HamsterNote 数据围栏导出，需要目标支持该方言"
    )
    return namedFence("hamster-note-drawing", String(nodeAttrs["data"]))
  }
  const standard = standardBlock(value, diagnostics, path)
  if (standard) return standard
  const names: Record<string, string> = {
    callout: "提示框",
    card: "卡片",
    drawing: "画板",
    directory: "目录",
    collapsible: "折叠块",
    formula: "公式",
    table: "复杂表格",
    picture: "图片",
    blockquote: "带署名引用",
    orderedList: "特殊编号列表",
    bulletList: "复杂列表",
    taskList: "复杂任务列表",
    codeBlock: "带文件名代码块"
  }
  return fallbackNode(
    value,
    diagnostics,
    path,
    "node-fallback",
    `${names[String(value["type"])] ?? "自定义节点"} 已以可重组 HamsterNote 围栏导出`
  )
}

/** 显式导出前始终调用 encodeHnn；非法 PM Node 不能绕过 URL、ID、attrs 与大小校验。 */
export function exportMarkdown(
  input: HnnDocument | ProseMirrorNode
): MarkdownExportResult {
  const document =
    input instanceof ProseMirrorNode
      ? encodeHnn(input)
      : encodeHnn(decodeHnn(input))
  const root = document.data as HnnJsonNode
  const diagnostics: MarkdownDiagnostic[] = []
  const values = children(root)
  let tree: Root = {
    type: "root",
    children: values.flatMap((value, index) =>
      exportNode(value, diagnostics, pointer("/data/content", index))
    )
  }
  let markdown = markdownStringifier.stringify(tree)
  const roundTripsEquivalently = (candidate: string): boolean => {
    const result = importMarkdown(candidate)
    return (
      "document" in result &&
      structurallyEquivalentIgnoringNodeIds(root, result.document.data)
    )
  }
  if (!roundTripsEquivalently(markdown)) {
    // 只尝试一次完整文档 fallback：逐顶层节点给出定位诊断，避免导出/导入互相递归。
    tree = {
      type: "root",
      children: values.flatMap((value, index) =>
        fallbackNode(
          value,
          diagnostics,
          pointer("/data/content", index),
          "roundtrip-fallback",
          "标准 Markdown 回读后与原 HNN 结构不等价，已改为可重组围栏"
        )
      )
    }
    markdown = markdownStringifier.stringify(tree)
  }
  if (!roundTripsEquivalently(markdown))
    throw new Error(
      "Markdown 导出 fallback 回读后与原 HNN 结构不等价或超过安全预算"
    )
  return { markdown, diagnostics }
}
