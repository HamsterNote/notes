/// <reference types="node" />

import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("editable text styles", () => {
  it("lets every editable line fill the available row width", () => {
    // Given: the stylesheet used by every contentEditable text surface.
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")

    // When: the shared editable layout rule is inspected.
    // Then: non-empty and empty lines both create an unconstrained block/flex item.
    expect(styles).toMatch(
      /\.hn-note-editable\s*\{[^}]*display:\s*block;[^}]*flex:\s*1 1 auto;[^}]*max-width:\s*none;[^}]*\}/
    )
  })

  it("keeps an empty editable line tall enough to receive pointer focus", () => {
    // Given: browsers represent an empty contentEditable as empty DOM or one <br>.
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")

    // When: the empty-state rule is inspected.
    // Then: either representation retains one clickable line of height.
    expect(styles).toMatch(
      /\.hn-note-editable:empty,\s*\.hn-note-editable:has\(> br:only-child\)\s*\{[^}]*min-height:\s*1lh;[^}]*\}/
    )
  })
})
