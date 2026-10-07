import { describe, expect, it } from "vitest"

import { jsonCharBytes, jsonStringBytes, utf8Bytes } from "./stringBytes"

/**
 * 以 TextEncoder / JSON.stringify 的真实输出为基准真值，交叉验证共享宽度表。
 * codec 的严格校验与编辑器 UI 预检都依赖这份口径，任何漂移都会在这里暴露。
 */
describe("hnn stringBytes 共享计数工具", () => {
  it("utf8Bytes 与 TextEncoder 编码长度全字符类别一致", () => {
    const samples = [
      "",
      "ascii only",
      "é", // 2 字节
      "汉", // 3 字节
      "😀", // 合法代理对：4 字节
      "\n\t\"\\", // 控制符与需转义字符：原始编码各 1 字节
      "\x00\x1f", // C0 控制符：各 1 字节
      "\ud800", // 未配对高代理项：3 字节（U+FFFD）
      "\udc00", // 未配对低代理项：3 字节
      "\udc00\udc00", // 连续低代理项不是代理对：3+3
      "\ud800x", // 高代理项 + 普通字符：3+1
      "x\udc00", // 普通字符 + 低代理项：1+3
      "a汉😀\ud800é" // 混合
    ]
    for (const sample of samples) {
      expect(utf8Bytes(sample), JSON.stringify(sample)).toBe(new TextEncoder().encode(sample).length)
    }
  })

  it("jsonStringBytes 与 JSON.stringify 编码长度全字符类别一致", () => {
    const samples = [
      "",
      "ascii only",
      "\"", // 引号：2 字节转义
      "\\", // 反斜杠：2 字节转义
      "\n\t\b\f\r", // 具名转义：各 2 字节
      "\x01\x1f", // 其余 C0：\u00XX 各 6 字节
      "\x0b", // 垂直制表符不在具名转义之列：6 字节
      "\x7f", // DEL 不转义：1 字节
      "汉", // 原样输出：3 字节
      "😀", // 合法代理对原样输出：4 字节
      "\ud800", // 未配对高代理项：\uXXXX 6 字节
      "\udc00", // 未配对低代理项：\uXXXX 6 字节
      "\udc00\udc00", // 连续低代理项：6+6
      "a汉😀\"\\\n\x01\ud800" // 混合
    ]
    for (const sample of samples) {
      expect(jsonStringBytes(sample), JSON.stringify(sample)).toBe(new TextEncoder().encode(JSON.stringify(sample)).length)
    }
  })

  it("修正 low-surrogate pair 检测：连续低代理项各计 3/6 字节而非代理对", () => {
    // 旧实现把「低代理项 + 低代理项」误判为代理对（4 字节），codec 口径是各计 3 字节。
    expect(utf8Bytes("\udc00\udc00")).toBe(6)
    expect(jsonStringBytes("\udc00\udc00")).toBe(14) // 2 外层引号 + 6 + 6
    expect(jsonCharBytes("\udc00\udc00", 0)).toEqual({ bytes: 6, units: 1 })
    // 合法高低代理对仍按 4 字节、消耗 2 码元
    expect(jsonCharBytes("😀", 0)).toEqual({ bytes: 4, units: 2 })
  })

  it("精确边界值（供 UI/codec 上限测试引用）", () => {
    expect(utf8Bytes("😀".repeat(128))).toBe(512)
    expect(utf8Bytes("汉".repeat(170) + "ab")).toBe(512)
    expect(jsonStringBytes("\"".repeat(4095))).toBe(8192)
    expect(jsonStringBytes("\"".repeat(4096))).toBe(8194)
  })
})
