import { type RefObject, useCallback, useState } from "react"

import { findEditableBlockById } from "./editableSelection"

export type FocusCaret = "start" | "end"

export const focusEditableBlock = (
  blockId: string,
  caret: FocusCaret,
  root?: ParentNode | null
): void => {
  const target = findEditableBlockById(root ?? document, blockId)
  if (!target) return

  target.focus()
  const range = document.createRange()
  range.selectNodeContents(target)
  range.collapse(caret === "start")
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export const useBlockEditing = (shellRef: RefObject<HTMLElement | null>) => {
  const [openBlockMenuId, setOpenBlockMenuId] = useState<string | null>(null)

  const requestFocus = useCallback(
    (blockId: string, caret: FocusCaret) => {
      setTimeout(() => focusEditableBlock(blockId, caret, shellRef.current), 0)
    },
    [shellRef]
  )

  const handleBlockMenuOpenChange = useCallback(
    (blockId: string, open: boolean) => {
      setOpenBlockMenuId((current) => {
        if (open) return blockId
        return current === blockId ? null : current
      })
    },
    []
  )

  return {
    openBlockMenuId,
    requestFocus,
    handleBlockMenuOpenChange
  }
}
