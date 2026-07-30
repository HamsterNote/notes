import { Button, Icon, Popover } from "@hamster-note/components"
import type { ReactElement } from "react"

import type { NoteCardData, NoteTheme } from "./types"

type CardLink = {
  readonly source: NoteCardData
  readonly target: NoteCardData
}

type Point = {
  readonly x: number
  readonly y: number
}

type CardLinkOverlayProps = {
  readonly cards: readonly NoteCardData[]
  readonly editable: boolean
  readonly selectedLinkId: string | undefined
  readonly theme: NoteTheme
  readonly onDelete: (sourceId: string, targetId: string) => void
  readonly onSelect: (linkId: string | undefined) => void
}

const getCardLinks = (cards: readonly NoteCardData[]): readonly CardLink[] => {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  return cards.flatMap((source) =>
    (source.linkedCardIds ?? []).flatMap((targetId) => {
      const target = cardsById.get(targetId)
      return target ? [{ source, target }] : []
    })
  )
}

const getCardBoundaryPoint = (
  source: NoteCardData,
  target: NoteCardData
): Point => {
  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2
  }
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2
  }
  const deltaX = targetCenter.x - sourceCenter.x
  const deltaY = targetCenter.y - sourceCenter.y
  const scale = Math.min(
    deltaX === 0 ? Number.POSITIVE_INFINITY : source.width / 2 / Math.abs(deltaX),
    deltaY === 0 ? Number.POSITIVE_INFINITY : source.height / 2 / Math.abs(deltaY)
  )

  return Number.isFinite(scale)
    ? { x: sourceCenter.x + deltaX * scale, y: sourceCenter.y + deltaY * scale }
    : sourceCenter
}

export const CardLinkOverlay = ({
  cards,
  editable,
  selectedLinkId,
  theme,
  onDelete,
  onSelect
}: CardLinkOverlayProps): ReactElement => (
  <svg className="hn-note-card-links" aria-label="卡片连线">
    {getCardLinks(cards).map(({ source, target }) => {
      const linkId = `${source.id}:${target.id}`
      const selected = linkId === selectedLinkId
      const start = getCardBoundaryPoint(source, target)
      const end = getCardBoundaryPoint(target, source)

      return (
        <g key={linkId}>
          <line
            className={`hn-note-card-link${selected ? " hn-note-card-link--selected" : ""}`}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
          />
          <line
            className="hn-note-card-link-hit-area"
            role="button"
            aria-label={`${source.title} 到 ${target.title} 的连线`}
            aria-pressed={selected}
            tabIndex={0}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            onClick={() => onSelect(selected ? undefined : linkId)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              onSelect(selected ? undefined : linkId)
            }}
          />
          {selected && editable ? (
            <foreignObject
              className="hn-note-card-link-popover"
              x={(start.x + end.x) / 2 - 22}
              y={(start.y + end.y) / 2 + 8}
              width="44"
              height="44"
            >
              <Popover theme={theme} role="toolbar" aria-label="连线操作">
                <Button
                  className="hn-note-card-link-delete"
                  type="button"
                  size="small"
                  variant="ghost"
                  aria-label="删除连线"
                  title="删除连线"
                  onClick={() => onDelete(source.id, target.id)}
                >
                  <Icon name="delete" aria-hidden="true" />
                </Button>
              </Popover>
            </foreignObject>
          ) : null}
        </g>
      )
    })}
  </svg>
)
