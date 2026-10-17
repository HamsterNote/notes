import { NoteEditor, NoteSaveStatus, MarkdownExport, decodeHnn, encodeHnn,
  HnnCodecError, importMarkdown, exportMarkdown, type NoteSave, type HnnDocument } from "@hamster-note/notes"
import "@hamster-note/notes/styles.css"
import "@hamster-note/notes/formula.css"

const onSave: NoteSave = async (_document, { documentId, baseRevision, signal }) => {
  void documentId; void signal
  return baseRevision === "conflict" ? { kind: "conflict" } : { kind: "saved", revision: "r2" }
}
export function LegacyConsumer({ document }: { document: HnnDocument }) {
  return <NoteEditor documentId="legacy" loadKey={1} initialDocument={document} initialRevision="r1" onSave={onSave} />
}
export const legacyRuntime = { NoteSaveStatus, MarkdownExport, decodeHnn, encodeHnn,
  HnnCodecError, importMarkdown, exportMarkdown }
