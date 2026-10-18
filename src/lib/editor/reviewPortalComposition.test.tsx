// @vitest-environment jsdom
import { createRef } from "react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { NoteDocumentProvider, NoteEditorView, type NoteDocumentController } from "../index"
import { demoFixtures } from "../../demo/fixtures"

afterEach(cleanup)
it("does not commit and close a formula portal with an active composition", async () => {
  const controllerRef = createRef<NoteDocumentController>()
  const h = render(<NoteDocumentProvider documentId="review" loadKey={1}
    initialDocument={demoFixtures[0]!.document}
    initialHostSnapshot={{ changeId: 0, value: { title: "", summary: "" } }}
    onChange={() => {}} onSave={async () => {}} controllerRef={controllerRef}>
    <NoteEditorView viewId="a" />
  </NoteDocumentProvider>)
  fireEvent.click(h.container.querySelector(".hn-editor-formula-preview")!)
  const textarea = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-textarea")!
  fireEvent.compositionStart(textarea)
  fireEvent.input(textarea, { target: { value: "x+y" }, isComposing: true })
  const controller = controllerRef.current!
  let result: unknown
  await act(async () => {
    result = await controller.setInputFrozen(true, {
      expectedSessionId: controller.getState().identity!.sessionId, requestId: "portal-ime"
    })
  })
  expect.soft(result).toMatchObject({ kind: "failure" })
  expect.soft(textarea.isConnected).toBe(true)
})
