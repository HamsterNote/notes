import { useRef } from "react"
import { createRoot } from "react-dom/client"
import { NoteDocumentProvider, NoteEditorView, NoteEditor, type NoteDocumentController, type NoteSave, type HnnDocument } from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"
import "@hamster-note/notes/formula.css"

const document: HnnDocument = { schemaVersion: 1, data: { type: "doc", content: [{ type: "paragraph", attrs: {
  nodeId: "123e4567-e89b-42d3-a456-426614174000"
}, content: [{ type: "text", text: "package body" }] }] } }
const legacySave: NoteSave = async (snapshot, { documentId, baseRevision, signal }) => {
  await Promise.resolve()
  localStorage.setItem("legacy-save", JSON.stringify({ snapshot, documentId, baseRevision, aborted: signal.aborted }))
  return { kind: "saved", revision: "r2" }
}
function Consumer() {
  const controller = useRef<NoteDocumentController>(null)
  return <>
    <NoteDocumentProvider documentId="consumer" loadKey={1} initialDocument={document}
      initialHostSnapshot={{ changeId: 0, value: { title: "pack", summary: "" } }}
      controllerRef={controller} onChange={() => undefined} onSave={async (payload) => {
        await Promise.resolve()
        localStorage.setItem("pack-save", JSON.stringify(payload))
      }}>
      <NoteEditorView viewId="left" />
      <NoteEditorView viewId="right" />
    </NoteDocumentProvider>
    <section id="legacy"><NoteEditor documentId="legacy" loadKey={1} initialDocument={document} initialRevision="r1" onSave={legacySave} /></section>
  </>
}
createRoot(window.document.getElementById("root")!).render(<Consumer />)
