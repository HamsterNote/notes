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

describe("block action handle layout", () => {
  it("positions handles absolutely so they do not consume row width", () => {
    // Given: the stylesheet that renders the left gutter controls.
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")

    // Then: the row establishes positioning context and handles sit outside flow.
    expect(styles).toMatch(
      /\.hn-note-block-row\s*\{[^}]*position:\s*relative;[^}]*\}/
    )
    expect(styles).toMatch(
      /\.hn-note-block-handle\s*\{[^}]*position:\s*absolute;[^}]*\}/
    )
  })

  it("places add and convert handles side-by-side in the left gutter", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")

    // Then: the two handle variants have distinct horizontal offsets and share size.
    expect(styles).toMatch(
      /\.hn-note-block-handle--convert\s*\{[^}]*right:\s*calc\(100%\s*\+\s*4px\);[^}]*\}/
    )
    expect(styles).toMatch(
      /\.hn-note-block-handle--add\s*\{[^}]*right:\s*calc\(100%\s*\+\s*32px\);[^}]*\}/
    )
    expect(styles).toMatch(
      /\.hn-note-block-handle\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*\}/
    )
  })

  it("keeps the content area as the sole in-flow flex child", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")

    // Then: content still stretches to fill the row without being pushed by handles.
    expect(styles).toMatch(
      /\.hn-note-block-content\s*\{[^}]*flex:\s*1 1 0%;[^}]*min-width:\s*0;[^}]*\}/
    )
  })
})

describe("editable code styles", () => {
  it("keeps a highlighted code layer visible while the plain-text editor is active", () => {
    // Given: the code block component switches from its preview to an editor on focus.
    const source = readFileSync(
      new URL("./NoteCodeEditorBlock.tsx", import.meta.url),
      "utf8"
    )

    // When: the editing branch is inspected.
    // Then: it renders a live highlight layer and updates it from editor input.
    expect(source).toMatch(/className=.*hn-note-code-highlight/)
    expect(source).toMatch(/onInput=.*setDraftCode/s)
  })

  it("uses one typography contract for preview, highlight, and editor layers", () => {
    // Given: every code surface must occupy the same pixels when editing starts.
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")

    // When: the shared code surface styles are inspected.
    // Then: all layers use the same explicit monospace token, size, and line height.
    expect(styles).toMatch(
      /\.hn-note-code-card pre,\s*\.hn-note-code-editor,\s*\.hn-note-code-preview,\s*\.hn-note-code-highlight\s*\{[^}]*font-family:\s*var\(--hn-code-font\);[^}]*font-size:\s*0\.9rem;[^}]*line-height:\s*1\.7;/
    )
    expect(styles).toMatch(
      /\.hn-note-code-editor\s*\{[^}]*color:\s*transparent;[^}]*caret-color:\s*#e2e8f0;/
    )
  })

  it("keeps code editing plain-text, IME-safe, and accessibly named", () => {
    // Given: the transparent editor must remain aligned with its highlighted layer.
    const source = readFileSync(
      new URL("./NoteCodeEditorBlock.tsx", import.meta.url),
      "utf8"
    )

    // When: paste and keyboard input handlers are inspected.
    // Then: rich paste is flattened, composition keys bypass block splitting,
    // and the active textbox retains the preview action's accessible name.
    expect(source).toMatch(/onPaste=.*clipboardData\.getData\("text\/plain"\)/s)
    expect(source).toMatch(/if \(event\.nativeEvent\.isComposing\) return/)
    expect(source).toMatch(/ref=\{editorRef\}\s*aria-label=\{.*编辑代码/s)
  })
})
