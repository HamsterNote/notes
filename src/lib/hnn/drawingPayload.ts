import {
  normalizeDrawingValue,
  type DrawingStrokeToolV2,
  type DrawingValueV2
} from "@hamster-note/painting"

import {
  getPersistedStringBudget,
  type PersistedStringBudget
} from "./persistedStringBudget"
import { HNN_LIMITS } from "./limits"
import { utf8Bytes } from "./stringBytes"

/** 新建 drawing 节点唯一允许使用的 canonical 空 data（painting v2）。 */
export const HNN_DRAWING_EMPTY_DATA = '{"strokes":[],"schemaVersion":2}'

export interface DrawingPayloadError {
  readonly code: "attr-raw-too-large" | "attr-json-too-large" | "invalid-json" | "invalid-shape" | "unknown-key" | "invalid-value" | "duplicate-id"
  readonly path: string
  readonly message: string
}

export type DrawingPayloadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DrawingPayloadError }

export interface DrawingPayloadCandidate {
  readonly result: DrawingPayloadResult<string>
  readonly budget?: PersistedStringBudget
}

const MAX_STROKES = 128
const MAX_POINTS_PER_STROKE = 512
const MAX_TOTAL_POINTS = 2_048
const MAX_DASH_ITEMS = 32
const MAX_ABSOLUTE_COORDINATE = 1_000_000
const MAX_STROKE_WIDTH = 10_000
const TOOLS: readonly DrawingStrokeToolV2[] = ["pen", "line", "rect", "ellipse", "polygon", "bezier"]
const ROOT_KEYS = ["schemaVersion", "strokes"] as const
const STROKE_KEYS = ["schemaVersion", "id", "tool", "points", "strokeColor", "strokeWidth", "dashArray", "dashOffset", "fillColor", "fillOpacity"] as const
const POINT_KEYS = ["x", "y", "pressure"] as const
const SVG_COLOR_PATTERN = /^(?:#[0-9A-Fa-f]{3,4}|#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?|black)$/u

function failure(code: DrawingPayloadError["code"], path: string, message: string): DrawingPayloadResult<never> {
  return { ok: false, error: { code, path, message } }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[], path: string): DrawingPayloadResult<void> {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) return failure("unknown-key", `${path}/${key}`, `不允许字段 ${key}`)
  }
  return { ok: true, value: undefined }
}

function isBoundedFinite(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum
}

/**
 * 只接受绘制器实际可用的固定 SVG 颜色语法，避免 attr 进入 SVG 时解释 url()/var()
 * 或控制字符等间接引用。fill 额外允许 none；未设置时仍由 DrawingSurface 回退为 black。
 */
function isSafeSvgPaint(value: unknown, allowNone: boolean): value is string {
  return typeof value === "string" && utf8Bytes(value) <= HNN_LIMITS.maxLabelBytes && (SVG_COLOR_PATTERN.test(value) || (allowNone && value === "none"))
}

/** 在调用 painting 的宽松 normalize 前，拒绝会被其静默丢弃或修正的不可信结构。 */
function validateDrawingShape(value: unknown): DrawingPayloadResult<void> {
  if (!isRecord(value)) return failure("invalid-shape", "/", "drawing data 必须是对象")
  const rootKeys = hasOnlyKeys(value, ROOT_KEYS, "")
  if (!rootKeys.ok) return rootKeys
  if (value["schemaVersion"] !== undefined && value["schemaVersion"] !== 2) return failure("invalid-value", "/schemaVersion", "schemaVersion 必须为 2 或省略以供 painting 迁移")
  const strokes = value["strokes"]
  if (!(Array.isArray(strokes) && strokes.length <= MAX_STROKES)) return failure("invalid-value", "/strokes", `strokes 必须是最多 ${MAX_STROKES} 项的数组`)
  const strokeList: readonly unknown[] = strokes
  let points = 0
  const ids = new Set<string>()
  for (let strokeIndex = 0; strokeIndex < strokeList.length; strokeIndex += 1) {
    const stroke = strokeList[strokeIndex]
    const strokePath = `/strokes/${strokeIndex}`
    if (!isRecord(stroke)) return failure("invalid-shape", strokePath, "stroke 必须是对象")
    const strokeKeys = hasOnlyKeys(stroke, STROKE_KEYS, strokePath)
    if (!strokeKeys.ok) return strokeKeys
    if (stroke["schemaVersion"] !== undefined && stroke["schemaVersion"] !== 2) return failure("invalid-value", `${strokePath}/schemaVersion`, "stroke schemaVersion 必须为 2 或省略")
    const id = stroke["id"]
    if (!(typeof id === "string" && id.length > 0 && utf8Bytes(id) <= HNN_LIMITS.maxIdentifierBytes)) return failure("invalid-value", `${strokePath}/id`, "stroke id 必须是有界非空字符串")
    if (ids.has(id)) return failure("duplicate-id", `${strokePath}/id`, `重复 stroke id: ${id}`)
    ids.add(id)
    const tool = stroke["tool"]
    if (!(typeof tool === "string" && TOOLS.includes(tool as DrawingStrokeToolV2))) return failure("invalid-value", `${strokePath}/tool`, "tool 不支持持久化")
    const strokePoints = stroke["points"]
    if (!(Array.isArray(strokePoints) && strokePoints.length <= MAX_POINTS_PER_STROKE)) return failure("invalid-value", `${strokePath}/points`, `points 必须是最多 ${MAX_POINTS_PER_STROKE} 项的数组`)
    const pointList: readonly unknown[] = strokePoints
    points += pointList.length
    if (points > MAX_TOTAL_POINTS) return failure("invalid-value", "/strokes", `全部 points 不得超过 ${MAX_TOTAL_POINTS} 项`)
    for (let pointIndex = 0; pointIndex < pointList.length; pointIndex += 1) {
      const point = pointList[pointIndex]
      const pointPath = `${strokePath}/points/${pointIndex}`
      if (!isRecord(point)) return failure("invalid-shape", pointPath, "point 必须是对象")
      const pointKeys = hasOnlyKeys(point, POINT_KEYS, pointPath)
      if (!pointKeys.ok) return pointKeys
      if (!isBoundedFinite(point["x"], MAX_ABSOLUTE_COORDINATE) || !isBoundedFinite(point["y"], MAX_ABSOLUTE_COORDINATE)) return failure("invalid-value", pointPath, "point x/y 必须是有界有限数")
      const pressure = point["pressure"]
      if (pressure !== undefined && !(typeof pressure === "number" && Number.isFinite(pressure) && pressure >= 0 && pressure <= 1)) return failure("invalid-value", `${pointPath}/pressure`, "pressure 必须在 0 到 1 之间")
    }
    const strokeColor = stroke["strokeColor"]
    if (strokeColor !== undefined && !isSafeSvgPaint(strokeColor, false)) return failure("invalid-value", `${strokePath}/strokeColor`, "strokeColor 仅允许 #RGB、#RGBA、#RRGGBB、#RRGGBBAA 或 black")
    const fillColor = stroke["fillColor"]
    if (fillColor !== undefined && !isSafeSvgPaint(fillColor, true)) return failure("invalid-value", `${strokePath}/fillColor`, "fillColor 仅允许 #RGB、#RGBA、#RRGGBB、#RRGGBBAA、black 或 none")
    const strokeWidth = stroke["strokeWidth"]
    if (strokeWidth !== undefined && !(typeof strokeWidth === "number" && Number.isFinite(strokeWidth) && strokeWidth > 0 && strokeWidth <= MAX_STROKE_WIDTH)) return failure("invalid-value", `${strokePath}/strokeWidth`, "strokeWidth 必须是有界正数")
    const dashOffset = stroke["dashOffset"]
    if (dashOffset !== undefined && !isBoundedFinite(dashOffset, MAX_ABSOLUTE_COORDINATE)) return failure("invalid-value", `${strokePath}/dashOffset`, "dashOffset 必须是有界有限数")
    const dashArray = stroke["dashArray"]
    if (dashArray !== undefined && !(Array.isArray(dashArray) && dashArray.length <= MAX_DASH_ITEMS && dashArray.every((dash) => typeof dash === "number" && Number.isFinite(dash) && dash >= 0 && dash <= MAX_ABSOLUTE_COORDINATE))) return failure("invalid-value", `${strokePath}/dashArray`, "dashArray 必须是有界非负有限数数组")
    const fillOpacity = stroke["fillOpacity"]
    if (fillOpacity !== undefined && !(typeof fillOpacity === "number" && Number.isFinite(fillOpacity) && fillOpacity >= 0 && fillOpacity <= 1)) return failure("invalid-value", `${strokePath}/fillOpacity`, "fillOpacity 必须在 0 到 1 之间")
  }
  return { ok: true, value: undefined }
}

function normalizeDrawingPayload(value: unknown): DrawingPayloadResult<DrawingValueV2> {
  const validation = validateDrawingShape(value)
  if (!validation.ok) return validation
  // shape 已完成防御式验证，normalize 仅负责 package 维护的版本迁移与深拷贝。
  return { ok: true, value: normalizeDrawingValue(value as { readonly strokes: readonly unknown[] }) }
}

/** 解析既有 attr；错误绝不被转换为一张空画板。 */
export function parseDrawingPayload(data: string): DrawingPayloadResult<DrawingValueV2> {
  const budget = getPersistedStringBudget(data)
  if (budget.error !== undefined) return failure(budget.error.code, "/", budget.error.message)
  try {
    return normalizeDrawingPayload(JSON.parse(data) as unknown)
  } catch {
    return failure("invalid-json", "/", "drawing data 不是合法 JSON")
  }
}

/** 序列化为 painting 归一化后的 minified JSON，并再次按 HNN attr 预算确认可提交。 */
export function serializeDrawingPayload(value: unknown): DrawingPayloadResult<string> {
  const normalized = normalizeDrawingPayload(value)
  if (!normalized.ok) return normalized
  const data = JSON.stringify(normalized.value)
  const budget = getPersistedStringBudget(data)
  if (budget.error !== undefined) return failure(budget.error.code, "/", budget.error.message)
  return { ok: true, value: data }
}

export function prepareDrawingPayloadCandidate(value: unknown): DrawingPayloadCandidate {
  const result = serializeDrawingPayload(value)
  return result.ok ? { result, budget: getPersistedStringBudget(result.value) } : { result }
}
