import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import type { NoteTheme } from "./types"

export type TableMenuItem = {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly danger?: boolean
  readonly confirmationLabel?: string
}

type TableOperationMenuProps = {
  readonly items: readonly TableMenuItem[]
  readonly triggerRect: DOMRect
  readonly theme: NoteTheme
  readonly onClose: () => void
}

export const TableOperationMenu = ({
  items,
  triggerRect,
  theme,
  onClose
}: TableOperationMenuProps): ReactElement => {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pendingConfirmationLabel, setPendingConfirmationLabel] = useState<
    string | null
  >(null)

  const menuStyle: CSSProperties = {
    position: "fixed",
    top: triggerRect.bottom + 4,
    left: Math.min(triggerRect.left, window.innerWidth - 180),
    zIndex: 9999
  }

  useEffect(() => {
    const handleOutsideClick = (event: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }
    const handleClose = () => onClose()

    document.addEventListener("mousedown", handleOutsideClick)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("scroll", handleClose, true)
    window.addEventListener("resize", handleClose)
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("scroll", handleClose, true)
      window.removeEventListener("resize", handleClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="hn-note-block-menu"
      data-theme={theme}
      role="menu"
      style={menuStyle}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={[
            "hn-note-block-menu-item",
            item.danger ? "hn-note-block-menu-item--danger" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={item.disabled}
          onClick={() => {
            if (
              item.confirmationLabel &&
              pendingConfirmationLabel !== item.confirmationLabel
            ) {
              setPendingConfirmationLabel(item.confirmationLabel)
              return
            }
            item.onClick()
            onClose()
          }}
        >
          {pendingConfirmationLabel === item.confirmationLabel
            ? item.confirmationLabel
            : item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
