import type { StableNoteCaret } from "./noteSelectionRestore"
import { restrictedHtmlTextLength } from "./restrictedHtml"
import { noteTextOffset } from "./noteTextOffset"
import type { NoteContentUndoRedoSnapshot } from "./types"

export const NOTE_REGION_ATTRIBUTE = "data-note-region-id"
export const NOTE_ATOMIC_ATTRIBUTE = "data-note-atomic-id"

export type SelectedNoteFlow = {
  readonly range: Range
  readonly start: HTMLElement
  readonly end: HTMLElement
  readonly units: readonly HTMLElement[]
}

const intersects = (range: Range, element: HTMLElement): boolean => {
  try {
    return range.intersectsNode(element)
  } catch {
    return false
  }
}

const closestFlowUnit = (node: Node): HTMLElement | null => {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest<HTMLElement>(
    `[${NOTE_REGION_ATTRIBUTE}], [${NOTE_ATOMIC_ATTRIBUTE}]`,
  ) ?? null
}

const fullyCoversUnit = (range: Range, unit: HTMLElement): boolean => {
  const unitRange = document.createRange()
  unitRange.selectNode(unit)
  return range.compareBoundaryPoints(Range.START_TO_START, unitRange) <= 0
    && range.compareBoundaryPoints(Range.END_TO_END, unitRange) >= 0
}

export const selectedNoteFlow = (container: HTMLElement): SelectedNoteFlow | null => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const units = Array.from(
    container.querySelectorAll<HTMLElement>(
      `[${NOTE_REGION_ATTRIBUTE}], [${NOTE_ATOMIC_ATTRIBUTE}]`,
    ),
  ).filter((element) => intersects(range, element))
  const start = closestFlowUnit(range.startContainer) ?? units[0] ?? null
  const end = closestFlowUnit(range.endContainer) ?? units[units.length - 1] ?? null
  if (!start || !end) return null
  if (start === end) {
    return start.hasAttribute(NOTE_ATOMIC_ATTRIBUTE) && fullyCoversUnit(range, start)
      ? { range, start, end, units }
      : null
  }
  return { range, start, end, units }
}

export const rangeCrossesNoteFields = (range: Range): boolean => {
  const start = closestFlowUnit(range.startContainer)
  const end = closestFlowUnit(range.endContainer)
  if (!start || !end) return false
  const startId = start.getAttribute(NOTE_REGION_ATTRIBUTE)
  const endId = end.getAttribute(NOTE_REGION_ATTRIBUTE)
  if (!startId || !endId) return false
  const field = (regionId: string): "body" | "summary" | "title" => {
    if (regionId === "title") return "title"
    if (regionId === "summary") return "summary"
    return "body"
  }
  return field(startId) !== field(endId)
}

export const noteFlowCrossesFields = (flow: SelectedNoteFlow): boolean => {
  const field = (unit: HTMLElement): "body" | "summary" | "title" => {
    const regionId = unit.getAttribute(NOTE_REGION_ATTRIBUTE)
    if (regionId === "title") return "title"
    if (regionId === "summary") return "summary"
    return "body"
  }
  return field(flow.start) !== field(flow.end)
}

export const caretAfterNoteFlowMutation = (
  flow: SelectedNoteFlow,
  replacement: string,
  snapshot?: NoteContentUndoRedoSnapshot,
): StableNoteCaret | null => {
  const startId = flow.start.getAttribute(NOTE_REGION_ATTRIBUTE)
  if (startId) {
    if (startId === "summary" && snapshot && !snapshot.summary) {
      return {
        regionId: "title",
        offset: restrictedHtmlTextLength(snapshot.title),
      }
    }
    return {
      regionId: startId,
      offset: noteTextOffset(
        flow.start,
        flow.range.startContainer,
        flow.range.startOffset,
      ) + restrictedHtmlTextLength(replacement),
    }
  }
  const endId = flow.end.getAttribute(NOTE_REGION_ATTRIBUTE)
  return endId
    ? { regionId: endId, offset: restrictedHtmlTextLength(replacement) }
    : null
}

export const noteFlowClipboardPayload = (
  flow: SelectedNoteFlow,
  internal: string,
  semantic?: { readonly html: string; readonly text: string },
) => {
  if (semantic) return { html: semantic.html, text: semantic.text, internal }
  const wrapper = document.createElement("div")
  wrapper.append(flow.range.cloneContents())
  return {
    html: wrapper.innerHTML,
    text: flow.range.toString(),
    internal,
  }
}
