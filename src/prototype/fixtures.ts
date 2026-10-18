import type { HnnDocument } from "../lib/hnn/codec"
import { HNN_DRAWING_EMPTY_DATA } from "../lib/hnn/drawingPayload"

export const paragraphId = "123e4567-e89b-42d3-a456-426614174000"
export const cardId = "123e4567-e89b-42d3-a456-426614174001"
export const drawingId = "123e4567-e89b-42d3-a456-426614174002"
export const cardData = JSON.stringify({
  schemaVersion: 1,
  cards: [
    {
      id: "card-1",
      title: "卡片",
      content: "",
      x: 0,
      y: 0,
      width: 240,
      height: 160
    }
  ]
})

export function initialDocument(): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: paragraphId },
          content: [{ type: "text", text: "共享正文" }]
        },
        { type: "card", attrs: { nodeId: cardId, data: cardData } },
        {
          type: "drawing",
          attrs: { nodeId: drawingId, data: HNN_DRAWING_EMPTY_DATA }
        }
      ]
    }
  }
}
