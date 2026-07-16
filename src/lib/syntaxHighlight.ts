import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("css", css)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("xml", xml)

const escapeCode = (code: string): string =>
  code
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;")

/**
 * 获取所有已注册的高亮语言名称（按字母排序）。
 * 用于代码块左上角语言选择下拉菜单的选项列表。
 * "text"（Plain Text）不在此列表中，由调用方单独添加，
 * 因为它不是 highlight.js 注册语言，而是 escapeCode 的回退行为。
 */
export const listSupportedLanguages = (): readonly string[] =>
  [...hljs.listLanguages()].sort()

export const highlightCode = (code: string, language: string): string => {
  const normalizedLanguage = language.trim().toLowerCase()
  if (!normalizedLanguage || !hljs.getLanguage(normalizedLanguage)) {
    return escapeCode(code)
  }
  return hljs.highlight(code, {
    language: normalizedLanguage,
    ignoreIllegals: true
  }).value
}
