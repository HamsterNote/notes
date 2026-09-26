// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react"
import { StrictMode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HnnDocument } from "../hnn/codec"
import { NoteEditor } from "./NoteEditor"
import { EditorSession } from "./session"
import { encodeNoteEditorSessionKey } from "./sessionKey"
import type { EditorSessionOptions, NoteSave } from "./types"

const createdSessions = vi.hoisted(() => [] as EditorSession[])
const createdOptions = vi.hoisted(() => [] as EditorSessionOptions[])

vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>()
  return {
    ...actual,
    createEditorSession(options: EditorSessionOptions) {
      createdOptions.push(options)
      const session = actual.createEditorSession(options)
      createdSessions.push(session)
      return session
    }
  }
})

const initialDocument = {
  schemaVersion: 1,
  data: {
    type: "doc",
    content: [{ type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" }, content: [{ type: "text", text: "editable text" }] }]
  }
}

function documentWith(text: string): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000" }, content: [{ type: "text", text }] }]
    }
  }
}

function replaceText(session: EditorSession, text: string): void {
  const { state, view } = session.editor
  view.dispatch(state.tr.insertText(text, 1, state.doc.content.size - 1))
}

describe("内部 NoteEditor 最低呈现", () => {
  beforeEach(() => {
    createdSessions.splice(0)
    createdOptions.splice(0)
  })
  it("呈现标准可编辑内容，并且不产生 custom node 的交互界面", () => {
    const { container } = render(<NoteEditor documentId="A" loadKey="v1" initialDocument={initialDocument} />)

    const editable = container.querySelector(".tiptap")
    expect(editable).not.toBeNull()
    expect(editable?.getAttribute("contenteditable")).toBe("true")
    expect(editable?.textContent).toContain("editable text")
    expect(container.querySelector("[role='dialog'], [data-drag-handle], input[type='file']")).toBeNull()
  })

  it("custom node 只有不可编辑的安全 fallback，不注册 NodeView 或危险交互", () => {
    const customDocument = {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{ type: "formula", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000", latex: "x^2" } }]
      }
    }
    const { container } = render(<NoteEditor documentId="A" loadKey="custom" initialDocument={customDocument} />)

    const fallback = container.querySelector("[data-hnn-node='formula']")
    expect(fallback?.getAttribute("contenteditable")).toBe("false")
    expect(fallback?.textContent).toBe("[formula]")
    expect(container.querySelector("[role='dialog'], [data-drag-handle], input[type='file']")).toBeNull()
  })

  it("组件 props 没有 schema、extensions 或 history 注入入口", () => {
    const options: EditorSessionOptions = {
      documentId: "A",
      loadKey: "v1",
      initialDocument,
      // @ts-expect-error HNN schema 不接受宿主 extension 注入。
      extensions: []
    }
    void options
    const sessionOptions: EditorSessionOptions = {
      documentId: "A",
      loadKey: "v1",
      initialDocument,
      // @ts-expect-error HNN schema 不接受宿主 schema 注入。
      schema: {}
    }
    void sessionOptions
    const historyOptions: EditorSessionOptions = {
      documentId: "A",
      loadKey: "v1",
      initialDocument,
      // @ts-expect-error HNN history 不接受宿主替换。
      history: {}
    }
    void historyOptions
    expect(NoteEditor).toHaveLength(1)
  })

  it("仅 documentId 或 loadKey 变化才重建会话，同 key 忽略新的初始文档", () => {
    const view = render(<NoteEditor documentId="A" loadKey="v1" initialDocument={documentWith("first")} initialRevision="r1" />)

    view.rerender(<NoteEditor documentId="A" loadKey="v1" initialDocument={documentWith("ignored")} initialRevision="r2" />)
    expect(view.container.querySelector(".tiptap")?.textContent).toContain("first")

    view.rerender(<NoteEditor documentId="A" loadKey="v2" initialDocument={documentWith("reloaded")} initialRevision="r3" />)
    expect(view.container.querySelector(".tiptap")?.textContent).toContain("reloaded")
  })

  it("StrictMode setup-cleanup-setup 后销毁弃用会话且当前会话可编辑", () => {
    const destroy = vi.spyOn(EditorSession.prototype, "destroy")
    const view = render(<StrictMode><NoteEditor documentId="A" loadKey="strict" initialDocument={documentWith("first")} /></StrictMode>)
    try {
      const editable = view.container.querySelector(".tiptap") as HTMLElement
      expect(editable).not.toBeNull()
      fireEvent.input(editable, { inputType: "insertText", data: "x" })
      expect(destroy).not.toHaveBeenCalled()
      expect(editable.getAttribute("contenteditable")).toBe("true")
    } finally {
      view.unmount()
      // React StrictMode 的 probe 次数依赖于该次提交的 state update；无论 probe 次数，
      // 最后一个已创建 session 必须被销毁，且没有未销毁的弃用实例。
      expect(destroy).toHaveBeenCalledTimes(1)
      destroy.mockRestore()
    }
  })

  it("loadKey encoder 区分字符串、-0 与 0，并拒绝非有限数字", () => {
    expect(encodeNoteEditorSessionKey("A", "0")).not.toBe(encodeNoteEditorSessionKey("A", 0))
    expect(encodeNoteEditorSessionKey("A", -0)).not.toBe(encodeNoteEditorSessionKey("A", 0))
    expect(() => encodeNoteEditorSessionKey("A", Number.NaN)).toThrow(/loadKey/u)
    expect(() => encodeNoteEditorSessionKey("A", Number.POSITIVE_INFINITY)).toThrow(/loadKey/u)
    expect(() => encodeNoteEditorSessionKey("A", Number.NEGATIVE_INFINITY)).toThrow(/loadKey/u)
  })

  it("-0 到 0 的 loadKey 变化会重建会话", () => {
    const view = render(<NoteEditor documentId="A" loadKey={-0} initialDocument={documentWith("minus zero")} />)
    view.rerender(<NoteEditor documentId="A" loadKey={0} initialDocument={documentWith("zero")} />)
    expect(view.container.querySelector(".tiptap")?.textContent).toContain("zero")
  })

  it("无效 B 只通知一次候选回调，A 的会话和 callbacks 保持到合法 C 切换", async () => {
    const destroy = vi.spyOn(EditorSession.prototype, "destroy")
    const changes: string[] = []
    const saves: string[] = []
    const initialErrors: Array<{ error: unknown; context: { documentId: string; loadKey: string | number } }> = []
    const onSaveA: NoteSave = (_snapshot, context) => {
      saves.push(context.documentId)
      return Promise.resolve({ kind: "saved" as const })
    }
    const onChangeA = () => changes.push("A")
    const onChangeB = () => changes.push("B")
    const onChangeC = () => changes.push("C")
    const onInitialLoadErrorB = (error: unknown, context: { documentId: string; loadKey: string | number }) => initialErrors.push({ error, context })
    const view = render(<StrictMode><NoteEditor documentId="A" loadKey="A" initialDocument={documentWith("old")} onSave={onSaveA} onChange={onChangeA} /></StrictMode>)
    try {
      const aSession = createdSessions.at(-1)
      if (!aSession) throw new Error("A session 未创建")
      replaceText(aSession, "A local")
      expect(changes).toEqual(["A"])

      view.rerender(<StrictMode><NoteEditor
        documentId="B"
        loadKey="B"
        initialDocument={{ schemaVersion: 1, data: { type: "doc", content: [{ type: "unknown" }] } }}
        onSave={(_snapshot, context) => {
          saves.push(`B:${context.documentId}`)
          return Promise.resolve({ kind: "saved" as const })
        }}
        onChange={onChangeB}
        onInitialLoadError={onInitialLoadErrorB}
      /></StrictMode>)
      expect(destroy).not.toHaveBeenCalled()
      expect(initialErrors).toHaveLength(1)
      expect(initialErrors[0]?.context).toEqual({ documentId: "B", loadKey: "B" })
      expect(initialErrors[0]?.error).toBeInstanceOf(Error)
      expect(view.container.querySelector(".tiptap")?.textContent).toContain("A local")

      // B 的未提交 callback 不能覆盖 A；旧 editor 的编辑仍只通知 A。
      replaceText(aSession, "A after B")
      expect(changes).toEqual(["A", "A"])
      await expect(aSession.save()).resolves.toEqual({ kind: "saved" })
      expect(saves).toEqual(["A"])

      // 合法 C 才提交 session 交换，destroy A，且新编辑只通知 C。
      view.rerender(<StrictMode><NoteEditor documentId="C" loadKey="C" initialDocument={documentWith("C loaded")} onChange={onChangeC} /></StrictMode>)
      expect(destroy).toHaveBeenCalledTimes(1)
      const cSession = createdSessions.at(-1)
      if (!cSession || cSession === aSession) throw new Error("C session 未创建")
      expect(cSession.editor.getText()).toBe("C loaded")
      replaceText(cSession, "C local")
      expect(changes).toEqual(["A", "A", "C"])
    } finally {
      view.unmount()
      // A 在 C 切换时已销毁；卸载会额外销毁当前 C，StrictMode probe 可能还会产生
      // 已销毁实例的 cleanup。核心约束是 B 从未创建 session，且没有残留活动 session。
      expect(destroy).toHaveBeenCalledTimes(2)
      destroy.mockRestore()
    }
  })

  it("A→合法 C 的 layout 提交紧邻无效 D 时，活跃 session 完整归属 accepted C", async () => {
    const destroy = vi.spyOn(EditorSession.prototype, "destroy")
    const errors: string[] = []
    const renderCandidate = (documentId: string, loadKey: string, document: unknown, onSave?: NoteSave) => <>
      <NoteEditor
        documentId={documentId}
        loadKey={loadKey}
        initialDocument={document}
        {...(onSave === undefined ? {} : { onSave })}
        onInitialLoadError={(_error, context) => errors.push(context.documentId)}
      />
    </>
    const view = render(renderCandidate("A", "A", documentWith("A")))
    try {
      const onSaveC: NoteSave = (_snapshot, context) => Promise.resolve({ kind: "saved", revision: `C:${context.documentId}` })
      view.rerender(renderCandidate("C", "C", documentWith("C"), onSaveC))
      expect(createdSessions).toHaveLength(2)
      // C 已完成真实 layout commit，D 紧随抵达；D 失败时不能让 C session 混入 D props。
      view.rerender(renderCandidate("D", "D", { schemaVersion: 1, data: { type: "doc", content: [{ type: "unknown" }] } }))
      expect(errors).toEqual(["D"])
      expect(createdSessions).toHaveLength(2)
      expect(createdOptions).toHaveLength(2)
      const [aSession, cSession] = createdSessions
      const cOptions = createdOptions[1]
      if (!aSession || !cSession) throw new Error("A 或 C session 未创建")
      if (!cOptions) throw new Error("C options 未创建")
      expect(destroy).toHaveBeenCalledTimes(1)
      expect(cSession.editor.getText()).toBe("C")
      expect(cOptions.documentId).toBe("C")
      expect(cOptions.loadKey).toBe("C")
      expect(cOptions.initialDocument).toEqual(documentWith("C"))
      const callbackResult = await cOptions.onSave?.(documentWith("C"), {
        documentId: "C",
        baseRevision: "r1",
        signal: new AbortController().signal
      })
      expect(callbackResult).toEqual({ kind: "saved", revision: "C:C" })
      expect(createdSessions).toContain(cSession)
      expect(view.container.querySelector(".tiptap")?.textContent).toContain("C")
    } finally {
      view.unmount()
      expect(destroy).toHaveBeenCalledTimes(2)
      destroy.mockRestore()
    }
  })
})
