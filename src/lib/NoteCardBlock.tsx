import { CardCanvas, type CardCanvasCard } from "@hamster-note/cards"
import "@hamster-note/cards/styles.css"
import { Drawer } from "@hamster-note/components"
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

import { CardInspector } from "./CardInspector"
import { CardLinkOverlay } from "./CardLinkOverlay"
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

type NoteCardBlockProps = { readonly block: NoteCardBlockData; readonly ctx: EditContext }

type CardCanvasStyle = CSSProperties & { readonly "--hn-card-theme": string }
type CardDrawerStyle = CSSProperties & {
  readonly "--hn-drawer-size": string
  readonly "--hn-theme"?: string
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
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>()
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
    setSelectedLinkId(undefined)
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
  const deleteLink = (sourceId: string, targetId: string) => {
    commitCards(
      block.data.map((card) =>
        card.id === sourceId
          ? {
              ...card,
              linkedCardIds: (card.linkedCardIds ?? []).filter(
                (linkedId) => linkedId !== targetId
              )
            }
          : card
      )
    )
    setSelectedLinkId(undefined)
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
  const cardCanvasStyle: CardCanvasStyle = {
    "--hn-card-theme": ctx.themeColor ?? "var(--hn-theme)"
  }
  const drawerStyle: CardDrawerStyle = {
    "--hn-drawer-size": "60vh",
    ...(ctx.themeColor ? { "--hn-theme": ctx.themeColor } : {})
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
              <div
                className="hn-note-card-canvas"
                data-theme={ctx.theme}
                style={cardCanvasStyle}
              >
                <CardCanvas cards={previewGeometry.cards} theme={ctx.theme} />
              </div>
            ) : (
              <span className="hn-note-card-empty">空卡片画布</span>
            )}
          </div>
          <span className="hn-note-card-preview-hint">点击打开卡片</span>
        </div>
      </div>
      <Drawer
        open={dialogOpen}
        onClose={closeDialog}
        placement="bottom"
        className={`hn-note-shell hn-note-shell--${ctx.theme} hn-note-card-drawer`}
        style={drawerStyle}
        aria-label="卡片编辑器"
      >
        <header className="hn-note-card-drawer-header">
          <div>
            <h2>卡片</h2>
            <p>{ctx.editable ? "选择卡片后编辑内容" : "查看完整卡片画布"}</p>
          </div>
          <button type="button" onClick={closeDialog}>
            完成
          </button>
        </header>
        <div
          className={`hn-note-card-drawer-body${
            ctx.editable && selectedCard
              ? " hn-note-card-drawer-body--with-inspector"
              : ""
          }`}
        >
          <div className="hn-note-card-drawer-canvas">
            <div
              className="hn-note-card-drawer-stage"
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
              <div
                className="hn-note-card-canvas"
                data-theme={ctx.theme}
                style={cardCanvasStyle}
              >
                <CardCanvas
                  cards={dialogCards}
                  theme={ctx.theme}
                  selected={selectedCardId ? [selectedCardId] : []}
                  onSelect={(cardId) => {
                    setSelectedCardId(cardId)
                    setSelectedLinkId(undefined)
                  }}
                  onClearSelection={() => {
                    setSelectedCardId(undefined)
                    setSelectedLinkId(undefined)
                  }}
                  {...(ctx.editable
                    ? { onCardsChange: commitCanvasCards }
                    : {})}
                  options={{ requireSelectionToMoveResize: true }}
                >
                  <CardLinkOverlay
                    cards={dialogCards}
                    editable={ctx.editable}
                    selectedLinkId={selectedLinkId}
                    theme={ctx.theme}
                    onDelete={deleteLink}
                    onSelect={(linkId) => {
                      setSelectedLinkId(linkId)
                      setSelectedCardId(undefined)
                    }}
                  />
                </CardCanvas>
              </div>
            </div>
          </div>
          {ctx.editable && selectedCard ? (
            <CardInspector
              card={selectedCard}
              cards={block.data}
              onCardsChange={commitCards}
            />
          ) : null}
        </div>
      </Drawer>
    </>
  )
}
