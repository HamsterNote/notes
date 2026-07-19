import { afterEach, describe, expect, it, vi } from "vitest"

import { createNoteId } from "./noteId"

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

describe("createNoteId", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates unique UUID v4 identifiers for persisted note data", () => {
  // Given: a batch representing newly created blocks and todo items.
    // When: each record receives an ID through the public generator.
    const ids = Array.from({ length: 32 }, createNoteId)

    // Then: every ID has UUID v4 shape and is unique within the batch.
    expect(ids.every((id) => UUID_V4_PATTERN.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    // Given: crypto.randomUUID is missing, e.g. in a non-secure HTTP context.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.crypto,
      "randomUUID"
    )
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined
    })

    // When: generating an ID.
    try {
      const id = createNoteId()

      // Then: it still produces a valid UUID v4.
      expect(UUID_V4_PATTERN.test(id)).toBe(true)
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          globalThis.crypto,
          "randomUUID",
          originalDescriptor
        )
      } else {
        Reflect.deleteProperty(globalThis.crypto, "randomUUID")
      }
    }
  })
})
