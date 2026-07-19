import { quoteTextLines } from "./blockSourceConversion"
import { createNoteId } from "./noteId"
import type { NoteBlock, NoteQuoteBlock, NoteTodoBlock } from "./types"

export const splitTodoBlock = (
  block: NoteTodoBlock,
  itemId: string
): NoteBlock[] => {
  const itemIndex = block.items.findIndex((item) => item.id === itemId)
  const item = block.items[itemIndex]
  if (itemIndex < 0 || item === undefined) return [block]

  const beforeItems = block.items.slice(0, itemIndex)
  const afterItems = block.items.slice(itemIndex + 1)
  const titleForExtractedItem =
    beforeItems.length === 0 && afterItems.length === 0 ? block.title : ""

  return [
    ...(beforeItems.length > 0 ? [{ ...block, items: beforeItems }] : []),
    {
      id: item.id,
      kind: "todo",
      title: titleForExtractedItem,
      items: [item]
    },
    ...(afterItems.length > 0
      ? [
          {
            ...block,
            id: beforeItems.length > 0 ? createNoteId() : block.id,
            title: beforeItems.length > 0 ? "" : block.title,
            items: afterItems
          }
        ]
      : [])
  ]
}

export const splitQuoteBlock = (
  block: NoteQuoteBlock,
  lineIndex: number,
  lineId: string
): NoteBlock[] => {
  const lines = quoteTextLines(block.text)
  const line = lines[lineIndex]
  if (line === undefined) return [block]

  const beforeLines = lines.slice(0, lineIndex)
  const afterLines = lines.slice(lineIndex + 1)
  const quoteBlock = (
    id: string,
    text: string,
    author?: string
  ): NoteQuoteBlock => ({
    id,
    kind: "quote",
    text,
    ...(author === undefined ? {} : { author })
  })

  return [
    ...(beforeLines.length > 0
      ? [quoteBlock(block.id, beforeLines.join("\n"))]
      : []),
    quoteBlock(
      lineId,
      line,
      afterLines.length === 0 ? block.author : undefined
    ),
    ...(afterLines.length > 0
      ? [quoteBlock(createNoteId(), afterLines.join("\n"), block.author)]
      : [])
  ]
}
