/** HNN v1 的保守资源上限，所有大小均按 UTF-8 字节计。 */
export const HNN_LIMITS = {
  /** 单个 HNN JSON 外壳的最大序列化大小，避免不可信输入占用过多内存。 */
  maxShellBytes: 256 * 1024,
  /** 文档节点树最大深度，doc 自身计为第一层。 */
  maxDepth: 32,
  /** 一个文档允许的节点总数，文本节点同样计数。 */
  maxNodes: 512,
  /** 任一持久化 attr 的最大序列化 UTF-8 大小。 */
  maxAttrBytes: 8 * 1024,
  /** 普通展示字符串的上限，避免把大对象伪装成简短元数据。 */
  maxLabelBytes: 512,
  /** 资源标识、文件名、语言等短标识符的上限。 */
  maxIdentifierBytes: 256
} as const

export const HNN_SCHEMA_VERSION = 1 as const

/** 严格 UUID v4：版本 nibble 固定为 4，variant 仅接受 RFC 4122 的 8/9/a/b。 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
