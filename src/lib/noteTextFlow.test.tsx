/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock, NoteContentTransaction } from "./types"

const selectAcross = (start: Text, startOffset: number, end: Text, endOffset: number) => {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const selection = window.getSelection()
  if (!selection) throw new Error("Expected browser selection")
  selection.removeAllRanges()
  selection.addRange(range)
}

const dispatchBeforeInput = (target: Element, inputType: string): boolean =>
  target.dispatchEvent(
    new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType }),
  )

const dispatchClipboardEvent = (
  target: Element,
  type: "copy" | "cut",
): ReadonlyMap<string, string> => {
  const values = new Map<string, string>()
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (format: string, value: string) => values.set(format, value) },
  })
  target.dispatchEvent(event)
  return values
}

const dispatchPasteEvent = (
  target: Element,
  values: ReadonlyMap<string, string>,
): void => {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format: string) => values.get(format) ?? "" },
  })
  target.dispatchEvent(event)
}

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => new DOMRect(),
})

afterEach(cleanup)

describe("NoteContent continuous text selection", () => {
  it("marks title, summary, and body text with stable note regions", () => {
    // Given / When: an editable note renders all three note fields.
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        summary="Summary"
        blocks={[{ id: "body", kind: "paragraph", text: "Body" }]}
      />,
    )

    // Then: each field participates in one ordered note text flow.
    expect(
      Array.from(container.querySelectorAll("[data-note-region-id]"), (node) =>
        node.getAttribute("data-note-region-id"),
      ),
    ).toEqual(["title", "summary", "block:body"])
  })

  it("commits one front-fragment merge when deletion crosses title and body", () => {
    // Given: a selection starts inside the title and ends inside the body.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Alpha"
        summary="Bridge"
        blocks={[
          { id: "first", kind: "paragraph", text: "Omega" },
          { id: "tail", kind: "paragraph", text: "Tail" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:first"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(title.firstChild, 2, body.firstChild, 2)

    // When: the browser requests deletion of the selected note range.
    dispatchBeforeInput(
      container.querySelector("article") ?? container,
      "deleteContentBackward",
    )

    // Then: the front title keeps its type, absorbs the body suffix, and commits once.
    expect(onNoteTransaction).toHaveBeenCalledOnce()
    expect(onNoteTransaction).toHaveBeenCalledWith({
      snapshot: {
        title: "Alega",
        blocks: [{ id: "tail", kind: "paragraph", text: "Tail" }],
      },
      operation: { kind: "delete", source: "beforeinput" },
    })
  })

  it("blocks a cross-field mutation when no transaction callback is available", () => {
    // Given: the same cross-field selection without an atomic host callback.
    const onTitleChange = vi.fn()
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
    selectAcross(title.firstChild, 1, body.firstChild, 1)

    // When: mutation is requested without a whole-note transaction seam.
    const accepted = dispatchBeforeInput(
      container.querySelector("article") ?? container,
      "deleteContentForward",
    )

    // Then: the native mutation is cancelled and no partial field callback leaks.
    expect(accepted).toBe(false)
    expect(onTitleChange).not.toHaveBeenCalled()
    expect(onBlocksChange).not.toHaveBeenCalled()
  })

  it("disables cross-field formatting before the editable DOM can mutate without a transaction callback", async () => {
    // Given: a title-to-body selection with only legacy field callbacks.
    const onTitleChange = vi.fn()
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
    selectAcross(title.firstChild, 1, body.firstChild, 2)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    })
    document.dispatchEvent(new Event("selectionchange"))

    // When: the formatting toolbar observes the cross-field selection.
    const labels = [
      "粗体",
      "斜体",
      "下划线",
      "删除线",
      "行内代码",
      "文字颜色：红色",
      "清除样式",
    ] as const

    // Then: every mutating control is disabled before any browser command can run.
    for (const label of labels) {
      const button = await waitFor(() => {
        const candidate = document.body.querySelector<HTMLButtonElement>(
          `[aria-label="${label}"]`,
        )
        if (!candidate) throw new Error(`Expected ${label} control`)
        return candidate
      })
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
    }
    expect(execCommand).not.toHaveBeenCalled()
    expect(title.innerHTML).toBe("Alpha")
    expect(body.innerHTML).toBe("Omega")
    expect(onTitleChange).not.toHaveBeenCalled()
    expect(onBlocksChange).not.toHaveBeenCalled()
  })

  it("disables inline formula for title selections", async () => {
    // Given: a character selection confined to the title profile.
    const { container } = render(
      <NoteContent
        editable
        title="Alpha"
        blocks={[{ id: "body", kind: "paragraph", text: "Omega" }]}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    if (!(title?.firstChild instanceof Text)) throw new Error("Expected title text")
    selectAcross(title.firstChild, 0, title.firstChild, 2)

    // When: the formatting toolbar opens for the title selection.
    document.dispatchEvent(new Event("selectionchange"))

    // Then: inline formula is unavailable because the title allowlist excludes it.
    await waitFor(() => {
      const button = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="行内公式"]',
      )
      expect(button?.disabled).toBe(true)
    })
  })

  it("persists an inline formula through a structured quote region update", async () => {
    // Given: selected text in the first line of a quote and a body-only callback.
    let changedBlocks: readonly NoteBlock[] = []
    let changeCount = 0
    const onBlocksChange = (blocks: readonly NoteBlock[]) => {
      changedBlocks = blocks
      changeCount += 1
    }
    const { container } = render(
      <NoteContent
        editable
        title="Formula note"
        blocks={[{ id: "quote", kind: "quote", text: "Alpha\nOmega" }]}
        onBlocksChange={onBlocksChange}
      />,
    )
    const quote = container.querySelector<HTMLElement>('[data-note-region-id="block:quote"]')
    if (!(quote?.firstChild instanceof Text)) throw new Error("Expected quote text")
    selectAcross(quote.firstChild, 0, quote.firstChild, 5)
    document.dispatchEvent(new Event("selectionchange"))
    const formulaButton = await waitFor(() => {
      const candidate = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="行内公式"]',
      )
      if (!candidate) throw new Error("Expected formula control")
      return candidate
    })

    // When: the selected quote text is replaced by an inline formula.
    fireEvent.click(formulaButton)
    const input = await waitFor(() => {
      const candidate = document.body.querySelector<HTMLInputElement>(
        '[aria-label="公式（LaTeX）"]',
      )
      if (!candidate) throw new Error("Expected formula input")
      return candidate
    })
    fireEvent.change(input, { target: { value: "E = mc^2" } })
    fireEvent.click(document.body.querySelector('[aria-label="确认"]') ?? document.body)

    // Then: one blocks callback preserves the quote type and stores the formula markup.
    expect(changeCount).toBe(1)
    expect(changedBlocks).toHaveLength(1)
    expect(changedBlocks[0]?.kind).toBe("quote")
    if (changedBlocks[0]?.kind !== "quote") throw new Error("Expected quote block")
    expect(changedBlocks[0].text).toContain('data-hn-inline-formula="E = mc^2"')
  })

  it("replaces a cross-field selection in one transaction", () => {
    // Given: a selection crosses summary and body text.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        summary="Bridge"
        blocks={[{ id: "body", kind: "paragraph", text: "Omega" }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const summary = container.querySelector<HTMLElement>('[data-note-region-id="summary"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(summary?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(summary.firstChild, 2, body.firstChild, 2)

    // When: text input replaces the selected note range.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: "X",
        inputType: "insertText",
      }),
    )

    // Then: the summary keeps its type and absorbs the replacement plus body suffix.
    expect(onNoteTransaction).toHaveBeenCalledWith({
      snapshot: { title: "Title", summary: "BrXega", blocks: [] },
      operation: { kind: "replace", source: "beforeinput" },
    })
  })

  it("copies a continuous selection in all clipboard formats while read-only", () => {
    // Given: a read-only note whose selection crosses title and body.
    const { container } = render(
      <NoteContent
        title="Alpha"
        summary="Bridge"
        blocks={[{ id: "body", kind: "paragraph", text: "Omega" }]}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected read-only text regions")
    }
    selectAcross(title.firstChild, 1, body.firstChild, 2)

    // When: the user copies the selection.
    const clipboard = dispatchClipboardEvent(
      container.querySelector("article") ?? container,
      "copy",
    )

    // Then: interoperable and internal clipboard representations are all present.
    expect(clipboard.get("text/plain")).toContain("lpha")
    expect(clipboard.get("text/html")).toContain("lpha")
    expect(JSON.parse(clipboard.get("application/x-hamsternote-fragment+json") ?? "")).toMatchObject({
      version: 2,
    })
  })

  it("cuts a continuous selection as one note transaction", () => {
    // Given: an editable selection crossing title and body.
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

    // When: the selection is cut.
    const clipboard = dispatchClipboardEvent(
      container.querySelector("article") ?? container,
      "cut",
    )

    // Then: clipboard data is written and deletion commits exactly once.
    expect(clipboard.get("text/plain")).toContain("pha")
    expect(onNoteTransaction).toHaveBeenCalledOnce()
    expect(onNoteTransaction).toHaveBeenCalledWith({
      snapshot: { title: "Alega", blocks: [] },
      operation: { kind: "cut", source: "clipboard" },
    })
  })

  it("includes an atomic block between text endpoints in copy and deletion", () => {
    // Given: a picture is fully enclosed by a selection between two text regions.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[
          { id: "before", kind: "paragraph", text: "Alpha" },
          { id: "picture", kind: "picture", url: "/image.png", filename: "Diagram" },
          { id: "after", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const before = container.querySelector<HTMLElement>('[data-note-region-id="block:before"]')
    const after = container.querySelector<HTMLElement>('[data-note-region-id="block:after"]')
    if (!(before?.firstChild instanceof Text) || !(after?.firstChild instanceof Text)) {
      throw new Error("Expected text around atomic block")
    }
    selectAcross(before.firstChild, 2, after.firstChild, 2)

    // When: the same continuous range is copied and deleted.
    const article = container.querySelector("article") ?? container
    const clipboard = dispatchClipboardEvent(article, "copy")
    dispatchBeforeInput(article, "deleteContentForward")

    // Then: the atomic unit is copied whole and removed by the single transaction.
    expect(clipboard.get("text/html")).toContain("/image.png")
    expect(onNoteTransaction).toHaveBeenCalledWith({
      snapshot: {
        title: "Title",
        blocks: [{ id: "before", kind: "paragraph", text: "Alega" }],
      },
      operation: { kind: "delete", source: "beforeinput" },
    })
  })

  it("keeps an empty paragraph when the entire note text flow is deleted", () => {
    // Given: the selection covers the complete note text flow.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        summary="Summary"
        blocks={[{ id: "body", kind: "paragraph", text: "Body" }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected complete note text regions")
    }
    selectAcross(title.firstChild, 0, body.firstChild, body.firstChild.data.length)

    // When: the whole continuous range is deleted.
    dispatchBeforeInput(container.querySelector("article") ?? container, "deleteContentForward")

    // Then: title remains empty, summary is removed, and one empty paragraph survives.
    const transaction = onNoteTransaction.mock.calls[0]?.[0]
    expect(transaction?.snapshot.title).toBe("")
    expect(transaction?.snapshot.summary).toBeUndefined()
    expect(transaction?.snapshot.blocks).toHaveLength(1)
    expect(transaction?.snapshot.blocks[0]).toMatchObject({ kind: "paragraph", text: "" })
  })

  it("keeps select mode outside continuous editing", () => {
    // Given / When: editable and select mode are both requested.
    const { container } = render(
      <NoteContent
        editable
        selectMode
        title="Title"
        blocks={[{ id: "body", kind: "paragraph", text: "Body" }]}
      />,
    )

    // Then: no contenteditable surface or selection popover is mounted.
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    expect(container.querySelector('[aria-label="文字操作"]')).toBeNull()
    fireEvent.keyDown(container.querySelector("article") ?? container, {
      key: "a",
      metaKey: true,
    })
  })

  it("commits cross-field formatting as one note transaction", async () => {
    // Given: title and body text are selected as one continuous range.
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
    selectAcross(title.firstChild, 1, body.firstChild, 2)
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: vi.fn((command: string) => {
      if (command !== "bold") return true
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return false
      const range = selection.getRangeAt(0)
      const strong = document.createElement("strong")
      strong.append(range.extractContents())
      range.insertNode(strong)
      return true
      }),
    })
    document.dispatchEvent(new Event("selectionchange"))
    await waitFor(() => expect(document.body.querySelector('[aria-label="粗体"]')).not.toBeNull())

    // When: the shared formatting control is activated.
    fireEvent.click(document.body.querySelector('[aria-label="粗体"]') ?? document.body)

    // Then: both fields are persisted by exactly one whole-note transaction.
    await waitFor(() => expect(onNoteTransaction).toHaveBeenCalledOnce())
    const transaction = onNoteTransaction.mock.calls[0]?.[0]
    expect(transaction?.operation).toEqual({ kind: "format", source: "popover" })
    expect(transaction?.snapshot.title).toContain("<strong>")
    expect(transaction?.snapshot.blocks[0]).toMatchObject({ kind: "paragraph" })
    expect(transaction?.snapshot.blocks[0]?.kind === "paragraph"
      ? transaction.snapshot.blocks[0].text
      : "").toContain("<strong>")
  })

  it("persists formatting in a structured quote region", async () => {
    // Given: one quote line is selected in a structured block.
    const onBlocksChange = vi.fn()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[{ id: "quote", kind: "quote", text: "Alpha\nOmega", author: "Author" }]}
        onBlocksChange={onBlocksChange}
      />,
    )
    const line = container.querySelector<HTMLElement>('[data-note-region-id="block:quote"]')
    if (!(line?.firstChild instanceof Text)) throw new Error("Expected quote line")
    selectAcross(line.firstChild, 0, line.firstChild, 5)
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: vi.fn((command: string) => {
        if (command !== "bold") return true
        const range = window.getSelection()?.getRangeAt(0)
        if (!range) return false
        const strong = document.createElement("strong")
        strong.append(range.extractContents())
        range.insertNode(strong)
        return true
      }),
    })
    document.dispatchEvent(new Event("selectionchange"))
    await waitFor(() => expect(document.body.querySelector('[aria-label="粗体"]')).not.toBeNull())

    // When: formatting is applied from the shared popover.
    fireEvent.click(document.body.querySelector('[aria-label="粗体"]') ?? document.body)

    // Then: the quote structure survives and one blocks callback persists its first line.
    await waitFor(() => expect(onBlocksChange).toHaveBeenCalledOnce())
    expect(onBlocksChange.mock.calls[0]?.[0]).toEqual([
      { id: "quote", kind: "quote", text: "<strong>Alpha</strong>\nOmega", author: "Author" },
    ])
  })

  it("commits cross-field color as one sanitized note transaction", async () => {
    // Given: a continuous selection spans title and body.
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
    selectAcross(title.firstChild, 1, body.firstChild, 2)
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: vi.fn((command: string, _showUi: boolean, color: string) => {
        if (command !== "foreColor") return true
        for (const root of [title, body]) {
          root.innerHTML = `<font color="${color}">${root.textContent ?? ""}</font>`
        }
        return true
      }),
    })
    document.dispatchEvent(new Event("selectionchange"))
    await waitFor(() => expect(document.body.querySelector('[aria-label="文字颜色：红色"]')).not.toBeNull())

    // When: the red palette control is clicked.
    fireEvent.click(document.body.querySelector('[aria-label="文字颜色：红色"]') ?? document.body)

    // Then: title rejects body-only color while the body stores normalized palette metadata.
    await waitFor(() => expect(onNoteTransaction).toHaveBeenCalledOnce())
    const transaction = onNoteTransaction.mock.calls[0]?.[0]
    expect(transaction?.snapshot.title).toBe("Alpha")
    expect(transaction?.snapshot.blocks[0]).toMatchObject({
      kind: "paragraph",
      text: '<span data-hn-color="#ef4444">Omega</span>',
    })
    expect(title.querySelector("font")).toBeNull()
    expect(title.querySelector("[data-hn-color]")).toBeNull()
    expect(body.innerHTML).toBe('<span data-hn-color="#ef4444">Omega</span>')
  })

  it("extends a second select-all command from one region to the complete note flow", () => {
    // Given: the current editable body region is already fully selected.
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        summary="Summary"
        blocks={[{ id: "body", kind: "paragraph", text: "Body" }]}
      />,
    )
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!body) throw new Error("Expected body region")
    const range = document.createRange()
    range.selectNodeContents(body)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: Ctrl+A is pressed again from the fully selected region.
    fireEvent.keyDown(body, { key: "a", ctrlKey: true })

    // Then: title, summary, and body are selected in reading order.
    expect(window.getSelection()?.toString()).toContain("Title")
    expect(window.getSelection()?.toString()).toContain("Summary")
    expect(window.getSelection()?.toString()).toContain("Body")
  })

  it("extends native select-all when browser range endpoints are text nodes", () => {
    // Given: Chromium represents a native full-region selection with text-node endpoints.
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        summary="Summary"
        blocks={[{ id: "body", kind: "paragraph", text: "Body" }]}
      />,
    )
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    if (!(title?.firstChild instanceof Text)) throw new Error("Expected title text")
    const range = document.createRange()
    range.setStart(title.firstChild, 0)
    range.setEnd(title.firstChild, title.firstChild.data.length)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: Ctrl+A is pressed a second time from Chromium's native selection shape.
    fireEvent.keyDown(title, { key: "a", ctrlKey: true })

    // Then: the complete note flow replaces the region-local selection.
    expect(window.getSelection()?.toString()).toContain("Title")
    expect(window.getSelection()?.toString()).toContain("Summary")
    expect(window.getSelection()?.toString()).toContain("Body")
  })

  it("treats a table row at the selection endpoint as one atomic unit", () => {
    // Given: selection starts in text and ends after the first table row.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[
          { id: "before", kind: "paragraph", text: "Alpha" },
          { id: "table", kind: "table", rows: [["H1", "H2"], ["A1", "A2"]] },
          { id: "after", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const before = container.querySelector<HTMLElement>('[data-note-region-id="block:before"]')
    const firstRow = container.querySelector<HTMLElement>('[data-note-atomic-id="table:table:row:0"]')
    if (!(before?.firstChild instanceof Text) || !firstRow) {
      throw new Error("Expected text and table row")
    }
    const range = document.createRange()
    range.setStart(before.firstChild, 2)
    range.setEndAfter(firstRow)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the continuous selection is deleted.
    dispatchBeforeInput(container.querySelector("article") ?? container, "deleteContentForward")

    // Then: the first row is removed whole while the remaining table structure survives.
    expect(onNoteTransaction).toHaveBeenCalledWith({
      snapshot: {
        title: "Title",
        blocks: [
          { id: "before", kind: "paragraph", text: "Al" },
          { id: "table", kind: "table", rows: [["A1", "A2"]] },
          { id: "after", kind: "paragraph", text: "Omega" },
        ],
      },
      operation: { kind: "delete", source: "beforeinput" },
    })
  })

  it("removes an atomic start endpoint and keeps the back text suffix", () => {
    // Given: selection starts before a picture and ends inside following text.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[
          { id: "picture", kind: "picture", url: "/image.png", filename: "Diagram" },
          { id: "after", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const picture = container.querySelector<HTMLElement>('[data-note-atomic-id="block:picture"]')
    const after = container.querySelector<HTMLElement>('[data-note-region-id="block:after"]')
    if (!picture || !(after?.firstChild instanceof Text)) {
      throw new Error("Expected atomic picture and following text")
    }
    const range = document.createRange()
    range.setStartBefore(picture)
    range.setEnd(after.firstChild, 2)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the range is deleted.
    dispatchBeforeInput(container.querySelector("article") ?? container, "deleteContentForward")

    // Then: the picture is removed as a whole and the paragraph keeps only its suffix.
    expect(onNoteTransaction).toHaveBeenCalledWith({
      snapshot: {
        title: "Title",
        blocks: [{ id: "after", kind: "paragraph", text: "ega" }],
      },
      operation: { kind: "delete", source: "beforeinput" },
    })
  })

  it("deletes one fully selected atomic unit", () => {
    // Given: one picture is selected from its outer boundary to outer boundary.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[
          { id: "before", kind: "paragraph", text: "Before" },
          { id: "picture", kind: "picture", url: "/image.png", filename: "Diagram" },
          { id: "after", kind: "paragraph", text: "After" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const picture = container.querySelector<HTMLElement>('[data-note-atomic-id="block:picture"]')
    if (!picture) throw new Error("Expected atomic picture")
    const range = document.createRange()
    range.selectNode(picture)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the selected atomic unit is deleted.
    dispatchBeforeInput(container.querySelector("article") ?? container, "deleteContentForward")

    // Then: only that picture is removed through one note transaction.
    expect(onNoteTransaction).toHaveBeenCalledWith({
      snapshot: {
        title: "Title",
        blocks: [
          { id: "before", kind: "paragraph", text: "Before" },
          { id: "after", kind: "paragraph", text: "After" },
        ],
      },
      operation: { kind: "delete", source: "beforeinput" },
    })
  })

  it("merges the survivors when deleting multiple rows from one table", () => {
    // Given: a range fully covers two middle rows in the same table.
    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const { container } = render(
      <NoteContent
        editable
        title="Title"
        blocks={[{
          id: "table",
          kind: "table",
          rows: [["A"], ["B"], ["C"], ["D"]],
        }]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const secondRow = container.querySelector<HTMLElement>('[data-note-atomic-id="table:table:row:1"]')
    const thirdRow = container.querySelector<HTMLElement>('[data-note-atomic-id="table:table:row:2"]')
    if (!secondRow || !thirdRow) throw new Error("Expected table rows")
    const range = document.createRange()
    range.setStartBefore(secondRow)
    range.setEndAfter(thirdRow)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)

    // When: the selected rows are deleted.
    dispatchBeforeInput(container.querySelector("article") ?? container, "deleteContentForward")

    // Then: one table with the unselected rows remains and its ID stays unique.
    expect(onNoteTransaction.mock.calls[0]?.[0].snapshot.blocks).toEqual([{
      id: "table",
      kind: "table",
      rows: [["A"], ["D"]],
    }])
  })

  it("restores a collapsed caret after the host applies a cross-field replacement", async () => {
    // Given: a controlled host applies whole-note transactions back into props.
    const Harness = () => {
      const [snapshot, setSnapshot] = useState<{
        readonly title: string
        readonly summary?: string
        readonly blocks: readonly { readonly id: string; readonly kind: "paragraph"; readonly text: string }[]
      }>({
        title: "Alpha",
        summary: "Bridge",
        blocks: [{ id: "body", kind: "paragraph" as const, text: "Omega" }],
      })
      return (
        <NoteContent
          editable
          title={snapshot.title}
          {...(snapshot.summary === undefined ? {} : { summary: snapshot.summary })}
          blocks={snapshot.blocks}
          onNoteTransaction={(transaction) => setSnapshot({
            title: transaction.snapshot.title,
            ...(transaction.snapshot.summary === undefined
              ? {}
              : { summary: transaction.snapshot.summary }),
            blocks: [...transaction.snapshot.blocks].filter(
              (block): block is { id: string; kind: "paragraph"; text: string } =>
                block.kind === "paragraph",
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

    // When: input replaces the selected continuous range.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    }))

    // Then: the caret is restored after the inserted text in the surviving title region.
    await waitFor(() => expect(container.querySelector('[data-note-region-id="title"]')?.textContent).toBe("AlXega"))
    const selection = window.getSelection()
    expect(selection?.isCollapsed).toBe(true)
    const restoredTitle = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    if (!restoredTitle || !selection || selection.rangeCount === 0) {
      throw new Error("Expected restored caret")
    }
    const prefix = document.createRange()
    prefix.selectNodeContents(restoredTitle)
    const restoredRange = selection.getRangeAt(0)
    prefix.setEnd(restoredRange.startContainer, restoredRange.startOffset)
    expect(prefix.toString()).toBe("AlX")
  })

  it("restores the caret when the host normalizes an absent summary to an empty string", async () => {
    // Given: the controlled host schema represents an absent summary as an empty string.
    const Harness = () => {
      const [snapshot, setSnapshot] = useState({
        title: "Alpha",
        summary: "Bridge",
        blocks: [{ id: "body", kind: "paragraph" as const, text: "Omega" }],
      })
      return (
        <NoteContent
          editable
          title={snapshot.title}
          summary={snapshot.summary}
          blocks={snapshot.blocks}
          onNoteTransaction={(transaction) => setSnapshot({
            title: transaction.snapshot.title,
            summary: transaction.snapshot.summary ?? "",
            blocks: [...transaction.snapshot.blocks].filter(
              (block): block is { id: string; kind: "paragraph"; text: string } =>
                block.kind === "paragraph",
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

    // When: input replaces the range and removes the summary from the note snapshot.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    }))

    // Then: the host's equivalent empty summary still allows caret restoration.
    await waitFor(() => expect(container.querySelector('[data-note-region-id="title"]')?.textContent).toBe("AlXega"))
    await waitFor(() => expect(window.getSelection()?.isCollapsed).toBe(true))
    const selection = window.getSelection()
    const restoredTitle = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    if (!restoredTitle || !selection || selection.rangeCount === 0) {
      throw new Error("Expected restored caret")
    }
    const prefix = document.createRange()
    prefix.selectNodeContents(restoredTitle)
    const restoredRange = selection.getRangeAt(0)
    prefix.setEnd(restoredRange.startContainer, restoredRange.startOffset)
    expect(prefix.toString()).toBe("AlX")
  })

  it("remaps the caret to the title when deleting the summary region", async () => {
    // Given: a controlled note selection starts at the empty front of the summary and consumes the body.
    const Harness = () => {
      const [snapshot, setSnapshot] = useState<{
        readonly title: string
        readonly summary?: string
        readonly blocks: readonly NoteBlock[]
      }>({
        title: "Title",
        summary: "Bridge",
        blocks: [{ id: "body", kind: "paragraph", text: "Omega" }],
      })
      return (
        <NoteContent
          editable
          title={snapshot.title}
          {...(snapshot.summary === undefined ? {} : { summary: snapshot.summary })}
          blocks={snapshot.blocks}
          onNoteTransaction={(transaction) => setSnapshot(transaction.snapshot)}
        />
      )
    }
    const { container } = render(<Harness />)
    const summary = container.querySelector<HTMLElement>('[data-note-region-id="summary"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(summary?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected summary and body regions")
    }
    selectAcross(summary.firstChild, 0, body.firstChild, body.firstChild.data.length)

    // When: the continuous range is deleted and the empty summary is removed from rendering.
    dispatchBeforeInput(container.querySelector("article") ?? container, "deleteContentForward")

    // Then: the caret resolves to the end of the nearest surviving front region.
    await waitFor(() => expect(container.querySelector('[data-note-region-id="summary"]')).toBeNull())
    await waitFor(() => expect(window.getSelection()?.isCollapsed).toBe(true))
    const selection = window.getSelection()
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    if (!title || !selection || selection.rangeCount === 0) {
      throw new Error("Expected remapped title caret")
    }
    const prefix = document.createRange()
    prefix.selectNodeContents(title)
    const restored = selection.getRangeAt(0)
    prefix.setEnd(restored.startContainer, restored.startOffset)
    expect(prefix.toString()).toBe("Title")
  })

  it("waits for the controlled host to apply the transaction before restoring the caret", async () => {
    // Given: a controlled host delays applying a whole-note transaction.
    let applyPendingTransaction: (() => void) | undefined
    const Harness = () => {
      const [snapshot, setSnapshot] = useState<{
        readonly title: string
        readonly summary?: string
        readonly blocks: readonly { readonly id: string; readonly kind: "paragraph"; readonly text: string }[]
      }>({
        title: "Alpha",
        summary: "Bridge",
        blocks: [{ id: "body", kind: "paragraph" as const, text: "Omega" }],
      })
      const [, forceUnrelatedRender] = useState(0)
      return (
        <>
          <button type="button" onClick={() => forceUnrelatedRender((value) => value + 1)}>
            unrelated render
          </button>
          <NoteContent
            editable
            title={snapshot.title}
            {...(snapshot.summary === undefined ? {} : { summary: snapshot.summary })}
            blocks={snapshot.blocks}
            onNoteTransaction={(transaction) => {
              applyPendingTransaction = () => setSnapshot({
                title: transaction.snapshot.title,
                ...(transaction.snapshot.summary === undefined
                  ? {}
                  : { summary: transaction.snapshot.summary }),
                blocks: [...transaction.snapshot.blocks].filter(
                  (block): block is { id: string; kind: "paragraph"; text: string } =>
                    block.kind === "paragraph",
                ),
              })
            }}
          />
        </>
      )
    }
    const { container, getByRole } = render(<Harness />)
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(title.firstChild, 2, body.firstChild, 2)

    // When: replacement is requested, then an unrelated render occurs before the host applies it.
    const article = container.querySelector("article") ?? container
    article.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    }))
    getByRole("button", { name: "unrelated render" }).click()

    // Then: selection remains pending until the expected snapshot is rendered, then restores correctly.
    expect(container.querySelector('[data-note-region-id="title"]')?.textContent).toBe("Alpha")
    expect(window.getSelection()?.isCollapsed).toBe(false)
    if (!applyPendingTransaction) throw new Error("Expected pending transaction")
    applyPendingTransaction()
    await waitFor(() => expect(container.querySelector('[data-note-region-id="title"]')?.textContent).toBe("AlXega"))
    const selection = window.getSelection()
    const restoredTitle = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    if (!restoredTitle || !selection || selection.rangeCount === 0) {
      throw new Error("Expected restored caret")
    }
    const prefix = document.createRange()
    prefix.selectNodeContents(restoredTitle)
    const restoredRange = selection.getRangeAt(0)
    prefix.setEnd(restoredRange.startContainer, restoredRange.startOffset)
    expect(prefix.toString()).toBe("AlX")
  })

  it("waits for the controlled host before restoring a formatted selection", async () => {
    // Given: a controlled host delays applying a whole-note formatting transaction.
    let applyPendingTransaction: (() => void) | undefined
    const Harness = () => {
      const [snapshot, setSnapshot] = useState({
        title: "Alpha",
        blocks: [{ id: "body", kind: "paragraph" as const, text: "Omega" }],
      })
      const [, forceUnrelatedRender] = useState(0)
      return (
        <>
          <button type="button" onClick={() => forceUnrelatedRender((value) => value + 1)}>
            unrelated format render
          </button>
          <NoteContent
            editable
            title={snapshot.title}
            blocks={snapshot.blocks}
            onNoteTransaction={(transaction) => {
              applyPendingTransaction = () => setSnapshot({
                title: transaction.snapshot.title,
                blocks: [...transaction.snapshot.blocks].filter(
                  (block): block is { id: string; kind: "paragraph"; text: string } =>
                    block.kind === "paragraph",
                ),
              })
            }}
          />
        </>
      )
    }
    const { container, getByRole } = render(<Harness />)
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    if (!(title?.firstChild instanceof Text) || !(body?.firstChild instanceof Text)) {
      throw new Error("Expected text regions")
    }
    selectAcross(title.firstChild, 1, body.firstChild, 2)
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: vi.fn((command: string) => {
        if (command !== "bold") return true
        for (const root of [title, body]) root.innerHTML = `<strong>${root.textContent ?? ""}</strong>`
        const nextTitleText = title.querySelector("strong")?.firstChild
        const nextBodyText = body.querySelector("strong")?.firstChild
        if (!(nextTitleText instanceof Text) || !(nextBodyText instanceof Text)) return false
        selectAcross(nextTitleText, 1, nextBodyText, 2)
        return true
      }),
    })
    document.dispatchEvent(new Event("selectionchange"))
    await waitFor(() => expect(document.body.querySelector('[aria-label="粗体"]')).not.toBeNull())

    // When: formatting is requested and an unrelated render happens first.
    fireEvent.click(document.body.querySelector('[aria-label="粗体"]') ?? document.body)
    const unrelatedButton = getByRole("button", { name: "unrelated format render" })
    const unrelatedRange = document.createRange()
    unrelatedRange.selectNodeContents(unrelatedButton)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(unrelatedRange)
    unrelatedButton.click()

    // Then: the pending selection is restored only after the formatted snapshot appears.
    expect(window.getSelection()?.toString()).toBe("unrelated format render")
    if (!applyPendingTransaction) throw new Error("Expected pending format transaction")
    applyPendingTransaction()
    await waitFor(() => expect(container.querySelector('[data-note-region-id="title"]')?.innerHTML).toContain("strong"))
    await waitFor(() => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) throw new Error("Expected restored selection")
      const restored = selection.getRangeAt(0)
      const restoredTitle = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
      const restoredBody = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
      if (!restoredTitle || !restoredBody) throw new Error("Expected restored regions")
      const titlePrefix = document.createRange()
      titlePrefix.selectNodeContents(restoredTitle)
      titlePrefix.setEnd(restored.startContainer, restored.startOffset)
      const bodyPrefix = document.createRange()
      bodyPrefix.selectNodeContents(restoredBody)
      bodyPrefix.setEnd(restored.endContainer, restored.endOffset)
      expect(titlePrefix.toString()).toBe("A")
      expect(bodyPrefix.toString()).toBe("Om")
    })
  })

  it("restores the corrected selection after clearing a formula in a controlled note", async () => {
    // Given: a controlled cross-region selection includes an inline formula before trailing text.
    const Harness = () => {
      const [snapshot, setSnapshot] = useState({
        title: "Alpha",
        blocks: [{
          id: "body",
          kind: "paragraph" as const,
          text: 'x<span data-hn-inline-formula="FORM" contenteditable="false">FORM</span>tail',
        }],
      })
      return (
        <NoteContent
          editable
          title={snapshot.title}
          blocks={snapshot.blocks}
          onNoteTransaction={(transaction) => setSnapshot({
            title: transaction.snapshot.title,
            blocks: [...transaction.snapshot.blocks].filter(
              (block): block is { id: string; kind: "paragraph"; text: string } =>
                block.kind === "paragraph",
            ),
          })}
        />
      )
    }
    const { container } = render(<Harness />)
    const title = container.querySelector<HTMLElement>('[data-note-region-id="title"]')
    const body = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
    const titleText = title?.firstChild
    const trailingText = Array.from(body?.childNodes ?? []).find(
      (node): node is Text => node instanceof Text && node.data.includes("tail"),
    )
    if (!(titleText instanceof Text) || !trailingText) {
      throw new Error("Expected title and trailing body text")
    }
    selectAcross(titleText, 0, trailingText, 2)
    document.dispatchEvent(new Event("selectionchange"))
    await waitFor(() => expect(document.body.querySelector('[aria-label="清除样式"]')).not.toBeNull())

    // When: clearing formatting removes the selected formula and commits the controlled snapshot.
    fireEvent.click(document.body.querySelector('[aria-label="清除样式"]') ?? document.body)

    // Then: the restored endpoint uses the corrected post-removal offset, not the stale formula length.
    await waitFor(() => expect(container.querySelector('[data-hn-inline-formula]')).toBeNull())
    await waitFor(() => {
      const selection = window.getSelection()
      const restoredBody = container.querySelector<HTMLElement>('[data-note-region-id="block:body"]')
      if (!selection || selection.rangeCount === 0 || !restoredBody) {
        throw new Error("Expected restored controlled selection")
      }
      const restored = selection.getRangeAt(0)
      const bodyPrefix = document.createRange()
      bodyPrefix.selectNodeContents(restoredBody)
      bodyPrefix.setEnd(restored.endContainer, restored.endOffset)
      expect(bodyPrefix.toString()).toBe("xta")
    })
  })

  it("pastes an internal fragment with its atomic structure and fresh ids", () => {
    // Given: an internal selection contains text fragments around a picture.
    const source = render(
      <NoteContent
        title="Source note"
        blocks={[
          { id: "source-front", kind: "paragraph", text: "Source" },
          { id: "source-picture", kind: "picture", url: "/image.png", filename: "Diagram" },
          { id: "source-back", kind: "paragraph", text: "End" },
        ]}
      />,
    )
    const sourceFront = source.container.querySelector<HTMLElement>(
      '[data-note-region-id="block:source-front"]',
    )
    const sourceBack = source.container.querySelector<HTMLElement>(
      '[data-note-region-id="block:source-back"]',
    )
    if (!(sourceFront?.firstChild instanceof Text) || !(sourceBack?.firstChild instanceof Text)) {
      throw new Error("Expected source text regions")
    }
    selectAcross(sourceFront.firstChild, 2, sourceBack.firstChild, 1)
    const clipboard = dispatchClipboardEvent(
      source.container.querySelector("article") ?? source.container,
      "copy",
    )
    source.unmount()

    const onNoteTransaction = vi.fn<(transaction: NoteContentTransaction) => void>()
    const target = render(
      <NoteContent
        editable
        title="Target note"
        blocks={[
          { id: "target-front", kind: "paragraph", text: "Alpha" },
          { id: "target-back", kind: "paragraph", text: "Omega" },
        ]}
        onNoteTransaction={onNoteTransaction}
      />,
    )
    const targetFront = target.container.querySelector<HTMLElement>(
      '[data-note-region-id="block:target-front"]',
    )
    const targetBack = target.container.querySelector<HTMLElement>(
      '[data-note-region-id="block:target-back"]',
    )
    if (!(targetFront?.firstChild instanceof Text) || !(targetBack?.firstChild instanceof Text)) {
      throw new Error("Expected target text regions")
    }
    selectAcross(targetFront.firstChild, 2, targetBack.firstChild, 2)

    // When: the internal fragment replaces the target selection.
    dispatchPasteEvent(target.container.querySelector("article") ?? target.container, clipboard)

    // Then: text edges merge, the picture stays atomic, and its id is regenerated.
    expect(onNoteTransaction).toHaveBeenCalledOnce()
    const transaction = onNoteTransaction.mock.calls[0]?.[0]
    expect(transaction?.operation).toEqual({ kind: "replace", source: "clipboard" })
    expect(transaction?.snapshot.blocks).toHaveLength(3)
    expect(transaction?.snapshot.blocks[0]).toEqual({
      id: "target-front",
      kind: "paragraph",
      text: "Alurce",
    })
    expect(transaction?.snapshot.blocks[1]).toMatchObject({
      kind: "picture",
      url: "/image.png",
      filename: "Diagram",
    })
    expect(transaction?.snapshot.blocks[1]?.id).not.toBe("source-picture")
    expect(transaction?.snapshot.blocks[2]).toMatchObject({
      kind: "paragraph",
      text: "Eega",
    })
  })
})
