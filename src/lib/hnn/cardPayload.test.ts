import { describe, expect, it } from "vitest"

import { HNN_LIMITS } from "./limits"
import {
  HNN_CARD_EMPTY_DATA,
  parseCardPayload,
  prepareCardPayloadCandidate,
  serializeCardPayload
} from "./cardPayload"

const card = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: "卡片",
  content: "内容",
  x: 10,
  y: 20,
  width: 240,
  height: 160,
  ...overrides
})

describe("HNN card payload", () => {
  it("提供可直接写入新节点的 canonical 空 data", () => {
    expect(parseCardPayload(HNN_CARD_EMPTY_DATA)).toEqual({
      ok: true,
      value: { schemaVersion: 1, cards: [] }
    })
    expect(serializeCardPayload(JSON.parse(HNN_CARD_EMPTY_DATA) as unknown)).toEqual({
      ok: true,
      value: HNN_CARD_EMPTY_DATA
    })
  })

  it("验证有效业务数据并输出固定顺序的 minified canonical JSON", () => {
    const input = {
      cards: [
        card("root", { linkedCardIds: ["child"], childrenLayout: "mind-map-horizontal" }),
        card("child", { parentId: "root", locked: true, zIndex: 2 })
      ],
      schemaVersion: 1
    }

    const serialized = serializeCardPayload(input)

    expect(serialized).toEqual({
      ok: true,
      value: "{\"schemaVersion\":1,\"cards\":[{\"id\":\"root\",\"title\":\"卡片\",\"content\":\"内容\",\"x\":10,\"y\":20,\"width\":240,\"height\":160,\"linkedCardIds\":[\"child\"],\"childrenLayout\":\"mind-map-horizontal\"},{\"id\":\"child\",\"title\":\"卡片\",\"content\":\"内容\",\"x\":10,\"y\":20,\"width\":240,\"height\":160,\"parentId\":\"root\",\"zIndex\":2,\"locked\":true}]}"
    })
  })

  it("拒绝字段白名单之外的值、非有限数、非正尺寸、重复 id、悬空引用和 parent 环", () => {
    expect(serializeCardPayload({ schemaVersion: 1, cards: [card("one", { extra: true })] })).toMatchObject({ ok: false, error: { code: "unknown-key", path: "/cards/0/extra" } })
    expect(serializeCardPayload({ schemaVersion: 1, cards: [card("one", { x: Number.NaN })] })).toMatchObject({ ok: false, error: { code: "invalid-value", path: "/cards/0/x" } })
    expect(serializeCardPayload({ schemaVersion: 1, cards: [card("one", { width: 0 })] })).toMatchObject({ ok: false, error: { code: "invalid-value", path: "/cards/0/width" } })
    expect(serializeCardPayload({ schemaVersion: 1, cards: [card("same"), card("same")] })).toMatchObject({ ok: false, error: { code: "duplicate-id" } })
    expect(serializeCardPayload({ schemaVersion: 1, cards: [card("one", { parentId: "missing" })] })).toMatchObject({ ok: false, error: { code: "invalid-reference", path: "/cards/0/parentId" } })
    expect(serializeCardPayload({ schemaVersion: 1, cards: [card("one", { parentId: "two" }), card("two", { parentId: "one" })] })).toMatchObject({ ok: false, error: { code: "parent-cycle" } })
  })

  it("不修改输入，并对 legacy 非法字符串返回错误而非替代 payload", () => {
    const input = {
      schemaVersion: 1,
      cards: [card("one", { linkedCardIds: ["one"] })]
    }
    const snapshot = structuredClone(input)

    expect(serializeCardPayload(input)).toMatchObject({ ok: true })
    expect(input).toEqual(snapshot)
    expect(parseCardPayload("{not-json")).toMatchObject({ ok: false, error: { code: "invalid-json" } })
    expect(parseCardPayload(JSON.stringify([card("legacy")]))).toMatchObject({ ok: false, error: { code: "invalid-shape" } })
  })

  it("候选提交同时检查 8KiB raw 与 JSON attr 预算", () => {
    const rawOverBudget = prepareCardPayloadCandidate({
      schemaVersion: 1,
      cards: [card("one", { content: "a".repeat(HNN_LIMITS.maxAttrBytes) })]
    })
    const escapedOverBudget = prepareCardPayloadCandidate({
      schemaVersion: 1,
      cards: [card("one", { content: "\"".repeat(3000) })]
    })
    const multibyteOverBudget = prepareCardPayloadCandidate({
      schemaVersion: 1,
      cards: [card("one", { content: "😀".repeat(2048) })]
    })
    const surrogateOverBudget = prepareCardPayloadCandidate({
      schemaVersion: 1,
      cards: [card("one", { content: "\ud800".repeat(1200) })]
    })

    expect(rawOverBudget.result).toMatchObject({ ok: false, error: { code: "attr-raw-too-large" } })
    expect(escapedOverBudget.result).toMatchObject({ ok: false, error: { code: "attr-json-too-large" } })
    expect(multibyteOverBudget.result).toMatchObject({ ok: false, error: { code: "attr-raw-too-large" } })
    expect(surrogateOverBudget.result).toMatchObject({ ok: false, error: { code: "attr-json-too-large" } })
  })
})
