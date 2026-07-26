import type { NoteCardData } from "./types"

export const NOTE_CARD_FENCE_LANGUAGE = "hamster-note-card"

const MAX_CARD_DATA_LENGTH = 5_000_000
const MAX_CARD_COUNT = 500
const MAX_ID_LENGTH = 256
const MAX_TITLE_LENGTH = 10_000
const MAX_CONTENT_LENGTH = 100_000
const MAX_COORDINATE = 1_000_000
const MAX_DIMENSION = 100_000

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" && value.length <= maxLength

const parseCard = (value: unknown): NoteCardData | undefined => {
  if (!isRecord(value)) return undefined
  const {
    id,
    title,
    content,
    x,
    y,
    width,
    height,
    parent,
    zIndex,
    childrenLayoutMode,
    linkedCardIds,
    lock
  } = value
  const hasValidLinks =
    linkedCardIds === undefined ||
    (Array.isArray(linkedCardIds) &&
      linkedCardIds.length <= MAX_CARD_COUNT &&
      linkedCardIds.every((item) => isBoundedString(item, MAX_ID_LENGTH)))
  const isValid =
    isBoundedString(id, MAX_ID_LENGTH) &&
    isBoundedString(title, MAX_TITLE_LENGTH) &&
    isBoundedString(content, MAX_CONTENT_LENGTH) &&
    typeof x === "number" &&
    Number.isFinite(x) &&
    Math.abs(x) <= MAX_COORDINATE &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    Math.abs(y) <= MAX_COORDINATE &&
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    width <= MAX_DIMENSION &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0 &&
    height <= MAX_DIMENSION &&
    (parent === undefined || isBoundedString(parent, MAX_ID_LENGTH)) &&
    (zIndex === undefined ||
      (typeof zIndex === "number" &&
        Number.isFinite(zIndex) &&
        Math.abs(zIndex) <= MAX_COORDINATE)) &&
    (childrenLayoutMode === undefined ||
      childrenLayoutMode === "free" ||
      childrenLayoutMode === "mind-map-horizontal" ||
      childrenLayoutMode === "arrange") &&
    (lock === undefined || typeof lock === "boolean") &&
    hasValidLinks

  if (!isValid) return undefined

  return {
    id,
    title,
    content,
    x,
    y,
    width,
    height,
    ...(parent === undefined ? {} : { parent }),
    ...(zIndex === undefined ? {} : { zIndex }),
    ...(childrenLayoutMode === undefined ? {} : { childrenLayoutMode }),
    ...(linkedCardIds === undefined ? {} : { linkedCardIds }),
    ...(lock === undefined ? {} : { lock })
  }
}

export const normalizeCardData = (
  value: unknown
): NoteCardData[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_CARD_COUNT) return undefined

  const cards: NoteCardData[] = []
  for (const item of value) {
    const card = parseCard(item)
    if (!card) return undefined
    cards.push(card)
  }
  return cards
}

export const parseCardData = (value: string): NoteCardData[] | undefined => {
  if (value.length > MAX_CARD_DATA_LENGTH) return undefined
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }

  return normalizeCardData(parsed)
}

export const stringifyCardData = (cards: readonly NoteCardData[]): string =>
  JSON.stringify(cards, null, 2)
