/** HNN 持久化与运行时 Link extension 共用的 URL 白名单。 */
const UNSAFE_URL_CODE_POINT =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u

/**
 * 检查 URL 的 UTF-16 代理项和 Unicode 安全类别。先检查代理项，避免把 malformed
 * 字符串交给 URL 构造器或 Unicode 正则后产生含混行为。
 */
export function hasUnsafeHnnUrlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    let end = index + 1
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true
      end += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
    // RegExp 的 u 标志会把配对代理项作为一个 code point 处理。
    if (UNSAFE_URL_CODE_POINT.test(value.slice(index, end))) return true
    index = end - 1
  }
  return false
}

/** 仅允许 HNN v1 规定的绝对协议，禁止相对链接、tel: 和所有浏览器危险协议。 */
export function isSafeHnnUrl(value: string): boolean {
  if (value.trim() !== value || hasUnsafeHnnUrlCharacters(value)) return false
  try {
    const parsed = new URL(value)
    return (
      ["http:", "https:", "mailto:", "hnmagic:"].includes(parsed.protocol) &&
      value.startsWith(parsed.protocol)
    )
  } catch {
    return false
  }
}
