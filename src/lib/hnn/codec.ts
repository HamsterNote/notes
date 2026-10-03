import { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { TableMap } from "@tiptap/pm/tables"
import { HNN_LIMITS, HNN_SCHEMA_VERSION, HNN_TABLE_LIMITS, UUID_V4_PATTERN } from "./limits"
import { HNN_MARK_TYPES, HNN_NODE_TYPES, hnnSchema } from "./schema"
import { jsonCharBytes, jsonStringBytes, utf8Bytes, utf8CharBytes } from "./stringBytes"
import { isSafeHnnUrl } from "./urlPolicy"

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
type SnapshotFrame = { source: object; target: JsonObject | JsonValue[]; path: string; depth: number; isArray: boolean; ancestors: readonly object[] }
type ValidationFrame = { value: unknown; path: string; depth: number; parentType?: string; index?: number }
type JsonCountAction = { kind: "value"; value: JsonValue }
type TablePath = { path: string }
type ProseMirrorPreflightFrame = { node: ProseMirrorNode; path: string; depth: number; nextChildIndex: number; childCount: number }

const METADATA_KEYS = new Set(["title", "summary", "tag", "time"])
const NODE_ID_TYPES = new Set([...HNN_NODE_TYPES].filter((type) => type !== "doc" && type !== "text"))
const INLINE_TYPES = new Set(["text", "hardBreak", "inlineFormula", "mention"])
const EMPTY_CONTENT_TYPES = new Set(["paragraph", "heading", "codeBlock"])
const MARK_RANK = new Map(Object.keys(hnnSchema.marks).map((type, rank) => [type, rank]))
const ATOM_TYPES = new Set(["horizontalRule", "formula", "picture", "card", "drawing", "directory", "resource", "externalItem", "hardBreak", "inlineFormula", "mention"])
const BLOCK_CONTENT_TYPES = new Set([
  "paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock",
  "horizontalRule", "table", "taskList", "callout", "collapsible", "formula",
  "picture", "card", "drawing", "directory", "externalItem"
])
// JSON 结构会多于文档 node（attrs、marks 与 shell），但仍受固定预算限制。
const SNAPSHOT_WORK_LIMIT = HNN_LIMITS.maxNodes * 16
// 文档深度计 node，而 snapshot 还要经过 shell/data/content/attrs 数组与对象层。
const SNAPSHOT_DEPTH_LIMIT = HNN_LIMITS.maxDepth * 3
// PM Node 入口在 toJSON 前只允许最终 512 KiB 外壳的两倍线性扫描工作，另加每个
// 节点的固定结构访问预算。一次字符扫描与固定字段访问会重叠，但该上界仍有界，且
// 允许临界合法文档完成预检而不是因计数自身的常数开销被提前拒绝。
const PROSEMIRROR_PREFLIGHT_WORK_LIMIT = HNN_LIMITS.maxShellBytes * 2 + HNN_LIMITS.maxNodes * 16

// 字符串字节宽度表统一定义在 ./stringBytes（codec 严格校验与编辑器 UI 预检共用，避免口径漂移）。

function jsonPrimitiveByteLength(value: JsonValue): number | undefined {
  if (typeof value === "string") return jsonStringBytes(value)
  if (typeof value === "number") return Object.is(value, -0) ? 1 : utf8Bytes(String(value))
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
      if (!add(jsonStringBytes(key) + 1)) return undefined
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

/**
 * 在调用 ProseMirror 的 toJSON 前精确预计算 canonical JSON 的 UTF-8 大小。
 *
 * 这条路径只读取 Node、Mark 和 attr 的数据字段，绝不调用输入实例的 toJSON。attrs
 * 若不能以有界的 JSON 原始值/原始值数组安全计数便直接失败；成功后的完整 schema 和
 * canonical 校验仍由 decodeHnn 负责。
 */
function preflightProseMirrorNode(root: ProseMirrorNode): void {
  const stack: ProseMirrorPreflightFrame[] = []
  let nodeCount = 0
  let work = 0
  let serializedBytes = utf8Bytes('{"schemaVersion":1,"data":}')

  const consume = (path: string, amount = 1): void => {
    work += amount
    if (work > PROSEMIRROR_PREFLIGHT_WORK_LIMIT) {
      throw diagnostic(path, "pm-preflight-work-limit", `ProseMirror 编码预检超过 ${PROSEMIRROR_PREFLIGHT_WORK_LIMIT} 项工作预算`)
    }
  }

  const addBytes = (path: string, bytes: number): void => {
    serializedBytes += bytes
    if (serializedBytes > HNN_LIMITS.maxShellBytes) {
      throw diagnostic(path, "shell-too-large", `HNN 外壳超过 ${HNN_LIMITS.maxShellBytes} UTF-8 字节`)
    }
  }

  // 宽度表来自 ./stringBytes 共享工具；此处只保留逐字符 consume 预算与超限即停的流式外壳。
  const boundedUtf8Bytes = (value: string, path: string, label: string): number => {
    let bytes = 0
    for (let index = 0; index < value.length;) {
      consume(path)
      const step = utf8CharBytes(value, index)
      bytes += step.bytes
      index += step.units
      if (bytes > HNN_LIMITS.maxAttrBytes) throw diagnostic(path, "attr-too-large", `${label} 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`)
    }
    return bytes
  }

  const boundedJsonStringBytes = (value: string, path: string, limit?: number): number => {
    let bytes = 2
    for (let index = 0; index < value.length;) {
      consume(path)
      const step = jsonCharBytes(value, index)
      bytes += step.bytes
      index += step.units
      if (limit !== undefined && bytes > limit) throw diagnostic(path, "attr-too-large", `attr 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`)
    }
    return bytes
  }

  /** attrs 的闭合 schema 当前只需要 JSON 原始值和 colwidth 的原始值数组。 */
  const attrValueBytes = (value: unknown, path: string): number => {
    if (typeof value === "string") return boundedJsonStringBytes(value, path, HNN_LIMITS.maxAttrBytes)
    const primitiveBytes = value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
      ? jsonPrimitiveByteLength(value)
      : undefined
    if (primitiveBytes !== undefined) return primitiveBytes
    if (!Array.isArray(value)) throw diagnostic(path, "unsafe-pm-attrs", "ProseMirror attr 必须是有限 JSON 原始值或原始值数组")
    let length: number
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, "length")
      if (!descriptor || "get" in descriptor || "set" in descriptor || typeof descriptor.value !== "number" || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) {
        throw diagnostic(path, "unsafe-pm-attrs", "ProseMirror attr 数组 length 必须是非负安全整数数据属性")
      }
      length = descriptor.value
    } catch (error) {
      if (error instanceof HnnCodecError) throw error
      throw diagnostic(path, "unsafe-pm-attrs", "无法安全读取 ProseMirror attr 数组 length")
    }

    // 每项至少一个 JSON 字节；先排除伪造的大 length，避免进入长循环。
    if (length > Math.floor((HNN_LIMITS.maxAttrBytes - 2) / 2) + 1) {
      throw diagnostic(path, "attr-too-large", `attr 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`)
    }
    let attrBytes = 2
    for (let index = 0; index < length; index += 1) {
      consume(path)
      const itemPath = `${path}/${index}`
      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      } catch {
        throw diagnostic(itemPath, "unsafe-pm-attrs", "无法安全读取 ProseMirror attr 数组项")
      }
      if (!descriptor || "get" in descriptor || "set" in descriptor) throw diagnostic(itemPath, "unsafe-pm-attrs", "ProseMirror attr 数组项必须是数据属性")
      if (index > 0) {
        attrBytes += 1
      }
      const item: unknown = descriptor.value
      if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)) || typeof item === "string") {
        const itemBytes = typeof item === "string" ? boundedJsonStringBytes(item, itemPath, HNN_LIMITS.maxAttrBytes) : jsonPrimitiveByteLength(item)
        if (itemBytes === undefined) throw diagnostic(itemPath, "unsafe-pm-attrs", "无法计算 ProseMirror attr 数组项大小")
        attrBytes += itemBytes
        if (attrBytes > HNN_LIMITS.maxAttrBytes) throw diagnostic(path, "attr-too-large", `attr 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`)
      } else throw diagnostic(itemPath, "unsafe-pm-attrs", "ProseMirror attr 数组项必须是有限 JSON 原始值")
    }
    // JSON.stringify 会忽略非索引属性；预检选择 fail closed，避免未知数据路径。
    for (const key of Reflect.ownKeys(value)) {
      consume(path)
      if (key === "length") continue
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length) {
        throw diagnostic(path, "unsafe-pm-attrs", "ProseMirror attr 数组不得包含 symbol 或非索引字段")
      }
    }
    return attrBytes
  }

  /** 不复制 attrs；逐个数据描述符计数，并拒绝未知或继承字段。 */
  const attrsBytes = (value: unknown, expectedAttrs: Record<string, unknown>, path: string): number | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw diagnostic(path, "unsafe-pm-attrs", "ProseMirror attrs 必须是对象")
    let bytes = 2
    let count = 0
    try {
      // Node.toJSON 使用 for...in；先单独检查 own keys，避免非枚举或 symbol 字段在
      // 实例被篡改时逃过“严格可 JSON 表达”的预检。
      for (const key of Reflect.ownKeys(value)) {
        consume(path)
        if (typeof key !== "string" || !(key in expectedAttrs)) throw diagnostic(path, "unsafe-pm-attrs", "ProseMirror attrs 不得包含 symbol 或未知字段")
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || "get" in descriptor || "set" in descriptor || !descriptor.enumerable) throw diagnostic(`${path}/${key}`, "unsafe-pm-attrs", "ProseMirror attr 必须是可枚举数据属性")
      }
      for (const key in value) {
        consume(path)
        if (!Object.hasOwn(value, key) || !(key in expectedAttrs)) throw diagnostic(`${path}/${key}`, "unsafe-pm-attrs", "ProseMirror attrs 包含未知或继承字段")
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || "get" in descriptor || "set" in descriptor || !descriptor.enumerable) throw diagnostic(`${path}/${key}`, "unsafe-pm-attrs", "ProseMirror attr 必须是可枚举数据属性")
        const valueBytes = attrValueBytes(descriptor.value, `${path}/${key}`)
        bytes += (count > 0 ? 1 : 0) + jsonStringBytes(key) + 1 + valueBytes
        count += 1
      }
    } catch (error) {
      if (error instanceof HnnCodecError) throw error
      throw diagnostic(path, "unsafe-pm-attrs", "无法安全读取 ProseMirror attrs")
    }
    return count > 0 ? bytes : undefined
  }

  const markBytes = (mark: unknown, path: string): number => {
    if (!mark || typeof mark !== "object") throw diagnostic(path, "unsafe-pm-node", "ProseMirror mark 必须是对象")
    const markValue = mark as { type?: { name?: unknown }; attrs?: unknown }
    const type = markValue.type?.name
    if (typeof type !== "string" || !HNN_MARK_TYPES.has(type)) throw diagnostic(`${path}/type`, "unknown-mark", `不支持的 mark ${String(type)}`)
    const expectedAttrs = hnnSchema.marks[type]?.spec.attrs ?? {}
    const attrs = attrsBytes(markValue.attrs, expectedAttrs, `${path}/attrs`)
    return 2 + jsonStringBytes("type") + 1 + jsonStringBytes(type) + (attrs === undefined ? 0 : 1 + jsonStringBytes("attrs") + 1 + attrs)
  }

  const enter = (node: ProseMirrorNode, path: string, depth: number): ProseMirrorPreflightFrame => {
    consume(path)
    nodeCount += 1
    if (nodeCount > HNN_LIMITS.maxNodes) throw diagnostic(path, "node-limit", `节点总数超过 ${HNN_LIMITS.maxNodes}`)
    if (depth > HNN_LIMITS.maxDepth) throw diagnostic(path, "depth-limit", `文档深度超过 ${HNN_LIMITS.maxDepth}`)

    const type = node.type.name
    if (!HNN_NODE_TYPES.has(type)) throw diagnostic(`${path}/type`, "unknown-node", `不支持的节点 ${type}`)
    let nodeBytes = 2 + jsonStringBytes("type") + 1 + jsonStringBytes(type)
    let properties = 1

    if (node.isText) {
      const value = node.text
      if (typeof value !== "string") throw diagnostic(`${path}/text`, "unsafe-pm-node", "ProseMirror text 节点必须包含字符串")
      boundedUtf8Bytes(value, `${path}/text`, "text")
      nodeBytes += 1 + jsonStringBytes("text") + 1 + boundedJsonStringBytes(value, `${path}/text`)
      properties += 1
    }

    const attrs = attrsBytes(node.attrs, hnnSchema.nodes[type]?.spec.attrs ?? {}, `${path}/attrs`)
    if (attrs !== undefined) {
      nodeBytes += 1 + jsonStringBytes("attrs") + 1 + attrs
      properties += 1
    }

    const childCount = node.childCount
    if (!Number.isSafeInteger(childCount) || childCount < 0) throw diagnostic(`${path}/content`, "unsafe-pm-node", "ProseMirror childCount 必须是非负安全整数")
    // 先以 childCount 判断，宽树不读取子节点、更不会为每个子节点创建栈帧。
    if (childCount > HNN_LIMITS.maxNodes - nodeCount) throw diagnostic(`${path}/content`, "node-limit", `节点总数超过 ${HNN_LIMITS.maxNodes}`)
    if (childCount > 0) {
      nodeBytes += 1 + jsonStringBytes("content") + 1 + 2 + childCount - 1
      properties += 1
    }

    const marks = node.marks
    if (!Array.isArray(marks) || !Number.isSafeInteger(marks.length) || marks.length < 0) throw diagnostic(`${path}/marks`, "unsafe-pm-node", "ProseMirror marks 必须是数组")
    if (marks.length > 0) {
      // 每个 mark 至少为 {"type":"x"}，先拦住不可能装入 shell 的伪造 length。
      if (marks.length > Math.floor((HNN_LIMITS.maxShellBytes - serializedBytes) / 12)) throw diagnostic(`${path}/marks`, "shell-too-large", `HNN 外壳超过 ${HNN_LIMITS.maxShellBytes} UTF-8 字节`)
      let marksBytes = 2 + marks.length - 1
      for (let index = 0; index < marks.length; index += 1) {
        consume(`${path}/marks/${index}`)
        marksBytes += markBytes(marks[index], `${path}/marks/${index}`)
        if (marksBytes > HNN_LIMITS.maxShellBytes - serializedBytes) throw diagnostic(`${path}/marks`, "shell-too-large", `HNN 外壳超过 ${HNN_LIMITS.maxShellBytes} UTF-8 字节`)
      }
      nodeBytes += 1 + jsonStringBytes("marks") + 1 + marksBytes
      properties += 1
    }
    // properties 的累计保留在这里，明确 object field 的逗号已由上述每个可选字段计入。
    void properties
    addBytes(path, nodeBytes)
    return { node, path, depth, nextChildIndex: 0, childCount }
  }

  stack.push(enter(root, "/data", 1))
  while (stack.length > 0) {
    const frame = stack.at(-1)
    if (!frame) break
    if (frame.nextChildIndex >= frame.childCount) {
      stack.pop()
      continue
    }
    const index = frame.nextChildIndex
    frame.nextChildIndex += 1
    const childPath = `${frame.path}/content/${index}`
    consume(childPath)
    let child: ProseMirrorNode
    try {
      child = frame.node.child(index)
    } catch {
      throw diagnostic(childPath, "unsafe-pm-node", "无法安全读取 ProseMirror 子节点")
    }
    stack.push(enter(child, childPath, frame.depth + 1))
  }
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

  const copyContainer = (value: unknown, path: string, depth: number, ancestors: readonly object[]): { target: JsonObject | JsonValue[]; frame: SnapshotFrame } => {
    if (typeof value !== "object" || value === null) throw diagnostic(path, "unsafe-input", "容器必须是对象或数组")
    if (depth > SNAPSHOT_DEPTH_LIMIT) throw diagnostic(path, "snapshot-depth-limit", `输入结构深度超过 ${SNAPSHOT_DEPTH_LIMIT}`)
    // 仅检查活动祖先链。重复引用是合法的 JSON.stringify 输入，必须在每个分支复制。
    if (ancestors.includes(value)) throw diagnostic(path, "unsafe-input", "输入含循环引用，不能作为 JSON 快照")

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
      return { target, frame: { source: value, target, path, depth, isArray, ancestors } }
    } catch (error) {
      if (error instanceof HnnCodecError) throw error
      throw diagnostic(path, "unsafe-input", "无法安全检查输入对象的原型")
    }
  }

  let root: JsonValue
  const frames: SnapshotFrame[] = []
  if (typeof input === "object" && input !== null) {
    const container = copyContainer(input, "", 0, [])
    root = container.target
    frames.push(container.frame)
  } else {
    root = copyPrimitive(input, "")
  }

  while (frames.length > 0) {
    const frame = frames.pop()
    if (!frame) break
    // dense array 的 length 可以远大于实际 JSON/HNN 预算。必须在 ownKeys 前读取它，
    // 以免 Proxy/大数组仅靠枚举字段就消耗无界工作。
    let arrayLength: number | undefined
    if (frame.isArray) {
      try {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(frame.source, "length")
        if (!lengthDescriptor || "get" in lengthDescriptor || "set" in lengthDescriptor || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
          throw diagnostic(frame.path, "unsafe-input", "数组 length 必须是普通非负整数数据属性")
        }
        arrayLength = lengthDescriptor.value
      } catch (error) {
        if (error instanceof HnnCodecError) throw error
        throw diagnostic(frame.path, "unsafe-input", "无法安全检查数组 length")
      }
      // 每个元素至少需要一次描述符读取，非空 JSON array 至少为 2n + 1 个字节。
      if (arrayLength > SNAPSHOT_WORK_LIMIT - work) {
        throw diagnostic(frame.path, "snapshot-work-limit", `输入结构超过 ${SNAPSHOT_WORK_LIMIT} 项工作预算`)
      }
      const minimumBytes = arrayLength === 0 ? 2 : arrayLength * 2 + 1
      if (minimumBytes > HNN_LIMITS.maxShellBytes - lowerBoundBytes) {
        throw diagnostic(frame.path, "shell-too-large", `HNN 外壳超过 ${HNN_LIMITS.maxShellBytes} UTF-8 字节`)
      }
      // 这里只是尽早拒绝；随后每个元素仍会把其精确 primitive 下界加入全局累计，
      // 因而不能把同一数组的最小逗号/元素预算重复加进去。
    }
    let keys: readonly PropertyKey[]
    try {
      keys = Reflect.ownKeys(frame.source)
    } catch {
      throw diagnostic(frame.path, "unsafe-input", "无法安全枚举输入对象字段")
    }
    if (frame.isArray) {
      const length = arrayLength!
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
          const child = copyContainer(value, childPath, frame.depth + 1, [...frame.ancestors, frame.source])
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
      addLowerBound(jsonStringBytes(key) + 1, childPath)
      work += 1
      if (work > SNAPSHOT_WORK_LIMIT) throw diagnostic(appendPath(frame.path, key), "snapshot-work-limit", `输入结构超过 ${SNAPSHOT_WORK_LIMIT} 项工作预算`)
      const value: unknown = descriptor.value
      if (typeof value === "object" && value !== null) {
        const child = copyContainer(value, childPath, frame.depth + 1, [...frame.ancestors, frame.source])
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

class Validator {
  readonly diagnostics: HnnDiagnostic[] = []
  readonly nodeIds = new Set<string>()
  readonly tablePaths: TablePath[] = []
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
    if (utf8Bytes(value) > maxBytes) this.error(path, "attr-too-large", `${label} 超过 ${maxBytes} UTF-8 字节`)
    return true
  }

  attrSize(value: unknown, path: string): void {
    // value 来自受控 snapshot，因此 stringify 不会读调用方对象或遭遇无界图。
    const bytes = utf8Bytes(JSON.stringify(value))
    if (bytes > HNN_LIMITS.maxAttrBytes) this.error(path, "attr-too-large", `attr 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`)
  }

  validateUrl(value: unknown, path: string): void {
    if (!this.requiredString(value, path, HNN_LIMITS.maxAttrBytes, "URL")) return
    if (!isSafeHnnUrl(value)) this.error(path, "unsafe-url", "URL 仅允许不含危险 Unicode 或首尾空白的 http:、https:、mailto: 或 hnmagic: 绝对地址")
  }

  validateAttrs(type: string, attrs: unknown, path: string): void {
    if (!isSnapshotObject(attrs)) {
      this.error(path, "invalid-attrs", "attrs 必须是纯对象")
      return
    }
    // runtime schema 是 attrs 的唯一来源，避免 codec 与 extension 集合各自演化。
    const expected = Object.keys(hnnSchema.nodes[type]?.spec.attrs ?? {})
    this.objectKeys(attrs, expected, path)
    for (const key of expected) {
      // v1 Phase2 文档允许官方节点的默认 attrs 省略；PM schema 会在建树时补默认值。
      const optionalV1 = (type === "blockquote" && key === "author") || (type === "orderedList" && key === "type") || ((type === "tableCell" || type === "tableHeader") && ["colspan", "rowspan", "colwidth", "align"].includes(key))
      if (!(key in attrs)) {
        if (!optionalV1) this.error(appendPath(path, key), "missing-attr", `缺少必填 attr ${key}`)
        continue
      }
      this.attrSize(attrs[key], appendPath(path, key))
    }

    const nodeId = attrs["nodeId"]
    if (this.requiredString(nodeId, `${path}/nodeId`, HNN_LIMITS.maxIdentifierBytes, "nodeId")) {
      if (!UUID_V4_PATTERN.test(nodeId)) this.error(`${path}/nodeId`, "invalid-node-id", "nodeId 必须是小写 UUID v4")
      else if (this.nodeIds.has(nodeId)) this.error(`${path}/nodeId`, "duplicate-node-id", "nodeId 在文档中必须唯一")
      else this.nodeIds.add(nodeId)
    }
    if (type === "heading" && !(Number.isInteger(attrs["level"]) && (attrs["level"] as number) >= 1 && (attrs["level"] as number) <= 6)) this.error(`${path}/level`, "invalid-attr", "heading level 必须为 1 到 6 的整数")
    if (type === "orderedList") {
      if (!(Number.isInteger(attrs["start"]) && (attrs["start"] as number) >= 1)) this.error(`${path}/start`, "invalid-attr", "orderedList start 必须为正整数")
      const listType = attrs["type"] ?? null
      if (!(listType === null || ["1", "a", "A", "i", "I"].includes(listType as string))) this.error(`${path}/type`, "invalid-attr", "orderedList type 必须为 null、1、a、A、i 或 I")
    }
    if (type === "blockquote" && attrs["author"] !== undefined && attrs["author"] !== null) this.requiredString(attrs["author"], `${path}/author`, HNN_LIMITS.maxLabelBytes, "blockquote author")
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
    if (type === "tableCell" || type === "tableHeader") {
      const colspanValue = attrs["colspan"] ?? 1
      const rowspanValue = attrs["rowspan"] ?? 1
      const colwidthValue = attrs["colwidth"] ?? null
      const alignValue = attrs["align"] ?? null
      for (const attr of ["colspan", "rowspan"] as const) {
        const value = attr === "colspan" ? colspanValue : rowspanValue
        if (!(typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= HNN_TABLE_LIMITS.maxSpan)) this.error(`${path}/${attr}`, "invalid-attr", `${attr} 必须为 1 到 ${HNN_TABLE_LIMITS.maxSpan} 的整数`)
      }
      if (!(colwidthValue === null || (Array.isArray(colwidthValue) && Number.isInteger(colspanValue) && colwidthValue.length === colspanValue && colwidthValue.every((width) => Number.isInteger(width) && width > 0 && width <= HNN_TABLE_LIMITS.maxColumnWidth)))) {
        this.error(`${path}/colwidth`, "invalid-attr", "colwidth 必须为 null，或长度等于 colspan 且每项为有界正整数的数组")
      }
      if (!(alignValue === null || ["left", "right", "center"].includes(alignValue as string))) this.error(`${path}/align`, "invalid-attr", "align 必须为 null、left、right 或 center")
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
        else if (utf8Bytes(text) > HNN_LIMITS.maxAttrBytes) this.error(`${frame.path}/text`, "attr-too-large", `text 超过 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节`)
        if (frame.value["marks"] !== undefined) {
          if (frame.parentType === "codeBlock") this.error(`${frame.path}/marks`, "forbidden-mark", "codeBlock 内 text 不得包含 marks")
          else this.validateMarks(frame.value["marks"], `${frame.path}/marks`)
        }
        continue
      }
      if (type === "doc" && frame.value["attrs"] !== undefined) this.error(`${frame.path}/attrs`, "forbidden-attrs", "doc 不得包含 attrs")
      if (NODE_ID_TYPES.has(type)) this.validateAttrs(type, frame.value["attrs"], `${frame.path}/attrs`)
      if (frame.value["marks"] !== undefined) this.error(`${frame.path}/marks`, "forbidden-mark", `${type} 节点不得直接带 marks`)
      if (type === "table") this.validateTableGeometry(frame.value, frame.path)
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

  /**
   * 在 HNN JSON 上以至多 64 列的固定状态数组模拟表格布局。这个预检先于
   * hnnSchema.nodeFromJSON/TableMap，避免恶意 rowspan/colspan 触发大网格分配。
   */
  validateTableGeometry(table: Record<string, unknown>, path: string): void {
    this.tablePaths.push({ path })
    const rows = table["content"]
    if (!Array.isArray(rows)) return
    if (rows.length > HNN_TABLE_LIMITS.maxRows) {
      this.error(path, "invalid-table-geometry", `表格行数不得超过 ${HNN_TABLE_LIMITS.maxRows}`)
      return
    }

    const activeRowspans = new Array<number>(HNN_TABLE_LIMITS.maxColumns).fill(0)
    let width: number | undefined
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row: unknown = rows[rowIndex]
      const cells = isSnapshotObject(row) ? row["content"] : undefined
      if (!Array.isArray(cells)) return
      const nextRowspans = activeRowspans.map((span) => Math.max(0, span - 1))
      let column = 0
      let rowWidth = 0
      for (const cell of cells) {
        while (column < HNN_TABLE_LIMITS.maxColumns && activeRowspans[column] !== 0) column += 1
        const attrs = isSnapshotObject(cell) && isSnapshotObject(cell["attrs"]) ? cell["attrs"] : undefined
        const colspan = typeof attrs?.["colspan"] === "number" ? attrs["colspan"] : 1
        const rowspan = typeof attrs?.["rowspan"] === "number" ? attrs["rowspan"] : 1
        if (!Number.isInteger(colspan) || !Number.isInteger(rowspan) || colspan < 1 || rowspan < 1 || column + colspan > HNN_TABLE_LIMITS.maxColumns) {
          this.error(path, "invalid-table-geometry", `表格列数不得超过 ${HNN_TABLE_LIMITS.maxColumns}`)
          return
        }
        for (let offset = 0; offset < colspan; offset += 1) {
          if (activeRowspans[column + offset] !== 0) {
            this.error(path, "invalid-table-geometry", "表格单元格不得覆盖 rowspan 占用的坐标")
            return
          }
          nextRowspans[column + offset] = rowspan - 1
        }
        column += colspan
        rowWidth = Math.max(rowWidth, column)
      }
      for (let index = 0; index < HNN_TABLE_LIMITS.maxColumns; index += 1) {
        if (activeRowspans[index] !== 0) rowWidth = Math.max(rowWidth, index + 1)
      }
      if (width === undefined) width = rowWidth
      if (width === 0 || rowWidth !== width || width > HNN_TABLE_LIMITS.maxColumns || (rowIndex + 1) * width > HNN_TABLE_LIMITS.maxGridCells) {
        this.error(path, "invalid-table-geometry", `表格必须是完整矩形，且网格面积不得超过 ${HNN_TABLE_LIMITS.maxGridCells}`)
        return
      }
      for (let index = 0; index < width; index += 1) {
        const coveredByCell = nextRowspans[index] !== 0 || activeRowspans[index] !== 0
        if (!coveredByCell && index >= column) {
          this.error(path, "invalid-table-geometry", "表格行存在未覆盖的网格坐标")
          return
        }
      }
      activeRowspans.splice(0, activeRowspans.length, ...nextRowspans)
    }
    if (activeRowspans.some((span) => span !== 0)) this.error(path, "invalid-table-geometry", "rowspan 不得超出表格末行")
  }

  isAllowedChild(parent: string, childType: unknown, index: number): boolean {
    if (typeof childType !== "string") return false
    if (["doc", "blockquote", "callout", "collapsible", "tableCell", "tableHeader"].includes(parent)) return BLOCK_CONTENT_TYPES.has(childType)
    if (parent === "bulletList" || parent === "orderedList") return childType === "listItem"
    if (parent === "taskList") return childType === "taskItem"
    if (parent === "listItem" || parent === "taskItem") return index === 0 ? childType === "paragraph" : BLOCK_CONTENT_TYPES.has(childType)
    if (parent === "table") return childType === "tableRow"
    if (parent === "tableRow") return childType === "tableHeader" || childType === "tableCell"
    if (parent === "paragraph" || parent === "heading") return INLINE_TYPES.has(childType) || childType === "resource"
    return parent === "codeBlock" && childType === "text"
  }
}

function validateTableGeometry(document: ProseMirrorNode, tablePaths: readonly TablePath[]): void {
  let failure: HnnCodecError | undefined
  let tableIndex = 0
  document.descendants((node) => {
    if (failure || node.type.name !== "table") return
    const path = tablePaths[tableIndex++]?.path ?? "/data"
    try {
      const map = TableMap.get(node)
      if (map.width < 1 || map.height < 1 || map.map.some((cell) => cell <= 0) || map.problems !== null) {
        throw new Error(map.problems?.map((problem) => problem.type).join(", ") || "TableMap contains invalid coordinates")
      }
      for (let row = 0; row < map.height; row += 1) {
        for (let column = 0; column < map.width; column += 1) {
          if (map.map[row * map.width + column] === undefined) throw new Error("TableMap has an uncovered grid slot")
        }
      }
    } catch (error) {
      failure = diagnostic(path, "invalid-table-geometry", error instanceof Error ? `表格几何无效：${error.message}` : "表格几何无效")
    }
  })
  if (failure) throw failure
}

function validateShell(snapshot: JsonObject): Validator {
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
  return validator
}

function normalizeV1Defaults(data: JsonObject): JsonObject {
  const normalized = cloneJson(data) as JsonObject
  const visit = (value: JsonValue): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isSnapshotObject(value)) return
    const type = value["type"]
    const attrs = value["attrs"]
    if (isSnapshotObject(attrs)) {
      if (type === "orderedList" && !("type" in attrs)) attrs["type"] = null
      if (type === "blockquote" && !("author" in attrs)) attrs["author"] = null
      if (type === "tableCell" || type === "tableHeader") {
        if (!("colspan" in attrs)) attrs["colspan"] = 1
        if (!("rowspan" in attrs)) attrs["rowspan"] = 1
        if (!("colwidth" in attrs)) attrs["colwidth"] = null
        if (!("align" in attrs)) attrs["align"] = null
      }
    }
    const content = value["content"]
    if (Array.isArray(content)) content.forEach(visit)
  }
  visit(normalized)
  return normalized
}

/** 解码并以 ProseMirror 进行最终结构回退检查；失败永远抛出 HnnCodecError。 */
export function decodeHnn(input: unknown): ProseMirrorNode {
  const snapshot = snapshotJson(input)
  if (!isSnapshotObject(snapshot)) throw diagnostic("/", "invalid-shell", "HNN 外壳必须是纯 JSON 对象")
  // 兼容字段补全前，必须以调用方实际提交的 v1 外壳计算持久化字节上限。
  const validator = validateShell(snapshot)
  const dataValue = snapshot["data"]
  const normalizedInput = { ...snapshot, data: isSnapshotObject(dataValue) ? normalizeV1Defaults(dataValue) : dataValue }
  const data = normalizedInput["data"] as JsonObject
  try {
    const document = hnnSchema.nodeFromJSON(data)
    if (document.type !== hnnSchema.topNodeType) throw diagnostic("/data/type", "invalid-root", "ProseMirror 根节点必须为 schema topNode doc")
    document.check()
    validateTableGeometry(document, validator.tablePaths)
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
  if (input instanceof ProseMirrorNode) preflightProseMirrorNode(input)
  const data = input instanceof ProseMirrorNode ? input.toJSON() as Record<string, unknown> : input
  const document = decodeHnn({ schemaVersion: HNN_SCHEMA_VERSION, data })
  const canonical = document.toJSON() as JsonValue
  // decode 为兼容旧 v1 输入会按调用方提交的原始外壳计算上限，并补全省略的官方默认
  // attrs；补全后的 canonical JSON 可能更大。这里在返回前对最终
  // {schemaVersion, data} 使用与 decode 一致的受限序列化大小检查，PM Node 入口与
  // Record 入口统一，避免返回超过持久化上限、无法再被 decode 的 HNN。
  const shell: JsonValue = { schemaVersion: HNN_SCHEMA_VERSION, data: canonical }
  if (serializedJsonByteLength(shell, HNN_LIMITS.maxShellBytes) === undefined) {
    throw diagnostic("/", "shell-too-large", `HNN 外壳超过 ${HNN_LIMITS.maxShellBytes} UTF-8 字节`)
  }
  return {
    schemaVersion: HNN_SCHEMA_VERSION,
    data: cloneJson(canonical) as Record<string, unknown>
  }
}
