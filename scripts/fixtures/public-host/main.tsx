import { useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController, type PictureUploadHandler, type PictureUploadResult } from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"
import "@hamster-note/notes/formula.css"

const id = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`
const initial = { schemaVersion: 1, data: { type: "doc", content: [
  { type: "paragraph", attrs: { nodeId: id(0) }, content: [
    { type: "text", text: "body " },
    { type: "mention", attrs: { nodeId: id(1), resourceId: "highlight", name: "Highlight" } },
    { type: "resource", attrs: { nodeId: id(2), resourceId: "highlight", name: "Highlight" } }
  ] },
  { type: "card", attrs: { nodeId: id(3), data: '{"schemaVersion":1,"cards":[]}' } },
  { type: "drawing", attrs: { nodeId: id(4), data: '{"strokes":[],"schemaVersion":2}' } }
] } }
const pending = new Map<string, { resolve: (value: PictureUploadResult) => void; reject: (error: Error) => void; src: string }>()
let removed = false
let calls = 0
const requestLog: Array<{ uploadId: string; attempt: number; aborted: boolean }> = []
const upload: PictureUploadHandler = (file, { uploadId, attempt, signal }) => {
  const entry = { uploadId, attempt, aborted: false }
  requestLog.push(entry)
  signal.addEventListener("abort", () => { entry.aborted = true; localStorage.setItem("upload-log", JSON.stringify(requestLog)) }, { once: true })
  localStorage.setItem("upload-log", JSON.stringify(requestLog))
  return new Promise((resolve, reject) => { pending.set(uploadId, { resolve, reject, src: `${location.origin}/image.png?name=${encodeURIComponent(file.name)}` }) })
}
function Fixture() {
  const controller = useRef<NoteDocumentController>(null)
  const lease = useRef<{ requestId: string; leaseId: string } | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [left, setLeft] = useState(true)
  const [result, setResult] = useState("")
  const resolve = () => { calls++; localStorage.setItem("resolve-calls", String(calls)); return removed ? null : { label: "Present" } }
  const refresh = (kind: "reference" | "document") => {
    removed = true
    const c = controller.current!, expectedSessionId = c.getState().identity!.sessionId
    const result = c.invalidateReferences?.({ expectedSessionId, scope: kind === "document" ? { kind } : { kind, reference: { kind: "mention", resourceId: "highlight" } } })
    setResult(JSON.stringify(result))
  }
  const freeze = async () => {
    const c = controller.current!, expectedSessionId = c.getState().identity!.sessionId
    const response = lease.current
      ? await c.setInputFrozen(false, { expectedSessionId, ...lease.current })
      : await c.setInputFrozen(true, { expectedSessionId, requestId: "navigation" })
    if (response.kind === "applied") lease.current = response.action === "acquired" ? { requestId: response.requestId, leaseId: response.leaseId } : null
    setResult(JSON.stringify(response))
  }
  return <main>
    <div className="fixture-toolbar">
      <button onClick={() => refresh("reference")}>Invalidate Candidate</button>
      <button onClick={() => refresh("document")}>Invalidate Document</button>
      <button onClick={() => setResult(JSON.stringify(controller.current!.getState()))}>Snapshot</button>
      <button onClick={() => { for (const item of pending.values()) item.resolve({ src: item.src }); pending.clear() }}>Resolve Upload</button>
      <button onClick={() => { for (const item of pending.values()) item.reject(new Error("offline")); pending.clear() }}>Reject Upload</button>
      <button onClick={() => { void freeze() }}>Freeze</button>
      <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Upload Enabled</label>
      <label><input type="checkbox" checked={left} onChange={(event) => setLeft(event.target.checked)} />Left View</label>
      <output data-result>{result}</output>
    </div>
    <NoteDocumentProvider documentId="public-contract" loadKey={1} initialDocument={initial}
      initialHostSnapshot={{ changeId: 0, value: { title: "title", summary: "summary" } }} controllerRef={controller}
      onReferenceResolve={resolve} {...(enabled ? { onPictureUpload: upload } : {})}
      onChange={(document) => {
        localStorage.setItem("changes", String(Number(localStorage.getItem("changes") ?? 0) + 1))
        localStorage.setItem("last-document", JSON.stringify(document))
      }} onSave={async (payload) => { await Promise.resolve(); localStorage.setItem("saved", JSON.stringify(payload)) }}>
      <div className="fixture-panes">{left && <NoteEditorView viewId="a" />}<NoteEditorView viewId="b" /></div>
    </NoteDocumentProvider>
  </main>
}
const style = document.createElement("style")
style.textContent = "body{margin:0;font:14px sans-serif;background:#fff;color:#202020}.fixture-toolbar{padding:8px;display:flex;flex-wrap:wrap;gap:8px}.fixture-toolbar output{width:100%;overflow-wrap:anywhere}.fixture-panes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:8px}.hn-editor{min-width:0}.hn-editor-content{min-height:100px}@media(max-width:600px){.fixture-panes{grid-template-columns:minmax(0,1fr)}}"
document.head.append(style)
createRoot(document.getElementById("root")!).render(<Fixture />)
