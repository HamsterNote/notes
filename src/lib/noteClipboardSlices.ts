import { cloneClipboardBlock, parseClipboardBlock } from "./noteClipboardBlockCodec"
import { MAX_CLIPBOARD_TABLE_CELLS } from "./noteClipboardLimits"
import { createNoteId } from "./noteId"
import { plainTextToRestrictedHtml, sanitizeBodyHtml } from "./restrictedHtml"
import { restrictedHtmlToPlainText } from "./noteRegionCodec"
import type { NoteBlock } from "./types"
import { assertNever } from "./utils"

type RichClipboardBlock = Extract<
  NoteBlock,
  { readonly kind: "heading" | "orderedList" | "paragraph" | "unorderedList" }
>
type AtomicClipboardBlock = Extract<
  NoteBlock,
  { readonly kind: "card" | "directory" | "drawing" | "formula" | "picture" }
>
type StructuredClipboardBlock = Exclude<
  NoteBlock,
  AtomicClipboardBlock | Extract<NoteBlock, { readonly kind: "code" }> | RichClipboardBlock
>

export type NoteClipboardSlice =
  | { readonly kind: "atomic-block"; readonly block: AtomicClipboardBlock }
  | { readonly kind: "code-block"; readonly block: Extract<NoteBlock, { readonly kind: "code" }> }
  | { readonly kind: "rich-block"; readonly block: RichClipboardBlock }
  | { readonly kind: "structured-block"; readonly block: StructuredClipboardBlock }
  | { readonly kind: "table-row"; readonly cells: readonly string[] }

export const sliceFromBlock = (block: NoteBlock): NoteClipboardSlice => {
  switch (block.kind) {
    case "heading":
    case "orderedList":
    case "paragraph":
    case "unorderedList":
      return { kind: "rich-block", block }
    case "code":
      return { kind: "code-block", block }
    case "card":
    case "directory":
    case "drawing":
    case "formula":
    case "picture":
      return { kind: "atomic-block", block }
    case "callout":
    case "checklist":
    case "collapsible":
    case "quote":
    case "table":
    case "todo":
      return { kind: "structured-block", block }
  }
}

export const clipboardSlicesToBlocks = (
  slices: readonly NoteClipboardSlice[],
): readonly NoteBlock[] => slices.map((slice) => {
  switch (slice.kind) {
    case "atomic-block":
    case "structured-block":
      return cloneClipboardBlock(slice.block)
    case "code-block":
    case "rich-block":
      return { ...slice.block, id: createNoteId() }
    case "table-row":
      return { id: createNoteId(), kind: "table", rows: [slice.cells] }
  }
  return assertNever(slice)
})

const parseBlockSlice = (value: object): NoteClipboardSlice | null => {
  const kind = "kind" in value ? value.kind : undefined
  const block = parseClipboardBlock("block" in value ? value.block : undefined)
  if (!block) return null
  const parsed = sliceFromBlock(block)
  return parsed.kind === kind ? parsed : null
}

export const parseClipboardSlice = (value: unknown): NoteClipboardSlice | null => {
  if (typeof value !== "object" || value === null) return null
  const kind = "kind" in value ? value.kind : undefined
  if (kind !== "table-row") return parseBlockSlice(value)
  const cells = "cells" in value ? value.cells : undefined
  return Array.isArray(cells)
    && cells.length <= MAX_CLIPBOARD_TABLE_CELLS
    && cells.every((cell) => typeof cell === "string")
    ? { kind: "table-row", cells: cells.map(sanitizeBodyHtml) }
    : null
}

export const appendSliceHtml = (target: HTMLElement, slice: NoteClipboardSlice): void => {
  if (slice.kind === "code-block") {
    const pre = document.createElement("pre")
    const code = document.createElement("code")
    code.innerHTML = plainTextToRestrictedHtml(slice.block.code)
    pre.append(code)
    target.append(pre)
    return
  }
  if (slice.kind === "rich-block") {
    const paragraph = document.createElement("p")
    paragraph.innerHTML = sanitizeBodyHtml(slice.block.text)
    target.append(paragraph)
    return
  }
  if (slice.kind === "structured-block") {
    const block = slice.block
    const wrapper = document.createElement(block.kind === "quote" ? "blockquote" : "div")
    if (block.kind === "table") {
      const table = document.createElement("table")
      for (const cells of block.rows) {
        const row = table.insertRow()
        for (const cellHtml of cells) row.insertCell().innerHTML = sanitizeBodyHtml(cellHtml)
      }
      wrapper.append(table)
    } else if (block.kind === "todo" || block.kind === "checklist") {
      const title = document.createElement("strong")
      title.innerHTML = sanitizeBodyHtml(block.title)
      const list = document.createElement("ul")
      for (const item of block.items) {
        const entry = document.createElement("li")
        entry.innerHTML = `${item.checked ? "☑ " : "☐ "}${sanitizeBodyHtml(item.text)}`
        list.append(entry)
      }
      wrapper.append(title, list)
    } else if (block.kind === "collapsible") {
      const details = document.createElement("details")
      details.open = !block.collapsed
      const summary = document.createElement("summary")
      summary.innerHTML = sanitizeBodyHtml(block.title)
      details.append(summary)
      for (const nested of block.blocks) appendSliceHtml(details, sliceFromBlock(nested))
      wrapper.append(details)
    } else {
      const title = block.kind === "callout" ? block.title : block.text
      wrapper.innerHTML = sanitizeBodyHtml(title)
      if (block.kind === "callout") wrapper.insertAdjacentHTML("beforeend", sanitizeBodyHtml(block.text))
      if (block.kind === "quote" && block.author) wrapper.insertAdjacentText("beforeend", ` — ${block.author}`)
    }
    target.append(wrapper)
    return
  }
  if (slice.kind === "table-row") {
    const table = document.createElement("table")
    const row = table.insertRow()
    for (const cellHtml of slice.cells) row.insertCell().innerHTML = sanitizeBodyHtml(cellHtml)
    target.append(table)
    return
  }
  const label = document.createElement("div")
  if (slice.block.kind === "picture") {
    const image = document.createElement("img")
    image.src = slice.block.url
    image.alt = slice.block.filename
    label.append(image)
  } else {
    label.textContent = slice.block.kind
  }
  target.append(label)
}

export const clipboardSlicePlainText = (slice: NoteClipboardSlice): string => {
  if (slice.kind === "table-row") {
    return slice.cells.map(restrictedHtmlToPlainText).join("\t")
  }
  const block = slice.block
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "orderedList":
    case "unorderedList":
    case "quote":
      return restrictedHtmlToPlainText(block.text)
    case "code":
      return block.code
    case "todo":
    case "checklist":
      return [
        restrictedHtmlToPlainText(block.title),
        ...block.items.map((item) => `${item.checked ? "☑" : "☐"} ${restrictedHtmlToPlainText(item.text)}`),
      ].filter(Boolean).join("\n")
    case "callout":
      return [block.title, block.text].map(restrictedHtmlToPlainText).filter(Boolean).join("\n")
    case "table":
      return block.rows.map((row) => row.map(restrictedHtmlToPlainText).join("\t")).join("\n")
    case "collapsible":
      return [
        restrictedHtmlToPlainText(block.title),
        ...block.blocks.map((nested) => clipboardSlicePlainText(sliceFromBlock(nested))),
      ].filter(Boolean).join("\n")
    case "formula":
      return block.formula
    case "picture":
      return block.filename
    case "card":
      return "card"
    case "drawing":
      return "drawing"
    case "directory":
      return "directory"
  }
  return assertNever(block)
}
