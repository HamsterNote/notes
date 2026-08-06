/** @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import { parseStructuredClipboard } from "./noteStructuredClipboard"
import type { NoteContentTransaction } from "./types"

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => new DOMRect(),
})

const selectAcross = (start: Text, startOffset: number, end: Text, endOffset: number) => {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const selection = window.getSelection()
  if (!selection) throw new Error("Expected browser selection")
  selection.removeAllRanges()
  selection.addRange(range)
}

const paste = (target: Element, values: Readonly<Record<string, string>>): boolean => {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format: string) => values[format] ?? "" },
  })
  return target.dispatchEvent(event)
}

const drop = (target: Element, values: Readonly<Record<string, string>>): boolean => {
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: { getData: (format: string) => values[format] ?? "" },
  })
  return target.dispatchEvent(event)
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

const cut = (target: Element): Readonly<Record<string, string>> => {
  const values: Record<string, string> = {}
  const event = new Event("cut", { bubbles: true, cancelable: true })
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

describe("NoteContent continuous selection clipboard", () => {
  it("serializes each readonly strict-middle structure exactly once", () => {
    // Given: readonly text endpoints surround quote, table, and expanded collapsible structures.
    const { container } = render(
      <NoteContent
        title="Note"
        blocks={[
          { id: "front", kind: "paragraph", text: "Alpha" },
          { id: "quote", kind: "quote", text: "First\nSecond", author: "Author" },
          { id: "table", kind: "table", rows: [["A"], ["B"]] },
          {
            id: "fold",
            kind: "collapsible",
            title: "Details",
            collapsed: false,
            blocks: [{ id: "nested", kind: "paragraph", text: "Nested" }],
          },
          { id: "back", kind: "paragraph", text: "Omega" },
        ]}
      />,
    )
    const front = container.querySelector<HTMLElement>('[data-note-region-id="block:front"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:back"]')
    if (!(front?.firstChild instanceof Text) || !(back?.firstChild instanceof Text)) {
      throw new Error("Expected readonly text endpoints")
    }
    selectAcross(front.firstChild, 2, back.firstChild, 2)

    // When: the complete middle structures are copied.
    const clipboard = copy(container.querySelector("article") ?? container)
    const internal = parseStructuredClipboard(
      clipboard["application/x-hamsternote-fragment+json"] ?? "",
    )

    // Then: each top-level structure is represented once without row or nested duplication.
    expect(internal?.slices.map((slice) => "block" in slice ? slice.block.kind : slice.kind)).toEqual([
      "quote",
      "table",
      "collapsible",
    ])
  })

  it("keeps complete sibling regions from a structured front boundary", () => {
    // Given: a selection starts inside one Todo item and crosses its complete sibling into a later block.
    const { container } = render(
      <NoteContent
        title="Note"
        blocks={[
          {
            id: "tasks",
            kind: "todo",
            title: "Tasks",
            items: [
              { id: "first-task", checked: false, text: "Alpha" },
              { id: "second-task", checked: true, text: "Middle sibling" },
            ],
          },
          { id: "back", kind: "paragraph", text: "Omega" },
        ]}
      />,
    )
    const first = container.querySelector<HTMLElement>('[data-note-region-id="block:first-task"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:back"]')
    if (!(first?.firstChild instanceof Text) || !(back?.firstChild instanceof Text)) {
      throw new Error("Expected structured text endpoints")
    }
    selectAcross(first.firstChild, 2, back.firstChild, 2)

    // When: the structured boundary selection is copied.
    const clipboard = copy(container.querySelector("article") ?? container)

    // Then: every semantic flavor retains the fully selected sibling Todo item.
    expect(clipboard["text/plain"]).toContain("Middle sibling")
    expect(clipboard["text/html"]).toContain("Middle sibling")
    expect(clipboard["application/x-hamsternote-fragment+json"]).toContain("Middle sibling")
  })

  it("writes a fully selected atomic picture before cutting it", () => {
    // Given: a picture is the sole fully selected atomic unit.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Note"
        blocks={[{ id: "sole-picture", kind: "picture", url: "/sole.png", filename: "Sole picture" }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const picture = container.querySelector<HTMLElement>('[data-note-atomic-id="block:sole-picture"]')
    if (!picture) throw new Error("Expected atomic picture")
    const range = document.createRange()
    range.selectNode(picture)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the atomic unit is cut.
    const clipboard = cut(container.querySelector("article") ?? container)

    // Then: every clipboard flavor contains the picture before one transaction removes it.
    expect(clipboard["text/plain"]).toContain("Sole picture")
    expect(clipboard["text/html"]).toContain("/sole.png")
    expect(clipboard["application/x-hamsternote-fragment+json"]).toContain("/sole.png")
    expect(onNoteTransaction).toHaveBeenCalledOnce()
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks).toEqual([])
  })

  it("includes an atomic unit when it is the front endpoint", () => {
    // Given: a continuous selection starts before a picture and ends inside following text.
    const { container } = render(
      <NoteContent
        title="Note"
        blocks={[
          { id: "front-picture", kind: "picture", url: "/front.png", filename: "Front picture" },
          { id: "front-back", kind: "paragraph", text: "Omega" },
        ]}
      />,
    )
    const picture = container.querySelector<HTMLElement>('[data-note-atomic-id="block:front-picture"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:front-back"]')
    if (!picture || !(back?.firstChild instanceof Text)) throw new Error("Expected atomic and text endpoints")
    const range = document.createRange()
    range.setStartBefore(picture)
    range.setEnd(back.firstChild, 2)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the mixed continuous range is copied.
    const clipboard = copy(container.querySelector("article") ?? container)

    // Then: the front atomic unit and trailing text both survive semantically.
    expect(clipboard["text/plain"]).toBe("Front picture\nOm")
    expect(clipboard["text/html"]).toContain("/front.png")
    expect(clipboard["application/x-hamsternote-fragment+json"]).toContain("/front.png")
  })

  it("serializes a fully selected atomic unit nested in an expanded collapsible", () => {
    // Given: an expanded collapsible contains a nested picture selected as one unit.
    const { container } = render(
      <NoteContent
        title="Note"
        blocks={[{
          id: "nested-fold",
          kind: "collapsible",
          title: "Details",
          collapsed: false,
          blocks: [{ id: "nested-picture", kind: "picture", url: "/nested.png", filename: "Nested picture" }],
        }]}
      />,
    )
    const picture = container.querySelector<HTMLElement>('[data-note-atomic-id="block:nested-picture"]')
    if (!picture) throw new Error("Expected nested atomic picture")
    const range = document.createRange()
    range.selectNode(picture)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the nested atomic unit is copied.
    const clipboard = copy(container.querySelector("article") ?? container)

    // Then: recursive lookup preserves it in all clipboard flavors.
    expect(clipboard["text/plain"]).toContain("Nested picture")
    expect(clipboard["text/html"]).toContain("/nested.png")
    expect(clipboard["application/x-hamsternote-fragment+json"]).toContain("/nested.png")
  })

  it("deletes from nested text through a nested atomic unit", () => {
    // Given: an expanded collapsible contains a text edge, a picture, and an untouched sibling.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Note"
        blocks={[{
          id: "fold-text-atomic",
          kind: "collapsible",
          title: "Details",
          collapsed: false,
          blocks: [
            { id: "nested-front", kind: "paragraph", text: "Alpha" },
            { id: "nested-cut-picture", kind: "picture", url: "/cut.png", filename: "Cut picture" },
            { id: "nested-after", kind: "paragraph", text: "After" },
          ],
        }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const front = container.querySelector<HTMLElement>('[data-note-region-id="block:nested-front"]')
    const picture = container.querySelector<HTMLElement>('[data-note-atomic-id="block:nested-cut-picture"]')
    if (!(front?.firstChild instanceof Text) || !picture) throw new Error("Expected nested endpoints")
    const range = document.createRange()
    range.setStart(front.firstChild, 2)
    range.setEndAfter(picture)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    // When: the mixed nested range is deleted.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    }))

    // Then: the front fragment and untouched sibling remain inside the same collapsible.
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks).toEqual([{
      id: "fold-text-atomic",
      kind: "collapsible",
      title: "Details",
      collapsed: false,
      blocks: [
        { id: "nested-front", kind: "paragraph", text: "Al" },
        { id: "nested-after", kind: "paragraph", text: "After" },
      ],
    }])
  })

  it("deletes from a nested atomic unit into nested text", () => {
    // Given: an expanded collapsible starts with a picture followed by two text children.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Note"
        blocks={[{
          id: "fold-atomic-text",
          kind: "collapsible",
          title: "Details",
          collapsed: false,
          blocks: [
            { id: "nested-start-picture", kind: "picture", url: "/start.png", filename: "Start picture" },
            { id: "nested-back", kind: "paragraph", text: "Omega" },
            { id: "nested-tail", kind: "paragraph", text: "Tail" },
          ],
        }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const picture = container.querySelector<HTMLElement>('[data-note-atomic-id="block:nested-start-picture"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:nested-back"]')
    if (!picture || !(back?.firstChild instanceof Text)) throw new Error("Expected nested endpoints")
    const range = document.createRange()
    range.setStartBefore(picture)
    range.setEnd(back.firstChild, 2)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    // When: the mixed nested range is deleted.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    }))

    // Then: the back suffix and later sibling remain in their original collapsible.
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks).toEqual([{
      id: "fold-atomic-text",
      kind: "collapsible",
      title: "Details",
      collapsed: false,
      blocks: [
        { id: "nested-back", kind: "paragraph", text: "ega" },
        { id: "nested-tail", kind: "paragraph", text: "Tail" },
      ],
    }])
  })

  it("pastes structured content across nested text and atomic endpoints", () => {
    // Given: an internal picture fragment and a target range inside one expanded collapsible.
    const source = render(
      <NoteContent
        title="Source"
        blocks={[{ id: "source-nested-picture", kind: "picture", url: "/source-nested.png", filename: "Source picture" }]}
      />,
    )
    const sourcePicture = source.container.querySelector<HTMLElement>('[data-note-atomic-id="block:source-nested-picture"]')
    if (!sourcePicture) throw new Error("Expected source picture")
    const sourceRange = document.createRange()
    sourceRange.selectNode(sourcePicture)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(sourceRange)
    const clipboard = copy(source.container.querySelector("article") ?? source.container)
    source.unmount()

    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const target = render(
      <NoteContent
        editable
        title="Target"
        blocks={[{
          id: "paste-fold",
          kind: "collapsible",
          title: "Details",
          collapsed: false,
          blocks: [
            { id: "paste-front", kind: "paragraph", text: "Alpha" },
            { id: "paste-old-picture", kind: "picture", url: "/old.png", filename: "Old picture" },
            { id: "paste-after", kind: "paragraph", text: "After" },
          ],
        }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const front = target.container.querySelector<HTMLElement>('[data-note-region-id="block:paste-front"]')
    const oldPicture = target.container.querySelector<HTMLElement>('[data-note-atomic-id="block:paste-old-picture"]')
    if (!(front?.firstChild instanceof Text) || !oldPicture) throw new Error("Expected target endpoints")
    const targetRange = document.createRange()
    targetRange.setStart(front.firstChild, 2)
    targetRange.setEndAfter(oldPicture)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(targetRange)

    // When: the internal structured fragment replaces the nested mixed range.
    paste(target.container.querySelector("article") ?? target.container, clipboard)

    // Then: replacement structure stays nested and surrounding children survive.
    const fold = onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks[0]
    expect(fold).toMatchObject({ id: "paste-fold", kind: "collapsible" })
    if (fold?.kind !== "collapsible") throw new Error("Expected collapsible result")
    expect(fold.blocks.map((block) => block.kind)).toEqual(["paragraph", "picture", "paragraph", "paragraph"])
    expect(fold.blocks[0]).toMatchObject({ id: "paste-front", text: "Al" })
    expect(fold.blocks[1]).toMatchObject({ kind: "picture", url: "/source-nested.png" })
    expect(fold.blocks[2]).toMatchObject({ kind: "paragraph", text: "" })
    expect(fold.blocks[3]).toMatchObject({ id: "paste-after", text: "After" })
  })

  it("sanitizes external HTML and commits it as one replacement", () => {
    // Given: a continuous range crosses the title and body.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Alpha"
        blocks={[{ id: "body", kind: "paragraph", text: "Omega" }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(title.firstChild, 2, body.firstChild, 2)

    // When: untrusted external HTML is pasted.
    paste(container.querySelector("article") ?? container, {
      "text/html": '<strong onclick="alert(1)">Safe</strong><script>bad()</script>',
    })

    // Then: allowed formatting survives, script content is removed, and commit is atomic.
    expect(onNoteTransaction).toHaveBeenCalledOnce()
    expect(onNoteTransaction).toHaveBeenCalledWith({
      snapshot: {
        title: "Al<strong>Safe</strong>ega",
        blocks: [],
      },
      operation: { kind: "replace", source: "clipboard" },
    })
  })

  it("restores the caret by visible characters after formatted HTML paste", async () => {
    // Given: a controlled host applies a formatted cross-field paste transaction.
    const Harness = () => {
      const [snapshot, setSnapshot] = useState({
        title: "Alpha",
        blocks: [{ id: "body", kind: "paragraph" as const, text: "Omega" }],
      })
      return (
        <NoteContent
          editable
          title={snapshot.title}
          blocks={snapshot.blocks}
          onNoteTransaction={(transaction) => setSnapshot({
            title: transaction.snapshot.title,
            blocks: transaction.snapshot.blocks.flatMap((block) =>
              block.kind === "paragraph" ? [block] : [],
            ),
          })}
        />
      )
    }
    const { container } = render(<Harness />)
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(title.firstChild, 2, body.firstChild, 2)

    // When: formatted HTML replaces the selected range.
    paste(container.querySelector("article") ?? container, {
      "text/html": "<strong>Safe</strong>",
    })

    // Then: the caret follows the four visible inserted characters, not the markup length.
    await waitFor(() => expect(container.querySelector('[data-note-region-id="title"]')?.textContent).toBe("AlSafeega"))
    const selection = window.getSelection()
    const restoredTitle = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    if (!selection || selection.rangeCount === 0 || !restoredTitle) {
      throw new Error("Expected restored caret")
    }
    const prefix = document.createRange()
    prefix.selectNodeContents(restoredTitle)
    const restored = selection.getRangeAt(0)
    prefix.setEnd(restored.startContainer, restored.startOffset)
    expect(prefix.toString()).toBe("AlSafe")
  })

  it("escapes typed markup characters during cross-region replacement", () => {
    // Given: a continuous range spans two body regions.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[
          { id: "front", kind: "paragraph", text: "Alpha" },
          { id: "back", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const front = container.querySelector<HTMLElement>('[data-note-region-id="block:front"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:back"]')
    if (!(front?.firstChild instanceof Text) || !(back?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(front.firstChild, 2, back.firstChild, 2)

    // When: the browser reports literal text input containing a markup delimiter.
    ;(container.querySelector("article") ?? container).dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "<",
      inputType: "insertText",
    }))

    // Then: the persisted restricted HTML represents a literal character.
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks[0]).toEqual({
      id: "front",
      kind: "paragraph",
      text: "Al&lt;ega",
    })
  })

  it("escapes external plain text before inserting it", () => {
    // Given: a continuous range spans two body regions.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[
          { id: "front", kind: "paragraph", text: "Alpha" },
          { id: "back", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const front = container.querySelector<HTMLElement>('[data-note-region-id="block:front"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:back"]')
    if (!(front?.firstChild instanceof Text) || !(back?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(front.firstChild, 2, back.firstChild, 2)

    // When: plain text containing markup-like characters is pasted.
    paste(container.querySelector("article") ?? container, { "text/plain": "2 < 3\nnext" })

    // Then: literal text and its line break survive without becoming markup.
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks[0]).toEqual({
      id: "front",
      kind: "paragraph",
      text: "Al2 &lt; 3<br>nextega",
    })
  })

  it("reads dropped replacement content from DataTransfer", () => {
    // Given: a continuous body selection and a drop payload whose InputEvent data would be empty.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[
          { id: "drop-front", kind: "paragraph", text: "Alpha" },
          { id: "drop-back", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const front = container.querySelector<HTMLElement>('[data-note-region-id="block:drop-front"]')
    const back = container.querySelector<HTMLElement>('[data-note-region-id="block:drop-back"]')
    if (!(front?.firstChild instanceof Text) || !(back?.firstChild instanceof Text)) {
      throw new Error("Expected drop text regions")
    }
    selectAcross(front.firstChild, 2, back.firstChild, 2)

    // When: HTML is delivered by the drop event's DataTransfer.
    const allowed = drop(container.querySelector("article") ?? container, {
      "text/html": "<strong>Dropped</strong>",
      "text/plain": "Dropped",
    })

    // Then: the transfer content replaces the selection exactly once instead of deleting it.
    expect(allowed).toBe(false)
    expect(onNoteTransaction).toHaveBeenCalledOnce()
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks).toEqual([
      { id: "drop-front", kind: "paragraph", text: "Al<strong>Dropped</strong>ega" },
    ])
  })

  it("replaces an atomic start endpoint with an internal structured fragment", () => {
    // Given: a copied fragment contains text around an atomic picture.
    const source = render(
      <NoteContent
        title="Source"
        blocks={[
          { id: "source-front", kind: "paragraph", text: "Source" },
          { id: "source-picture", kind: "picture", url: "/source.png", filename: "Source" },
          { id: "source-back", kind: "paragraph", text: "End" },
        ]}
      />,
    )
    const sourceFront = source.container.querySelector<HTMLElement>('[data-note-region-id="block:source-front"]')
    const sourceBack = source.container.querySelector<HTMLElement>('[data-note-region-id="block:source-back"]')
    if (!(sourceFront?.firstChild instanceof Text) || !(sourceBack?.firstChild instanceof Text)) {
      throw new Error("Expected source text regions")
    }
    selectAcross(sourceFront.firstChild, 2, sourceBack.firstChild, 1)
    const clipboard = copy(source.container.querySelector("article") ?? source.container)
    source.unmount()

    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const target = render(
      <NoteContent
        editable
        title="Target"
        blocks={[
          { id: "kept", kind: "paragraph", text: "Kept" },
          { id: "target-picture", kind: "picture", url: "/target.png", filename: "Target" },
          { id: "target-back", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const targetPicture = target.container.querySelector<HTMLElement>('[data-note-atomic-id="block:target-picture"]')
    const targetBack = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-back"]')
    if (!targetPicture || !(targetBack?.firstChild instanceof Text)) {
      throw new Error("Expected target atomic unit and text region")
    }
    const range = document.createRange()
    range.setStartBefore(targetPicture)
    range.setEnd(targetBack.firstChild, 2)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the internal fragment replaces the range beginning at the atomic unit.
    paste(target.container.querySelector("article") ?? target.container, clipboard)

    // Then: the old picture is removed and the pasted text edges surround a fresh picture.
    const blocks = onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks
    expect(blocks).toHaveLength(4)
    expect(blocks?.[0]).toEqual({ id: "kept", kind: "paragraph", text: "Kept" })
    expect(blocks?.[1]).toMatchObject({ kind: "paragraph", text: "urce" })
    expect(blocks?.[2]).toMatchObject({ kind: "picture", url: "/source.png" })
    expect(blocks?.[3]).toMatchObject({ kind: "paragraph", text: "Eega" })
  })

  it("round-trips ordered intermediate rich, code, and atomic blocks", () => {
    // Given: an internal fragment contains complete rich, code, and picture blocks between text edges.
    const source = render(
      <NoteContent
        title="Source"
        blocks={[
          { id: "edge-front", kind: "paragraph", text: "Alpha" },
          { id: "middle-rich", kind: "paragraph", text: "Middle" },
          { id: "middle-code", kind: "code", code: "const x = 1", language: "typescript", filename: "x.ts" },
          { id: "middle-picture", kind: "picture", url: "/middle.png", filename: "Middle" },
          { id: "edge-back", kind: "paragraph", text: "Omega" },
        ]}
      />,
    )
    const sourceFront = source.container.querySelector<HTMLElement>('[data-note-region-id="block:edge-front"]')
    const sourceBack = source.container.querySelector<HTMLElement>('[data-note-region-id="block:edge-back"]')
    if (!(sourceFront?.firstChild instanceof Text) || !(sourceBack?.firstChild instanceof Text)) {
      throw new Error("Expected source text edges")
    }
    selectAcross(sourceFront.firstChild, 2, sourceBack.firstChild, 2)
    const clipboard = copy(source.container.querySelector("article") ?? source.container)
    source.unmount()

    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const target = render(
      <NoteContent
        editable
        title="Target"
        blocks={[
          { id: "target-front", kind: "paragraph", text: "Front" },
          { id: "target-back", kind: "paragraph", text: "Back" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const targetFront = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-front"]')
    const targetBack = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-back"]')
    if (!(targetFront?.firstChild instanceof Text) || !(targetBack?.firstChild instanceof Text)) {
      throw new Error("Expected target text edges")
    }
    selectAcross(targetFront.firstChild, 2, targetBack.firstChild, 2)

    // When: the internal payload replaces another continuous selection.
    paste(target.container.querySelector("article") ?? target.container, clipboard)

    // Then: reading order, code metadata, picture data, and fresh IDs survive the round trip.
    const blocks = onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks
    expect(blocks?.map((block) => block.kind)).toEqual([
      "paragraph",
      "paragraph",
      "code",
      "picture",
      "paragraph",
    ])
    expect(blocks?.[0]).toMatchObject({ id: "target-front", text: "Frpha" })
    expect(blocks?.[1]).toMatchObject({ kind: "paragraph", text: "Middle" })
    expect(blocks?.[2]).toMatchObject({
      kind: "code",
      code: "const x = 1",
      language: "typescript",
      filename: "x.ts",
    })
    expect(blocks?.[3]).toMatchObject({ kind: "picture", url: "/middle.png" })
    expect(blocks?.[4]).toMatchObject({ kind: "paragraph", text: "Omck" })
    expect(blocks?.slice(1, 4).every((block) => !block?.id.startsWith("middle-"))).toBe(true)
  })

  it("preserves a complete nested block between partial regions", () => {
    // Given: the selected reading range crosses three children inside one expanded collapsible.
    const source = render(
      <NoteContent
        title="Source"
        blocks={[{
          id: "fold",
          kind: "collapsible",
          title: "Details",
          collapsed: false,
          blocks: [
            { id: "nested-front", kind: "paragraph", text: "Alpha" },
            { id: "nested-middle", kind: "paragraph", text: "Middle" },
            { id: "nested-back", kind: "paragraph", text: "Omega" },
          ],
        }]}
      />,
    )
    const sourceFront = source.container.querySelector<HTMLElement>('[data-note-region-id="block:nested-front"]')
    const sourceBack = source.container.querySelector<HTMLElement>('[data-note-region-id="block:nested-back"]')
    if (!(sourceFront?.firstChild instanceof Text) || !(sourceBack?.firstChild instanceof Text)) {
      throw new Error("Expected nested text edges")
    }
    selectAcross(sourceFront.firstChild, 2, sourceBack.firstChild, 2)
    const clipboard = copy(source.container.querySelector("article") ?? source.container)
    source.unmount()

    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const target = render(
      <NoteContent
        editable
        title="Target"
        blocks={[
          { id: "target-front", kind: "paragraph", text: "Front" },
          { id: "target-back", kind: "paragraph", text: "Back" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const targetFront = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-front"]')
    const targetBack = target.container.querySelector<HTMLElement>('[data-note-region-id="block:target-back"]')
    if (!(targetFront?.firstChild instanceof Text) || !(targetBack?.firstChild instanceof Text)) {
      throw new Error("Expected target text edges")
    }
    selectAcross(targetFront.firstChild, 2, targetBack.firstChild, 2)

    // When: the internal fragment is pasted into another continuous range.
    paste(target.container.querySelector("article") ?? target.container, clipboard)

    // Then: the complete nested child remains a structured middle block with a fresh ID.
    const blocks = onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks
    expect(blocks?.map((block) => block.kind)).toEqual(["paragraph", "paragraph", "paragraph"])
    expect(blocks?.[0]).toMatchObject({ id: "target-front", text: "Frpha" })
    expect(blocks?.[1]).toMatchObject({ kind: "paragraph", text: "Middle" })
    expect(blocks?.[1]?.id).not.toBe("nested-middle")
    expect(blocks?.[2]).toMatchObject({ kind: "paragraph", text: "Omck" })
  })

  it("separates complete middle regions in the plain-text clipboard flavor", () => {
    // Given: a quote selection contains a complete middle line between partial edge lines.
    const source = render(
      <NoteContent
        title="Source"
        blocks={[{ id: "quote-copy", kind: "quote", text: "Alpha\nMiddle\nOmega" }]}
      />,
    )
    const first = source.container.querySelector<HTMLElement>('[data-note-region-id="block:quote-copy"]')
    const last = source.container.querySelector<HTMLElement>('[data-note-region-id="block:quote-copy-line-2"]')
    if (!(first?.firstChild instanceof Text) || !(last?.firstChild instanceof Text)) {
      throw new Error("Expected quote edge lines")
    }
    selectAcross(first.firstChild, 2, last.firstChild, 2)

    // When: the continuous quote range is copied.
    const clipboard = copy(source.container.querySelector("article") ?? source.container)

    // Then: semantic region boundaries remain readable in plain text.
    expect(clipboard["text/plain"]).toBe("pha\nMiddle\nOm")
  })

  it("blocks cross-field paste when no transaction callback is available", () => {
    // Given: an editable continuous range without a whole-note transaction callback.
    const onTitleChange = vi.fn<(title: string) => void>()
    const onBlocksChange = vi.fn()
    const { container } = render(
      <NoteContent
        editable
        title="Alpha"
        blocks={[{ id: "body", kind: "paragraph", text: "Omega" }]}
        onTitleChange={onTitleChange}
        onBlocksChange={onBlocksChange}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(title.firstChild, 2, body.firstChild, 2)

    // When: paste is requested.
    const allowed = paste(container.querySelector("article") ?? container, {
      "text/plain": "replacement",
    })

    // Then: native mutation is canceled and legacy callbacks remain untouched.
    expect(allowed).toBe(false)
    expect(onTitleChange).not.toHaveBeenCalled()
    expect(onBlocksChange).not.toHaveBeenCalled()
  })

  it("normalizes a reverse drag to document reading order", () => {
    // Given: the selection anchor is in the body and focus is in the title.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Alpha"
        blocks={[{ id: "body", kind: "paragraph", text: "Omega" }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.setBaseAndExtent(body.firstChild, 2, title.firstChild, 2)

    // When: the reverse range is deleted.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    }))

    // Then: the front title still owns the merged result.
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot).toEqual({
      title: "Alega",
      blocks: [],
    })
  })

  it("merges callout title and body fragments inside one structured block", () => {
    // Given: a continuous selection starts in a callout title and ends in its body.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Note"
        blocks={[{ id: "callout", kind: "callout", tone: "info", title: "Alpha", text: "Omega" }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="block:callout:title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:callout"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected callout regions")
    }
    selectAcross(title.firstChild, 2, body.firstChild, 2)

    // When: the structured range is deleted.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    }))

    // Then: the front title owns the merged suffix and the consumed body is empty.
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks).toEqual([
      { id: "callout", kind: "callout", tone: "info", title: "Alega", text: "" },
    ])
  })

  it("merges quote line fragments and removes consumed lines", () => {
    // Given: a quote has three independently selectable lines.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Note"
        blocks={[{ id: "quote", kind: "quote", text: "Alpha\nMiddle\nOmega", author: "Writer" }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const first = container.querySelector<HTMLElement>('[data-note-region-id="block:quote"]')?.firstChild
    const last = container.querySelector<HTMLElement>('[data-note-region-id="block:quote-line-2"]')?.firstChild
    if (!(first instanceof Text) || !(last instanceof Text)) throw new Error("Expected quote lines")
    selectAcross(first, 2, last, 2)

    // When: the range spanning the middle line is deleted.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    }))

    // Then: the first line keeps the merged text and the author survives after it.
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks).toEqual([
      { id: "quote", kind: "quote", text: "Alega", author: "Writer" },
    ])
  })

  it.each([
    ["insertCompositionText", "中", "Al中ega"],
    ["insertReplacementText", "word", "Alwordega"],
    ["insertParagraph", null, "Al<br>ega"],
  ])("commits %s as one controlled replacement", (inputType, data, expected) => {
    // Given: a title-to-body range is active during an advanced browser input operation.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Alpha"
        blocks={[{ id: "body", kind: "paragraph", text: "Omega" }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(title.firstChild, 2, body.firstChild, 2)

    // When: the browser emits composition, replacement, or paragraph beforeinput.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType,
      data,
    }))

    // Then: the range replacement is one whole-note transaction with normalized rich HTML.
    expect(onNoteTransaction).toHaveBeenCalledTimes(1)
    expect(onNoteTransaction.mock.calls[0]?.[0]).toMatchObject({
      snapshot: { title: expected, blocks: [] },
      operation: { kind: "replace", source: "beforeinput" },
    })
  })
})
