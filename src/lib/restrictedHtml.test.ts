/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest"

import {
  sanitizeBodyHtml,
  sanitizeRestrictedHref,
  sanitizeTitleHtml
} from "./restrictedHtml"

describe("restricted rich text HTML", () => {
  it("keeps title formatting while removing unsupported wrappers", () => {
    // Given: title HTML contains allowed formatting and an unsupported link.
    const html = '<a href="https://example.com"><strong>Safe</strong></a><code>code</code>'

    // When: the title allowlist sanitizes the field.
    const sanitized = sanitizeTitleHtml(html)

    // Then: readable text and title formatting remain without the link.
    expect(sanitized).toBe("<strong>Safe</strong><code>code</code>")
  })

  it("removes executable body HTML and unsafe URLs", () => {
    // Given: body HTML contains script, event handlers, and a JavaScript URL.
    const html = '<p onclick="alert(1)">Text<script>alert(1)</script><a href="javascript:alert(1)">link</a></p>'

    // When: the body allowlist sanitizes the field.
    const sanitized = sanitizeBodyHtml(html)

    // Then: executable content is absent while readable text remains.
    expect(sanitized).toBe('Text<a>link</a>')
  })

  it("preserves supported HamsterNote inline metadata", () => {
    // Given: inline formula and mention spans use supported metadata.
    const html = '<span class="hn-note-inline-formula" data-hn-inline-formula="x+y" contenteditable="false">x+y</span><span data-note-link-id="note-1">Note</span>'

    // When: body HTML is sanitized.
    const sanitized = sanitizeBodyHtml(html)

    // Then: only the supported metadata survives.
    expect(sanitized).toContain('data-hn-inline-formula="x+y"')
    expect(sanitized).toContain('data-note-link-id="note-1"')
    expect(sanitized).toContain('contenteditable="false"')
  })

  it("normalizes browser color markup and rejects unsafe link schemes", () => {
    // Given: browser-generated font markup and an attacker-controlled link value.
    const html = '<font color="#EF4444">red</font><span data-hn-color="#123456">bad</span>'

    // When: the body HTML and link boundary are sanitized.
    const sanitized = sanitizeBodyHtml(html)

    // Then: only the fixed palette survives and JavaScript is rejected before DOM mutation.
    expect(sanitized).toBe('<span data-hn-color="#ef4444">red</span><span>bad</span>')
    expect(sanitizeRestrictedHref("javascript:alert(1)")).toBeNull()
    expect(sanitizeRestrictedHref("HNMagic://card/1")).toBeNull()
    expect(sanitizeRestrictedHref("hnmagic://card/1")).toBe("hnmagic://card/1")
  })
})
