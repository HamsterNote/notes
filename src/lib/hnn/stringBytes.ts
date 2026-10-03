/**
 * HNN 字符串字节计数共享工具（纯模块，零依赖）。
 *
 * codec 的严格校验与编辑器 UI 的提交前预检必须共用同一份宽度表，
 * 任何一方单独维护都可能产生口径漂移（例如把连续低代理项误计为代理对）。
 * 所有口径均以 TextEncoder / JSON.stringify 的真实输出为准。
 */

/** 单个字符的字节宽度与其消耗的 UTF-16 码元数（合法代理对消耗 2 个码元）。 */
export interface CharByteWidth {
  bytes: number
  units: number
}

/**
 * 原始 UTF-8 编码宽度（与 TextEncoder 一致）：
 * 合法代理对计 4 字节；未配对的高/低代理项各自按替换符 U+FFFD 计 3 字节。
 * 注意只有“高代理项 + 低代理项”才是代理对，连续低代理项必须各计 3 字节。
 */
export function utf8CharBytes(value: string, index: number): CharByteWidth {
  const unit = value.charCodeAt(index)
  if (unit < 0x80) return { bytes: 1, units: 1 }
  if (unit < 0x800) return { bytes: 2, units: 1 }
  if (unit >= 0xd800 && unit <= 0xdbff) {
    // 越界时 charCodeAt 返回 NaN，比较恒为 false，自然落入未配对分支。
    const next = value.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) return { bytes: 4, units: 2 }
  }
  return { bytes: 3, units: 1 }
}

/**
 * JSON.stringify 字符串字面量内单个字符的 UTF-8 宽度（不含外层引号）：
 * 引号/反斜杠与 \b \t \n \f \r 展开为 2 字节转义；其余 C0 控制符展开为 \u00XX（6 字节）；
 * 合法代理对原样输出（4 字节 UTF-8）；未配对代理项转义为 \uXXXX（6 字节）。
 */
export function jsonCharBytes(value: string, index: number): CharByteWidth {
  const unit = value.charCodeAt(index)
  if (unit === 0x22 || unit === 0x5c || unit === 0x08 || unit === 0x09 || unit === 0x0a || unit === 0x0c || unit === 0x0d) {
    return { bytes: 2, units: 1 }
  }
  if (unit < 0x20) return { bytes: 6, units: 1 }
  if (unit < 0x80) return { bytes: 1, units: 1 }
  if (unit < 0x800) return { bytes: 2, units: 1 }
  if (unit >= 0xd800 && unit <= 0xdbff) {
    const next = value.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) return { bytes: 4, units: 2 }
    // Well-formed JSON.stringify 对未配对代理项输出 \uXXXX 转义。
    return { bytes: 6, units: 1 }
  }
  if (unit >= 0xdc00 && unit <= 0xdfff) return { bytes: 6, units: 1 }
  return { bytes: 3, units: 1 }
}

/** 原始 UTF-8 字节总数，与 new TextEncoder().encode(value).length 一致。 */
export function utf8Bytes(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length;) {
    const step = utf8CharBytes(value, index)
    bytes += step.bytes
    index += step.units
  }
  return bytes
}

/** JSON.stringify(value) 的精确 UTF-8 字节总数（含外层引号与全部转义展开）。 */
export function jsonStringBytes(value: string): number {
  let bytes = 2 // opening and closing quotes
  for (let index = 0; index < value.length;) {
    const step = jsonCharBytes(value, index)
    bytes += step.bytes
    index += step.units
  }
  return bytes
}
