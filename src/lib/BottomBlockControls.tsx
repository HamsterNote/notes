import type { RefObject } from "react"

import { triggerBlockActionMenu } from "./BlockActionMenu"

type BlockMenuMode = "add" | "convert"

export type BottomBlockTarget = {
  readonly sourceId: string
  readonly addLabel: string
  readonly convertLabel: string
  readonly addExpanded: boolean
  readonly convertExpanded: boolean
}

const directHandle = (
  boundary: Element,
  mode: BlockMenuMode
): HTMLButtonElement | null =>
  boundary.querySelector<HTMLButtonElement>(
    `:scope > [data-block-menu-mode="${mode}"]`
  )

export const resolveBottomBlockTarget = (
  target: EventTarget | null,
  body: HTMLElement
): BottomBlockTarget | null => {
  if (!(target instanceof Element) || !body.contains(target)) return null
  const boundary = target.closest(".hn-note-block")
  if (!boundary || !body.contains(boundary)) return null
  const add = directHandle(boundary, "add")
  const convert = directHandle(boundary, "convert")
  const sourceId = add?.getAttribute("data-block-id")
  if (!add || !convert || !sourceId) return null

  return {
    sourceId,
    addLabel: add.ariaLabel ?? "在当前区块下方插入新行",
    convertLabel: convert.ariaLabel ?? "更改当前区块",
    addExpanded: add.ariaExpanded === "true",
    convertExpanded: convert.ariaExpanded === "true"
  }
}

export const resolveBottomBlockTargetBySource = (
  body: HTMLElement,
  sourceId: string | null
): BottomBlockTarget | null => {
  const boundaries = body.querySelectorAll(".hn-note-block")
  for (const boundary of boundaries) {
    const add = directHandle(boundary, "add")
    if (sourceId === null || add?.getAttribute("data-block-id") === sourceId) {
      return resolveBottomBlockTarget(boundary, body)
    }
  }
  return null
}

type BottomBlockControlsProps = {
  readonly shellRef: RefObject<HTMLElement | null>
  readonly target: BottomBlockTarget | null
}

export const BottomBlockControls = ({
  shellRef,
  target
}: BottomBlockControlsProps) => {
  const openMenu = (
    mode: BlockMenuMode,
    anchor: HTMLButtonElement
  ): void => {
    const shell = shellRef.current
    if (!shell || !target) return
    const handles = shell.querySelectorAll<HTMLButtonElement>(
      `.hn-note-body [data-block-menu-mode="${mode}"]`
    )
    for (const handle of handles) {
      if (handle.getAttribute("data-block-id") !== target.sourceId) continue
      triggerBlockActionMenu(handle, anchor)
      return
    }
  }

  return (
    <div
      className="hn-note-bottom-actions"
      role="toolbar"
      aria-label="区块操作"
    >
      <button
        type="button"
        className="hn-note-bottom-action hn-note-bottom-action--add"
        aria-haspopup="menu"
        aria-expanded={target?.addExpanded ?? false}
        aria-label={target?.addLabel ?? "在当前区块下方插入新行"}
        data-block-id={target?.sourceId}
        data-block-menu-mode="add"
        disabled={!target}
        onClick={(event) => openMenu("add", event.currentTarget)}
      >
        <span aria-hidden="true">+</span>
      </button>
      <button
        type="button"
        className="hn-note-bottom-action hn-note-bottom-action--convert"
        aria-haspopup="menu"
        aria-expanded={target?.convertExpanded ?? false}
        aria-label={target?.convertLabel ?? "更改当前区块"}
        data-block-id={target?.sourceId}
        data-block-menu-mode="convert"
        disabled={!target}
        onClick={(event) => openMenu("convert", event.currentTarget)}
      >
        <span className="hn-note-block-handle-glyph" aria-hidden="true">
          ⋮⋮
        </span>
      </button>
    </div>
  )
}
