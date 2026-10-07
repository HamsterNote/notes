import { HNN_LIMITS } from "./limits"
import {
  getPersistedStringBudget,
  type PersistedStringBudget
} from "./persistedStringBudget"
import { utf8Bytes } from "./stringBytes"

export const HNN_CARD_PAYLOAD_VERSION = 1 as const

/** 新建 card 节点唯一允许使用的 canonical 空 data。 */
export const HNN_CARD_EMPTY_DATA = '{"schemaVersion":1,"cards":[]}'

/** HNN 自有卡片格式；不以 CardCanvas 或旧 NoteCardData 作为事实来源。 */
export interface HnnCard {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly parentId?: string
  readonly linkedCardIds?: readonly string[]
  readonly zIndex?: number
  readonly locked?: boolean
  readonly childrenLayout?: "free" | "mind-map-horizontal" | "arrange"
}

export interface HnnCardPayload {
  readonly schemaVersion: typeof HNN_CARD_PAYLOAD_VERSION
  readonly cards: readonly HnnCard[]
}

export interface CardPayloadError {
  readonly code:
    | "attr-raw-too-large"
    | "attr-json-too-large"
    | "invalid-json"
    | "invalid-shape"
    | "unknown-key"
    | "invalid-value"
    | "duplicate-id"
    | "invalid-reference"
    | "parent-cycle"
  readonly path: string
  readonly message: string
}

export type CardPayloadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CardPayloadError }

export interface CardPayloadCandidate {
  readonly result: CardPayloadResult<string>
  readonly budget?: PersistedStringBudget
}

const MAX_CARDS = 128
const MAX_COORDINATE = 1_000_000
const MAX_DIMENSION = 100_000
const MAX_Z_INDEX = 1_000_000
const MAX_LINKS_PER_CARD = 128
const CARD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const CARD_KEYS = [
  "id",
  "title",
  "content",
  "x",
  "y",
  "width",
  "height",
  "parentId",
  "linkedCardIds",
  "zIndex",
  "locked",
  "childrenLayout"
] as const
const PAYLOAD_KEYS = ["schemaVersion", "cards"] as const

function failure(code: CardPayloadError["code"], path: string, message: string): CardPayloadResult<never> {
  return { ok: false, error: { code, path, message } }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[], path: string): CardPayloadResult<void> {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) return failure("unknown-key", `${path}/${key}`, `不允许字段 ${key}`)
  }
  return { ok: true, value: undefined }
}

function isBoundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && utf8Bytes(value) <= maxBytes
}

function isCardIdList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_LINKS_PER_CARD) return false
  const links: readonly unknown[] = value
  return links.every((link) => isBoundedString(link, HNN_LIMITS.maxIdentifierBytes) && CARD_ID_PATTERN.test(link))
}

function parseCard(value: unknown, path: string): CardPayloadResult<HnnCard> {
  if (!isRecord(value)) return failure("invalid-shape", path, "卡片必须是对象")
  const keys = hasOnlyKeys(value, CARD_KEYS, path)
  if (!keys.ok) return keys

  const id = value["id"]
  if (!(isBoundedString(id, HNN_LIMITS.maxIdentifierBytes) && CARD_ID_PATTERN.test(id))) {
    return failure("invalid-value", `${path}/id`, "id 必须是 1 到 128 个受限 ASCII 字符")
  }
  const title = value["title"]
  if (!isBoundedString(title, HNN_LIMITS.maxLabelBytes)) {
    return failure("invalid-value", `${path}/title`, `title 必须是最多 ${HNN_LIMITS.maxLabelBytes} UTF-8 字节的字符串`)
  }
  const content = value["content"]
  if (!isBoundedString(content, HNN_LIMITS.maxAttrBytes)) {
    return failure("invalid-value", `${path}/content`, `content 必须是最多 ${HNN_LIMITS.maxAttrBytes} UTF-8 字节的字符串`)
  }

  const x = value["x"]
  const y = value["y"]
  const width = value["width"]
  const height = value["height"]
  if (!(typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= MAX_COORDINATE)) return failure("invalid-value", `${path}/x`, "x 必须是有界有限数")
  if (!(typeof y === "number" && Number.isFinite(y) && Math.abs(y) <= MAX_COORDINATE)) return failure("invalid-value", `${path}/y`, "y 必须是有界有限数")
  if (!(typeof width === "number" && Number.isFinite(width) && width > 0 && width <= MAX_DIMENSION)) return failure("invalid-value", `${path}/width`, "width 必须是有界正数")
  if (!(typeof height === "number" && Number.isFinite(height) && height > 0 && height <= MAX_DIMENSION)) return failure("invalid-value", `${path}/height`, "height 必须是有界正数")

  const parentId = value["parentId"]
  if (parentId !== undefined && !(isBoundedString(parentId, HNN_LIMITS.maxIdentifierBytes) && CARD_ID_PATTERN.test(parentId))) return failure("invalid-value", `${path}/parentId`, "parentId 必须是受限卡片 id")
  const linkedCardIds = value["linkedCardIds"]
  if (linkedCardIds !== undefined && !isCardIdList(linkedCardIds)) {
    return failure("invalid-value", `${path}/linkedCardIds`, "linkedCardIds 必须是有界卡片 id 数组")
  }
  const zIndex = value["zIndex"]
  if (zIndex !== undefined && !(typeof zIndex === "number" && Number.isFinite(zIndex) && Math.abs(zIndex) <= MAX_Z_INDEX)) return failure("invalid-value", `${path}/zIndex`, "zIndex 必须是有界有限数")
  const locked = value["locked"]
  if (locked !== undefined && typeof locked !== "boolean") return failure("invalid-value", `${path}/locked`, "locked 必须是布尔值")
  const childrenLayout = value["childrenLayout"]
  if (childrenLayout !== undefined && childrenLayout !== "free" && childrenLayout !== "mind-map-horizontal" && childrenLayout !== "arrange") return failure("invalid-value", `${path}/childrenLayout`, "childrenLayout 不受支持")

  return {
    ok: true,
    value: {
      id,
      title,
      content,
      x,
      y,
      width,
      height,
      ...(parentId === undefined ? {} : { parentId }),
      ...(linkedCardIds === undefined ? {} : { linkedCardIds: [...linkedCardIds] }),
      ...(zIndex === undefined ? {} : { zIndex }),
      ...(locked === undefined ? {} : { locked }),
      ...(childrenLayout === undefined ? {} : { childrenLayout })
    }
  }
}

function validateReferences(cards: readonly HnnCard[]): CardPayloadResult<void> {
  const ids = new Set<string>()
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    if (card === undefined) continue
    if (ids.has(card.id)) return failure("duplicate-id", `/cards/${index}/id`, `重复 card id: ${card.id}`)
    ids.add(card.id)
  }
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    if (card === undefined) continue
    if (card.parentId !== undefined && !ids.has(card.parentId)) return failure("invalid-reference", `/cards/${index}/parentId`, "parentId 必须引用当前 payload 内的卡片")
    for (let linkIndex = 0; linkIndex < (card.linkedCardIds?.length ?? 0); linkIndex += 1) {
      const link = card.linkedCardIds?.[linkIndex]
      if (link !== undefined && !ids.has(link)) return failure("invalid-reference", `/cards/${index}/linkedCardIds/${linkIndex}`, "链接必须引用当前 payload 内的卡片")
    }
  }
  for (const card of cards) {
    const visited = new Set<string>()
    let current: HnnCard | undefined = card
    while (current?.parentId !== undefined) {
      if (visited.has(current.id)) return failure("parent-cycle", "/cards", "parentId 不得形成循环")
      visited.add(current.id)
      current = cards.find((candidate) => candidate.id === current?.parentId)
    }
  }
  return { ok: true, value: undefined }
}

/** 将未知 JSON 值收敛为受限、独立的 HNN card payload，绝不修改输入。 */
export function normalizeCardPayload(value: unknown): CardPayloadResult<HnnCardPayload> {
  if (!isRecord(value)) return failure("invalid-shape", "/", "card payload 必须是对象")
  const keys = hasOnlyKeys(value, PAYLOAD_KEYS, "")
  if (!keys.ok) return keys
  if (value["schemaVersion"] !== HNN_CARD_PAYLOAD_VERSION) return failure("invalid-value", "/schemaVersion", `schemaVersion 必须为 ${HNN_CARD_PAYLOAD_VERSION}`)
  const sourceCards = value["cards"]
  if (!(Array.isArray(sourceCards) && sourceCards.length <= MAX_CARDS)) return failure("invalid-value", "/cards", `cards 必须是最多 ${MAX_CARDS} 项的数组`)
  const cardsSource: readonly unknown[] = sourceCards
  const cards: HnnCard[] = []
  for (let index = 0; index < cardsSource.length; index += 1) {
    const card = parseCard(cardsSource[index], `/cards/${index}`)
    if (!card.ok) return card
    cards.push(card.value)
  }
  const references = validateReferences(cards)
  if (!references.ok) return references
  return { ok: true, value: { schemaVersion: HNN_CARD_PAYLOAD_VERSION, cards } }
}

/** 解析既有 attr；不合法的旧数据只返回错误，调用方不得替换为空卡片。 */
export function parseCardPayload(data: string): CardPayloadResult<HnnCardPayload> {
  const budget = getPersistedStringBudget(data)
  if (budget.error !== undefined) return failure(budget.error.code, "/", budget.error.message)
  try {
    return normalizeCardPayload(JSON.parse(data) as unknown)
  } catch {
    return failure("invalid-json", "/", "card data 不是合法 JSON")
  }
}

/** 输出固定字段顺序的 minified JSON，作为 HNN card data 的唯一 canonical 形式。 */
export function serializeCardPayload(value: unknown): CardPayloadResult<string> {
  const normalized = normalizeCardPayload(value)
  if (!normalized.ok) return normalized
  const data = JSON.stringify(normalized.value)
  const budget = getPersistedStringBudget(data)
  if (budget.error !== undefined) return failure(budget.error.code, "/", budget.error.message)
  return { ok: true, value: data }
}

/** Drawer draft 的提交前入口：返回 canonical data 或可直接展示的结构化错误与预算。 */
export function prepareCardPayloadCandidate(value: unknown): CardPayloadCandidate {
  const result = serializeCardPayload(value)
  return result.ok ? { result, budget: getPersistedStringBudget(result.value) } : { result }
}
