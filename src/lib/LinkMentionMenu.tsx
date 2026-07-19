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
  readonly triggerRange: Range
}

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

export const LinkMentionMenu = ({
  containerRef,
  links
}: MentionMenuProps) => {
  const [menu, setMenu] = useState<MentionMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
    if (!container || links.length === 0) {
      setMenu(null)
      return
    }

    const handleInput = (event: Event) => {
      if (event instanceof InputEvent && event.isComposing) return
      const editable = editableFromTarget(event.target, container)
      if (!editable) return
      const triggerRange = triggerRangeAtCaret(editable)
      if (!triggerRange) {
        setMenu(null)
        return
      }
      setMenu({
        activeIndex: 0,
        editable,
        triggerRange,
        ...menuPosition(editable, triggerRange)
      })
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
        setMenu(null)
        return
      }
      // 左 / 右方向键移动光标：用户已主动离开 @ 触发点，
      // 关闭下拉菜单让光标按浏览器默认行为移动（不 preventDefault，
      // 否则光标会卡在原地，菜单也关了却没动）。
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        setMenu(null)
        return
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        event.stopPropagation()
        const offset = event.key === "ArrowDown" ? 1 : -1
        setMenu((current) =>
          current
            ? {
                ...current,
                activeIndex:
                  (current.activeIndex + offset + links.length) % links.length
              }
            : null
        )
        return
      }
      if (event.key !== "Enter") return

      event.preventDefault()
      event.stopPropagation()
      const link = links[menu.activeIndex]
      if (link) {
        insertMention(menu, link)
        setMenu(null)
      }
    }

    const closeFromPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setMenu(null)
    }
    const close = () => setMenu(null)

    container.addEventListener("input", handleInput)
    container.addEventListener("keydown", handleKeyDown)
    document.addEventListener("pointerdown", closeFromPointer)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", close, true)
    return () => {
      container.removeEventListener("input", handleInput)
      container.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("pointerdown", closeFromPointer)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", close, true)
    }
  }, [containerRef, links, menu])

  if (!menu) return null

  const style: CSSProperties = { left: menu.left, top: menu.top }
  return createPortal(
    <div
      ref={menuRef}
      className="hn-note-mention-menu"
      role="listbox"
      aria-label="可选链接"
      style={style}
    >
      {links.map((link, index) => (
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
            setMenu(null)
          }}
        >
          <span className="hn-note-mention-mark" aria-hidden="true">
            @
          </span>
          <span>{link.name}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}
