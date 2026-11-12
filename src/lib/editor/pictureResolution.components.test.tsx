// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NoteDocumentProvider, NoteEditor, NoteEditorView, type NoteDocumentProviderProps } from "../index"
import type { PictureResolveHandler } from "./types"

const document = {
  schemaVersion: 1 as const,
  data: {
    type: "doc",
    content: [{
      type: "picture",
      attrs: {
        nodeId: "123e4567-e89b-42d3-a456-426614174000",
        src: "hamster_note_data/images/0123456789abcdef0123456789abcdef.png",
        alt: "图片"
      }
    }]
  }
}

afterEach(cleanup)

describe("公开图片解析 props", () => {
  it("独立 NoteEditor 支持 resolver，纯回调替换不重建会话或触发正文变更", async () => {
    const firstDispose = vi.fn()
    const first: PictureResolveHandler = vi.fn().mockResolvedValue({ url: "blob:https://example.test/first", dispose: firstDispose })
    const second: PictureResolveHandler = vi.fn().mockResolvedValue({ url: "blob:https://example.test/second" })
    const onChange = vi.fn()
    const props = { documentId: "A", loadKey: 1, initialDocument: document, onChange }
    const view = render(<NoteEditor {...props} onPictureResolve={first} />)
    await waitFor(() => expect(view.container.querySelector("img")?.getAttribute("src")).toBe("blob:https://example.test/first"))
    const initialCalls = vi.mocked(first).mock.calls.length
    const initialDisposals = firstDispose.mock.calls.length
    const editor = view.container.querySelector(".tiptap")
    view.rerender(<NoteEditor {...props} onPictureResolve={second} />)
    await waitFor(() => expect(view.container.querySelector("img")?.getAttribute("src")).toBe("blob:https://example.test/second"))
    expect(view.container.querySelector(".tiptap")).toBe(editor)
    expect(first).toHaveBeenCalledTimes(initialCalls)
    expect(firstDispose).toHaveBeenCalledTimes(initialDisposals + 1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("Provider/View 支持 resolver 更新且保留共享 session identity", async () => {
    const first: PictureResolveHandler = vi.fn().mockResolvedValue({ url: "blob:https://example.test/provider-first" })
    const second: PictureResolveHandler = vi.fn().mockResolvedValue({ url: "blob:https://example.test/provider-second" })
    const identities: string[] = []
    const props: NoteDocumentProviderProps = {
      documentId: "A",
      loadKey: 1,
      initialDocument: document,
      initialHostSnapshot: { changeId: 0, value: { title: "", summary: "" } },
      onSave: vi.fn(() => Promise.resolve()),
      onChange: (_snapshot, identity) => { identities.push(identity.sessionId) },
      onPictureResolve: first,
      children: <NoteEditorView viewId="left" />
    }
    const view = render(<NoteDocumentProvider {...props} />)
    await waitFor(() => expect(view.container.querySelector("img")?.getAttribute("src")).toBe("blob:https://example.test/provider-first"))
    const editor = view.container.querySelector(".tiptap")
    view.rerender(<NoteDocumentProvider {...props} onPictureResolve={second} />)
    await waitFor(() => expect(view.container.querySelector("img")?.getAttribute("src")).toBe("blob:https://example.test/provider-second"))
    expect(view.container.querySelector(".tiptap")).toBe(editor)
    expect(second).toHaveBeenCalledTimes(1)
    expect(identities).toEqual([])
  })
})
