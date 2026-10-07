import { describe, expect, it } from "vitest"

import { HNN_LIMITS } from "./limits"
import { getPersistedStringBudget } from "./persistedStringBudget"

describe("HNN 持久化字符串预算", () => {
  it("精确区分 raw 8KiB 与 JSON attr 8KiB 的边界", () => {
    const rawBoundary = "a".repeat(HNN_LIMITS.maxAttrBytes)
    const escapedBoundary = "\"".repeat((HNN_LIMITS.maxAttrBytes - 2) / 2)

    expect(getPersistedStringBudget(rawBoundary)).toMatchObject({
      rawBytes: HNN_LIMITS.maxAttrBytes,
      jsonBytes: HNN_LIMITS.maxAttrBytes + 2,
      error: { code: "attr-json-too-large" }
    })
    expect(getPersistedStringBudget(escapedBoundary)).toMatchObject({
      rawBytes: 4095,
      jsonBytes: HNN_LIMITS.maxAttrBytes
    })
  })

  it("区分原始 UTF-8、JSON 转义、多字节与未配对代理项的超限原因", () => {
    expect(getPersistedStringBudget("a".repeat(HNN_LIMITS.maxAttrBytes + 1)).error?.code).toBe("attr-raw-too-large")
    expect(getPersistedStringBudget("\"".repeat(4096)).error?.code).toBe("attr-json-too-large")
    expect(getPersistedStringBudget("汉".repeat(2731)).error?.code).toBe("attr-raw-too-large")
    expect(getPersistedStringBudget("\ud800".repeat(1366)).error?.code).toBe("attr-json-too-large")
  })
})
