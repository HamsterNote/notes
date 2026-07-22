import {
  type CSSProperties,
  type FormEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

// 组件库 Popover / PopoverSeparator：作为弹层表面，不传 anchor 时不注入定位样式，
// 只渲染 <div class="hn-popover {className}" ...>，style / ref / role 等 props 原样透传
import { Popover, PopoverSeparator } from "@hamster-note/components"
// 组件库样式：使用 @layer hamster-note.components 分层，项目 src/lib/styles.css 未分层，
// 未分层样式在冲突时优先，故现有 .hn-note-popover* 视觉会被保留
import "@hamster-note/components/styles.css"
import "./styles.css"

import {
  findEditableBlockById,
  isRangeCrossMultipleEditableRoots,
  isRangeInNoteEditableScope,
  isRangeInSingleEditableRoot
} from "./editableSelection"
import {
  applyInlineCode,
  captureSelectionOffsets,
  clearSelectionFormatting,
  crossBlockClearFormatting,
  crossBlockToggleInlineCode,
  EMPTY_SELECTION_FORMAT_STATE,
  getSelectionFormatState,
  restoreSelectionOffsets,
  runCrossBlockFormatCommand,
  runNativeFormatCommand,
  type SelectionFormatState,
  syncEditableBlockFromRange,
  syncEditableBlocksFromRange,
  wrapSelectionWithInlineFormula
} from "./inlineSelectionFormatting"

type SelectionPopoverProps = {
  readonly containerRef: RefObject<HTMLElement | null>
  readonly portalContainerRef?: RefObject<HTMLElement | null> | undefined
  readonly onMagicLinkConfigure?: (() => Promise<string>) | undefined
  /**
   * createLink 执行后，将 contentEditable 的 innerHTML 同步回 React 状态。
   * 参数：(blockId, innerHtml)。
   * 解决：execCommand("createLink") 修改了 DOM 但未同步 React 状态，
   * 后续 onBlur 触发时会因 dangerouslySetInnerHTML 引用变化而替换 DOM，
   * 导致保存的选区 Range 失效。
   */
  readonly onContentChange?: ((blockId: string, innerHtml: string) => void) | undefined
  /**
   * 跨块格式化后批量同步：参数为受影响 root 的 (blockId, innerHtml) 数组。
   * 单块场景继续走 onContentChange；跨块场景使用本批量入口，避免多次调用
   * onContentChange 时 NoteContent 闭包内 blocks 取到 stale 值。
   */
  readonly onBatchContentChange?:
    | ((updates: ReadonlyArray<readonly [string, string]>) => void)
    | undefined
}

type PopoverPosition = {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly flip: boolean
}

type PopoverMode = "format" | "link" | "formula"



// 选区距视口顶部小于该阈值时，popover 翻转到选区下方，避免被裁切
const FLIP_THRESHOLD = 88
// popover 与选区之间的间距
const POPPER_GAP = 8
// popover 水平 clamp 时与容器左右边缘保留的间距
const POPOVER_MARGIN = 8

const computePosition = (range: Range): PopoverPosition => {
  const rect = range.getBoundingClientRect()
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left + rect.width / 2,
    flip: rect.top < FLIP_THRESHOLD
  }
}

// 以元素（如行内公式 span）的矩形为锚点计算 popover 位置，与选区锚点共用翻转阈值
const computeElementPosition = (el: HTMLElement): PopoverPosition => {
  const rect = el.getBoundingClientRect()
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left + rect.width / 2,
    flip: rect.top < FLIP_THRESHOLD
  }
}

// 预设文字颜色：与 popover 中的色块按钮一一对应，
// 点击调用 document.execCommand("foreColor", false, hex) 将颜色作为内联样式写入选区
const TEXT_COLORS = [
  { name: "红色", hex: "#ef4444" },
  { name: "蓝色", hex: "#3b82f6" },
  { name: "绿色", hex: "#22c55e" },
  { name: "黑色", hex: "#000000" },
  { name: "灰色", hex: "#6b7280" }
] as const

// 读取当前选区的文字颜色，用于在对应色块上高亮。
// jsdom 未实现 queryCommandValue，需做空值与异常兜底，避免测试与 SSR 崩溃。
const queryActiveColor = (): string => {
  if (typeof document.queryCommandValue !== "function") return ""
  try {
    const value = document.queryCommandValue("foreColor")
    return typeof value === "string" ? value : ""
  } catch {
    return ""
  }
}

export const SelectionPopover = ({
  containerRef,
  portalContainerRef,
  onMagicLinkConfigure,
  onContentChange,
  onBatchContentChange
}: SelectionPopoverProps) => {
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const [mode, setMode] = useState<PopoverMode>("format")
  const [linkUrl, setLinkUrl] = useState("")
  const [configuring, setConfiguring] = useState(false)
  // 公式输入模式（R1）的草稿值；确认时作为 LaTeX 源写入占位 span
  const [formulaValue, setFormulaValue] = useState("")
  // 当前选区的格式激活态（bold / italic / underline / strikeThrough / code / formula）
  // 在 selectionchange 与每次格式化动作后刷新；popover 隐藏时重置为空态
  const [activeFormats, setActiveFormats] = useState<SelectionFormatState>(
    EMPTY_SELECTION_FORMAT_STATE
  )
  // 当前选区文字颜色（由 queryCommandValue("foreColor") 读取），
  // 用于在对应色块上高亮；jsdom 下为空字符串，不会命中任何预设色块
  const [activeColor, setActiveColor] = useState<string>("")
  // 当前选区是否跨多个 contenteditable 根；用于在跨块时禁用 createLink 等单 selection 操作。
  const [crossBlock, setCrossBlock] = useState(false)

  // 保存进入链接配置时的选区 Range，用于恢复选区后执行 createLink
  const savedRangeRef = useRef<Range | null>(null)
  // 链接输入框 ref，用于自动聚焦
  const inputRef = useRef<HTMLInputElement | null>(null)
  // 公式输入框 ref，用于自动聚焦
  const formulaInputRef = useRef<HTMLInputElement | null>(null)
  // 正在编辑的已有行内公式 span（R1）；null 表示本次是新建公式
  const editingFormulaSpanRef = useRef<HTMLElement | null>(null)
  // mode 的 ref 镜像：selectionchange 监听器内读取最新值，避免闭包过期
  const modeRef = useRef<PopoverMode>(mode)
  modeRef.current = mode
  // 最近一次有效选区的 Range 克隆；格式化 helper 执行后若选区丢失，
  // 用它作为 syncEditableBlockFromRange 的兜底入参，保证 onContentChange 仍被触发
  const lastRangeRef = useRef<Range | null>(null)
  // popover 根元素 ref：水平 clamp 需要测量自身宽度
  const popoverRef = useRef<HTMLDivElement | null>(null)
  // R5: 格式化动作同步 innerHTML 会触发 React 重渲染，contentEditable 的 DOM
  // 被 dangerouslySetInnerHTML 整体替换，旧选区随之失效。动作后在此记录选区的
  // 纯文本偏移，useLayoutEffect 在提交完成后按偏移在新 DOM 上重建选区。
  // blockId 为 null 表示偏移基准是容器（跨块选区），否则是块元素。
  const pendingRestoreRef = useRef<{
    blockId: string | null
    start: number
    end: number
  } | null>(null)

  // 监听选区变化：仅在笔记容器内、非折叠、含可见文字时展示 popover。
  // 链接 / 公式输入模式下跳过同步，避免输入框获焦导致选区丢失而关闭 popover。
  useEffect(() => {
    const sync = () => {
      if (modeRef.current !== "format") return

      const container = containerRef.current
      const selection = window.getSelection()

      if (
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed ||
        !container
      ) {
        setPosition(null)
        setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
        setActiveColor("")
        setCrossBlock(false)
        return
      }

      const range = selection.getRangeAt(0)

      if (!isRangeInNoteEditableScope(range, container)) {
        setPosition(null)
        setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
        setActiveColor("")
        setCrossBlock(false)
        return
      }

      const text = selection.toString()

      if (!text.trim()) {
        setPosition(null)
        setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
        setActiveColor("")
        setCrossBlock(false)
        return
      }

      lastRangeRef.current = range.cloneRange()
      setPosition(computePosition(range))
      setActiveFormats(getSelectionFormatState())
      setActiveColor(queryActiveColor())
      setCrossBlock(isRangeCrossMultipleEditableRoots(range))
    }

    document.addEventListener("selectionchange", sync)
    return () => document.removeEventListener("selectionchange", sync)
  }, [containerRef])

  // popover 展示期间：滚动或 Escape 关闭（含链接模式状态重置）。
  // 注意 Docked 模式（移动端底部栏内）跳过 scroll 关闭：
  // 移动端触摸滚动时浏览器通常保留选区高亮，但不会触发 selectionchange，
  // 若仍按 scroll 关闭会导致“选区高亮还在、底部工具栏却消失”的体验割裂。
  // Escape 等键盘事件在两种模式下都关闭。
  useEffect(() => {
    if (!position) return

    const close = () => {
      setMode("format")
      setLinkUrl("")
      setFormulaValue("")
      setConfiguring(false)
      savedRangeRef.current = null
      editingFormulaSpanRef.current = null
      lastRangeRef.current = null
      setPosition(null)
      setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
      setActiveColor("")
      setCrossBlock(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    document.addEventListener("keydown", onKeyDown)

    const isDocked = Boolean(portalContainerRef?.current)
    if (!isDocked) {
      window.addEventListener("scroll", close, true)
      // R6: 点击 popover 外部任意位置即关闭（含公式 / 链接输入模式），
      // 与公式块 NoteFormulaBlock 的 pointerdown 外部关闭行为对齐。
      // 点击 popover 内部（输入框 / 按钮）时跳过；docked 底部栏模式与
      // scroll 关闭同理跳过——移动端可能保留选区高亮但不触发 selectionchange。
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target
        if (!(target instanceof Node)) return
        if (popoverRef.current?.contains(target)) return
        close()
      }
      document.addEventListener("pointerdown", onPointerDown)
      return () => {
        window.removeEventListener("scroll", close, true)
        document.removeEventListener("keydown", onKeyDown)
        document.removeEventListener("pointerdown", onPointerDown)
      }
    }
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [position, portalContainerRef])

  // 进入链接 / 公式输入模式：聚焦对应输入框
  useEffect(() => {
    if (mode === "link" && inputRef.current) {
      inputRef.current.focus()
    }
    if (mode === "formula" && formulaInputRef.current) {
      formulaInputRef.current.focus()
    }
  }, [mode])

  // R1: 点击已有的行内公式 span（contenteditable=false）时打开公式编辑 popover。
  // 这类点击会把选区折叠到 span 旁，无法靠 selectionchange 驱动，需单独监听。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const span = target.closest<HTMLElement>("[data-hn-inline-formula]")
      if (!span || !container.contains(span)) return
      editingFormulaSpanRef.current = span
      savedRangeRef.current = null
      setFormulaValue(
        span.getAttribute("data-hn-inline-formula") ?? span.textContent ?? ""
      )
      setPosition(computeElementPosition(span))
      setMode("formula")
    }
    container.addEventListener("click", onClick)
    return () => container.removeEventListener("click", onClick)
  }, [containerRef])

  // R4: 水平 clamp —— 浮动 popover 以 translate(-50%) 居中于 position.left，
  // 选区靠近容器边缘时 popover 会溢出容器。渲染后测量自身宽度，把中心点
  // clamp 到 [容器左 + MARGIN + 半宽, 容器右 - MARGIN - 半宽]；
  // 容器缺失时退化为视口。docked（底部栏）模式由宿主布局负责，跳过。
  useLayoutEffect(() => {
    if (!position || portalContainerRef?.current) return
    const popover = popoverRef.current
    if (!popover) return
    const width = popover.getBoundingClientRect().width
    const containerRect = containerRef.current?.getBoundingClientRect()
    // jsdom 等环境下容器矩形退化为零宽时按视口边界 clamp，避免错误归 0
    const boundLeft =
      containerRect && containerRect.width > 0 ? containerRect.left : 0
    const boundRight =
      containerRect && containerRect.width > 0
        ? containerRect.right
        : window.innerWidth
    const minCenter = boundLeft + POPOVER_MARGIN + width / 2
    const maxCenter = boundRight - POPOVER_MARGIN - width / 2
    // 容器比 popover 还窄时退化为容器中心，避免 min > max 造成来回抖动
    const clamped =
      maxCenter < minCenter
        ? (boundLeft + boundRight) / 2
        : Math.min(Math.max(position.left, minCenter), maxCenter)
    if (clamped !== position.left) {
      setPosition((current) => (current ? { ...current, left: clamped } : null))
    }
  }, [position, containerRef, portalContainerRef])

  // R5: 格式化动作后记录选区偏移，待重渲染提交后恢复。
  // 必须在 syncAfterFormat（触发 React 状态更新）之前调用 —— 此时旧 DOM 上的
  // 选区仍有效。跨块选区以容器为偏移基准，单块以所在块元素为基准。
  const capturePendingRestore = () => {
    pendingRestoreRef.current = null
    const container = containerRef.current
    const selection = window.getSelection()
    if (
      !container ||
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      return
    }
    const range = selection.getRangeAt(0)
    const startEl =
      range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement
    const blockEl = crossBlock
      ? null
      : (startEl?.closest("[data-editable-block-id]") ?? null)
    const root = blockEl ?? container
    const offsets = captureSelectionOffsets(root, range)
    if (offsets.end <= offsets.start) return
    pendingRestoreRef.current = {
      blockId: blockEl?.getAttribute("data-editable-block-id") ?? null,
      start: offsets.start,
      end: offsets.end
    }
  }

  // R5: 每次提交后检查是否有待恢复的选区 —— 重渲染替换 innerHTML 后，
  // 按 blockId 找到新块元素并按纯文本偏移重建选区，再据此更新 popover 位置。
  useLayoutEffect(() => {
    const pending = pendingRestoreRef.current
    if (!pending) return
    pendingRestoreRef.current = null
    const container = containerRef.current
    if (!container) return
    const root = pending.blockId
      ? findEditableBlockById(container, pending.blockId)
      : container
    if (!root) return
    restoreSelectionOffsets(root, pending.start, pending.end)
    const selection = window.getSelection()
    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed
    ) {
      setPosition(computePosition(selection.getRangeAt(0)))
    }
  })

  if (!position) return null

  // 格式化动作后把 contentEditable 的 DOM 变更同步回 React 状态。
  // 优先使用 helper 执行后的新鲜选区；若选区已丢失（如公式占位插入后光标
  // 落在 contenteditable=false 节点旁），回退到 lastRangeRef 保存的选区，
  // 确保 onContentChange 总能被触发。
  // 跨块选区走 syncEditableBlocksFromRange，遍历每个受影响 root 多次回调。
  // 若宿主提供 onBatchContentChange，则一次性收集所有 (blockId, innerHtml) 后批量回调，
  // 避免 NoteContent 内 onContentChange 闭包 blocks 取到 stale 值。
  const syncAfterFormat = () => {
    if (!onContentChange && !onBatchContentChange) return
    const container = containerRef.current
    const selection = window.getSelection()
    let range: Range | null =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    if (range === null) {
      range = lastRangeRef.current
    }
    if (range === null) return
    if (crossBlock && container) {
      if (onBatchContentChange) {
        const updates: Array<readonly [string, string]> = []
        syncEditableBlocksFromRange(range, container, (blockId, innerHtml) => {
          updates.push([blockId, innerHtml])
        })
        if (updates.length > 0) onBatchContentChange(updates)
      } else if (onContentChange) {
        syncEditableBlocksFromRange(range, container, onContentChange)
      }
    } else if (onContentChange) {
      syncEditableBlockFromRange(range, onContentChange)
    }
  }

  // 格式化动作后刷新 popover 位置与激活态：选区仍有效则重新定位，否则隐藏
  const refreshPositionAndState = () => {
    const selection = window.getSelection()
    const container = containerRef.current

    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      container &&
      isRangeInNoteEditableScope(selection.getRangeAt(0), container)
    ) {
      // 切换格式后立即读取最新状态，使按钮高亮反映 toggle 结果
      setActiveColor(queryActiveColor())
      setActiveFormats(getSelectionFormatState())
      setPosition(computePosition(selection.getRangeAt(0)))
    } else {
      setPosition(null)
    }
  }

  // 应用文字颜色：与 format 一致的选区校验与重定位逻辑，
  // 仅 command 改为 foreColor 并带上颜色 hex 作为第三参数
  const applyColor = (colorHex: string) => {
    document.execCommand("foreColor", false, colorHex)
    setActiveColor(colorHex)
    // 应用颜色不改变 bold/italic/underline 状态，但仍刷新一次以规避
    // 浏览器在跨节点选择时可能产生的格式漂移
    setActiveFormats(getSelectionFormatState())

    const selection = window.getSelection()
    const container = containerRef.current

    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      container &&
      isRangeInSingleEditableRoot(selection.getRangeAt(0), container)
    ) {
      setPosition(computePosition(selection.getRangeAt(0)))
    } else {
      setPosition(null)
    }
  }

  // 清除原生富文本标签，并补充处理自定义行内代码与公式节点。
  // 跨块选区需逐个 editable root 清理，避免原生命令只作用于当前根。
  const clearFormatting = () => {
    const container = containerRef.current
    if (crossBlock && container) {
      crossBlockClearFormatting(container)
    } else {
      clearSelectionFormatting()
    }
    capturePendingRestore()
    syncAfterFormat()
    refreshPositionAndState()
  }

  // 原生格式命令（bold / italic / underline / strikeThrough）：
  // 单块选区 -> runNativeFormatCommand；跨块选区 -> runCrossBlockFormatCommand 按 root 逐段执行
  const format = (command: "bold" | "italic" | "underline" | "strikeThrough") => {
    const container = containerRef.current
    if (crossBlock && container) {
      runCrossBlockFormatCommand(container, command)
    } else {
      runNativeFormatCommand(command)
    }
    capturePendingRestore()
    syncAfterFormat()
    refreshPositionAndState()
  }

  // 行内代码：选区外包裹 <code>，已在 <code> 内则解包（单块走 applyInlineCode；跨块走 crossBlockToggleInlineCode）
  const handleInlineCode = () => {
    const container = containerRef.current
    if (crossBlock && container) {
      crossBlockToggleInlineCode(container)
    } else {
      applyInlineCode()
    }
    capturePendingRestore()
    syncAfterFormat()
    refreshPositionAndState()
  }

  // 行内公式（R1）：不再直接包裹选区文本，而是打开公式输入 popover ——
  // 预填选中文本作为 LaTeX 草稿，确认时才插入占位 span。跨块时禁用
  // （按钮 disabled），避免多块内容塌陷到单个 span。
  const handleInlineFormula = () => {
    if (crossBlock) return
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange()
    }
    editingFormulaSpanRef.current = null
    setFormulaValue(selection?.toString().trim() ?? "")
    setMode("formula")
  }

  // 确认公式输入：编辑已有 span 时原地更新属性与文本；否则恢复保存的选区，
  // 用 wrapSelectionWithInlineFormula 插入新占位 span。两条路径都同步所在块。
  const applyFormula = () => {
    const formula = formulaValue.trim()
    if (!formula) {
      close()
      return
    }
    const editingSpan = editingFormulaSpanRef.current
    if (editingSpan?.isConnected) {
      editingSpan.setAttribute("data-hn-inline-formula", formula)
      editingSpan.textContent = formula
      if (onContentChange) {
        const range = document.createRange()
        range.selectNode(editingSpan)
        syncEditableBlockFromRange(range, onContentChange)
      }
      close()
      return
    }
    const savedRange = savedRangeRef.current
    if (!savedRange) {
      close()
      return
    }
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(savedRange)
    }
    wrapSelectionWithInlineFormula(formula)
    if (onContentChange) {
      syncEditableBlockFromRange(savedRange, onContentChange)
    }
    close()
  }

  // 进入链接配置模式：保存当前选区 Range（克隆以避免后续 DOM 变更影响）
  const enterLinkMode = () => {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange()
    }
    setLinkUrl("")
    setMode("link")
  }

  // 点击"魔法链接"按钮：调用宿主提供的 async 回调，返回值作为链接 URL
  const handleMagicLinkConfigure = async () => {
    if (!onMagicLinkConfigure) return
    setConfiguring(true)
    try {
      const result = await onMagicLinkConfigure()
      setLinkUrl(result)
    } finally {
      setConfiguring(false)
    }
  }

  // 确认应用链接：恢复保存的选区，执行 createLink（选中文本作为链接文案，url 作为 href）
  // 之后通过 syncEditableBlockFromRange 同步 DOM 变更到 React 状态，避免 onBlur
  // 因 innerHTML 差异替换 DOM 节点
  const applyLink = () => {
    const url = linkUrl.trim()
    const savedRange = savedRangeRef.current
    if (!url || !savedRange) {
      close()
      return
    }
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(savedRange)
    }
    document.execCommand("createLink", false, url)

    // createLink 后立即同步 contentEditable 的 innerHTML 到 React 状态，
    // 使 block.text 包含 <a> 标签，防止后续重渲染因 dangerouslySetInnerHTML
    // 引用变化而替换 DOM，从而避免保存的选区 Range 失效
    if (onContentChange) {
      syncEditableBlockFromRange(savedRange, onContentChange)
    }

    close()
  }

  const close = () => {
    setMode("format")
    setLinkUrl("")
    setFormulaValue("")
    setConfiguring(false)
    savedRangeRef.current = null
    editingFormulaSpanRef.current = null
    lastRangeRef.current = null
    setPosition(null)
    setActiveFormats(EMPTY_SELECTION_FORMAT_STATE)
    setActiveColor("")
    setCrossBlock(false)
  }

  const onLinkFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    applyLink()
  }

  const onFormulaFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    applyFormula()
  }

  const style: CSSProperties = position.flip
    ? {
        top: position.bottom + POPPER_GAP,
        left: position.left,
        transform: "translate(-50%, 0)"
      }
    : {
        top: position.top - POPPER_GAP,
        left: position.left,
        transform: "translate(-50%, -100%)"
      }

  const popover = (
    <Popover
      ref={popoverRef}
      className={`hn-note-popover hn-note-popover--edit${portalContainerRef ? " hn-note-popover--docked" : ""}`}
      style={portalContainerRef ? undefined : style}
      role="toolbar"
      aria-label="文字操作"
      onMouseDown={(event) => {
        // 格式模式：阻止 mousedown 默认行为，避免抢走 contentEditable 焦点、折叠选区。
        // 链接模式：不阻止，让输入框可正常获焦（选区已保存，不受影响）。
        if (mode === "format") event.preventDefault()
      }}
    >
      {mode === "format" ? (
        <>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.bold ? " hn-note-popover-btn--active" : ""}`}
            onClick={() => format("bold")}
            title="粗体"
            aria-label="粗体"
            aria-pressed={activeFormats.bold}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--bold">
              B
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.italic ? " hn-note-popover-btn--active" : ""}`}
            onClick={() => format("italic")}
            title="斜体"
            aria-label="斜体"
            aria-pressed={activeFormats.italic}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--italic">
              I
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.underline ? " hn-note-popover-btn--active" : ""}`}
            onClick={() => format("underline")}
            title="下划线"
            aria-label="下划线"
            aria-pressed={activeFormats.underline}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--underline">
              U
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.strikeThrough ? " hn-note-popover-btn--active" : ""}`}
            onClick={() => format("strikeThrough")}
            title="删除线"
            aria-label="删除线"
            aria-pressed={activeFormats.strikeThrough}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--strikethrough">
              S
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.code ? " hn-note-popover-btn--active" : ""}`}
            onClick={handleInlineCode}
            title="行内代码"
            aria-label="行内代码"
            aria-pressed={activeFormats.code}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--code">
              {"</>"}
            </span>
          </button>
          <button
            type="button"
            className={`hn-note-popover-btn${activeFormats.formula ? " hn-note-popover-btn--active" : ""}`}
            onClick={handleInlineFormula}
            title="行内公式"
            aria-label="行内公式"
            aria-pressed={activeFormats.formula}
            disabled={crossBlock}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--formula">
              fx
            </span>
          </button>
          <PopoverSeparator className="hn-note-popover-divider" />
          {TEXT_COLORS.map((color) => (
            <button
              key={color.hex}
              type="button"
              className={`hn-note-popover-color${
                activeColor === color.hex ? " hn-note-popover-color--active" : ""
              }`}
              style={{ backgroundColor: color.hex }}
              onClick={() => applyColor(color.hex)}
              title={`文字颜色：${color.name}`}
              aria-label={`文字颜色：${color.name}`}
              data-active={activeColor === color.hex}
            />
          ))}
          <PopoverSeparator className="hn-note-popover-divider" />
          <button
            type="button"
            className="hn-note-popover-btn hn-note-popover-btn--clear"
            onClick={clearFormatting}
            title="清除样式"
            aria-label="清除样式"
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--clear" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M9 7l1 13" />
                <path d="M15 7l-1 13" />
                <path d="M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13" />
                <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
              </svg>
            </span>
          </button>
          <PopoverSeparator className="hn-note-popover-divider" />
          <button
            type="button"
            className="hn-note-popover-btn hn-note-popover-btn--link"
            onClick={enterLinkMode}
            title="链接"
            aria-label="为选中文字添加链接"
            disabled={crossBlock}
          >
            <span className="hn-note-popover-glyph hn-note-popover-glyph--link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
          </button>
        </>
      ) : mode === "formula" ? (
        <form
          className="hn-note-popover-link-form"
          onSubmit={onFormulaFormSubmit}
        >
          <input
            ref={formulaInputRef}
            type="text"
            className="hn-note-popover-link-input"
            placeholder="输入 LaTeX 公式"
            aria-label="公式（LaTeX）"
            value={formulaValue}
            onChange={(event) => setFormulaValue(event.target.value)}
          />
          <button
            type="submit"
            className="hn-note-popover-btn hn-note-popover-btn--confirm"
            disabled={!formulaValue.trim()}
            title="确认"
            aria-label="确认"
          >
            ✓
          </button>
          <button
            type="button"
            className="hn-note-popover-btn hn-note-popover-btn--cancel"
            onClick={close}
            title="取消"
            aria-label="取消"
          >
            ✕
          </button>
        </form>
      ) : (
        <form className="hn-note-popover-link-form" onSubmit={onLinkFormSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="hn-note-popover-link-input"
            placeholder="输入链接 URL"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            disabled={configuring}
          />
          {onMagicLinkConfigure ? (
            <button
              type="button"
              className="hn-note-popover-btn hn-note-popover-btn--magic"
              onClick={() => {
                void handleMagicLinkConfigure()
              }}
              disabled={configuring}
              title="魔法链接"
            >
              {configuring ? "…" : "魔法链接"}
            </button>
          ) : null}
          <button
            type="submit"
            className="hn-note-popover-btn hn-note-popover-btn--confirm"
            disabled={!linkUrl.trim() || configuring}
            title="确认"
          >
            ✓
          </button>
          <button
            type="button"
            className="hn-note-popover-btn hn-note-popover-btn--cancel"
            onClick={close}
            title="取消"
          >
            ✕
          </button>
        </form>
      )}
    </Popover>
  )

  return createPortal(popover, portalContainerRef?.current ?? document.body)
}
