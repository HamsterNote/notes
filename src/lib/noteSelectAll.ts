import { NOTE_ATOMIC_ATTRIBUTE, NOTE_REGION_ATTRIBUTE } from "./noteTextFlow"
import { noteTextLength, noteTextOffset } from "./noteTextOffset"

const selectionCoversRegion = (selection: Selection, region: HTMLElement): boolean => {
  if (selection.rangeCount === 0 || selection.isCollapsed) return false
  const selected = selection.getRangeAt(0)
  const startsAtRegionStart = selected.startContainer === region || region.contains(selected.startContainer)
    ? noteTextOffset(region, selected.startContainer, selected.startOffset) === 0
    : false
  const endsAtRegionEnd = selected.endContainer === region || region.contains(selected.endContainer)
    ? noteTextOffset(region, selected.endContainer, selected.endOffset) === noteTextLength(region)
    : false
  if (startsAtRegionStart && endsAtRegionEnd) return true
  const complete = document.createRange()
  complete.selectNodeContents(region)
  return selected.compareBoundaryPoints(Range.START_TO_START, complete) <= 0
    && selected.compareBoundaryPoints(Range.END_TO_END, complete) >= 0
}

export const expandSelectAllToNoteFlow = (
  container: HTMLElement,
  target: EventTarget | null,
): boolean => {
  if (!(target instanceof Node)) return false
  const element = target instanceof Element ? target : target.parentElement
  const region = element?.closest<HTMLElement>(`[${NOTE_REGION_ATTRIBUTE}]`)
  const selection = window.getSelection()
  if (!region || !selection || !selectionCoversRegion(selection, region)) return false
  const units = container.querySelectorAll<HTMLElement>(
    `[${NOTE_REGION_ATTRIBUTE}], [${NOTE_ATOMIC_ATTRIBUTE}]`,
  )
  const first = units.item(0)
  const last = units.item(units.length - 1)
  if (!first || !last) return false
  const range = document.createRange()
  range.setStartBefore(first)
  range.setEndAfter(last)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}
