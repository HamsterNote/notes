import { describe, expect, it } from "vitest"

import { parseCardData } from "./cardData"

describe("parseCardData", () => {
  it("strips renderer styles and unknown fields from fenced JSON", () => {
    // Given: untrusted Markdown contains renderer-only styles and extra data.
    const value = JSON.stringify([
      {
        id: "release",
        title: "Release",
        content: "Ready",
        x: 0,
        y: 0,
        width: 240,
        height: 144,
        titleStyle: { position: "fixed" },
        unknown: "discard me"
      }
    ])

    // When: the fenced JSON crosses the card-data boundary.
    const cards = parseCardData(value)

    // Then: only the persisted card schema reaches the renderer.
    expect(cards).toEqual([
      {
        id: "release",
        title: "Release",
        content: "Ready",
        x: 0,
        y: 0,
        width: 240,
        height: 144
      }
    ])
  })

  it("rejects non-finite dimensions and oversized card collections", () => {
    // Given: JSON values that could crash geometry or exhaust the renderer.
    const infiniteWidth =
      '[{"id":"release","title":"Release","content":"Ready","x":0,"y":0,"width":1e999,"height":144}]'
    const tooManyCards = JSON.stringify(
      Array.from({ length: 501 }, (_, index) => ({
        id: `card-${index}`,
        title: "Card",
        content: "",
        x: index,
        y: 0,
        width: 240,
        height: 144
      }))
    )

    // When: the values are parsed.
    const infiniteResult = parseCardData(infiniteWidth)
    const oversizedResult = parseCardData(tooManyCards)

    // Then: neither unsafe collection is accepted as card data.
    expect(infiniteResult).toBeUndefined()
    expect(oversizedResult).toBeUndefined()
  })

  it("preserves a valid card lock and rejects an invalid lock value", () => {
    // Given: persisted cards contain either a boolean lock or an invalid lock.
    const lockedCard = JSON.stringify([
      {
        id: "locked-card",
        title: "Locked",
        content: "",
        x: 0,
        y: 0,
        width: 240,
        height: 144,
        lock: true
      }
    ])
    const invalidLock = lockedCard.replace('"lock":true', '"lock":"true"')

    // When: both values cross the persisted card-data boundary.
    const lockedResult = parseCardData(lockedCard)
    const invalidResult = parseCardData(invalidLock)

    // Then: the boolean lock round-trips while the invalid value is rejected.
    expect(lockedResult?.[0]?.lock).toBe(true)
    expect(invalidResult).toBeUndefined()
  })
})
