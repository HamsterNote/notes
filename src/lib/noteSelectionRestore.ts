import { NOTE_REGION_ATTRIBUTE } from "./noteTextFlow"
import { noteDomPoint, noteTextOffset } from "./noteTextOffset"

type RegionPoint = {
  readonly regionId: string
  readonly offset: number
}

export type StableNoteCaret = RegionPoint

export type StableNoteSelection = {
  readonly start: RegionPoint
  readonly end: RegionPoint
}

const regionForNode = (node: Node): HTMLElement | null => {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest<HTMLElement>(`[${NOTE_REGION_ATTRIBUTE}]`) ?? null
}

export const captureStableNoteSelection = (range: Range): StableNoteSelection | null => {
  const startRegion = regionForNode(range.startContainer)
  const endRegion = regionForNode(range.endContainer)
  const startId = startRegion?.getAttribute(NOTE_REGION_ATTRIBUTE)
  const endId = endRegion?.getAttribute(NOTE_REGION_ATTRIBUTE)
  if (!startRegion || !endRegion || !startId || !endId) return null
  return {
    start: { regionId: startId, offset: noteTextOffset(startRegion, range.startContainer, range.startOffset) },
    end: { regionId: endId, offset: noteTextOffset(endRegion, range.endContainer, range.endOffset) },
  }
}

export const restoreStableNoteSelection = (
  container: HTMLElement,
  selection: StableNoteSelection,
): Range | null => {
  const regions = Array.from(
    container.querySelectorAll<HTMLElement>(`[${NOTE_REGION_ATTRIBUTE}]`),
  )
  const start = regions.find(
    (region) => region.getAttribute(NOTE_REGION_ATTRIBUTE) === selection.start.regionId,
  )
  const end = regions.find(
    (region) => region.getAttribute(NOTE_REGION_ATTRIBUTE) === selection.end.regionId,
  )
  if (!start || !end) return null
  const startPoint = noteDomPoint(start, selection.start.offset)
  const endPoint = noteDomPoint(end, selection.end.offset)
  const range = document.createRange()
  range.setStart(startPoint[0], startPoint[1])
  range.setEnd(endPoint[0], endPoint[1])
  const browserSelection = window.getSelection()
  if (!browserSelection) return null
  browserSelection.removeAllRanges()
  browserSelection.addRange(range)
  return range
}

export const restoreStableNoteCaret = (
  container: HTMLElement,
  caret: StableNoteCaret,
): Range | null => restoreStableNoteSelection(container, { start: caret, end: caret })
