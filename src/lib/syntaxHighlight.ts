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
