import type { NoteCardData } from "./types"

export const CARD_PREVIEW_WIDTH = 720
export const CARD_PREVIEW_HEIGHT = 220

export type CardCanvasGeometry = {
  readonly cards: NoteCardData[]
  readonly width: number
  readonly height: number
  readonly offsetX: number
  readonly offsetY: number
}

export const getCardCanvasGeometry = (
  cards: readonly NoteCardData[]
): CardCanvasGeometry => {
  if (cards.length === 0) {
    return {
      cards: [],
      width: CARD_PREVIEW_WIDTH,
      height: CARD_PREVIEW_HEIGHT,
      offsetX: 0,
      offsetY: 0
    }
  }

  const padding = 32
  let minX = cards[0]?.x ?? 0
  let minY = cards[0]?.y ?? 0
  let maxX = (cards[0]?.x ?? 0) + (cards[0]?.width ?? 0)
  let maxY = (cards[0]?.y ?? 0) + (cards[0]?.height ?? 0)
  for (const card of cards.slice(1)) {
    minX = Math.min(minX, card.x)
    minY = Math.min(minY, card.y)
    maxX = Math.max(maxX, card.x + card.width)
    maxY = Math.max(maxY, card.y + card.height)
  }
  const offsetX = padding - minX
  const offsetY = padding - minY

  return {
    cards: cards.map((card) => ({
      ...card,
      x: card.x + offsetX,
      y: card.y + offsetY
    })),
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
    offsetX,
    offsetY
  }
}

export const restoreCardCanvasCoordinates = (
  cards: readonly NoteCardData[],
  geometry: CardCanvasGeometry
): NoteCardData[] =>
  cards.map((card) => ({
    ...card,
    x: card.x - geometry.offsetX,
    y: card.y - geometry.offsetY
  }))

export const translateCardCanvasCoordinates = (
  cards: readonly NoteCardData[],
  geometry: CardCanvasGeometry
): NoteCardData[] =>
  cards.map((card) => ({
    ...card,
    x: card.x + geometry.offsetX,
    y: card.y + geometry.offsetY
  }))
