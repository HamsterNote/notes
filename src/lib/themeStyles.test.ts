/// <reference types="node" />

import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const readSource = (fileName: string): string =>
  readFileSync(new URL(fileName, import.meta.url), "utf8")

describe("NoteContent theme contract", () => {
  it("keeps outer-container presentation under host control", () => {
    // Given: the component shell CSS is consumed inside an arbitrary host layout.
    const styles = readSource("./styles.css")
    const shellRule = styles.match(/\.hn-note-shell\s*\{([^}]*)\}/)?.[1]

    // When: the root shell declarations are inspected.
    // Then: the component does not impose outer sizing or surface decoration.
    expect(shellRule).toBeDefined()
    expect(shellRule).not.toMatch(
      /\n\s*(?:max-width|background|border(?:-radius)?|box-shadow)\s*:/
    )
  })

  it("selects light or dark tokens through the public theme prop", () => {
    // Given: consumers need deterministic theme selection independent of OS settings.
    const componentSource = readSource("./NoteContent.tsx")
    const typeSource = readSource("./types.ts")
    const styles = readSource("./styles.css")

    // When: the public prop, root class, and dark token set are inspected.
    // Then: all three layers expose the explicit light/dark contract.
    expect(typeSource).toContain('export type NoteTheme = "light" | "dark"')
    expect(componentSource).toContain('theme = "light"')
    expect(componentSource).toContain("hn-note-shell--$" + "{theme}")
    expect(styles).toContain(".hn-note-shell--dark")
  })
})
