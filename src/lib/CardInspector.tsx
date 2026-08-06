import type { ReactElement } from "react"

import type { NoteCardData } from "./types"

type CardInspectorProps = {
  readonly card: NoteCardData
  readonly cards: readonly NoteCardData[]
  readonly onCardsChange: (cards: readonly NoteCardData[]) => void
}

export const CardInspector = ({
  card,
  cards,
  onCardsChange
}: CardInspectorProps): ReactElement => (
  <aside className="hn-note-card-inspector">
    <label>
      <span>卡片标题</span>
      <input
        aria-label="卡片标题"
        value={card.title}
        onChange={(event) =>
          onCardsChange(
            cards.map((currentCard) =>
              currentCard.id === card.id
                ? { ...currentCard, title: event.currentTarget.value }
                : currentCard
            )
          )
        }
      />
    </label>
    <label>
      <span>卡片内容</span>
      <textarea
        aria-label="卡片内容"
        value={card.content}
        onChange={(event) =>
          onCardsChange(
            cards.map((currentCard) =>
              currentCard.id === card.id
                ? { ...currentCard, content: event.currentTarget.value }
                : currentCard
            )
          )
        }
      />
    </label>
  </aside>
)
