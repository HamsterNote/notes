import { StrictMode, useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController, type NotePublicState, type SaveTerminal } from "../lib"
import { demoFixtures } from "./fixtures"
import { createHnnNodeId } from "../lib/hnn/nodeId"
import "./shared.css"

const rawBlocks = demoFixtures[0]!.document.data["content"]
const blocks: unknown[] = Array.isArray(rawBlocks) ? rawBlocks : []

const initial = {
  schemaVersion: 1,
  data: { type: "doc", content: [
    { type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" }, content: [{ type: "text", text: "共享正文" }] },
    ...blocks.slice(-4, -1)
  ] }
}
const labels: Record<string, string> = { clean: "已保存", dirty: "待保存", pending: "保存中", blocked: "暂不能保存", failure: "保存失败" }

export function SharedDemo() {
  const [controller, setController] = useState<NoteDocumentController | null>(null)
  const [state, setState] = useState<NotePublicState | null>(null)
  const [panes, setPanes] = useState(["a", "b"])
  const [title, setTitle] = useState("共享笔记")
  const [error, setError] = useState("")
  const [freezePending, setFreezePending] = useState(false)
  const lease = useRef<{ requestId: string; leaseId: string } | null>(null)
  const changeId = useRef(0)
  const bind = useCallback((value: NoteDocumentController | null) => { setController(value) }, [])
  useEffect(() => {
    setState(controller?.getState() ?? null)
    return controller?.subscribe(setState)
  }, [controller])
  const changePane = (id: string, enabled: boolean) => {
    const identity = controller?.getState().identity
    if (!enabled && identity) {
      const result = controller.canDetachView(id, { expectedSessionId: identity.sessionId })
      if (result.kind !== "allowed") { setError("请先完成或取消当前草稿"); return }
    }
    setPanes((current) => enabled ? [...current, id].sort() : current.filter((pane) => pane !== id))
  }
  const save = async () => {
    const identity = controller?.getState().identity
    if (!identity) return
    const result = controller.requestSave({ expectedSessionId: identity.sessionId, reason: "host-save" })
    const terminal: SaveTerminal = result.kind === "pending" ? await result.completion : result
    if (terminal.kind !== "clean" && terminal.kind !== "saved") setError("当前修改尚未保存")
  }
  const toggleFreeze = async (frozen: boolean) => {
    const identity = controller?.getState().identity
    if (!identity) return
    setFreezePending(true)
    try {
      if (frozen) {
        const requestId = createHnnNodeId()
        const result = await controller.setInputFrozen(true, { expectedSessionId: identity.sessionId, requestId })
        if ((result.kind === "applied" || result.kind === "noop") && "leaseId" in result) lease.current = { requestId, leaseId: result.leaseId }
        else setError("输入尚未结束，请稍后重试")
      } else if (lease.current) {
        await controller.setInputFrozen(false, { expectedSessionId: identity.sessionId, ...lease.current })
        lease.current = null
      }
    } finally { setFreezePending(false) }
  }
  return <main className="shared-workspace">
    <header className="shared-header">
      <input aria-label="笔记标题" value={title} disabled={state?.inputFrozen} onChange={(event) => {
        const identity = controller?.getState().identity
        if (!identity) return
        const result = controller.updateHostSnapshot({ changeId: ++changeId.current, value: { title: event.target.value, summary: "" } }, { expectedSessionId: identity.sessionId })
        if (result.kind === "accepted") setTitle(event.target.value)
      }} />
      <span role="status">{labels[state?.save ?? "clean"]}</span>
      <button type="button" onClick={() => { void save() }}>保存笔记</button>
      <label><input type="checkbox" checked={panes.includes("a")} onChange={(event) => changePane("a", event.target.checked)} />左栏</label>
      <label><input type="checkbox" checked={panes.includes("b")} onChange={(event) => changePane("b", event.target.checked)} />右栏</label>
      <label><input type="checkbox" checked={state?.inputFrozen ?? false} disabled={freezePending} onChange={(event) => { void toggleFreeze(event.target.checked) }} />锁定输入</label>
    </header>
    {error && <p role="alert" onClick={() => setError("")}>{error}</p>}
    <NoteDocumentProvider documentId="shared-demo" loadKey={1} initialDocument={initial}
      initialHostSnapshot={{ changeId: 0, value: { title: "共享笔记", summary: "" } }}
      controllerRef={bind} onChange={() => undefined}
      onSave={async (payload, context) => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        if (context.signal.aborted) throw new Error("Save aborted")
        localStorage.setItem("notes-shared-demo", JSON.stringify(payload))
      }}
      onReferenceCandidates={async (_kind, query, { signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return signal.aborted ? [] : [{ resourceId: "resource-1", name: query || "资料" }]
      }}
      onReferenceResolve={() => ({ label: "资料" })} onReferenceActivate={() => undefined}>
      <section className={`shared-panes ${panes.length === 1 ? "shared-panes--single" : ""}`}>
        {panes.map((viewId) => <NoteEditorView key={viewId} viewId={viewId} />)}
      </section>
    </NoteDocumentProvider>
  </main>
}

createRoot(document.getElementById("root")!).render(<StrictMode><SharedDemo /></StrictMode>)
