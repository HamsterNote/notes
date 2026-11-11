import { useState } from "react"
import { createRoot } from "react-dom/client"
import {
  NoteDocumentProvider,
  NoteEditorView,
  type NoteFileRequest,
  type NoteFileRequestResult,
  type NotePaneToolbarLayout,
  type NoteToolbarFile
} from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"

const initial = { schemaVersion: 1, data: { type: "doc", content: [
  { type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" }, content: [{ type: "text", text: "工具栏夹具正文" }] }
] } }
const params = new URLSearchParams(location.search)
const files: readonly NoteToolbarFile[] = [
  { key: "/local/a.hnn", storageId: "local", path: "a.hnn", displayName: "A.hnn", resolvedFormat: "hnn" },
  { key: "/local/b.hnn", storageId: "local", path: "b.hnn", displayName: "B.hnn", resolvedFormat: "hnn" }
]
const log: unknown[] = []
const record = (entry: unknown) => { log.push(entry); (window as Window & { sessionLog?: unknown[] }).sessionLog = log }

export function Fixture() {
  const [edge, setEdge] = useState<"top" | "bottom">(params.get("edge") === "bottom" ? "bottom" : "top")
  const [items, setItems] = useState<readonly NoteToolbarFile[]>(files)
  const layout: NotePaneToolbarLayout = {
    edge,
    insets: { top: Number(params.get("top") ?? 0), bottom: Number(params.get("bottom") ?? 0), left: 0, right: 0 },
    headerContentInset: Number(params.get("header") ?? 0)
  }
  const select = (request: NoteFileRequest): Promise<NoteFileRequestResult> => {
    record({ kind: "select", fileKey: request.fileKey, paneId: request.paneId })
    return Promise.resolve({ status: "success" })
  }
  const remove = (request: NoteFileRequest): Promise<NoteFileRequestResult> => {
    record({ kind: "remove", fileKey: request.fileKey, paneId: request.paneId })
    setItems(current => current.filter(file => file.key !== request.fileKey))
    return Promise.resolve({ status: "success" })
  }
  return <NoteDocumentProvider documentId="toolbar-fixture" loadKey={1} initialDocument={initial}
    initialHostSnapshot={{ changeId: 0, value: { title: "", summary: "" } }}
    onSave={() => Promise.resolve()} onChange={() => {}}>
    <button id="toggle-edge" type="button" onClick={() => setEdge(current => current === "top" ? "bottom" : "top")}>切换方向</button>
    <NoteEditorView viewId="a" paneId="pane-a" files={items} {...(items[0] === undefined ? {} : { currentFileKey: items[0].key })}
      onSelectFile={select} onRequestRemove={remove} layout={layout} />
  </NoteDocumentProvider>
}

createRoot(document.getElementById("root")!).render(<Fixture />)
