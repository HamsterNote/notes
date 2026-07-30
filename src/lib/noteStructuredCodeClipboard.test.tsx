/** @vitest-environment jsdom */

import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteContentTransaction } from "./types"

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
  throw new Error("Expected text boundary")
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

const copy = (target: Element): Readonly<Record<string, string>> => {
  const values: Record<string, string> = {}
  const event = new Event("copy", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) => values[format] ?? "",
      setData: (format: string, value: string) => {
        values[format] = value
      },
    },
  })
  target.dispatchEvent(event)
  return values
}

const paste = (target: Element, values: Readonly<Record<string, string>>): void => {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format: string) => values[format] ?? "" },
  })
  target.dispatchEvent(event)
}

describe("structured clipboard code endpoints", () => {
  it("preserves a code block used as the back endpoint of a structured paste", () => {
    // Given: an internal fragment contains a picture and targets rich text through partial code.
    const source = render(
      <NoteContent
        title="Source"
        blocks={[
          { id: "source-front", kind: "paragraph", text: "Alpha" },
          { id: "source-picture", kind: "picture", url: "/back-source.png", filename: "Picture" },
          { id: "source-back", kind: "paragraph", text: "Omega" },
        ]}
      />,
    )
    const sourceFront = source.container.querySelector<HTMLElement>('[data-note-region-id="block:source-front"]')
    const sourceBack = source.container.querySelector<HTMLElement>('[data-note-region-id="block:source-back"]')
    if (!sourceFront || !sourceBack) throw new Error("Expected source regions")
    selectAcross(sourceFront, 2, sourceBack, 2)
    const clipboard = copy(source.container.querySelector("article") ?? source.container)
    source.unmount()

    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const target = render(
      <NoteContent
        editable
        title="Target"
        blocks={[
          { id: "target-front", kind: "paragraph", text: "Front" },
          {
            id: "target-code",
            kind: "code",
            code: "const <div>x</div> &copy; <strong>raw</strong>",
            language: "typescript",
            filename: "target.ts",
          },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const targetFront = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-front"]')
    const targetCode = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-code"]')
    if (!targetFront || !targetCode) throw new Error("Expected target regions")
    selectAcross(targetFront, 2, targetCode, 6)

    // When: the structure replaces a selection ending inside code.
    paste(target.container.querySelector("article") ?? target.container, clipboard)

    // Then: the back fragment remains raw code with its original metadata.
    const blocks = onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks
    expect(blocks?.map((block) => block.kind)).toEqual(["paragraph", "picture", "code"])
    expect(blocks?.[2]).toMatchObject({
      kind: "code",
      code: "Om<div>x</div> &copy; <strong>raw</strong>",
      language: "typescript",
      filename: "target.ts",
    })
  })

  it("keeps a partial highlighted code endpoint as raw source around inserted structure", () => {
    // Given: a copied range starts in highlighted code, crosses a picture, and ends in rich text.
    const source = render(
      <NoteContent
        title="Source"
        blocks={[
          { id: "source-code", kind: "code", code: "const value = 1", language: "typescript" },
          { id: "source-picture", kind: "picture", url: "/source.png", filename: "Source" },
          { id: "source-back", kind: "paragraph", text: "Omega" },
        ]}
      />,
    )
    const sourceCode = source.container.querySelector<HTMLElement>('[data-note-region-id="block:source-code"]')
    const sourceBack = source.container.querySelector<HTMLElement>('[data-note-region-id="block:source-back"]')
    if (!sourceCode || !sourceBack) throw new Error("Expected source endpoints")
    selectAcross(sourceCode, 6, sourceBack, 2)
    const clipboard = copy(source.container.querySelector("article") ?? source.container)
    source.unmount()

    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const target = render(
      <NoteContent
        editable
        title="Target"
        blocks={[
          { id: "target-code", kind: "code", code: "let target = 0", language: "typescript" },
          { id: "target-back", kind: "paragraph", text: "Back" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const targetCode = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-code"]')
    const targetBack = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-back"]')
    if (!targetCode || !targetBack) throw new Error("Expected target endpoints")
    selectAcross(targetCode, 4, targetBack, 2)

    // When: the internal fragment replaces a range whose front type is code.
    paste(target.container.querySelector("article") ?? target.container, clipboard)

    // Then: raw code contains no highlight or rich-text markup and structure remains ordered.
    const blocks = onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks
    expect(blocks?.map((block) => block.kind)).toEqual(["code", "picture", "paragraph"])
    expect(blocks?.[0]).toMatchObject({
      id: "target-code",
      kind: "code",
      code: "let value = 1",
    })
    expect(blocks?.[0]?.kind === "code" ? blocks[0].code : "").not.toMatch(/<(?:span|strong|br)\b/i)
    expect(blocks?.[1]).toMatchObject({ kind: "picture", url: "/source.png" })
    expect(blocks?.[2]).toMatchObject({ kind: "paragraph", text: "Omck" })
  })
})
