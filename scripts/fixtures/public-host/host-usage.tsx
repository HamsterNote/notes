import type { NoteDocumentController, PictureUploadHandler } from "@hamster-note/notes"

export function refreshHighlight(controller: NoteDocumentController, resourceId: string) {
  const expectedSessionId = controller.getState().identity?.sessionId
  if (!expectedSessionId) return
  if (!controller.invalidateReferences) throw new Error("Requires notes >= 3.1.2")
  for (const kind of ["mention", "resource"] as const) {
    const result = controller.invalidateReferences({ expectedSessionId,
      scope: { kind: "reference", reference: { kind, resourceId } } })
    if (result.kind !== "accepted") throw new Error(JSON.stringify(result))
  }
}

export const upload: PictureUploadHandler = async (file, { uploadId, attempt, signal }) => {
  const response = await fetch("/images", { method: "POST", body: file, signal,
    headers: { "X-Upload-Id": uploadId, "X-Upload-Attempt": String(attempt) } })
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
  return { src: response.headers.get("Location") ?? "", alt: file.name }
}
