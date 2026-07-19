/** 为新建的持久化块或 todo 条目生成标准 UUID v4。 */
export const createNoteId = (): string => {
  const crypto = globalThis.crypto

  // crypto.randomUUID 仅在安全上下文（HTTPS 或 localhost）中可用。
  // 当它在例如局域网 HTTP 开发环境缺失时，回退到 getRandomValues 手动拼装。
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID()
  }

  if (!crypto) {
    throw new Error("Web Crypto API is not available in this environment")
  }

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  // version = 4
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  // variant = 10 (RFC 4122)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-")
}
