import type { NoteBlock } from "./types"

export type ExternalNoteDropTarget = {
  readonly element: HTMLElement
  readonly insertionIndex: number
  readonly placement: "before" | "after"
}

export const getExternalNoteDropTarget = (
  body: HTMLElement,
  blocks: readonly NoteBlock[],
  point: { readonly x: number; readonly y: number }
): ExternalNoteDropTarget | null => {
  const bodyRect = body.getBoundingClientRect()
  if (
    point.x < bodyRect.left ||
    point.x > bodyRect.right ||
    point.y < bodyRect.top ||
    point.y > bodyRect.bottom
  ) {
    return null
  }

  const groups = new Map<string, HTMLElement[]>()
  for (const child of body.children) {
    if (!(child instanceof HTMLElement)) continue
    const blockId = child.getAttribute("data-note-block-id")
    if (blockId === null || !child.hasAttribute("data-note-sortable-id")) {
      continue
    }
    const group = groups.get(blockId)
    if (group === undefined) groups.set(blockId, [child])
    else group.push(child)
  }

  for (let insertionIndex = 0; insertionIndex < blocks.length; insertionIndex += 1) {
    const block = blocks[insertionIndex]
    if (block === undefined) continue
    const group = groups.get(block.id)
    const first = group?.[0]
    const last = group?.at(-1)
    if (first === undefined || last === undefined) continue
    const top = first.getBoundingClientRect().top
    const bottom = last.getBoundingClientRect().bottom
    if (point.y > bottom && insertionIndex < blocks.length - 1) continue
    const placement = point.y < top + (bottom - top) / 2 ? "before" : "after"
    return {
      element: placement === "before" ? first : last,
      insertionIndex: placement === "before" ? insertionIndex : insertionIndex + 1,
      placement
    }
  }

  const tail = body.querySelector<HTMLElement>(":scope > .hn-note-body-tail")
  return tail === null
    ? null
    : { element: tail, insertionIndex: 0, placement: "before" }
}
