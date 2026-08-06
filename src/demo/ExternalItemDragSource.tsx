import { Drag } from "@system-ui-js/multi-drag"
import { type RefObject, useEffect, useRef, useState } from "react"

import type {
  ExternalNoteDragSession,
  NoteContentHandle,
  NoteExternalItem
} from "../lib"
import "./externalItemDragSource.css"

const demoItem: NoteExternalItem = {
  id: "demo-linked-item",
  content: "Dragged reference\nClick to open",
  clickable: true
}

type ExternalItemDragSourceProps = {
  readonly className?: string
  readonly disabled: boolean
  readonly lastActivatedItemId: string | null
  readonly noteContentRef: RefObject<NoteContentHandle | null>
  readonly onInsert: () => void
}

export const ExternalItemDragSource = ({
  className,
  disabled,
  lastActivatedItemId,
  noteContentRef,
  onInsert
}: ExternalItemDragSourceProps) => {
  const sourceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const sessionRef = useRef<ExternalNoteDragSession | null>(null)
  const [status, setStatus] = useState("按住并拖入笔记")

  useEffect(() => {
    const source = sourceRef.current
    if (source === null) return

    const drag = new Drag(source, { setPose: () => {} })
    dragRef.current = drag
    return () => {
      sessionRef.current?.cancel()
      sessionRef.current = null
      dragRef.current = null
      drag.destroy()
    }
  }, [])

  const startExternalDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    const drag = dragRef.current
    const noteContent = noteContentRef.current
    if (drag === null || noteContent === null) return

    // Drag 的原生 pointerdown 监听器先创建 Finger；React 冒泡到这里后再开启会话。
    const result = noteContent.startExternalDrag({
      drag,
      item: demoItem,
      pointerId: event.pointerId
    })
    if (!result.ok) {
      setStatus(`无法拖入：${result.reason}`)
      return
    }

    setStatus("拖动中，释放到横线位置")
    sessionRef.current = result.session
    void result.session.completion.then((completion) => {
      sessionRef.current = null
      setStatus(
        completion.status === "placed"
          ? "已插入，可点击新内容"
          : `已取消：${completion.reason}`
      )
    }, () => {
      sessionRef.current = null
      setStatus("宿主未接受此次插入")
    })
  }

  return (
    <section
      className={`demo-control-group ${className ?? ""}`}
      aria-label="External item drag demo"
    >
      <h3 className="demo-control-label">External Item</h3>
      <div
        ref={sourceRef}
        className={`demo-external-drag-source ${disabled ? "demo-external-drag-source--disabled" : ""}`}
        aria-disabled={disabled}
        onPointerDown={startExternalDrag}
      >
        <span className="demo-external-drag-source__title">Linked reference</span>
        <span className="demo-external-drag-source__content">
          {demoItem.content}
        </span>
      </div>
      <button
        type="button"
        className="demo-external-insert-button"
        disabled={disabled}
        onClick={onInsert}
      >
        使用键盘插入到末尾
      </button>
      <p className="demo-hint" aria-live="polite">
        {status}
      </p>
      <output className="demo-select-result" aria-live="polite">
        {lastActivatedItemId === null
          ? "尚未点击外部内容"
          : `点击回调：${lastActivatedItemId}`}
      </output>
    </section>
  )
}
