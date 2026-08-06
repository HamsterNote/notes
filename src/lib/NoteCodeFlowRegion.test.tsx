/** @vitest-environment jsdom */

import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => new DOMRect(),
})

const textBoundary = (root: HTMLElement, offset: number): readonly [Text, number] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  while (node) {
    if (node instanceof Text) {
      if (remaining <= node.data.length) return [node, remaining]
      remaining -= node.data.length
    }
    node = walker.nextNode()
  }
  throw new Error("Expected code text boundary")
}

const selectAcross = (
  startRoot: HTMLElement,
  startOffset: number,
  endRoot: HTMLElement,
  endOffset: number,
): void => {
  const [start, localStart] = textBoundary(startRoot, startOffset)
  const [end, localEnd] = textBoundary(endRoot, endOffset)
  const range = document.createRange()
  range.setStart(start, localStart)
  range.setEnd(end, localEnd)
  const selection = window.getSelection()
  if (!selection) throw new Error("Expected browser selection")
  selection.removeAllRanges()
  selection.addRange(range)
}

describe("NoteCodeBlock note text flow region", () => {
  it("keeps one canonical pre region while the native editor is open", () => {
    // Given: an editable code block rendered in the note text flow.
    const onBlocksChange = vi.fn<(blocks: NoteBlock[]) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Code"
        blocks={[{
          id: "code",
          kind: "code",
          code: "const value = 1",
          language: "typescript",
        }]}
        onBlocksChange={onBlocksChange}
      />,
    )

    // When: the always-available native code editor is changed.
    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑代码"]')
    if (!editor) throw new Error("Expected native code editor")
    fireEvent.change(editor, { target: { value: "const value = 2" } })

    // Then: only the pre is a flow region and it mirrors the draft.
    const regions = container.querySelectorAll('[data-note-region-id="block:code"]')
    expect(regions).toHaveLength(1)
    expect(regions[0]?.tagName).toBe("PRE")
    expect(regions[0]?.textContent).toBe("const value = 2")
    expect(editor.getAttribute("data-note-region-id")).toBeNull()
  })

  it("renders highlighted source as escaped text while retaining token classes", () => {
    // Given: code containing markup-like text in a supported language.
    const { container } = render(
      <NoteContent
        title="Code"
        blocks={[{
          id: "code",
          kind: "code",
          code: 'const attack = "<img src=x onerror=alert(1)>"',
          language: "typescript",
        }]}
      />,
    )

    // When: the canonical code preview is rendered.
    const region = container.querySelector<HTMLElement>('[data-note-region-id="block:code"]')

    // Then: source remains literal text and highlight.js classes survive.
    expect(region?.querySelector("img")).toBeNull()
    expect(region?.textContent).toContain("<img src=x onerror=alert(1)>")
    expect(region?.querySelector('[class^="hljs-"]')).not.toBeNull()
  })

  it("keeps code as raw plain text when a selection continues into rich text", () => {
    // Given: a continuous selection starts inside highlighted code and ends in a paragraph.
    const onBlocksChange = vi.fn<(blocks: NoteBlock[]) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Code"
        blocks={[
          { id: "code", kind: "code", code: "const value = 1", language: "typescript" },
          { id: "body", kind: "paragraph", text: "Omega" },
        ]}
        onBlocksChange={onBlocksChange}
      />,
    )
    const code = container.querySelector<HTMLElement>('[data-note-region-id="block:code"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!code || !body) throw new Error("Expected code and body regions")
    selectAcross(code, 6, body, 2)

    // When: literal markup-like text replaces the selected range.
    ;(container.querySelector("article") ?? container).dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "<x>",
      inputType: "insertText",
    }))

    // Then: the front code type is retained and receives raw text without highlight HTML.
    expect(onBlocksChange).toHaveBeenCalledWith([{
      id: "code",
      kind: "code",
      code: "const <x>ega",
      language: "typescript",
    }])
  })

  it("leaves native editor clipboard events inside the code editor", () => {
    // Given: an open code editor and a stale continuous note selection.
    const onNoteTransaction = vi.fn()
    const { container } = render(
      <NoteContent
        editable
        title="Code"
        blocks={[
          { id: "front", kind: "paragraph", text: "Alpha" },
          { id: "code", kind: "code", code: "value", language: "text" },
          { id: "back", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const front = container.querySelector<HTMLElement>('[data-note-region-id="block:front"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:back"]')
    if (!front || !back) throw new Error("Expected body regions")
    selectAcross(front, 2, back, 2)
    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑代码"]')
    if (!editor) throw new Error("Expected native code editor")

    // When: paste bubbles from the native textarea.
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { getData: () => "native" },
    })
    const nativeDefaultContinues = editor.dispatchEvent(pasteEvent)

    // Then: the note transaction layer neither cancels nor commits it.
    expect(nativeDefaultContinues).toBe(true)
    expect(onNoteTransaction).not.toHaveBeenCalled()
  })
})
