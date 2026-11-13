import { useRef } from "react"
import { createRoot } from "react-dom/client"
import { NoteDocumentProvider, NoteEditorView, NoteEditor, type NoteDocumentController, type NoteSave, type HnnDocument } from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"
import "@hamster-note/notes/formula.css"

const document: HnnDocument = { schemaVersion: 1, data: { type: "doc", content: [
  { type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" }, content: [{ type: "text", text: "package body" }] },
  { type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174001" }, content: [{ type: "text", text: "second" }] }
] } }
const managedSrc = "hamster_note_data/images/0123456789abcdef0123456789abcdef.png"
const pictures = new Map<string, File>()
const evidence = window as Window & {
  pictureSnapshot?: HnnDocument
  legacyPictureSnapshot?: HnnDocument
  pictureUploads?: number
}
const upload = async (file: File) => {
  pictures.set(managedSrc, file)
  evidence.pictureUploads = (evidence.pictureUploads ?? 0) + 1
  return { src: managedSrc, alt: "打包图片" }
}
const resolve = async (src: string) => {
  if (!src.startsWith("hamster_note_data/")) return { url: src }
  const file = pictures.get(src)
  if (!file) throw new Error("图片不存在")
  const url = URL.createObjectURL(file)
  return { url, dispose: () => URL.revokeObjectURL(url) }
}
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
      controllerRef={controller} onChange={(snapshot) => { evidence.pictureSnapshot = snapshot }} onSave={async (payload) => {
        await Promise.resolve()
        localStorage.setItem("pack-save", JSON.stringify(payload))
      }} onPictureUpload={upload} onPictureResolve={resolve}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 320px))", gap: 16, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}><NoteEditorView viewId="left" theme="light" /></div>
        <div style={{ minWidth: 0, background: "#0f172a" }}><NoteEditorView viewId="right" theme="dark" /></div>
      </div>
    </NoteDocumentProvider>
    <section id="legacy"><NoteEditor documentId="legacy" loadKey={1} initialDocument={document} initialRevision="r1"
      onSave={legacySave} onChange={(snapshot) => { evidence.legacyPictureSnapshot = snapshot }}
      onPictureUpload={upload} onPictureResolve={resolve} /></section>
  </>
}
createRoot(window.document.getElementById("root")!).render(<Consumer />)
