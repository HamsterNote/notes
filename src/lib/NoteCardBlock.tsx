import { CardCanvas, type CardCanvasCard } from "@hamster-note/cards"
import "@hamster-note/cards/styles.css"
import { Dialog } from "@hamster-note/components"
import "@hamster-note/components/styles.css"
import {
  type CSSProperties,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"

import {
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
  type CardCanvasGeometry,
  getCardCanvasGeometry,
  restoreCardCanvasCoordinates,
  translateCardCanvasCoordinates
} from "./cardGeometry"
import { renderBlockActionMenu } from "./NoteBlockEditingControls"
import type { EditContext } from "./NoteContentEditing"
import type {
  NoteBlock,
  NoteCardBlock as NoteCardBlockData,
  NoteCardData
} from "./types"

type NoteCardBlockProps = {
  readonly block: NoteCardBlockData
  readonly ctx: EditContext
}

const replaceCardBlock = (
  blocks: readonly NoteBlock[],
  blockId: string,
  cards: readonly NoteCardData[]
): NoteBlock[] =>
  blocks.map((currentBlock) =>
    currentBlock.id === blockId && currentBlock.kind === "card"
      ? { ...currentBlock, data: cards }
      : currentBlock
  )

export const NoteCardBlock = ({
  block,
  ctx
}: NoteCardBlockProps): ReactElement => {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>()
  const [previewWidth, setPreviewWidth] = useState(CARD_PREVIEW_WIDTH)
  const [dialogGeometry, setDialogGeometry] =
    useState<CardCanvasGeometry | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const previewGeometry = useMemo(
    () => getCardCanvasGeometry(block.data),
    [block.data]
  )
  const previewScale = Math.min(
    previewWidth / previewGeometry.width,
    CARD_PREVIEW_HEIGHT / previewGeometry.height,
    1
  )
  const selectedCard = block.data.find((card) => card.id === selectedCardId)
  const dialogCards = dialogGeometry
    ? translateCardCanvasCoordinates(block.data, dialogGeometry)
    : previewGeometry.cards

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setSelectedCardId(undefined)
    setDialogGeometry(null)
  }, [])

  useEffect(() => {
    const preview = previewRef.current
    if (!preview || typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) {
        setPreviewWidth(entry.contentRect.width)
      }
    })
    observer.observe(preview)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (ctx.openBlockMenuId !== null) setDialogOpen(false)
  }, [ctx.openBlockMenuId])

  const commitCards = (cards: readonly CardCanvasCard[]) => {
    if (!ctx.editable) return
    ctx.onBlocksChange?.(replaceCardBlock(ctx.getBlocks(), block.id, cards))
  }
  const commitCanvasCards = (cards: readonly CardCanvasCard[]) => {
    if (!dialogGeometry) return
    commitCards(restoreCardCanvasCoordinates(cards, dialogGeometry))
  }

  const openDialog = () => {
    setDialogGeometry(getCardCanvasGeometry(block.data))
    setDialogOpen(true)
  }
  const onPreviewKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    openDialog()
  }

  const previewStyle: CSSProperties = {
    width: previewGeometry.width,
    height: previewGeometry.height,
    transform: `scale(${previewScale})`
  }

  return (
    <>
      {renderBlockActionMenu(block, ctx)}
      <div className="hn-note-card">
        <div
          ref={previewRef}
          className="hn-note-card-preview"
          role="button"
          tabIndex={0}
          aria-label="打开卡片"
          aria-expanded={dialogOpen}
          aria-haspopup="dialog"
          onClick={openDialog}
          onKeyDown={onPreviewKeyDown}
        >
          <div className="hn-note-card-preview-stage" style={previewStyle} inert>
            {previewGeometry.cards.length > 0 ? (
              <CardCanvas cards={previewGeometry.cards} />
            ) : (
              <span className="hn-note-card-empty">空卡片画布</span>
            )}
          </div>
          <span className="hn-note-card-preview-hint">点击打开卡片</span>
        </div>
      </div>
      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        className={`hn-note-shell hn-note-shell--${ctx.theme} hn-note-card-dialog`}
        style={
          ctx.themeColor
            ? ({ "--hn-theme": ctx.themeColor } as CSSProperties)
            : undefined
        }
        aria-label="卡片编辑器"
      >
        <header className="hn-note-card-dialog-header">
          <div>
            <h2>卡片</h2>
            <p>{ctx.editable ? "选择卡片后编辑内容" : "查看完整卡片画布"}</p>
          </div>
          <button type="button" onClick={closeDialog}>
            完成
          </button>
        </header>
        <div
          className={`hn-note-card-dialog-body${
            ctx.editable && selectedCard
              ? " hn-note-card-dialog-body--with-inspector"
              : ""
          }`}
        >
          <div className="hn-note-card-dialog-canvas">
            <div
              className="hn-note-card-dialog-stage"
              style={{
                width: Math.max(
                  dialogGeometry?.width ?? previewGeometry.width,
                  CARD_PREVIEW_WIDTH
                ),
                height: Math.max(
                  dialogGeometry?.height ?? previewGeometry.height,
                  520
                )
              }}
            >
              <CardCanvas
                cards={dialogCards}
                selected={selectedCardId ? [selectedCardId] : []}
                onSelect={setSelectedCardId}
                onClearSelection={() => setSelectedCardId(undefined)}
                {...(ctx.editable
                  ? { onCardsChange: commitCanvasCards }
                  : {})}
                options={{ requireSelectionToMoveResize: true }}
              />
            </div>
          </div>
          {ctx.editable && selectedCard ? (
            <aside className="hn-note-card-inspector">
              <label>
                <span>卡片标题</span>
                <input
                  aria-label="卡片标题"
                  value={selectedCard.title}
                  onChange={(event) =>
                    commitCards(
                      block.data.map((card) =>
                        card.id === selectedCard.id
                          ? { ...card, title: event.currentTarget.value }
                          : card
                      )
                    )
                  }
                />
              </label>
              <label>
                <span>卡片内容</span>
                <textarea
                  aria-label="卡片内容"
                  value={selectedCard.content}
                  onChange={(event) =>
                    commitCards(
                      block.data.map((card) =>
                        card.id === selectedCard.id
                          ? { ...card, content: event.currentTarget.value }
                          : card
                      )
                    )
                  }
                />
              </label>
            </aside>
          ) : null}
        </div>
      </Dialog>
    </>
  )
}
