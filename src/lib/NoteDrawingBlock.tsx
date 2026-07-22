import {
  DrawingSurface,
  normalizeDrawingValue,
  StrokeRenderer,
  type DrawingTool
} from "@hamster-note/painting"
import {
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import {
  DRAWING_FALLBACK_COLOR,
  DRAWING_FALLBACK_WIDTH,
  parseDrawingData,
  stringifyDrawingData,
  strokesBounds
} from "./drawingData"
import {
  blockMenuStateKey,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import { type EditContext, updateDrawing } from "./NoteContentEditing"
import type { NoteDrawingBlock as NoteDrawingBlockData } from "./types"

type NoteDrawingBlockProps = {
  readonly block: NoteDrawingBlockData
  readonly ctx: EditContext
}

/** 编辑对话框中可选的画笔工具。 */
const DRAWING_DIALOG_TOOLS: readonly {
  readonly tool: DrawingTool
  readonly label: string
}[] = [
  { tool: "pen", label: "画笔" },
  { tool: "line", label: "直线" },
  { tool: "rect", label: "矩形" },
  { tool: "ellipse", label: "椭圆" },
  { tool: "eraser", label: "橡皮" }
]

type DrawingThumbnailProps = {
  /** 已规范化的画板数据；undefined 表示尚未绘制。 */
  readonly value: ReturnType<typeof parseDrawingData>
}

/**
 * 画板缩略图：把全部笔画渲染进一个以笔画外接矩形为 viewBox 的 SVG，
 * 由 CSS 控制等比缩放，视觉上与图片块一致。painting 没有导出 minimap，
 * 这里用 StrokeRenderer 复刻一份轻量缩略渲染。
 */
const DrawingThumbnail = ({ value }: DrawingThumbnailProps): ReactElement => {
  const bounds = value ? strokesBounds(value.strokes) : undefined

  if (!value || !bounds) {
    return <span className="hn-note-drawing-placeholder">Drawing</span>
  }

  return (
    <svg
      className="hn-note-drawing-thumbnail"
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="画板缩略图"
    >
      {value.strokes.map((stroke) => (
        <StrokeRenderer
          key={stroke.id}
          stroke={stroke}
          fallbackColor={DRAWING_FALLBACK_COLOR}
          fallbackWidth={DRAWING_FALLBACK_WIDTH}
        />
      ))}
    </svg>
  )
}

export const NoteDrawingBlock = ({
  block,
  ctx
}: NoteDrawingBlockProps): ReactElement => {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tool, setTool] = useState<DrawingTool>("pen")
  const previewRef = useRef<HTMLButtonElement | null>(null)

  // data 字符串 → 规范化画板数据；空串/非法 JSON 视为"尚未绘制"
  const value = useMemo(() => parseDrawingData(block.data), [block.data])

  const closeDialog = () => {
    setDialogOpen(false)
    // 关闭后焦点还原到缩略图按钮，与公式块弹层行为一致
    previewRef.current?.focus()
  }

  // Escape 关闭编辑对话框
  useEffect(() => {
    if (!dialogOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setDialogOpen(false)
      // 焦点还原到缩略图按钮
      previewRef.current?.focus()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [dialogOpen])

  // 块菜单打开时关闭对话框，避免浮层堆叠（与公式块一致）
  useEffect(() => {
    if (ctx.openBlockMenuId !== null) setDialogOpen(false)
  }, [ctx.openBlockMenuId])

  return (
    <>
      {renderBlockActionMenu(block, ctx)}
      <div className="hn-note-drawing">
        {ctx.editable ? (
          <button
            ref={previewRef}
            type="button"
            className="hn-note-drawing-preview hn-note-drawing-preview--editable"
            data-editable-block-id={block.id}
            aria-label="编辑画板"
            aria-expanded={dialogOpen}
            aria-haspopup="dialog"
            onClick={() => {
              // 与公式块一致：打开编辑器前关闭可能悬停的转换菜单
              ctx.onBlockMenuOpenChange(
                blockMenuStateKey("convert", {
                  kind: "block",
                  blockId: block.id
                }),
                false
              )
              setDialogOpen(true)
            }}
          >
            <DrawingThumbnail value={value} />
          </button>
        ) : (
          <div className="hn-note-drawing-preview">
            <DrawingThumbnail value={value} />
          </div>
        )}
      </div>
      {dialogOpen
        ? createPortal(
            <div
              className="hn-note-drawing-overlay"
              onPointerDown={(event) => {
                // 仅点击遮罩本体时关闭；面板内部点击不触发
                if (event.target === event.currentTarget) closeDialog()
              }}
            >
              <div
                className="hn-note-drawing-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="画板编辑器"
              >
                <div
                  className="hn-note-drawing-toolbar"
                  role="toolbar"
                  aria-label="画板工具"
                >
                  {DRAWING_DIALOG_TOOLS.map((item) => (
                    <button
                      key={item.tool}
                      type="button"
                      className="hn-note-drawing-tool"
                      aria-pressed={tool === item.tool}
                      onClick={() => setTool(item.tool)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="hn-note-drawing-tool hn-note-drawing-close"
                    onClick={closeDialog}
                  >
                    完成
                  </button>
                </div>
                <div className="hn-note-drawing-canvas">
                  <DrawingSurface
                    tool={tool}
                    value={value ?? EMPTY_DRAWING_VALUE}
                    onChange={(nextValue) =>
                      ctx.onBlocksChange?.(
                        updateDrawing(
                          ctx.getBlocks(),
                          block.id,
                          stringifyDrawingData(nextValue)
                        )
                      )
                    }
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/** 未绘制时传给 DrawingSurface 的受控空值（模块级常量，避免每次渲染新建引用）。 */
const EMPTY_DRAWING_VALUE = normalizeDrawingValue(null)
