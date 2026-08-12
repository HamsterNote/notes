import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from "react"

import "./styles.css"

import { Popover } from "@hamster-note/components"
import "@hamster-note/components/styles.css"

import {
  BottomBlockControls,
  type BottomBlockTarget,
  resolveBottomBlockTarget,
  resolveBottomBlockTargetBySource
} from "./BottomBlockControls"
import { isVisibleHtmlEmpty } from "./blockEditing"
import { findEditableBlockById } from "./editableSelection"
import type { NoteExternalItem } from "./externalNoteDrag"
import { useInlineFormulaRendering } from "./inlineFormulaRendering"
import {
  moveCaretOutsideTrailingFormat,
  tryApplyInlineMarkdownShortcut,
  tryEscapeTrailingFormat
} from "./inlineMarkdownShortcut"
import {
  captureSelectionOffsets,
  restoreSelectionOffsets
} from "./inlineSelectionFormatting"
import { LinkMentionMenu } from "./LinkMentionMenu"
import { NoteChecklistBlock } from "./NoteChecklistBlock"
import { renderBlock, richText } from "./NoteContentBlocks"
import {
  commitEditableContent,
  editableProps,
  updateText
} from "./NoteContentEditing"
import { NoteListBlock } from "./NoteListBlock"
import { NoteQuoteBlock } from "./NoteQuoteBlock"
import { NoteTodoBlock } from "./NoteTodoBlock"
import { DISABLED_CONTROLLER } from "./noteContentUndoRedo"
import { createNoteId } from "./noteId"
import { bindNotePointerSelection } from "./notePointerSelection"
import { isNativeNoteEditorTarget } from "./noteRegionCodec"
import { expandSelectAllToNoteFlow } from "./noteSelectAll"
import {
  restoreStableNoteCaret,
  restoreStableNoteSelection,
  type StableNoteCaret,
  type StableNoteSelection
} from "./noteSelectionRestore"
import {
  applyNoteRegionUpdates,
  deleteSelectedNoteFlow
} from "./noteSnapshotMutation"
import {
  createStructuredClipboard,
} from "./noteStructuredClipboard"
import {
  caretAfterNoteFlowMutation,
  NOTE_ATOMIC_ATTRIBUTE,
  noteFlowClipboardPayload,
  noteFlowCrossesFields,
  selectedNoteFlow
} from "./noteTextFlow"
import { replaceNoteFlowFromTransfer } from "./noteTransferReplacement"
import { plainTextToRestrictedHtml } from "./restrictedHtml"
import { SelectionPopover } from "./SelectionPopover"
import type {
  NoteBlock,
  NoteContentHandle,
  NoteContentProps,
  NoteContentTransactionOperation,
  NoteContentUndoRedoHandle,
  NoteContentUndoRedoSnapshot
} from "./types"
import { useBlockDrag } from "./useBlockDrag"
import { useBlockEditing } from "./useBlockEditing"
import { useExternalNoteDrag } from "./useExternalNoteDrag"

type LegacyNoteContentProps = Omit<NoteContentProps, "ref"> & {
  readonly ref?: Ref<NoteContentUndoRedoHandle>
}

const noteSnapshotRenderKey = (
  snapshot: NoteContentUndoRedoSnapshot
): string => JSON.stringify({
  title: snapshot.title,
  ...(snapshot.summary ? { summary: snapshot.summary } : {}),
  blocks: snapshot.blocks
})

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
  onNoteTransaction,
  onBlockSelect,
  onPictureUpload,
  onMagicLinkConfigure,
  onMagicLinkClick,
  onLinkClick,
  onExternalItemClick,
  ref: undoRedoRef,
  undoRedoController,
  topPadding,
  bottomPadding,
  bottomBarOffset = 32,
  titlePlaceholder = "请输入标题",
  bodyTailHint = "点击空白处新增一行"
}: NoteContentProps | LegacyNoteContentProps) {
  const contentEditable = editable && !selectMode
  const shellRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  // R7: Markdown 行内自动转换同步 innerHTML 后，React 提交会用
  // dangerouslySetInnerHTML 重建块 DOM，折叠光标随之失效。转换时在此记录
  // 块内纯文本偏移，useLayoutEffect 在提交完成后于新 DOM 上恢复光标。
  const pendingCaretRef = useRef<{ blockId: string; offset: number } | null>(
    null
  )
  const pendingNoteCaretRef = useRef<{
    readonly caret: StableNoteCaret
    readonly snapshotKey: string
  } | null>(null)
  const pendingNoteSelectionRef = useRef<{
    readonly selection: StableNoteSelection
    readonly snapshotKey: string
  } | null>(null)
  // R7: 一次性「逃逸」守卫 —— 自动转换完成后标记所在块；下一个可打印
  // 字符的 keydown 若仍处于块尾格式元素右边界，则手动插入该字符，
  // 规避 Chrome 把输入吸进内联元素的粘滞行为。
  const escapeFormatBlockRef = useRef<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 841 : window.innerWidth
  )
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [bottomBlockTarget, setBottomBlockTarget] =
    useState<BottomBlockTarget | null>(null)
  const blocksRef = useRef(blocks)
  const commitContinuousMutation = useCallback((
    snapshot: NoteContentUndoRedoSnapshot,
    operation: NoteContentTransactionOperation,
    crossesFields: boolean,
    caret: StableNoteCaret | null
  ): boolean => {
    const pending = caret
      ? { caret, snapshotKey: noteSnapshotRenderKey(snapshot) }
      : null
    if (onNoteTransaction) {
      pendingNoteCaretRef.current = pending
      onNoteTransaction({ snapshot, operation })
      return true
    }
    if (crossesFields) return false
    if (!onBlocksChange) return false
    pendingNoteCaretRef.current = pending
    onBlocksChange([...snapshot.blocks])
    return true
  }, [onBlocksChange, onNoteTransaction])
  const commitRegionFormat = useCallback((
    updates: readonly (readonly [regionId: string, html: string])[],
    selection: StableNoteSelection | null
  ): void => {
    const snapshot = applyNoteRegionUpdates(
      { title, ...(summary === undefined ? {} : { summary }), blocks },
      updates
    )
    const pending = selection
      ? { selection, snapshotKey: noteSnapshotRenderKey(snapshot) }
      : null
    if (onNoteTransaction) {
      pendingNoteSelectionRef.current = pending
      onNoteTransaction({
        snapshot,
        operation: { kind: "format", source: "popover" }
      })
      return
    }
    const fields = new Set(
      updates.map(([regionId]) =>
        regionId === "title" ? "title" : regionId === "summary" ? "summary" : "body"
      )
    )
    if (fields.size !== 1) return
    const field = fields.values().next().value
    pendingNoteSelectionRef.current = pending
    if (field === "title") onTitleChange?.(snapshot.title)
    else if (field === "summary") onSummaryChange?.(snapshot.summary ?? "")
    else onBlocksChange?.([...snapshot.blocks])
  }, [blocks, onBlocksChange, onNoteTransaction, onSummaryChange, onTitleChange, summary, title])
  const isMobileDevice =
    typeof navigator !== "undefined" &&
    (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

  useEffect(() => {
    const syncViewportWidth = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", syncViewportWidth)
    return () => window.removeEventListener("resize", syncViewportWidth)
  }, [])
  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !contentEditable) return
    return bindNotePointerSelection(shell)
  }, [contentEditable])
  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !contentEditable) return
    const handleBeforeInput = (event: InputEvent) => {
      if (isNativeNoteEditorTarget(event.target)) return
      const flow = selectedNoteFlow(shell)
      if (!flow) return
      const deletesSelection = event.inputType.startsWith("delete")
      const insertsText = event.inputType === "insertText" ||
        event.inputType === "insertReplacementText" ||
        event.inputType === "insertCompositionText"
      const insertsBreak = event.inputType === "insertParagraph" ||
        event.inputType === "insertLineBreak"
      const replacesSelection = insertsText || insertsBreak
      if (!deletesSelection && !replacesSelection) return
      event.preventDefault()
      const replacement = insertsBreak
        ? "<br>"
        : (insertsText ? plainTextToRestrictedHtml(event.data ?? "") : "")
      const next = deleteSelectedNoteFlow(
        flow,
        { title, ...(summary === undefined ? {} : { summary }), blocks },
        replacement
      )
      if (!next) return
       commitContinuousMutation(next, {
         kind: replacesSelection ? "replace" : "delete",
         source: "beforeinput"
       }, noteFlowCrossesFields(flow), caretAfterNoteFlowMutation(flow, replacement, next))
    }
    shell.addEventListener("beforeinput", handleBeforeInput)
    return () => shell.removeEventListener("beforeinput", handleBeforeInput)
  }, [blocks, commitContinuousMutation, contentEditable, summary, title])

  useLayoutEffect(() => {
    blocksRef.current = blocks
  }, [blocks])
  const bodyPaddingX = viewportWidth > 840 ? "4rem" : "1.5rem"
  const blockDragEnabled = contentEditable && onBlocksChange !== undefined
  const useBottomBar = isMobileDevice || viewportWidth < 840
  // shellStyle：注入主题色与可选的顶部/底部额外留白（px）。
  // 不直接写 padding，而是用 CSS 变量，使 .hn-note-hero/.hn-note-body
  // 能以 calc 叠加在各自默认内边距之上，保持原有视觉节奏。
  const shellStyle = {
    ...(themeColor ? { "--hn-theme": themeColor } : {}),
    ...(topPadding ? { "--hn-top-padding": `${topPadding}px` } : {}),
    ...(bottomPadding ? { "--hn-bottom-padding": `${bottomPadding}px` } : {})
  } as CSSProperties
  const controller = undoRedoController ?? DISABLED_CONTROLLER
  const externalDragHandle = useExternalNoteDrag({
    bodyRef,
    blocks,
    editable: contentEditable,
    canCommit: onBlocksChange !== undefined,
    commitBlocks: (nextBlocks) => onBlocksChange?.(nextBlocks)
  })
  useImperativeHandle(
    undoRedoRef,
    (): NoteContentHandle => ({
      ...controller,
      ...externalDragHandle,
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
    [controller, externalDragHandle]
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
  // R7: 每次提交后检查是否有待恢复的行内转换光标 —— 与 SelectionPopover
  // 的 pendingRestore 同理，按块内纯文本偏移在重建后的 DOM 上恢复折叠光标。
  useLayoutEffect(() => {
    const pendingNoteSelection = pendingNoteSelectionRef.current
    if (pendingNoteSelection) {
      const snapshotKey = noteSnapshotRenderKey({
        title,
        ...(summary === undefined ? {} : { summary }),
        blocks
      })
      if (snapshotKey === pendingNoteSelection.snapshotKey) {
        const shell = shellRef.current
        if (
          shell &&
          restoreStableNoteSelection(shell, pendingNoteSelection.selection)
        ) {
          pendingNoteSelectionRef.current = null
        }
      }
    }
    const pendingNoteCaret = pendingNoteCaretRef.current
    if (pendingNoteCaret) {
      const snapshotKey = noteSnapshotRenderKey({
        title,
        ...(summary === undefined ? {} : { summary }),
        blocks
      })
      if (snapshotKey === pendingNoteCaret.snapshotKey) {
        const shell = shellRef.current
        if (shell && restoreStableNoteCaret(shell, pendingNoteCaret.caret)) {
          pendingNoteCaretRef.current = null
        }
      }
    }
    const pending = pendingCaretRef.current
    if (!pending) return
    pendingCaretRef.current = null
    const shell = shellRef.current
    const root = shell ? findEditableBlockById(shell, pending.blockId) : null
    if (root) {
      restoreSelectionOffsets(root, pending.offset, pending.offset)
      // 偏移恢复的光标会落在格式元素文本内部末尾，外移到元素之后
      moveCaretOutsideTrailingFormat(root)
    }
  })
  useLayoutEffect(() => {
    if (!useBottomBar) return
    const body = bodyRef.current
    if (!body) return
    if (blocks.length === 0) {
      setBottomBlockTarget(null)
      return
    }
    const menuIsOpen = openBlockMenuId !== null
    setBottomBlockTarget((current) => {
      const next = resolveBottomBlockTargetBySource(
        body,
        current?.sourceId ?? null
      )
      if (
        !next ||
        menuIsOpen ||
        (!next.addExpanded && !next.convertExpanded)
      ) {
        return next
      }
      return { ...next, addExpanded: false, convertExpanded: false }
    })
  }, [blocks, openBlockMenuId, useBottomBar])
  const syncBottomBlockTarget = (target: EventTarget | null): void => {
    if (!useBottomBar) return
    const body = bodyRef.current
    if (!body) return
    const nextTarget = resolveBottomBlockTarget(target, body)
    if (nextTarget) setBottomBlockTarget(nextTarget)
  }
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
  const externalItemFromTarget = (
    target: EventTarget | null
  ): NoteExternalItem | null => {
    if (!(target instanceof Element)) return null
    const externalItem = target.closest<HTMLElement>(
      "[data-note-external-block-id]"
    )
    const blockId = externalItem?.getAttribute("data-note-external-block-id")
    if (blockId === null || blockId === undefined) return null
    const findBlock = (candidates: readonly NoteBlock[]): NoteBlock | undefined => {
      for (const candidate of candidates) {
        if (candidate.id === blockId) return candidate
        if (candidate.kind === "collapsible") {
          const nested = findBlock(candidate.blocks)
          if (nested !== undefined) return nested
        }
      }
      return undefined
    }
    const block = findBlock(blocksRef.current)
    return block?.kind === "paragraph" && block.externalItem?.clickable === true
      ? block.externalItem
      : null
  }

  return (
    <>
      <article
        className={`hn-note-shell hn-note-shell--${theme}${isMobileDevice ? " hn-note-shell--mobile" : ""}${useBottomBar ? " hn-note-shell--bottom-toolbar" : ""}`}
        data-theme={theme}
        role={selectMode ? "listbox" : undefined}
        aria-label={selectMode ? "Note blocks" : undefined}
        ref={shellRef}
        style={shellStyle}
        onCopy={(event) => {
          if (isNativeNoteEditorTarget(event.target)) return
          const flow = selectedNoteFlow(event.currentTarget)
          if (!flow) return
          const structured = createStructuredClipboard(flow, {
            title,
            ...(summary === undefined ? {} : { summary }),
            blocks
          })
          const payload = noteFlowClipboardPayload(flow, JSON.stringify(structured), structured)
          event.preventDefault()
          event.clipboardData.setData("text/html", payload.html)
          event.clipboardData.setData("text/plain", payload.text)
          event.clipboardData.setData(
            "application/x-hamsternote-fragment+json",
            payload.internal
          )
        }}
        onCut={(event) => {
          if (!contentEditable) return
          if (isNativeNoteEditorTarget(event.target)) return
          const flow = selectedNoteFlow(event.currentTarget)
          if (!flow) return
          event.preventDefault()
          const structured = createStructuredClipboard(flow, {
            title,
            ...(summary === undefined ? {} : { summary }),
            blocks
          })
          const payload = noteFlowClipboardPayload(flow, JSON.stringify(structured), structured)
          event.clipboardData.setData("text/html", payload.html)
          event.clipboardData.setData("text/plain", payload.text)
          event.clipboardData.setData(
            "application/x-hamsternote-fragment+json",
            payload.internal
          )
          const next = deleteSelectedNoteFlow(flow, {
            title,
            ...(summary === undefined ? {} : { summary }),
            blocks
          })
          if (!next) return
           commitContinuousMutation(next, {
             kind: "cut",
             source: "clipboard"
            }, noteFlowCrossesFields(flow), caretAfterNoteFlowMutation(flow, "", next))
        }}
        onPaste={(event) => {
          if (!contentEditable) return
          if (isNativeNoteEditorTarget(event.target)) return
          const flow = selectedNoteFlow(event.currentTarget)
          if (!flow) return
          event.preventDefault()
          const snapshot = {
            title,
            ...(summary === undefined ? {} : { summary }),
            blocks
          }
          const result = replaceNoteFlowFromTransfer(flow, snapshot, event.clipboardData)
          if (!result) return
          commitContinuousMutation(result.snapshot, {
            kind: "replace",
            source: "clipboard"
          }, noteFlowCrossesFields(flow), result.caret)
        }}
        onDrop={(event) => {
          if (!contentEditable) return
          if (isNativeNoteEditorTarget(event.target)) return
          const flow = selectedNoteFlow(event.currentTarget)
          if (!flow) return
          event.preventDefault()
          const result = replaceNoteFlowFromTransfer(flow, {
            title,
            ...(summary === undefined ? {} : { summary }),
            blocks
          }, event.dataTransfer)
          if (!result) return
          commitContinuousMutation(result.snapshot, {
            kind: "replace",
            source: "clipboard"
          }, noteFlowCrossesFields(flow), result.caret)
        }}
        onFocusCapture={(event) => syncBottomBlockTarget(event.target)}
        onPointerDownCapture={(event) => syncBottomBlockTarget(event.target)}
        onClickCapture={(event) => {
          if (
            contentEditable &&
            event.target === bodyRef.current &&
            window.getSelection()?.isCollapsed !== false
          ) {
            appendParagraphAtTail()
            return
          }
          if (selectMode && selectBlockFromTarget(event.target)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const externalItem = externalItemFromTarget(event.target)
          if (externalItem !== null) {
            event.preventDefault()
            event.stopPropagation()
            onExternalItemClick?.(externalItem)
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
          if (isNativeNoteEditorTarget(event.target)) return
          if (
            contentEditable &&
            event.key.toLowerCase() === "a" &&
            (event.ctrlKey || event.metaKey) &&
            expandSelectAllToNoteFlow(event.currentTarget, event.target)
          ) {
            event.preventDefault()
            return
          }
          // R7: Markdown 行内自动转换 —— 按下闭合字符（`、*、~）且与光标前
          // 起始标记配对时，直接把配对内容转换为行内 code/strong/em/s，
          // preventDefault 拦截该字符插入，并把块 innerHTML 同步回 React 状态。
          // capture 阶段处理，先于各块的 onKeyDown（它们不消费这些字符）。
          if (
            contentEditable &&
            onBlocksChange &&
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.nativeEvent.isComposing
          ) {
            // 一次性逃逸守卫：转换后的第一个可打印字符优先走手动插入
            if (escapeFormatBlockRef.current !== null) {
              escapeFormatBlockRef.current = null
              const escaped = tryEscapeTrailingFormat(event.key)
              if (escaped) {
                event.preventDefault()
                const blockId = escaped.getAttribute("data-editable-block-id")
                const selection = window.getSelection()
                if (blockId && selection && selection.rangeCount > 0) {
                  const offsets = captureSelectionOffsets(
                    escaped,
                    selection.getRangeAt(0)
                  )
                  pendingCaretRef.current = { blockId, offset: offsets.start }
                  commitEditableContent(escaped)
                }
                // 字符已手动插入并同步，跳过本键的其它处理
                return
              }
            }
            if (
              event.key === "`" ||
              event.key === "*" ||
              event.key === "~"
            ) {
              const blockEl = tryApplyInlineMarkdownShortcut(event.key)
              if (blockEl) {
                event.preventDefault()
                const blockId = blockEl.getAttribute("data-editable-block-id")
                const selection = window.getSelection()
                if (blockId && selection && selection.rangeCount > 0) {
                  const offsets = captureSelectionOffsets(
                    blockEl,
                    selection.getRangeAt(0)
                  )
                  pendingCaretRef.current = { blockId, offset: offsets.start }
                  escapeFormatBlockRef.current = blockId
                  commitEditableContent(blockEl)
                }
              }
            }
          }
          // 键盘等价：Enter/Space 激活 hnmagic:// 链接时同样拦截原生跳转
          if (event.key !== "Enter" && event.key !== " ") return
          if (selectMode && selectBlockFromTarget(event.target)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const externalItem = externalItemFromTarget(event.target)
          if (externalItem !== null) {
            if (event.key !== "Enter") return
            event.preventDefault()
            event.stopPropagation()
            onExternalItemClick?.(externalItem)
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
              {...editableProps((editable) =>
                onTitleChange?.(editable.innerHTML),
                undefined,
                "title"
              )}
              {...richText(title, "title")}
              data-note-region-id="title"
              data-editable-block-id="title"
              data-placeholder={titlePlaceholder}
            />
          ) : (
            <h1 data-note-region-id="title" {...richText(title, "title")} />
          )}
          {summary ? (
            contentEditable ? (
              <p
                {...editableProps(
                 (editable) => onSummaryChange?.(editable.innerHTML),
                  "hn-note-summary",
                  "title"
                )}
                {...richText(summary, "title")}
                data-note-region-id="summary"
                data-editable-block-id="summary"
              />
            ) : (
              <p
                className="hn-note-summary"
                data-note-region-id="summary"
                {...richText(summary, "title")}
              />
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
              theme,
              themeColor,
              blocks,
              getBlocks: () => blocksRef.current,
              openBlockMenuId,
              onBlocksChange,
              onPictureUpload,
              requestFocus,
              onBlockMenuOpenChange: handleBlockMenuOpenChange,
              externalItemsClickable:
                !selectMode && onExternalItemClick !== undefined,
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
                {...(["picture", "drawing", "card", "directory", "formula"].includes(
                  block.kind
                )
                  ? { [NOTE_ATOMIC_ATTRIBUTE]: `block:${block.id}` }
                  : {})}
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
            >
              {/* 尾部提示行：始终显示在正文最后一行，不可交互，
                  pointer-events: none 使点击穿透到按钮本身 */}
              <span className="hn-note-body-tail-hint" aria-hidden="true">
                {bodyTailHint}
              </span>
            </button>
          ) : null}
        </div>
        {contentEditable && useBottomBar ? (
          <Popover
            ref={bottomBarRef}
            className="hn-note-bottom-toolbar"
            data-note-bottom-bar
            theme={theme}
            edge="bottom"
            edgeOffset={bottomBarOffset}
            role="toolbar"
            aria-label="编辑操作"
            style={{ zIndex: 900 }}
          >
            <BottomBlockControls
              shellRef={shellRef}
              target={bottomBlockTarget}
            />
          </Popover>
        ) : null}
      </article>
      {contentEditable ? (
        <LinkMentionMenu containerRef={shellRef} links={links} />
      ) : null}
      {contentEditable && openBlockMenuId === null ? (
        <SelectionPopover
          containerRef={shellRef}
          theme={theme}
          allowCrossFieldFormat={Boolean(onNoteTransaction)}
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
          onRegionFormat={commitRegionFormat}
        />
      ) : null}
    </>
  )
}
