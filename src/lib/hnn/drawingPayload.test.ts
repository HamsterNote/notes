import { describe, expect, it } from "vitest"

import {
  HNN_DRAWING_EMPTY_DATA,
  parseDrawingPayload,
  serializeDrawingPayload
} from "./drawingPayload"

const drawing = (overrides: Record<string, unknown> = {}) => ({
  strokes: [
    {
      id: "stroke-1",
      tool: "pen",
      points: [{ x: 10, y: 20, pressure: 0.5 }],
      strokeColor: "#112233",
      strokeWidth: 2
    }
  ],
  ...overrides
})

describe("HNN drawing payload", () => {
  it("提供可直接写入新节点的 canonical 空 data", () => {
    expect(parseDrawingPayload(HNN_DRAWING_EMPTY_DATA)).toEqual({
      ok: true,
      value: { strokes: [], schemaVersion: 2 }
    })
    expect(serializeDrawingPayload(JSON.parse(HNN_DRAWING_EMPTY_DATA) as unknown)).toEqual({
      ok: true,
      value: HNN_DRAWING_EMPTY_DATA
    })
  })

  it("验证后交由 painting normalize，并输出 minified v2 JSON", () => {
    const input = drawing()
    const serialized = serializeDrawingPayload(input)

    expect(serialized).toEqual({
      ok: true,
      value: "{\"strokes\":[{\"schemaVersion\":2,\"id\":\"stroke-1\",\"points\":[{\"x\":10,\"y\":20,\"pressure\":0.5}],\"strokeColor\":\"#112233\",\"strokeWidth\":2,\"tool\":\"pen\"}],\"schemaVersion\":2}"
    })
    expect(input).toEqual(drawing())
  })

  it("拒绝 normalize 会静默忽略的非法 JSON/形状、未知字段、重复 id 和非有限点", () => {
    expect(parseDrawingPayload("{not-json")).toMatchObject({ ok: false, error: { code: "invalid-json" } })
    expect(parseDrawingPayload(JSON.stringify({ strokes: "not-an-array" }))).toMatchObject({ ok: false, error: { code: "invalid-value", path: "/strokes" } })
    expect(serializeDrawingPayload(drawing({ extra: true }))).toMatchObject({ ok: false, error: { code: "unknown-key", path: "/extra" } })
    expect(serializeDrawingPayload(drawing({ strokes: [{ id: "stroke-1", tool: "pen", points: [{ x: Number.POSITIVE_INFINITY, y: 0 }] }] }))).toMatchObject({ ok: false, error: { code: "invalid-value", path: "/strokes/0/points/0" } })
    expect(serializeDrawingPayload(drawing({ strokes: [drawing().strokes[0], { ...drawing().strokes[0] }] }))).toMatchObject({ ok: false, error: { code: "duplicate-id" } })
  })

  it("不把非法旧 payload 替换为空画板", () => {
    const malformed = JSON.stringify({ strokes: [{ id: "bad", tool: "eraser", points: [] }] })
    const result = parseDrawingPayload(malformed)

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-value", path: "/strokes/0/tool" } })
    expect(result).not.toMatchObject({ ok: true, value: { strokes: [] } })
  })

  it("仅接受固定 SVG paint，拒绝 url()/var()/控制字符而保留 DrawingSurface 默认 black", () => {
    for (const color of ["#abc", "#abcd", "#A1B2C3", "#a1b2c3d4", "black"]) {
      expect(serializeDrawingPayload(drawing({ strokes: [{ id: "stroke-1", tool: "pen", points: [], strokeColor: color, fillColor: color }] }))).toMatchObject({ ok: true })
    }
    expect(serializeDrawingPayload(drawing({ strokes: [{ id: "stroke-1", tool: "rect", points: [], strokeColor: "black", fillColor: "none" }] }))).toMatchObject({ ok: true })
    for (const color of ["url(#paint)", "var(--paint)", "#123456\n", "currentColor", "red", "none"]) {
      expect(serializeDrawingPayload(drawing({ strokes: [{ id: "stroke-1", tool: "pen", points: [], strokeColor: color }] }))).toMatchObject({ ok: false, error: { path: "/strokes/0/strokeColor" } })
    }
    for (const color of ["url(#paint)", "var(--paint)", "#123456\u0000"]) {
      expect(parseDrawingPayload(JSON.stringify({ strokes: [{ id: "legacy", tool: "rect", points: [], fillColor: color }] }))).toMatchObject({ ok: false, error: { path: "/strokes/0/fillColor" } })
    }
  })

})
