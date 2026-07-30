import {
  plainTextToRestrictedHtml,
  sanitizeBodyHtml,
  sanitizeTitleHtml,
} from "./restrictedHtml"

export type NoteRegionProfile = "code" | "rich"

export const noteRegionProfile = (region: HTMLElement): NoteRegionProfile =>
  region.getAttribute("data-note-region-profile") === "code" ? "code" : "rich"

const fragmentRange = (root: HTMLElement, range: Range, before: boolean): Range => {
  const fragment = document.createRange()
  fragment.selectNodeContents(root)
  if (before) {
    fragment.setEnd(range.startContainer, range.startOffset)
  } else {
    fragment.setStart(range.endContainer, range.endOffset)
  }
  return fragment
}

const rangeHtml = (range: Range): string => {
  const wrapper = document.createElement("div")
  wrapper.append(range.cloneContents())
  return wrapper.innerHTML
}

export const restrictedHtmlToPlainText = (value: string): string => {
  const parsed = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html")
  for (const lineBreak of parsed.body.querySelectorAll("br")) {
    lineBreak.replaceWith(parsed.createTextNode("\n"))
  }
  return parsed.body.textContent ?? ""
}

export const fragmentForRegion = (
  source: HTMLElement,
  range: Range,
  before: boolean,
  targetProfile: NoteRegionProfile,
): string => {
  const fragment = fragmentRange(source, range, before)
  if (targetProfile === "code") return fragment.toString()
  return noteRegionProfile(source) === "code"
    ? plainTextToRestrictedHtml(fragment.toString())
    : rangeHtml(fragment)
}

export const selectedRegionFragment = (
  source: HTMLElement,
  range: Range,
  fromSelectionStart: boolean,
): string => {
  const selected = document.createRange()
  selected.selectNodeContents(source)
  if (fromSelectionStart) selected.setStart(range.startContainer, range.startOffset)
  else selected.setEnd(range.endContainer, range.endOffset)
  return noteRegionProfile(source) === "code"
    ? plainTextToRestrictedHtml(selected.toString())
    : rangeHtml(selected)
}

export const replacementForRegion = (
  replacement: string,
  targetProfile: NoteRegionProfile,
): string => targetProfile === "code" ? restrictedHtmlToPlainText(replacement) : replacement

export const normalizeNoteRegionHtml = (region: HTMLElement): string => {
  const regionId = region.getAttribute("data-note-region-id")
  return regionId === "title" || regionId === "summary"
    ? sanitizeTitleHtml(region.innerHTML)
    : sanitizeBodyHtml(region.innerHTML)
}

export const isNativeNoteEditorTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(
    "input, textarea, select, [data-note-editor-panel]",
  ) !== null
