import { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { HNN_LIMITS, HNN_SCHEMA_VERSION, UUID_V4_PATTERN } from "./limits"
import { HNN_MARK_TYPES, HNN_NODE_TYPES, hnnSchema } from "./schema"

export interface HnnDiagnostic {
  path: string
  code: string
  message: string
}

export interface HnnDocument {
  schemaVersion: typeof HNN_SCHEMA_VERSION
  data: Record<string, unknown>
}

/** 解码永不返回兜底文档；调用方必须显式处理原始内容无法读取的情形。 */
export class HnnCodecError extends Error {
  readonly diagnostics: readonly HnnDiagnostic[]

  constructor(diagnostics: readonly HnnDiagnostic[]) {
    super(diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("; "))
    this.name = "HnnCodecError"
    this.diagnostics = diagnostics
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }
type SnapshotFrame = { source: object; target: JsonObject | JsonValue[]; path: string; depth: number; isArray: boolean }
type ValidationFrame = { value: unknown; path: string; depth: number; parentType?: string; index?: number }
type JsonCountAction = { kind: "value"; value: JsonValue }

const METADATA_KEYS = new Set(["title", "summary", "tag", "time"])
const NODE_ID_TYPES = new Set([...HNN_NODE_TYPES].filter((type) => type !== "doc" && type !== "text"))
const INLINE_TYPES = new Set(["text", "hardBreak", "inlineFormula", "mention"])
const EMPTY_CONTENT_TYPES = new Set(["paragraph", "heading", "codeBlock"])
const MARK_RANK = new Map(["bold", "italic", "strike", "code", "link"].map((type, rank) => [type, rank]))
const ATOM_TYPES = new Set(["horizontalRule", "formula", "picture", "card", "drawing", "directory", "resource", "externalItem", "hardBreak", "inlineFormula", "mention"])
const BLOCK_CONTENT_TYPES = new Set([
  "paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock",
  "horizontalRule", "table", "taskList", "callout", "collapsible", "formula",
  "picture", "card", "drawing", "directory", "resource", "externalItem"
])
// JSON 结构会多于文档 node（attrs、marks 与 shell），但仍受固定预算限制。
const SNAPSHOT_WORK_LIMIT = HNN_LIMITS.maxNodes * 16
// 文档深度计 node，而 snapshot 还要经过 shell/data/content/attrs 数组与对象层。
const SNAPSHOT_DEPTH_LIMIT = HNN_LIMITS.maxDepth * 3
const UNSAFE_URL_CODE_POINT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u

function byteLength(value: string): number {
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
  }
  return bytes
}

/** 精确计算 JSON.stringify 对字符串产出的 UTF-8 大小，不分配转义后的字符串。 */
function jsonStringByteLength(value: string): number {
  let bytes = 2 // opening and closing quotes
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit === 0x22 || unit === 0x5c || unit === 0x08 || unit === 0x09 || unit === 0x0a || unit === 0x0c || unit === 0x0d) {
      bytes += 2
    } else if (unit < 0x20) {
      bytes += 6
    } else if (unit < 0x80) {
      bytes += 1
    } else if (unit < 0x800) {
      bytes += 2
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        // Well-formed JSON.stringify emits an escaped surrogate for unpaired units.
        bytes += 6
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

function jsonPrimitiveByteLength(value: JsonValue): number | undefined {
  if (typeof value === "string") return jsonStringByteLength(value)
  if (typeof value === "number") return Object.is(value, -0) ? 1 : byteLength(String(value))
  if (typeof value === "boolean") return value ? 4 : 5
  if (value === null) return 4
  return undefined
}

/**
 * 对已经受控的快照做迭代精确 JSON UTF-8 计数。超过 limit 即停止，因此不会为了
 * 发现一字节超限而构造完整序列化字符串或完整字节数组。
 */
function serializedJsonByteLength(value: JsonValue, limit: number): number | undefined {
  const actions: JsonCountAction[] = [{ kind: "value", value }]
  let bytes = 0
  const add = (amount: number): boolean => {
    bytes += amount
    return bytes <= limit
  }
  while (actions.length > 0) {
    const action = actions.pop()
    if (!action) break
    const primitiveBytes = jsonPrimitiveByteLength(action.value)
    if (primitiveBytes !== undefined) {
      if (!add(primitiveBytes)) return undefined
      continue
    }
    if (Array.isArray(action.value)) {
      if (!add(2)) return undefined
      for (let index = action.value.length - 1; index >= 0; index -= 1) {
        if (index < action.value.length - 1 && !add(1)) return undefined
        const item = action.value[index]
        if (item === undefined) return undefined
        actions.push({ kind: "value", value: item })
      }
      continue
    }
    const object = action.value as JsonObject
    const keys = Object.keys(object)
    if (!add(2)) return undefined
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]
      if (key === undefined) return undefined
      if (index < keys.length - 1 && !add(1)) return undefined
      if (!add(jsonStringByteLength(key) + 1)) return undefined
      const child = object[key]
      if (child === undefined) return undefined
      actions.push({ kind: "value", value: child })
    }
  }
  return bytes
}

function diagnostic(path: string, code: string, message: string): HnnCodecError {
  return new HnnCodecError([{ path, code, message }])
}

function isSnapshotObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function appendPath(path: string, key: string): string {
  return `${path}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`
}

function isArrayIndex(key: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key
}

/**
 * 对不可信输入仅进行一次描述符驱动的快照。后续所有语义校验只读取该快照，避免
 * validate -> clone 的 TOCTOU。无法令恶意 Proxy 无副作用，但 reflection trap、
 * accessor、符号键、洞、循环和非 JSON 图都会以 HnnCodecError 硬失败。
 */
function snapshotJson(input: unknown): JsonValue {
  const seen = new WeakSet<object>()
  let work = 0
  // 每项都是最终 JSON 输出的独立 token，因此该和是安全下界而非猜测。
  let lowerBoundBytes = 0

  const addLowerBound = (bytes: number, path: string): void => {
    lowerBoundBytes += bytes
    if (lowerBoundBytes > HNN_LIMITS.maxShellBytes) {
      throw diagnostic(path, "shell-too-large", `HNN 外壳超过 ${HNN_LIMITS.maxShellBytes} UTF-8 字节`)
    }
  }

  const copyPrimitive = (value: unknown, path: string): JsonValue => {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      const bytes = jsonPrimitiveByteLength(value)
      if (bytes === undefined) throw diagnostic(path, "unsafe-input", "无法计算 JSON 原始值大小")
      addLowerBound(bytes, path)
      return value
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const bytes = jsonPrimitiveByteLength(value)
      if (bytes === undefined) throw diagnostic(path, "unsafe-input", "无法计算 JSON 原始值大小")
      addLowerBound(bytes, path)
      return value
    }
    throw diagnostic(path, "unsafe-input", "输入必须是有限 JSON 原始值或纯 JSON 容器")
  }

  const copyContainer = (value: unknown, path: string, depth: number): { target: JsonObject | JsonValue[]; frame: SnapshotFrame } => {
    if (typeof value !== "object" || value === null) throw diagnostic(path, "unsafe-input", "容器必须是对象或数组")
    if (depth > SNAPSHOT_DEPTH_LIMIT) throw diagnostic(path, "snapshot-depth-limit", `输入结构深度超过 ${SNAPSHOT_DEPTH_LIMIT}`)
    if (seen.has(value)) throw diagnostic(path, "unsafe-input", "输入含循环或重复对象引用，不能作为 JSON 快照")
    seen.add(value)

    try {
      const isArray = Array.isArray(value)
      const prototype: unknown = Object.getPrototypeOf(value)
      if (prototype !== null) {
        const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, "constructor")
        const constructor: unknown = constructorDescriptor && "value" in constructorDescriptor
          ? constructorDescriptor.value
          : undefined
        const expectedConstructor = isArray ? "Array" : "Object"
        const nameDescriptor = typeof constructor === "function"
          ? Object.getOwnPropertyDescriptor(constructor, "name")
          : undefined
        const constructorName: unknown = nameDescriptor && "value" in nameDescriptor
          ? nameDescriptor.value
          : undefined
        if (constructorName !== expectedConstructor) {
          throw diagnostic(path, "unsafe-input", `${isArray ? "数组" : "对象"}必须使用 ${expectedConstructor} 或 null 原型`)
        }
        const parentPrototype: unknown = Object.getPrototypeOf(prototype)
        const allowedArrayPrototype =
          typeof parentPrototype === "object" &&
          parentPrototype !== null &&
          Object.getPrototypeOf(parentPrototype) === null
        if (isArray ? !allowedArrayPrototype : parentPrototype !== null) {
          throw diagnostic(path, "unsafe-input", `${isArray ? "数组" : "对象"}不得使用自定义原型`)
        }
      }
      const target: JsonObject | JsonValue[] = isArray ? [] : Object.create(null) as JsonObject
      return { target, frame: { source: value, target, path, depth, isArray } }
    } catch (error) {
      if (error instanceof HnnCodecError) throw error
      throw diagnostic(path, "unsafe-input", "无法安全检查输入对象的原型")
    }
  }

  let root: JsonValue
  const frames: SnapshotFrame[] = []
  if (typeof input === "object" && input !== null) {
    const container = copyContainer(input, "", 0)
    root = container.target
    frames.push(container.frame)
  } else {
    root = copyPrimitive(input, "")
  }

  while (frames.length > 0) {
    const frame = frames.pop()
    if (!frame) break
    let keys: readonly PropertyKey[]
    try {
      keys = Reflect.ownKeys(frame.source)
    } catch {
      throw diagnostic(frame.path, "unsafe-input", "无法安全枚举输入对象字段")
    }

    if (frame.isArray) {
      let length = 0
      try {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(frame.source, "length")
        if (!lengthDescriptor || "get" in lengthDescriptor || "set" in lengthDescriptor || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
          throw diagnostic(frame.path, "unsafe-input", "数组 length 必须是普通非负整数数据属性")
        }
        length = lengthDescriptor.value
      } catch (error) {
        if (error instanceof HnnCodecError) throw error
        throw diagnostic(frame.path, "unsafe-input", "无法安全检查数组 length")
      }
      for (const key of keys) {
        if (key === "length") continue
        if (typeof key !== "string" || !isArrayIndex(key) || Number(key) >= length) {
          throw diagnostic(frame.path, "unsafe-input", "数组不得包含符号键、洞外索引或非索引自有属性")
        }
      }
      for (let index = 0; index < length; index += 1) {
        const key = String(index)
        let descriptor: PropertyDescriptor | undefined
        try {
          descriptor = Object.getOwnPropertyDescriptor(frame.source, key)
        } catch {
          throw diagnostic(appendPath(frame.path, key), "unsafe-input", "无法安全读取数组元素描述符")
        }
        if (!descriptor) throw diagnostic(appendPath(frame.path, key), "unsafe-input", "数组不得包含空洞")
        if ("get" in descriptor || "set" in descriptor || !descriptor.enumerable) {
          throw diagnostic(appendPath(frame.path, key), "unsafe-input", "数组元素必须是可枚举数据属性，不能使用 accessor")
        }
        work += 1
        if (work > SNAPSHOT_WORK_LIMIT) throw diagnostic(appendPath(frame.path, key), "snapshot-work-limit", `输入结构超过 ${SNAPSHOT_WORK_LIMIT} 项工作预算`)
        const childPath = appendPath(frame.path, key)
        const value: unknown = descriptor.value
        if (typeof value === "object" && value !== null) {
          const child = copyContainer(value, childPath, frame.depth + 1)
          ;(frame.target as JsonValue[])[index] = child.target
          frames.push(child.frame)
        } else {
          ;(frame.target as JsonValue[])[index] = copyPrimitive(value, childPath)
        }
      }
      continue
    }

    for (const key of keys) {
      if (typeof key !== "string") throw diagnostic(frame.path, "unsafe-input", "对象不得包含 symbol 键")
      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Object.getOwnPropertyDescriptor(frame.source, key)
      } catch {
        throw diagnostic(appendPath(frame.path, key), "unsafe-input", "无法安全读取对象字段描述符")
      }
      if (!descriptor || "get" in descriptor || "set" in descriptor || !descriptor.enumerable) {
        throw diagnostic(appendPath(frame.path, key), "unsafe-input", "对象字段必须是可枚举数据属性，不能使用 accessor")
      }
      const childPath = appendPath(frame.path, key)
      addLowerBound(jsonStringByteLength(key) + 1, childPath)
      work += 1
      if (work > SNAPSHOT_WORK_LIMIT) throw diagnostic(appendPath(frame.path, key), "snapshot-work-limit", `输入结构超过 ${SNAPSHOT_WORK_LIMIT} 项工作预算`)
      const value: unknown = descriptor.value
      if (typeof value === "object" && value !== null) {
        const child = copyContainer(value, childPath, frame.depth + 1)
        Object.defineProperty(frame.target, key, { value: child.target, enumerable: true, configurable: true, writable: true })
        frames.push(child.frame)
      } else {
        Object.defineProperty(frame.target, key, { value: copyPrimitive(value, childPath), enumerable: true, configurable: true, writable: true })
      }
    }
  }
  return root
}

function cloneJson(value: JsonValue): JsonValue {
  // 此处 value 已由本模块产生，深度与 work budget 已有界，非调用方原始对象。
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function structuralEqual(left: unknown, right: unknown): boolean {
  const stack: Array<[unknown, unknown]> = [[left, right]]
  while (stack.length > 0) {
    const pair = stack.pop()
    if (!pair) break
    const [currentLeft, currentRight] = pair
    if (Object.is(currentLeft, currentRight)) continue
    if (Array.isArray(currentLeft) && Array.isArray(currentRight)) {
      if (currentLeft.length !== currentRight.length) return false
      for (let index = 0; index < currentLeft.length; index += 1) stack.push([currentLeft[index], currentRight[index]])
      continue
    }
    if (isSnapshotObject(currentLeft) && isSnapshotObject(currentRight)) {
      const leftKeys = Object.keys(currentLeft).sort()
      const rightKeys = Object.keys(currentRight).sort()
      if (leftKeys.length !== rightKeys.length) return false
      for (let index = 0; index < leftKeys.length; index += 1) {
        const key = leftKeys[index]
        if (key === undefined || key !== rightKeys[index]) return false
        stack.push([currentLeft[key], currentRight[key]])
      }
      continue
    }
    return false
  }
  return true
}

/** URL 输入已经是快照字符串；统一按 UTF-16 code unit 检查所有不允许字符。 */
function hasUnsafeUrlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      const character = value.slice(index, index + 2)
      if (UNSAFE_URL_CODE_POINT.test(character)) return true
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
    else if (UNSAFE_URL_CODE_POINT.test(value[index] ?? "")) return true
  }
  return false
}

class Validator {
  readonly diagnostics: HnnDiagnostic[] = []
  readonly nodeIds = new Set<string>()
  nodeCount = 0

  error(path: string, code: string, message: string): void {
    this.diagnostics.push({ path, code, message })
  }

  objectKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.error(appendPath(path, key), "unknown-key", `不允许的字段 ${key}`)
    }
  }

  requiredString(value: unknown, path: string, maxBytes: number, label: string): value is string {
    if (typeof value !== "string") {
      this.error(path, "invalid-attr", `${label} 必须是字符串`)
      return false
    }
    if (value.trim().length === 0) {
      this.error(path, "invalid-attr", `${label} 不得为空`)
      return false
    }
    if (byteLength(value) > maxBytes) this.error(path, "attr-too-large", `${label} 超过 ${maxBytes} UTF-8 字节`)
    return true
  }

  attrSize(value: unknown, path: string): void {
    // value 来自受控 snapshot，因此 stringify 不会读调用方对象或遭遇无界图。
    const bytes = byteLength(JSON.stringify(value))
    if (bytes > HNN_LIMITS.maxAttrBytes) this.error(path, "attr-too-large", `attr 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`)
  }

  validateUrl(value: unknown, path: string): void {
    if (!this.requiredString(value, path, HNN_LIMITS.maxAttrBytes, "URL")) return
    if (hasUnsafeUrlCharacters(value) || value.trim() !== value) {
      this.error(path, "unsafe-url", "URL 不得包含控制字符、默认忽略字符、双向控制字符、未配对代理项或首尾空白")
      return
    }
    try {
      const parsed = new URL(value)
      if (!["http:", "https:", "mailto:", "hnmagic:"].includes(parsed.protocol) || !value.startsWith(parsed.protocol)) {
        this.error(path, "unsafe-url", "URL 协议仅允许 http:、https:、mailto: 或 hnmagic:")
      }
    } catch {
      this.error(path, "unsafe-url", "URL 必须为带白名单协议的绝对 URL")
    }
  }

  validateAttrs(type: string, attrs: unknown, path: string): void {
    if (!isSnapshotObject(attrs)) {
      this.error(path, "invalid-attrs", "attrs 必须是纯对象")
      return
    }
    const expected = ["nodeId"]
    if (type === "heading") expected.push("level")
    if (type === "orderedList") expected.push("start")
    if (type === "taskItem") expected.push("checked")
    if (type === "codeBlock") expected.push("language", "filename")
    if (type === "callout") expected.push("tone", "title")
    if (type === "collapsible") expected.push("title", "collapsed")
    if (type === "formula" || type === "inlineFormula") expected.push("latex")
    if (type === "picture") expected.push("src", "alt")
    if (type === "card" || type === "drawing") expected.push("data")
    if (type === "directory") expected.push("config")
    if (type === "mention" || type === "resource" || type === "externalItem") expected.push("resourceId", "name")
    this.objectKeys(attrs, expected, path)
    for (const key of expected) {
      if (!(key in attrs)) this.error(appendPath(path, key), "missing-attr", `缺少必填 attr ${key}`)
      else this.attrSize(attrs[key], appendPath(path, key))
    }

    const nodeId = attrs["nodeId"]
    if (this.requiredString(nodeId, `${path}/nodeId`, HNN_LIMITS.maxIdentifierBytes, "nodeId")) {
      if (!UUID_V4_PATTERN.test(nodeId)) this.error(`${path}/nodeId`, "invalid-node-id", "nodeId 必须是小写 UUID v4")
      else if (this.nodeIds.has(nodeId)) this.error(`${path}/nodeId`, "duplicate-node-id", "nodeId 在文档中必须唯一")
      else this.nodeIds.add(nodeId)
    }
    if (type === "heading" && !(Number.isInteger(attrs["level"]) && (attrs["level"] as number) >= 1 && (attrs["level"] as number) <= 6)) this.error(`${path}/level`, "invalid-attr", "heading level 必须为 1 到 6 的整数")
    if (type === "orderedList" && !(Number.isInteger(attrs["start"]) && (attrs["start"] as number) >= 1)) this.error(`${path}/start`, "invalid-attr", "orderedList start 必须为正整数")
    if (type === "taskItem" && typeof attrs["checked"] !== "boolean") this.error(`${path}/checked`, "invalid-attr", "checked 必须是布尔值")
    if (type === "collapsible") {
      this.requiredString(attrs["title"], `${path}/title`, HNN_LIMITS.maxLabelBytes, "collapsible title")
      if (typeof attrs["collapsed"] !== "boolean") this.error(`${path}/collapsed`, "invalid-attr", "collapsed 必须是布尔值")
    }
    if (type === "callout") {
      if (!["info", "success", "warning"].includes(attrs["tone"] as string)) this.error(`${path}/tone`, "invalid-attr", "callout tone 仅允许 info、success 或 warning")
      this.requiredString(attrs["title"], `${path}/title`, HNN_LIMITS.maxLabelBytes, "callout title")
    }
    if (type === "codeBlock") {
      this.requiredString(attrs["language"], `${path}/language`, HNN_LIMITS.maxIdentifierBytes, "codeBlock language")
      this.requiredString(attrs["filename"], `${path}/filename`, HNN_LIMITS.maxLabelBytes, "codeBlock filename")
    }
    if (type === "formula" || type === "inlineFormula") this.requiredString(attrs["latex"], `${path}/latex`, HNN_LIMITS.maxAttrBytes, "latex")
    if (type === "picture") {
      this.validateUrl(attrs["src"], `${path}/src`)
      this.requiredString(attrs["alt"], `${path}/alt`, HNN_LIMITS.maxLabelBytes, "picture alt")
    }
    if (type === "card" || type === "drawing") this.requiredString(attrs["data"], `${path}/data`, HNN_LIMITS.maxAttrBytes, `${type} data`)
    if (type === "directory") this.requiredString(attrs["config"], `${path}/config`, HNN_LIMITS.maxAttrBytes, "directory config")
    if (type === "mention" || type === "resource" || type === "externalItem") {
      this.requiredString(attrs["resourceId"], `${path}/resourceId`, HNN_LIMITS.maxIdentifierBytes, "resourceId")
      this.requiredString(attrs["name"], `${path}/name`, HNN_LIMITS.maxLabelBytes, "name")
    }
  }

  validateMarks(value: unknown, path: string): void {
    if (!Array.isArray(value)) {
      this.error(path, "invalid-marks", "marks 必须是数组")
      return
    }
    const seen = new Set<string>()
    let previousRank = -1
    for (let index = 0; index < value.length; index += 1) {
      const markPath = `${path}/${index}`
      const mark: unknown = value[index]
      if (!isSnapshotObject(mark)) {
        this.error(markPath, "invalid-mark", "mark 必须是纯对象")
        continue
      }
      const type = mark["type"]
      this.objectKeys(mark, type === "link" ? ["type", "attrs"] : ["type"], markPath)
      if (typeof type !== "string" || !HNN_MARK_TYPES.has(type)) {
        this.error(`${markPath}/type`, "unknown-mark", `不支持的 mark ${String(type)}`)
        continue
      }
      if (seen.has(type)) this.error(`${markPath}/type`, "duplicate-mark", `重复的 mark ${type}`)
      seen.add(type)
      const rank = MARK_RANK.get(type)
      if (rank === undefined || rank <= previousRank) this.error(markPath, "non-canonical-mark-order", "marks 必须按 schema rank 严格递增")
      previousRank = rank ?? previousRank
      if (type === "link") {
        const attrs = mark["attrs"]
        if (!isSnapshotObject(attrs)) this.error(`${markPath}/attrs`, "invalid-attrs", "link attrs 必须是纯对象")
        else {
          this.objectKeys(attrs, ["href"], `${markPath}/attrs`)
          if (!("href" in attrs)) this.error(`${markPath}/attrs/href`, "missing-attr", "缺少 link href")
          else {
            this.attrSize(attrs["href"], `${markPath}/attrs/href`)
            this.validateUrl(attrs["href"], `${markPath}/attrs/href`)
          }
        }
      }
    }
    if (seen.has("code") && value.length !== 1) this.error(path, "excluded-mark", "code mark 不得与其他 mark 同时出现")
  }

  validateDocument(root: unknown): void {
    const stack: ValidationFrame[] = [{ value: root, path: "/data", depth: 1 }]
    while (stack.length > 0) {
      const frame = stack.pop()
      if (!frame) break
      this.nodeCount += 1
      if (this.nodeCount > HNN_LIMITS.maxNodes) {
        this.error(frame.path, "node-limit", `节点总数超过 ${HNN_LIMITS.maxNodes}`)
        continue
      }
      if (frame.depth > HNN_LIMITS.maxDepth) {
        this.error(frame.path, "depth-limit", `文档深度超过 ${HNN_LIMITS.maxDepth}`)
        continue
      }
      if (!isSnapshotObject(frame.value)) {
        this.error(frame.path, "invalid-node", "节点必须是纯对象")
        continue
      }
      const type = frame.value["type"]
      if (typeof type !== "string" || !HNN_NODE_TYPES.has(type)) {
        this.error(`${frame.path}/type`, "unknown-node", `不支持的节点 ${String(type)}`)
        continue
      }
      if (frame.path === "/data" && type !== "doc") {
        this.error(`${frame.path}/type`, "invalid-root", "data 根节点必须为 type: doc")
        continue
      }
      const allowed = type === "text" ? ["type", "text", "marks"] : ["type", "attrs", "content", "marks"]
      this.objectKeys(frame.value, allowed, frame.path)
      if (type === "text") {
        const text = frame.value["text"]
        if (typeof text !== "string" || text.length === 0) this.error(`${frame.path}/text`, "invalid-text", "text 节点必须包含非空字符串 text")
        else if (byteLength(text) > HNN_LIMITS.maxAttrBytes) this.error(`${frame.path}/text`, "attr-too-large", `text 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`)
        if (frame.value["marks"] !== undefined) {
          if (frame.parentType === "codeBlock") this.error(`${frame.path}/marks`, "forbidden-mark", "codeBlock 内 text 不得包含 marks")
          else this.validateMarks(frame.value["marks"], `${frame.path}/marks`)
        }
        continue
      }
      if (type === "doc" && frame.value["attrs"] !== undefined) this.error(`${frame.path}/attrs`, "forbidden-attrs", "doc 不得包含 attrs")
      if (NODE_ID_TYPES.has(type)) this.validateAttrs(type, frame.value["attrs"], `${frame.path}/attrs`)
      if (frame.value["marks"] !== undefined) this.error(`${frame.path}/marks`, "forbidden-mark", `${type} 节点不得直接带 marks`)
      const content = frame.value["content"]
      if (ATOM_TYPES.has(type)) {
        if (content !== undefined) this.error(`${frame.path}/content`, "invalid-content", `${type} 是原子节点且不得包含 content`)
        continue
      }
      if (content === undefined && EMPTY_CONTENT_TYPES.has(type)) continue
      if (!Array.isArray(content)) {
        this.error(`${frame.path}/content`, "missing-content", `${type} 必须包含 content 数组`)
        continue
      }
      if (content.length === 0) {
        this.error(`${frame.path}/content`, EMPTY_CONTENT_TYPES.has(type) ? "non-canonical" : "invalid-content", EMPTY_CONTENT_TYPES.has(type) ? `${type} 的空内容必须省略 content 字段` : `${type} 必须包含至少一个子节点`)
        continue
      }
      for (let index = content.length - 1; index >= 0; index -= 1) {
        const child: unknown = content[index]
        const childPath = `${frame.path}/content/${index}`
        const childType = isSnapshotObject(child) ? child["type"] : undefined
        if (!this.isAllowedChild(type, childType, index)) this.error(childPath, "invalid-nesting", `${String(childType)} 不允许作为 ${type} 的子节点`)
        stack.push({ value: child, path: childPath, depth: frame.depth + 1, parentType: type, index })
      }
    }
  }

  isAllowedChild(parent: string, childType: unknown, index: number): boolean {
    if (typeof childType !== "string") return false
    if (["doc", "blockquote", "callout", "collapsible", "tableCell", "tableHeader"].includes(parent)) return BLOCK_CONTENT_TYPES.has(childType)
    if (parent === "bulletList" || parent === "orderedList") return childType === "listItem"
    if (parent === "taskList") return childType === "taskItem"
    if (parent === "listItem" || parent === "taskItem") return index === 0 ? childType === "paragraph" : BLOCK_CONTENT_TYPES.has(childType)
    if (parent === "table") return childType === "tableRow"
    if (parent === "tableRow") return childType === "tableHeader" || childType === "tableCell"
    if (parent === "paragraph" || parent === "heading") return INLINE_TYPES.has(childType)
    return parent === "codeBlock" && childType === "text"
  }
}

function validateShell(input: unknown): JsonObject {
  const snapshot = snapshotJson(input)
  if (!isSnapshotObject(snapshot)) throw diagnostic("/", "invalid-shell", "HNN 外壳必须是纯 JSON 对象")
  if (serializedJsonByteLength(snapshot, HNN_LIMITS.maxShellBytes) === undefined) {
    throw diagnostic("/", "shell-too-large", `HNN 外壳超过 ${HNN_LIMITS.maxShellBytes} UTF-8 字节`)
  }
  const validator = new Validator()
  validator.objectKeys(snapshot, ["schemaVersion", "data"], "")
  if (snapshot["schemaVersion"] !== HNN_SCHEMA_VERSION) validator.error("/schemaVersion", "unsupported-version", `schemaVersion 必须为 ${HNN_SCHEMA_VERSION}`)
  if (!("data" in snapshot)) validator.error("/data", "missing-data", "缺少 data")
  const data = snapshot["data"]
  if (isSnapshotObject(data)) {
    for (const metadata of METADATA_KEYS) {
      if (metadata in data) validator.error(`/data/${metadata}`, "forbidden-metadata", `data 不得包含笔记级字段 ${metadata}`)
    }
  }
  validator.validateDocument(data)
  if (validator.diagnostics.length > 0) throw new HnnCodecError(validator.diagnostics)
  return snapshot
}

/** 解码并以 ProseMirror 进行最终结构回退检查；失败永远抛出 HnnCodecError。 */
export function decodeHnn(input: unknown): ProseMirrorNode {
  const snapshot = validateShell(input)
  const data = snapshot["data"] as JsonObject
  try {
    const document = hnnSchema.nodeFromJSON(data)
    if (document.type !== hnnSchema.topNodeType) throw diagnostic("/data/type", "invalid-root", "ProseMirror 根节点必须为 schema topNode doc")
    document.check()
    const canonical: unknown = document.toJSON()
    if (!structuralEqual(canonical, data)) throw diagnostic("/data", "non-canonical", "HNN data 不是该封闭 schema 的规范 JSON 形式；请使用 codec 输出的 JSON")
    return document
  } catch (error) {
    if (error instanceof HnnCodecError) throw error
    throw diagnostic("/data", "schema-invalid", error instanceof Error ? error.message : "ProseMirror schema 校验失败")
  }
}

/** 编码接受 PM Node 或 closed JSON doc；输出始终经同一严格 decode 验证并深拷贝。 */
export function encodeHnn(input: ProseMirrorNode | Record<string, unknown>): HnnDocument {
  const data = input instanceof ProseMirrorNode ? input.toJSON() as Record<string, unknown> : input
  const document = decodeHnn({ schemaVersion: HNN_SCHEMA_VERSION, data })
  return {
    schemaVersion: HNN_SCHEMA_VERSION,
    data: cloneJson(document.toJSON() as JsonValue) as Record<string, unknown>
  }
}
