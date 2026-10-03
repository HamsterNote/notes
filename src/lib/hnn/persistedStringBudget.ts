import { HNN_LIMITS } from "./limits"
import { jsonStringBytes, utf8Bytes } from "./stringBytes"

/** 可直接展示给 Drawer 的持久化字符串预算失败。 */
export interface PersistedStringBudgetError {
  readonly code: "attr-raw-too-large" | "attr-json-too-large"
  readonly message: string
}

/**
 * HNN 字符串 attr 的双重预算。
 *
 * `rawBytes` 是 data 本身的 UTF-8 字节数；`jsonBytes` 是该 data 作为 HNN
 * attr 被 JSON.stringify 后的字节数（包含引号与转义）。两者都必须满足
 * maxAttrBytes，避免 Drawer 仅按可见字符数预检而提交一个不能编码的 HNN。
 */
export interface PersistedStringBudget {
  readonly rawBytes: number
  readonly jsonBytes: number
  readonly maxBytes: number
  readonly error?: PersistedStringBudgetError
}

export function getPersistedStringBudget(value: string): PersistedStringBudget {
  const rawBytes = utf8Bytes(value)
  const jsonBytes = jsonStringBytes(value)
  const maxBytes = HNN_LIMITS.maxAttrBytes

  if (rawBytes > maxBytes) {
    return {
      rawBytes,
      jsonBytes,
      maxBytes,
      error: {
        code: "attr-raw-too-large",
        message: `数据原始 UTF-8 编码超过 ${maxBytes} 字节`
      }
    }
  }
  if (jsonBytes > maxBytes) {
    return {
      rawBytes,
      jsonBytes,
      maxBytes,
      error: {
        code: "attr-json-too-large",
        message: `数据作为 HNN attr 序列化后超过 ${maxBytes} 字节`
      }
    }
  }
  return { rawBytes, jsonBytes, maxBytes }
}

export function isPersistedStringWithinHnnAttrBudget(value: string): boolean {
  return getPersistedStringBudget(value).error === undefined
}
