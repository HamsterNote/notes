import {
  ToolbarFileMenu,
  ToolbarShell,
  type ToolbarFileNavigationProps
} from "@hamster-note/painting-toolbar/toolbar"
import type { CSSProperties, ReactElement } from "react"
import type {
  NoteFileRequest,
  NoteFileRequestResult,
  NotePaneToolbarLayout,
  NoteToolbarFile
} from "./documentTypes"

type ViewToolbarProps = {
  files?: readonly NoteToolbarFile[] | undefined
  currentFileKey?: string | undefined
  paneId?: string | undefined
  busy?: boolean | undefined
  onSelectFile?: ((request: NoteFileRequest) => Promise<NoteFileRequestResult>) | undefined
  onRequestRemove?: ((request: NoteFileRequest) => Promise<NoteFileRequestResult>) | undefined
  layout?: NotePaneToolbarLayout | undefined
  locked: boolean
  saveDisabled: boolean
  status: string
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onOccupiedSpaceChange: (space: Readonly<{ top: number; bottom: number }>) => void
}

/**
 * Per-view controls. The file menu consumes only painting's lightweight toolbar
 * contract; document history, saving and status stay owned by the notes session.
 */
export function ViewToolbar({
  files,
  currentFileKey,
  paneId,
  busy,
  onSelectFile,
  onRequestRemove,
  layout,
  locked,
  saveDisabled,
  status,
  onUndo,
  onRedo,
  onSave,
  onOccupiedSpaceChange
}: ViewToolbarProps): ReactElement {
  const navigation: ToolbarFileNavigationProps = {
    ...(files === undefined ? {} : { files }),
    ...(currentFileKey === undefined ? {} : { currentFileKey }),
    ...(paneId === undefined ? {} : { paneId }),
    ...(busy === undefined ? {} : { busy }),
    ...(onSelectFile === undefined ? {} : { onSelectFile }),
    ...(onRequestRemove === undefined ? {} : { onRequestRemove })
  }
  const controls = (
    <>
      <button type="button" aria-label="撤销" title="撤销" disabled={locked} onClick={onUndo}>
        ↶
      </button>
      <button type="button" aria-label="重做" title="重做" disabled={locked} onClick={onRedo}>
        ↷
      </button>
      <ToolbarFileMenu {...navigation} {...(layout ? { layout } : {})} />
      <button type="button" disabled={saveDisabled} onClick={onSave}>
        保存
      </button>
      <span role="status">{status}</span>
    </>
  )
  if (!layout) {
    // Legacy hosts keep an in-flow control row; only its shell styling changes.
    return <ToolbarShell placement="inline" label="笔记工具">{controls}</ToolbarShell>
  }
  const bounds = layout.bounds
  const layerStyle: CSSProperties = bounds
    ? { position: "fixed", left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
    : { position: "fixed", inset: 0 }
  return (
    <div data-pane-toolbar-boundary style={{ ...layerStyle, pointerEvents: "none", zIndex: 30 }}>
      <ToolbarShell
        placement="floating"
        layout={layout}
        label="笔记工具"
        onOccupiedSpaceChange={onOccupiedSpaceChange}
      >
        {controls}
      </ToolbarShell>
    </div>
  )
}
