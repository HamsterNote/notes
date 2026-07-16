import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useState
} from "react"

import type { EditContext } from "./NoteContentEditing"
import type { TableMenuItem } from "./TableOperationMenu"
import {
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow
} from "./tableEditing"
import type { NoteTableBlock } from "./types"

type OpenMenuState = {
  readonly triggerRect: DOMRect
  readonly items: readonly TableMenuItem[]
}

type TableOperationMenus = {
  readonly openMenu: OpenMenuState | null
  readonly closeMenu: () => void
  readonly openRowMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    row: number
  ) => void
  readonly openColumnMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    col: number
  ) => void
  readonly openColumnEdgeMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    col: number
  ) => void
  readonly openRowEdgeMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    row: number
  ) => void
}

export const useTableOperationMenus = (
  block: NoteTableBlock,
  ctx: EditContext
): TableOperationMenus => {
  const { onBlocksChange } = ctx
  const [openMenu, setOpenMenu] = useState<OpenMenuState | null>(null)
  const rowCount = block.rows.length
  const colCount = block.rows[0]?.length ?? 0

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  const openMenuFromButton = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, items: readonly TableMenuItem[]) => {
      event.preventDefault()
      event.stopPropagation()
      setOpenMenu({
        triggerRect: event.currentTarget.getBoundingClientRect(),
        items
      })
    },
    []
  )

  const openRowMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, row: number) => {
      openMenuFromButton(event, [
        {
          label: "添加行",
          onClick: () =>
            onBlocksChange?.(insertTableRow(ctx.getBlocks(), block.id, row + 1))
        },
        {
          label: "删除行",
          confirmationLabel: "确认删除行",
          onClick: () =>
            onBlocksChange?.(deleteTableRow(ctx.getBlocks(), block.id, row)),
          disabled: rowCount <= 1,
          danger: true
        }
      ])
    },
    [block.id, ctx, onBlocksChange, openMenuFromButton, rowCount]
  )

  const openColumnMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, col: number) => {
      openMenuFromButton(event, [
        {
          label: "添加列",
          onClick: () =>
            onBlocksChange?.(
              insertTableColumn(ctx.getBlocks(), block.id, col + 1)
            )
        },
        {
          label: "删除列",
          onClick: () =>
            onBlocksChange?.(deleteTableColumn(ctx.getBlocks(), block.id, col)),
          disabled: colCount <= 1,
          danger: true
        }
      ])
    },
    [block.id, colCount, ctx, onBlocksChange, openMenuFromButton]
  )

  // 左右边界只提供列插入，传入值就是目标列索引。
  const openColumnEdgeMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, col: number) => {
      openMenuFromButton(event, [
        {
          label: "添加列",
          onClick: () =>
            onBlocksChange?.(insertTableColumn(ctx.getBlocks(), block.id, col))
        }
      ])
    },
    [block.id, ctx, onBlocksChange, openMenuFromButton]
  )

  // 上下边界只提供行插入，传入值就是目标行索引。
  const openRowEdgeMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, row: number) => {
      openMenuFromButton(event, [
        {
          label: "添加行",
          onClick: () =>
            onBlocksChange?.(insertTableRow(ctx.getBlocks(), block.id, row))
        }
      ])
    },
    [block.id, ctx, onBlocksChange, openMenuFromButton]
  )

  return {
    openMenu,
    closeMenu,
    openRowMenu,
    openColumnMenu,
    openColumnEdgeMenu,
    openRowEdgeMenu
  }
}
