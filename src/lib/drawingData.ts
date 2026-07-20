/**
 * 画板块（NoteDrawingBlock）的数据工具。
 *
 * 存储格式与代码块一致：块上只保存一个字符串字段 `data`，
 * 内容是 @hamster-note/painting 的 DrawingValue JSON。
 * markdown 导出时使用 `hamster-note-drawing` 作为围栏语言。
 */

import {
  DRAWING_STROKE_SCHEMA_VERSION,
  normalizeDrawingValue,
  type DrawingStrokeV2,
  type DrawingValue,
  type DrawingValueV2
} from "@hamster-note/painting"

/** 画板块在 markdown 围栏代码块中使用的语言标识。 */
export const NOTE_DRAWING_FENCE_LANGUAGE = "hamster-note-drawing"

/**
 * 缩略图渲染时的默认描边颜色。
 * 与 DESIGN.md 的 --hn-text（#1e293b）保持一致，避免新增中性色。
 */
export const DRAWING_FALLBACK_COLOR = "#1e293b"

/** 缩略图渲染时的默认描边宽度（与 painting 内部默认值 2 对齐）。 */
export const DRAWING_FALLBACK_WIDTH = 2

/** 所有笔画共同的外接矩形（画板坐标系）。 */
export type DrawingBounds = {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

/**
 * 解析画板块的 data 字符串为规范化的 DrawingValueV2。
 * 空串、非法 JSON 或结构不符时返回 undefined（视为"尚未绘制"）。
 * normalizeDrawingValue 负责把旧版（V1）或不完整的数据迁移到当前 schema。
 */
export const parseDrawingData = (data: string): DrawingValueV2 | undefined => {
  const trimmed = data.trim()
  if (!trimmed) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== "object" || parsed === null) return undefined
    return normalizeDrawingValue(parsed as { readonly strokes?: readonly unknown[] })
  } catch {
    return undefined
  }
}

/**
 * 把 DrawingSurface 回传的 DrawingValue 序列化为画板块的 data 字符串。
 * 先经 normalizeDrawingValue 迁移，保证落库数据始终为当前 schema 版本。
 */
export const stringifyDrawingData = (value: DrawingValue): string =>
  JSON.stringify(normalizeDrawingValue(value))

/** 生成一份空画板数据的 JSON 字符串（schemaVersion 与 painting 当前版本对齐）。 */
export const emptyDrawingData = (): string =>
  JSON.stringify({
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    strokes: []
  })

/**
 * 计算所有笔画的外接矩形，用于缩略图 SVG 的 viewBox。
 * 每条笔画按其 strokeWidth 向外扩半个线宽，避免粗描边在边缘被裁切；
 * 额外再留 1px 安全边距。无有效点时返回 undefined。
 */
export const strokesBounds = (
  strokes: readonly DrawingStrokeV2[]
): DrawingBounds | undefined => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const stroke of strokes) {
    // 未显式设置 strokeWidth 的笔画按 painting 默认宽度 2 处理
    const halfWidth = (stroke.strokeWidth ?? DRAWING_FALLBACK_WIDTH) / 2
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x - halfWidth)
      minY = Math.min(minY, point.y - halfWidth)
      maxX = Math.max(maxX, point.x + halfWidth)
      maxY = Math.max(maxY, point.y + halfWidth)
    }
  }

  if (!Number.isFinite(minX)) return undefined

  const padding = 1
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2
  }
}
