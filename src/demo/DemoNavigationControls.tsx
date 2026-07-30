import { type FormEvent, type RefObject, useState } from "react"

import type {
  NoteContentHandle,
  NoteContentUndoRedoController,
} from "../lib"

type DemoNavigationControlsProps = {
  readonly controller: NoteContentUndoRedoController
  readonly initialBlockId: string
  readonly noteContentRef: RefObject<NoteContentHandle | null>
}

export const DemoNavigationControls = ({
  controller,
  initialBlockId,
  noteContentRef,
}: DemoNavigationControlsProps) => {
  const [blockId, setBlockId] = useState(initialBlockId)
  const [navigationMessage, setNavigationMessage] = useState("")

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const targetId = blockId.trim()
    const didScroll =
      targetId.length > 0 &&
      noteContentRef.current?.scrollToBlock(targetId) === true
    setNavigationMessage(
      didScroll ? `已跳转到 ${targetId}` : `未找到 ${targetId || "空 id"}`,
    )
  }

  return (
    <>
      <section className="demo-control-group">
        <span className="demo-control-label">Undo / Redo</span>
        <div className="demo-undo-redo-row">
          <button
            type="button"
            className="demo-undo-redo-button"
            disabled={!controller.canUndo()}
            onClick={() => noteContentRef.current?.undo()}
          >
            Undo
          </button>
          <button
            type="button"
            className="demo-undo-redo-button"
            disabled={!controller.canRedo()}
            onClick={() => noteContentRef.current?.redo()}
          >
            Redo
          </button>
        </div>
        <p className="demo-hint">
          通过 NoteContent ref 触发撤销/恢复，无历史记录时
          <span className="demo-nowrap">按钮</span><span className="demo-nowrap">自动</span>禁用
        </p>
      </section>

      <section className="demo-control-group">
        <label className="demo-control-label" htmlFor="block-id-input">
          Block ID
        </label>
        <form className="demo-block-jump-row" onSubmit={handleSubmit}>
          <input
            id="block-id-input"
            type="text"
            className="demo-text-input demo-block-jump-input"
            value={blockId}
            onChange={(event) => setBlockId(event.target.value)}
          />
          <button
            type="submit"
            className="demo-undo-redo-button demo-block-jump-button"
          >
            Jump
          </button>
        </form>
        <p className="demo-hint" aria-live="polite">
          {navigationMessage || "输入块或 checklist 条目的 id"}
        </p>
      </section>
    </>
  )
}
