import { describe, expect, it } from "vitest"

import { highlightCode } from "./syntaxHighlight"

describe("highlightCode", () => {
  it("highlights a registered language", () => {
    // Given: TypeScript source and a supported language alias.
    // When: syntax highlighting is requested.
    const html = highlightCode("const count: number = 1", "tsx")

    // Then: Highlight.js emits token spans instead of plain source.
    expect(html).toContain("hljs-keyword")
    expect(html).toContain("hljs-built_in")
  })

  it("escapes code for an unknown language", () => {
    // Given: source containing HTML and an unsupported language.
    // When: the safe fallback is used.
    const html = highlightCode("<script>alert('&')</script>", "unknown-lang")

    // Then: no executable markup reaches the DOM.
    expect(html).toBe("&lt;script&gt;alert(&#x27;&amp;&#x27;)&lt;/script&gt;")
  })
})
