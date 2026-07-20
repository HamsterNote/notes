import { describe, expect, it } from "vitest"

import {
  emptyDrawingData,
  NOTE_DRAWING_FENCE_LANGUAGE,
  parseDrawingData,
  stringifyDrawingData,
  strokesBounds
} from "./drawingData"

describe("drawingData", () => {
  it("exposes the markdown fence language", () => {
    expect(NOTE_DRAWING_FENCE_LANGUAGE).toBe("hamster-note-drawing")
  })

  it("returns undefined for empty or invalid data", () => {
    expect(parseDrawingData("")).toBeUndefined()
    expect(parseDrawingData("   ")).toBeUndefined()
    expect(parseDrawingData("not json")).toBeUndefined()
    expect(parseDrawingData("42")).toBeUndefined()
  })

  it("parses and normalizes drawing JSON to the current schema", () => {
    const value = parseDrawingData(JSON.stringify({ strokes: [] }))
    expect(value).toEqual({ schemaVersion: 2, strokes: [] })
  })

  it("serializes values with the current schema version", () => {
    const data = stringifyDrawingData({ strokes: [] })
    expect(JSON.parse(data)).toEqual({ schemaVersion: 2, strokes: [] })
  })

  it("produces empty drawing data in the current schema", () => {
    expect(JSON.parse(emptyDrawingData())).toEqual({
      schemaVersion: 2,
      strokes: []
    })
  })

  it("computes stroke bounds including stroke width and safety padding", () => {
    const bounds = strokesBounds([
      {
        schemaVersion: 2,
        id: "a",
        tool: "pen",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 20 }
        ],
        strokeWidth: 4
      },
      {
        schemaVersion: 2,
        id: "b",
        tool: "line",
        // 未设置 strokeWidth，按默认宽度 2 计算
        points: [
          { x: -6, y: 8 },
          { x: 2, y: 2 }
        ]
      }
    ])

    // 并集 x∈[-7,12]、y∈[-2,22]，再向外留 1px 安全边距
    expect(bounds).toEqual({ minX: -8, minY: -3, width: 21, height: 26 })
  })

  it("returns undefined bounds when no points exist", () => {
    expect(strokesBounds([])).toBeUndefined()
  })
})
