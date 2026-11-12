import { useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { importMarkdown, NoteDocumentProvider, NoteEditorView, type HnnDocument, type NoteDocumentController } from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"

function parse(value: string): HnnDocument {
  const result = importMarkdown(value)
  if (!("document" in result)) throw new Error("Invalid fixture")
  return result.document
}
const plain = parse("alpha beta\n\nbeta gamma\n\ngamma delta")
const mixed = parse("5. parent\n   - [x] child\n6. second\n7. third\n\n- [x] done\n- [ ] open")
type EvidenceWindow = Window & { listSnapshot?: HnnDocument; dragStarts?: number }
const evidence = window as EvidenceWindow
document.addEventListener("hnn-reorder-start", () => { evidence.dragStarts = (evidence.dragStarts ?? 0) + 1 }, true)

export function Fixture() {
  const [generation, setGeneration] = useState(0)
  const [initial, setInitial] = useState(plain)
  const [status, setStatus] = useState("ready")
  const failSave = useRef(false)
  const controller = useRef<NoteDocumentController>(null)
  const lease = useRef<string>(undefined)
  const load = (document: HnnDocument) => {
    evidence.listSnapshot = document
    lease.current = undefined
    setInitial(document); setGeneration(n => n + 1); setStatus("ready")
  }
  const save = async () => {
    const c = controller.current!, expectedSessionId = c.getState().identity!.sessionId
    const result = c.requestSave({ expectedSessionId, reason: "host-retry" })
    const terminal = result.kind === "pending" ? await result.completion : result
    setStatus(`${terminal.kind}:${c.getState().dirty.body ? "dirty" : "clean"}`)
  }
  const freeze = async () => {
    const c = controller.current!, expectedSessionId = c.getState().identity!.sessionId
    if (lease.current) {
      await c.setInputFrozen(false, { expectedSessionId, requestId: "fixture", leaseId: lease.current }); lease.current = undefined
      setStatus("editable")
    } else {
      const result = await c.setInputFrozen(true, { expectedSessionId, requestId: "fixture" })
      if ("leaseId" in result) lease.current = result.leaseId
      setStatus(lease.current ? "frozen" : "freeze failed")
    }
  }
  return <>
    <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8 }}>
      <button onClick={() => load(plain)}>重置段落</button><button onClick={() => load(mixed)}>混合列表</button>
      <button onClick={() => { void save() }}>保存</button>
      <button onClick={() => { failSave.current = !failSave.current; setStatus(failSave.current ? "will fail" : "will save") }}>切换保存失败</button>
      <button onClick={() => load(JSON.parse(localStorage.getItem("ham237")!) as HnnDocument)}>重开</button>
      <button onClick={() => { void freeze() }}>冻结切换</button><output id="status">{status}</output>
    </nav>
    <NoteDocumentProvider key={generation} documentId="list-fixture" loadKey={generation} initialDocument={initial}
      initialHostSnapshot={{ changeId: 0, value: { title: "列表验证", summary: "" } }} controllerRef={controller}
      onChange={document => { evidence.listSnapshot = document }}
      onSave={payload => {
        if (failSave.current) return Promise.reject(new Error("fixture disk failure"))
        localStorage.setItem("ham237", JSON.stringify(payload.document)); return Promise.resolve()
      }}>
      <div style={{ maxWidth: 960, margin: "auto", padding: 8 }}>
        <NoteEditorView viewId="a" /><details><summary>共享视图</summary><NoteEditorView viewId="b" /></details>
      </div>
    </NoteDocumentProvider>
  </>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
