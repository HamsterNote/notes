import { type RefObject, useCallback, useState } from "react"

export type FocusCaret = "start" | "end"

const editableBlockSelector = (blockId: string): string =>
  `[data-editable-block-id="${blockId}"]`

export const focusEditableBlock = (
  blockId: string,
  caret: FocusCaret,
  root?: ParentNode | null
): void => {
  const target = (root ?? document).querySelector<HTMLElement>(
    editableBlockSelector(blockId)
  )
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
