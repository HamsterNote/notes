import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import type { NoteLink } from "./types"

type MentionMenuProps = {
  readonly containerRef: RefObject<HTMLElement | null>
  readonly links: readonly NoteLink[]
}

type MentionMenuState = {
  readonly activeIndex: number
  readonly anchorTop: number
  readonly editable: HTMLElement
  readonly left: number
  readonly top: number
  /** `@` 到当前光标之间的查询文本（不含前导 `@`），用于过滤 links 与重置 activeIndex。 */
  readonly query: string
  /** live Range：打开时覆盖 `@` 单字符，每次同步时 setEnd 到光标处；插入 mention 时整段替换。 */
  readonly triggerRange: Range
}

/**
 * 取当前光标位置的触发 range：仅当光标紧贴 `@` 右侧（首次触发）时返回单字符 range。
 * 菜单已打开时的 query 扩展由 syncFromSelection 负责，不在这里判断。
 */
const triggerRangeAtCaret = (editable: HTMLElement): Range | null => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null

  const caret = selection.getRangeAt(0)
  if (!editable.contains(caret.startContainer)) return null
  if (!(caret.startContainer instanceof Text) || caret.startOffset === 0) return null
  if (caret.startContainer.data.at(caret.startOffset - 1) !== "@") return null

  const triggerRange = caret.cloneRange()
  triggerRange.setStart(caret.startContainer, caret.startOffset - 1)
  return triggerRange
}

/**
 * 扫描光标左侧文本，找到最近的可触发 `@`（不要求紧邻光标）。
 * 用户一次性输入 `@query` 时，`@` 与光标之间已有 query 字符，
 * 应以该 `@` 为起点、光标为终点构造初始 triggerRange，初始 query = 其间文本去除前导 `@`。
 * 仅处理光标所在 text node 内的 `@`；跨节点场景由 selectionchange 同步逐步兜底。
 */
const scanBackForTrigger = (editable: HTMLElement): Range | null => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null

  const caret = selection.getRangeAt(0)
  if (!editable.contains(caret.startContainer)) return null
  if (!(caret.startContainer instanceof Text) || caret.startOffset === 0) return null

  const text = caret.startContainer.data
  const caretOffset = caret.startOffset
  // 从光标前一个字符向前找最近的 `@`；找到即以此为起点构造 triggerRange。
  const atIdx = text.lastIndexOf("@", caretOffset - 1)
  if (atIdx === -1) return null

  const triggerRange = caret.cloneRange()
  triggerRange.setStart(caret.startContainer, atIdx)
  triggerRange.setEnd(caret.startContainer, caretOffset)
  return triggerRange
}

/**
 * 从光标位置反推：紧邻 `@` 时退回 triggerRangeAtCaret 的单字符 range；
 * 否则用 scanBackForTrigger 取 `@query` 整段作为初始 triggerRange。
 * 两者合一，兼容「逐字输入 @」与「一次性输入 @query」两种触发路径。
 */
const detectTrigger = (editable: HTMLElement): Range | null => {
  const immediate = triggerRangeAtCaret(editable)
  if (immediate) return immediate
  return scanBackForTrigger(editable)
}

const menuPosition = (
  editable: HTMLElement,
  triggerRange: Range
): Pick<MentionMenuState, "anchorTop" | "left" | "top"> => {
  const caretRange = triggerRange.cloneRange()
  caretRange.collapse(false)
  const caretRect =
    typeof caretRange.getBoundingClientRect === "function"
      ? caretRange.getBoundingClientRect()
      : editable.getBoundingClientRect()
  const anchorRect =
    caretRect.width === 0 && caretRect.height === 0
      ? editable.getBoundingClientRect()
      : caretRect

  return {
    anchorTop: anchorRect.top,
    left: Math.max(12, Math.min(anchorRect.left, window.innerWidth - 272)),
    top: anchorRect.bottom + 8
  }
}

const editableFromTarget = (
  target: EventTarget | null,
  container: HTMLElement
): HTMLElement | null => {
  if (!(target instanceof Element)) return null
  const editable = target.closest<HTMLElement>('[contenteditable="true"]')
  return editable && container.contains(editable) ? editable : null
}

const insertMention = (menu: MentionMenuState, link: NoteLink): void => {
  if (!menu.editable.contains(menu.triggerRange.commonAncestorContainer)) return

  // triggerRange 已在 syncFromSelection 中扩展到当前光标，deleteContents 会
  // 一次性删除 `@query` 整段，再用 mention pill + nbsp spacer 替换。
  menu.triggerRange.deleteContents()
  const mention = document.createElement("span")
  mention.className = "hn-note-link-mention"
  mention.setAttribute("data-note-link-id", link.id)
  mention.contentEditable = "false"
  mention.textContent = link.name
  const spacer = document.createTextNode("\u00a0")
  const fragment = document.createDocumentFragment()
  fragment.append(mention, spacer)
  menu.triggerRange.insertNode(fragment)

  const caret = document.createRange()
  caret.setStartAfter(spacer)
  caret.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(caret)
  menu.editable.focus({ preventScroll: true })
  menu.editable.dispatchEvent(new InputEvent("input", { bubbles: true }))
}

/** 大小写不敏感子串过滤：query 为空时返回全部，匹配 link.name。 */
const filterLinks = (
  links: readonly NoteLink[],
  query: string
): readonly NoteLink[] => {
  const q = query.trim().toLowerCase()
  if (q === "") return links
  return links.filter((link) => link.name.toLowerCase().includes(q))
}

export const LinkMentionMenu = ({
  containerRef,
  links
}: MentionMenuProps) => {
  const [menu, setMenu] = useState<MentionMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // dismiss 标记：记录被 ESC 关闭的触发点（text node + offset）。
  // 对同一个 `@` 继续输入字符时不重新弹出菜单；其他三种关闭方式必须清除该标记，
  // 以保证之后用户重新输入 `@` 仍能正常触发。
  const dismissedAtRef = useRef<{ node: Text; offset: number } | null>(null)

  // 下方溢出视口时翻转到上方（保留现有 useLayoutEffect 逻辑）。
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return

    const menuRect = menuRef.current.getBoundingClientRect()
    if (menuRect.bottom <= window.innerHeight - 12) return

    const top = Math.max(
      12,
      Math.min(
        menu.anchorTop - menuRect.height - 8,
        window.innerHeight - menuRect.height - 12
      )
    )
    if (top === menu.top) return
    setMenu((current) => (current ? { ...current, top } : null))
  }, [menu])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      setMenu(null)
      return
    }

    /**
     * 同步函数：菜单打开期间由 input / selectionchange 统一汇入。
     * 取当前 collapsed selection 光标，判断是否仍在触发 `@` 右侧：
     *   - 光标不在 menu.editable 内、或位于 `@` 起始处/其左侧（含 `@` 被删除退化）
     *     → 按条件 a 关闭菜单。
     *   - 否则把 triggerRange 的 end 扩展到光标，要求 range 文本以 `@` 开头，
     *     query = slice(1)；query 变化时重置 activeIndex。
     * jsdom 支持 Range.compareBoundaryPoints，故用它做边界比较。
     */
    const syncFromSelection = (current: MentionMenuState): void => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        setMenu(null)
        return
      }
      const caret = selection.getRangeAt(0)
      if (!selection.isCollapsed) return
      if (!current.editable.isConnected || !current.editable.contains(caret.startContainer)) {
        setMenu(null)
        return
      }
      // 比较光标与触发 `@` 起始位置：光标位于 `@` 起始处或其左侧 → 关闭。
      if (caret.compareBoundaryPoints(Range.START_TO_START, current.triggerRange) <= 0) {
        setMenu(null)
        return
      }
      // 扩展 triggerRange 末尾到光标，要求结果以 `@` 开头（否则 `@` 被删/被改）。
      const extended = current.triggerRange.cloneRange()
      try {
        extended.setEnd(caret.startContainer, caret.startOffset)
      } catch {
        setMenu(null)
        return
      }
      const text = extended.toString()
      if (!text.startsWith("@")) {
        setMenu(null)
        return
      }
      const query = text.slice(1)
      setMenu((prev) => {
        if (!prev) return null
        if (prev.query === query) return prev
        // query 变化：重置 activeIndex 到 0，并更新 triggerRange 的 endContainer/endOffset。
        prev.triggerRange.setEnd(caret.startContainer, caret.startOffset)
        return { ...prev, activeIndex: 0, query, triggerRange: prev.triggerRange }
      })
    }

    const handleInput = (event: Event) => {
      if (event instanceof InputEvent && event.isComposing) return
      const editable = editableFromTarget(event.target, container)
      if (!editable) return

      if (menu) {
        // 菜单已打开：走统一同步流程，让 query 跟随输入更新。
        syncFromSelection(menu)
        return
      }

      // 菜单未打开：检测新的 `@` 触发，跳过被 ESC dismiss 的同一触发点。
      const triggerRange = detectTrigger(editable)
      if (!triggerRange) return
      const startNode = triggerRange.startContainer
      if (
        dismissedAtRef.current &&
        dismissedAtRef.current.node === startNode &&
        dismissedAtRef.current.offset === triggerRange.startOffset
      ) {
        return
      }

      // 初始 query 取 `@` 到光标之间的文本（去除前导 `@`），
      // 兼容「一次性输入 @query」：此时 triggerRange 已覆盖整段，query 非空。
      const initialQuery = triggerRange.toString().slice(1)
      setMenu({
        activeIndex: 0,
        editable,
        query: initialQuery,
        triggerRange,
        ...menuPosition(editable, triggerRange)
      })
    }

    const handleSelectionChange = () => {
      if (!menu) return
      syncFromSelection(menu)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !menu ||
        !(event.target instanceof Node) ||
        !menu.editable.contains(event.target)
      ) {
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        // 记录被 dismiss 的触发点（`@` 的 text node + offset），后续对同一 `@`
        // 继续输入不再重新弹出；其他关闭路径必须清除该标记。
        dismissedAtRef.current = {
          node: menu.triggerRange.startContainer as Text,
          offset: menu.triggerRange.startOffset
        }
        setMenu(null)
        return
      }

      const filtered = filterLinks(links, menu.query)

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // 无匹配时方向键不 preventDefault，让光标走编辑器默认行为。
        if (filtered.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        const offset = event.key === "ArrowDown" ? 1 : -1
        setMenu((current) =>
          current
            ? {
                ...current,
                activeIndex:
                  (current.activeIndex + offset + filtered.length) % filtered.length
              }
            : null
        )
        return
      }

      if (event.key !== "Enter") return

      // 无匹配时 Enter 不 preventDefault：走编辑器默认换行/分块逻辑，
      // editable blur 后菜单按条件 b 自然关闭。
      if (filtered.length === 0) return

      event.preventDefault()
      event.stopPropagation()
      const link = filtered[menu.activeIndex]
      if (link) {
        insertMention(menu, link)
        dismissedAtRef.current = null
        setMenu(null)
      }
    }

    // editable blur / focusout：焦点离开触发菜单的 editable 即关闭。
    // 点击菜单选项不会触发 blur，因为 option 的 onPointerDown 已 preventDefault。
    const handleFocusOut = (event: FocusEvent) => {
      if (!menu) return
      const target = event.target
      if (target instanceof Node && menu.editable.contains(target)) {
        dismissedAtRef.current = null
        setMenu(null)
      }
    }

    // 滚动 / 窗口 resize：不再关闭菜单，而是根据 triggerRange 末尾重新定位；
    // 若 editable 已脱离文档（!isConnected）则关闭。
    const handleReposition = () => {
      if (!menu) return
      if (!menu.editable.isConnected) {
        setMenu(null)
        return
      }
      setMenu((current) =>
        current ? { ...current, ...menuPosition(current.editable, current.triggerRange) } : null
      )
    }

    container.addEventListener("input", handleInput)
    container.addEventListener("keydown", handleKeyDown)
    container.addEventListener("focusout", handleFocusOut)
    document.addEventListener("selectionchange", handleSelectionChange)
    window.addEventListener("resize", handleReposition)
    window.addEventListener("scroll", handleReposition, true)
    return () => {
      container.removeEventListener("input", handleInput)
      container.removeEventListener("keydown", handleKeyDown)
      container.removeEventListener("focusout", handleFocusOut)
      document.removeEventListener("selectionchange", handleSelectionChange)
      window.removeEventListener("resize", handleReposition)
      window.removeEventListener("scroll", handleReposition, true)
    }
  }, [containerRef, links, menu])

  if (!menu) return null

  const filtered = filterLinks(links, menu.query)
  const style: CSSProperties = { left: menu.left, top: menu.top }
  return createPortal(
    <div
      ref={menuRef}
      className="hn-note-mention-menu"
      role="listbox"
      aria-label="可选链接"
      style={style}
    >
      {filtered.length === 0 ? (
        // 空态提示：非交互元素，不可选、不可点；复用 popover 视觉语言。
        <div className="hn-note-mention-empty" role="presentation">
          无匹配结果
        </div>
      ) : (
        filtered.map((link, index) => (
          <button
            key={link.id}
            type="button"
            className="hn-note-mention-option"
            role="option"
            aria-selected={index === menu.activeIndex}
            onPointerDown={(event) => event.preventDefault()}
            onPointerEnter={() =>
              setMenu((current) =>
                current ? { ...current, activeIndex: index } : null
              )
            }
            onClick={() => {
              insertMention(menu, link)
              // 选中插入属条件 c 关闭，清除 dismiss 标记，之后重新输入仍可触发。
              dismissedAtRef.current = null
              setMenu(null)
            }}
          >
            <span className="hn-note-mention-mark" aria-hidden="true">
              @
            </span>
            <span>{link.name}</span>
          </button>
        ))
      )}
    </div>,
    document.body
  )
}
