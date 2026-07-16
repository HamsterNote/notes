import katex from "katex"
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import {
  blockMenuStateKey,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import { type EditContext, updateFormula } from "./NoteContentEditing"
import type { NoteFormulaBlock as NoteFormulaBlockData } from "./types"

type NoteFormulaBlockProps = {
  readonly block: NoteFormulaBlockData
  readonly ctx: EditContext
}

type FormulaPopoverPosition = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly placeAbove: boolean
  readonly theme: string
  readonly codeFont: string
}

type FormulaPopoverStyle = CSSProperties & {
  readonly "--hn-theme": string
  readonly "--hn-code-font": string
}

const POPOVER_GAP = 8
const POPOVER_MARGIN = 8
const POPOVER_MAX_WIDTH = 520
const POPOVER_ESTIMATED_HEIGHT = 188

type FormulaPreviewProps = {
  readonly formula: string
}

const FormulaPreview = ({ formula }: FormulaPreviewProps): ReactElement => {
  const renderedRef = useRef<HTMLSpanElement | null>(null)

  useLayoutEffect(() => {
    const rendered = renderedRef.current
    if (!rendered || !formula.trim()) return
    katex.render(formula, rendered, {
      displayMode: true,
      throwOnError: false
    })
  }, [formula])

  return formula.trim() ? (
    <span ref={renderedRef} className="hn-note-formula-rendered" />
  ) : (
    <span className="hn-note-formula-placeholder" aria-hidden="true">
      f(x)
    </span>
  )
}

const positionPopover = (anchor: HTMLElement): FormulaPopoverPosition => {
  const rect = anchor.getBoundingClientRect()
  const anchorStyle = getComputedStyle(anchor)
  const width = Math.min(
    POPOVER_MAX_WIDTH,
    window.innerWidth - POPOVER_MARGIN * 2
  )
  const centeredLeft = rect.left + rect.width / 2 - width / 2
  const left = Math.max(
    POPOVER_MARGIN,
    Math.min(centeredLeft, window.innerWidth - width - POPOVER_MARGIN)
  )
  const placeAbove =
    window.innerHeight - rect.bottom < POPOVER_ESTIMATED_HEIGHT &&
    rect.top > POPOVER_ESTIMATED_HEIGHT

  return {
    left,
    top: placeAbove ? rect.top - POPOVER_GAP : rect.bottom + POPOVER_GAP,
    width,
    placeAbove,
    theme: anchorStyle.getPropertyValue("--hn-theme"),
    codeFont: anchorStyle.getPropertyValue("--hn-code-font")
  }
}

export const NoteFormulaBlock = ({
  block,
  ctx
}: NoteFormulaBlockProps): ReactElement => {
  const [position, setPosition] = useState<FormulaPopoverPosition | null>(null)
  const previewRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!position) return
    textareaRef.current?.focus()

    const close = () => setPosition(null)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        popoverRef.current?.contains(target) ||
        previewRef.current?.contains(target)
      )
        return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      previewRef.current?.focus()
    }
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && popoverRef.current?.contains(target)) return
      close()
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [position])

  useEffect(() => {
    if (ctx.openBlockMenuId !== null) setPosition(null)
  }, [ctx.openBlockMenuId])

  useLayoutEffect(() => {
    if (!position) return
    const popover = popoverRef.current
    if (!popover) return

    const rect = popover.getBoundingClientRect()
    const minTop = POPOVER_MARGIN
    const maxBottom = window.innerHeight - POPOVER_MARGIN
    const topAdjustment =
      rect.top < minTop
        ? minTop - rect.top
        : rect.bottom > maxBottom
          ? maxBottom - rect.bottom
          : 0
    if (topAdjustment === 0) return
    setPosition((current) =>
      current ? { ...current, top: current.top + topAdjustment } : null
    )
  }, [position])

  const popoverStyle: FormulaPopoverStyle | undefined = position
    ? {
        left: position.left,
        top: position.top,
        width: position.width,
        transform: position.placeAbove ? "translateY(-100%)" : undefined,
        "--hn-theme": position.theme,
        "--hn-code-font": position.codeFont
      }
    : undefined

  return (
    <div className="hn-note-block-row" id={block.id}>
      {renderBlockActionMenu(block, ctx)}
      <div className="hn-note-block-content hn-note-formula">
        {ctx.editable ? (
          <button
            ref={previewRef}
            type="button"
            className="hn-note-formula-preview hn-note-formula-preview--editable"
            data-editable-block-id={block.id}
            aria-label="编辑公式"
            aria-expanded={position !== null}
            aria-haspopup="dialog"
            onClick={(event) => {
              ctx.onBlockMenuOpenChange(
                blockMenuStateKey("convert", { kind: "block", blockId: block.id }),
                false
              )
              setPosition(positionPopover(event.currentTarget))
            }}
          >
            <FormulaPreview formula={block.formula} />
          </button>
        ) : (
          <div className="hn-note-formula-preview">
            <FormulaPreview formula={block.formula} />
          </div>
        )}
      </div>
      {position && popoverStyle
        ? createPortal(
            <div
              ref={popoverRef}
              className="hn-note-formula-popover"
              style={popoverStyle}
              role="dialog"
              aria-label="公式编辑器"
            >
              <textarea
                ref={textareaRef}
                className="hn-note-formula-textarea"
                value={block.formula}
                rows={5}
                spellCheck={false}
                aria-label="公式（LaTeX）"
                placeholder="例如：E = mc^2"
                onChange={(event) =>
                  ctx.onBlocksChange?.(
                    updateFormula(ctx.getBlocks(), block.id, event.target.value)
                  )
                }
              />
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
