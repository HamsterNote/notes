import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react"

import "./styles.css"

import { isVisibleHtmlEmpty } from "./blockEditing"
import { useInlineFormulaRendering } from "./inlineFormulaRendering"
import { LinkMentionMenu } from "./LinkMentionMenu"
import { NoteChecklistBlock } from "./NoteChecklistBlock"
import { NoteListBlock } from "./NoteListBlock"
import { renderBlock, richText } from "./NoteContentBlocks"
import { editableProps, updateText } from "./NoteContentEditing"
import type { NoteBlock, NoteContentProps, NoteContentUndoRedoHandle } from "./types"
import { NoteQuoteBlock } from "./NoteQuoteBlock"
import { NoteTodoBlock } from "./NoteTodoBlock"
import { DISABLED_CONTROLLER } from "./noteContentUndoRedo"
import { createNoteId } from "./noteId"
import { SelectionPopover } from "./SelectionPopover"
import { useBlockEditing } from "./useBlockEditing"
import { useBlockDrag } from "./useBlockDrag"

type LegacyNoteContentProps = Omit<NoteContentProps, "ref"> & {
  readonly ref?: Ref<NoteContentUndoRedoHandle>
}

export function NoteContent(props: LegacyNoteContentProps): ReactNode
export function NoteContent(props: NoteContentProps): ReactNode
export function NoteContent({
  blocks,
  links = [],
  summary,
  tagLabel,
  title,
  theme = "light",
  themeColor,
  editable = false,
  selectMode = false,
  onTitleChange,
  onSummaryChange,
  onBlocksChange,
  onBlockSelect,
  onPictureUpload,
  onMagicLinkConfigure,
  onMagicLinkClick,
  onLinkClick,
  ref: undoRedoRef,
  undoRedoController,
  topPadding,
  bottomPadding
}: NoteContentProps | LegacyNoteContentProps) {
  const shellRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 841 : window.innerWidth
  )
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const blocksRef = useRef(blocks)
  const isMobileDevice =
    typeof navigator !== "undefined" &&
    (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

  useEffect(() => {
    const syncViewportWidth = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", syncViewportWidth)
    return () => window.removeEventListener("resize", syncViewportWidth)
  }, [])

  blocksRef.current = blocks
  const bodyPaddingX = viewportWidth > 840 ? "4rem" : "1.5rem"
  const contentEditable = editable && !selectMode
  const blockDragEnabled = contentEditable && onBlocksChange !== undefined
  // 底部工具栏触发条件：移动设备 或 视口宽度 <= 840px（窄屏布局）
  const useBottomBar = isMobileDevice || viewportWidth <= 840
  // shellStyle：注入主题色与可选的顶部/底部额外留白（px）。
  // 不直接写 padding，而是用 CSS 变量，使 .hn-note-hero/.hn-note-body
  // 能以 calc 叠加在各自默认内边距之上，保持原有视觉节奏。
  const shellStyle = {
    ...(themeColor ? { "--hn-theme": themeColor } : {}),
    ...(topPadding ? { "--hn-top-padding": `${topPadding}px` } : {}),
    ...(bottomPadding ? { "--hn-bottom-padding": `${bottomPadding}px` } : {})
  } as CSSProperties
  const controller = undoRedoController ?? DISABLED_CONTROLLER
  useImperativeHandle(
    undoRedoRef,
    () => ({
      ...controller,
      scrollToBlock: (blockId: string): boolean => {
        const body = bodyRef.current
        if (!body) return false
        const target = Array.from(body.children).find(
          (element): element is HTMLElement =>
            element instanceof HTMLElement &&
            (element.id === blockId ||
              element.getAttribute("data-note-sortable-id") === blockId ||
              element.getAttribute("data-note-block-id") === blockId)
        )
        if (!target) return false
        target.scrollIntoView({ behavior: "smooth", block: "center" })
        if (!target.hasAttribute("tabindex")) target.tabIndex = -1
        target.focus({ preventScroll: true })
        return true
      }
    }),
    [controller]
  )
  const { openBlockMenuId, requestFocus, handleBlockMenuOpenChange } =
    useBlockEditing(shellRef)
  const appendParagraphAtTail = () => {
    const lastBlock = blocks[blocks.length - 1]
    if (
      lastBlock &&
      (lastBlock.kind === "paragraph" || lastBlock.kind === "heading") &&
      isVisibleHtmlEmpty(lastBlock.text)
    ) {
      requestFocus(lastBlock.id, "start")
      return
    }
    if (!onBlocksChange) return
    const newId = createNoteId()
    onBlocksChange([...blocks, { id: newId, kind: "paragraph", text: "" }])
    requestFocus(newId, "start")
  }
  useBlockDrag({
    bodyRef,
    blocks,
    onBlocksChange: blockDragEnabled ? onBlocksChange : undefined,
    touchEnabled: viewportWidth <= 840
  })
  // 只读模式下渲染富文本中嵌入的内联公式占位 span。可编辑模式下传 null
  // 禁用渲染——contentEditable 需保留原始 LaTeX 文本供用户直接编辑，
  // KaTeX 渲染产物会破坏选区与编辑语义。renderKey 仍随 blocks 变化，
  // 在只读模式下任何内容更新都会重新扫描并渲染公式。
  useInlineFormulaRendering({
    root: bodyRef,
    renderKey: contentEditable ? null : blocks
  })
  const selectBlockFromTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false
    const body = bodyRef.current
    if (!body) return false
    const boundary = Array.from(body.children).find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.hasAttribute("data-note-select-id") &&
        (element === target || element.contains(target))
    )
    if (!boundary) return false
    const blockId = boundary.getAttribute("data-note-select-id")
    if (!blockId) return false

    setSelectedBlockId(blockId)
    onBlockSelect?.(blockId)
    boundary.focus({ preventScroll: true })
    return true
  }

  return (
    <>
      <article
        className={`hn-note-shell hn-note-shell--${theme}${isMobileDevice ? " hn-note-shell--mobile" : ""}`}
        data-theme={theme}
        role={selectMode ? "listbox" : undefined}
        aria-label={selectMode ? "Note blocks" : undefined}
        ref={shellRef}
        style={shellStyle}
        onClickCapture={(event) => {
          if (contentEditable && event.target === bodyRef.current) {
            appendParagraphAtTail()
            return
          }
          if (selectMode && selectBlockFromTarget(event.target)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          // 拦截 hnmagic:// 链接点击：禁止原生跳转，交给宿主处理
          if (!(event.target instanceof Element)) return
          const anchor = event.target.closest("a")
          if (anchor) {
            const href = anchor.getAttribute("href")
            if (href?.startsWith("hnmagic://")) {
              event.preventDefault()
              event.stopPropagation()
              onMagicLinkClick?.(href)
            }
            return
          }
          // 已插入的 @ mention pill 点击：交给宿主处理
          const mention = event.target.closest<HTMLElement>("[data-note-link-id]")
          if (mention) {
            const id = mention.getAttribute("data-note-link-id")
            if (id) onLinkClick?.(id)
          }
        }}
        onKeyDownCapture={(event) => {
          // 键盘等价：Enter/Space 激活 hnmagic:// 链接时同样拦截原生跳转
          if (event.key !== "Enter" && event.key !== " ") return
          if (selectMode && selectBlockFromTarget(event.target)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (!(event.target instanceof Element)) return
          const anchor = event.target.closest("a")
          if (anchor) {
            const href = anchor.getAttribute("href")
            if (href?.startsWith("hnmagic://")) {
              event.preventDefault()
              event.stopPropagation()
              onMagicLinkClick?.(href)
            }
          }
        }}
      >
        <header className="hn-note-hero">
          {tagLabel ? <span className="hn-note-badge">{tagLabel}</span> : null}
          {contentEditable ? (
            <h1
              {...editableProps((event) =>
                onTitleChange?.(event.currentTarget.innerHTML)
              )}
              {...richText(title)}
            />
          ) : (
            <h1 {...richText(title)} />
          )}
          {summary ? (
            contentEditable ? (
              <p
                {...editableProps(
                  (event) =>
                    onSummaryChange?.(event.currentTarget.innerHTML),
                  "hn-note-summary"
                )}
                {...richText(summary)}
              />
            ) : (
              <p className="hn-note-summary" {...richText(summary)} />
            )
          ) : null}
        </header>

        <div
          ref={bodyRef}
          className="hn-note-body"
          style={{ "--hn-body-padding-x": bodyPaddingX } as CSSProperties}
        >
          {blocks.map((block) => {
            const editContext = {
              editable: contentEditable,
              blocks,
              getBlocks: () => blocksRef.current,
              openBlockMenuId,
              onBlocksChange,
              onPictureUpload,
              requestFocus,
              onBlockMenuOpenChange: handleBlockMenuOpenChange,
              selectMode,
              selectedBlockId
            }

            if (block.kind === "todo") {
              return (
                <NoteTodoBlock
                  key={block.id}
                  block={block}
                  ctx={editContext}
                />
              )
            }

            if (block.kind === "checklist") {
              return (
                <NoteChecklistBlock
                  key={block.id}
                  block={block}
                  ctx={editContext}
                />
              )
            }

            if (
              block.kind === "unorderedList" ||
              block.kind === "orderedList"
            ) {
              return (
                <NoteListBlock
                  key={block.id}
                  block={block}
                  ctx={editContext}
                />
              )
            }

            if (block.kind === "quote") {
              return (
                <NoteQuoteBlock
                  key={block.id}
                  block={block}
                  ctx={editContext}
                />
              )
            }

            const renderedBlock = renderBlock(block, editContext)

            return (
              <div
                className={[
                  "hn-note-block",
                  blockDragEnabled ? "hn-note-sortable-block" : "",
                  selectMode ? "hn-note-selectable-block" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                id={block.id}
                key={block.id}
                {...(blockDragEnabled
                  ? {
                      "data-note-sortable-id": block.id,
                      "data-note-block-id": block.id,
                      "data-note-drag-kind": "block"
                    }
                  : {})}
                {...(selectMode
                  ? {
                      "data-note-select-id": block.id,
                      role: "option" as const,
                      "aria-selected": selectedBlockId === block.id,
                      tabIndex: 0
                    }
                  : {})}
              >
                {renderedBlock}
              </div>
            )
          })}
          {/* 可编辑模式下，点击正文下方空白区域新建空段落 */}
          {contentEditable && onBlocksChange ? (
            <button
              type="button"
              aria-label="新建一行"
              className="hn-note-body-tail"
              onClick={appendParagraphAtTail}
            />
          ) : null}
        </div>
        {contentEditable && useBottomBar ? (
          <div ref={bottomBarRef} className="hn-note-bottom-bar" />
        ) : null}
      </article>
      {contentEditable ? (
        <LinkMentionMenu containerRef={shellRef} links={links} />
      ) : null}
      {contentEditable && openBlockMenuId === null ? (
        <SelectionPopover
          containerRef={shellRef}
          portalContainerRef={useBottomBar ? bottomBarRef : undefined}
          onMagicLinkConfigure={onMagicLinkConfigure}
          onContentChange={(blockId, innerHtml) => {
            onBlocksChange?.(updateText(blocks, blockId, innerHtml))
          }}
          onBatchContentChange={(updates) => {
            // 跨块格式化后批量同步：以本次渲染的 blocks 为起点 reduce，
            // 避免多次调用 onContentChange 时闭包 blocks 取到 stale 值。
            onBlocksChange?.(
              updates.reduce<NoteBlock[]>(
                (acc, [blockId, innerHtml]) => updateText(acc, blockId, innerHtml),
                [...blocks]
              )
            )
          }}
        />
      ) : null}
    </>
  )
}
