import { useState } from "react"
import { createRoot } from "react-dom/client"
import { NoteEditor, NoteDocumentProvider, NoteEditorView, type HnnDocument } from "../../../src/lib/index"
import "../../../src/lib/styles.css"

const mode = new URLSearchParams(location.search).get("mode") ?? "shared"
const initialDocument = {
  schemaVersion: 1,
  data: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" } }] }
}
const evidence = {
  mode, userAgent: navigator.userAgent,
  events: [] as unknown[], snapshots: [] as HnnDocument[]
}
Object.assign(window, { bodyComposition: evidence })

function record(detail: Record<string, unknown>) {
  const root = document.querySelector(".tiptap")
  const selection = window.getSelection()
  const point = (node: Node | null, offset: number) => {
    const path: number[] = []
    for (let current = node; current && current !== root; current = current.parentNode) {
      if (!current.parentNode) return null
      path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current))
    }
    return node && root?.contains(node) ? { path, offset } : null
  }
  evidence.events.push({
    at: performance.now(), ...detail,
    dom: root?.innerHTML,
    anchor: point(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0),
    focus: point(selection?.focusNode ?? null, selection?.focusOffset ?? 0)
  })
  document.querySelector("#events")!.textContent = JSON.stringify(evidence.events.slice(-3), null, 2)
}
for (const name of ["compositionstart", "compositionupdate", "compositionend", "keydown", "beforeinput", "input", "selectionchange"]) {
  document.addEventListener(name, (event) => {
    const target = event.target
    const root = document.querySelector(".tiptap")
    if (!root || (name !== "selectionchange" && (!(target instanceof Node) || !root.contains(target)))) return
    if (name === "selectionchange" && !root.contains(window.getSelection()?.anchorNode ?? null)) return
    const input = event as InputEvent
    const keyboard = event as KeyboardEvent
    const ranges = typeof input.getTargetRanges === "function" ? input.getTargetRanges().map(range => ({
      startOffset: range.startOffset, endOffset: range.endOffset,
      startNode: range.startContainer.nodeName, endNode: range.endContainer.nodeName
    })) : undefined
    record({ type: event.type, trusted: event.isTrusted, data: input.data,
      inputType: input.inputType, isComposing: input.isComposing,
      key: keyboard.key, keyCode: keyboard.keyCode, ranges })
  }, true)
}
document.querySelector("#download")!.addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `ham132-${mode}-input.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
})

function Fixture() {
  // Mirror hosts that rerender and pass back the latest initialDocument on every change.
  const [document, setDocument] = useState<unknown>(initialDocument)
  const onChange = (snapshot: HnnDocument) => {
    evidence.snapshots.push(snapshot)
    record({ type: "snapshot", snapshot })
    setDocument(snapshot)
  }
  const props = { documentId: "body-composition", loadKey: 1, initialDocument: document, onChange }
  return mode === "single" ? <NoteEditor {...props} /> :
    <NoteDocumentProvider {...props}
      initialHostSnapshot={{ changeId: 0, value: { title: "", summary: "" } }} onSave={async () => {}}>
      <NoteEditorView viewId="primary" />
    </NoteDocumentProvider>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
