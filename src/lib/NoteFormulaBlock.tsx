import katex from "katex"
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react"

// 组件库 Popover：作为弹层表面，不传 anchor 时不注入定位样式，
// 只渲染 <div class="hn-popover {className}" ...>，style / ref / role 等 props 原样透传
import { Popover } from "@hamster-note/components"
// 组件库样式：使用 @layer hamster-note.components 分层，项目 src/lib/styles.css 未分层，
// 未分层样式在冲突时优先，故现有 .hn-note-formula-popover 视觉会被保留
import "@hamster-note/components/styles.css"

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

type FormulaPopoverAnchor = {
  readonly el: HTMLElement
  readonly theme: string
  readonly codeFont: string
}

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

export const NoteFormulaBlock = ({
  block,
  ctx
}: NoteFormulaBlockProps): ReactElement => {
  const [popoverAnchor, setPopoverAnchor] = useState<FormulaPopoverAnchor | null>(null)
  const previewRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 弹层打开时：聚焦 textarea，监听外部点击 / Escape / 滚动 / 窗口缩放以关闭
  useEffect(() => {
    if (!popoverAnchor) return
    textareaRef.current?.focus()

    const close = () => setPopoverAnchor(null)
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
  }, [popoverAnchor])

  // 块菜单打开时关闭弹层，避免浮层堆叠
  useEffect(() => {
    if (ctx.openBlockMenuId !== null) setPopoverAnchor(null)
  }, [ctx.openBlockMenuId])

  return (
    <>
      {renderBlockActionMenu(block, ctx)}
      <div className="hn-note-formula">
        {ctx.editable ? (
          <button
            ref={previewRef}
            type="button"
            className="hn-note-formula-preview hn-note-formula-preview--editable"
            data-editable-block-id={block.id}
            aria-label="编辑公式"
            aria-expanded={popoverAnchor !== null}
            aria-haspopup="dialog"
            onClick={(event) => {
              ctx.onBlockMenuOpenChange(
                blockMenuStateKey("convert", {
                  kind: "block",
                  blockId: block.id
                }),
                false
              )
              // 从按钮读取 CSS 变量，传给 Popover 内部以保持主题 / 字体一致
              const target = event.currentTarget
              const style = getComputedStyle(target)
              setPopoverAnchor({
                el: target,
                theme: style.getPropertyValue("--hn-theme"),
                codeFont: style.getPropertyValue("--hn-code-font")
              })
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
      {popoverAnchor ? (
        <Popover
          ref={popoverRef}
          anchor={popoverAnchor.el}
          className="hn-note-formula-popover"
          style={
            {
              "--hn-theme": popoverAnchor.theme,
              "--hn-code-font": popoverAnchor.codeFont
            } as CSSProperties
          }
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
        </Popover>
      ) : null}
    </>
  )
}
