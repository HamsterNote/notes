// @vitest-environment jsdom
/**
 * 7.1 公共入口 smoke：只从根 `./index` 使用公开 runtime API 完成
 * HNN/Markdown 编解码装载、DOM 编辑 → onChange、CAS 保存、显式 Markdown 导出
 * （无诊断直出 / 有诊断等待确认）。
 *
 * 刻意不 mock session、不 import 内部 Editor/schema/installer，证明宿主仅凭公开导出
 * 即可完成上述流程（封闭模型）。
 */
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  HnnCodecError,
  MarkdownExport,
  NoteEditor,
  NoteSaveStatus,
  decodeHnn,
  encodeHnn,
  exportMarkdown,
  importMarkdown
} from "./index"
import type { HnnDocument, MarkdownExportProps, NoteEditorProps, NoteSave } from "./index"

afterEach(() => cleanup())

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002"
]

function paragraphsDocument(...texts: string[]): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: texts.map((text, index) => ({
        type: "paragraph",
        attrs: { nodeId: ids[index] },
        content: [{ type: "text", text }]
      }))
    }
  }
}

/** codeBlock 使用保留围栏名 math：Markdown 导出必走降级并产生诊断。 */
function degradedDocument(text: string): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { nodeId: ids[0], language: "math", filename: "untitled" },
          content: [{ type: "text", text }]
        }
      ]
    }
  }
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

/** 原生 paste 事件（仅 text/plain）：触发 ProseMirror DOM 编辑路径，而非内部 editor API。 */
function pasteTextEvent(text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
      files: [],
      items: [],
      types: ["text/plain"]
    }
  })
  return event
}

function renderEditor(props: NoteEditorProps) {
  const view = render(<NoteEditor {...props} />)
  return view
}

describe("7.1 公共入口 smoke", () => {
  it("公开 HNN 编解码可无损装载（无效输入抛 HnnCodecError）", () => {
    const hnn = paragraphsDocument("hello")
    const document = decodeHnn(hnn)
    const roundTripped = encodeHnn(document)
    expect(roundTripped.schemaVersion).toBe(1)
    expect(JSON.stringify(roundTripped)).toContain("hello")
    expect(() => decodeHnn({ schemaVersion: 2, data: {} })).toThrow(HnnCodecError)
  })

  it("公开 Markdown 编解码可导入并导出", () => {
    const imported = importMarkdown("# Title\n\nbody")
    expect(imported.document).toBeDefined()
    const exported = exportMarkdown(imported.document as HnnDocument)
    expect(exported.markdown).toContain("Title")
    expect(Array.isArray(exported.diagnostics)).toBe(true)
  })

  it("DOM 原生交互（paste）触发 onChange，快照是 HNN", async () => {
    const onChange = vi.fn()
    const view = renderEditor({ documentId: "A", loadKey: "v1", initialDocument: paragraphsDocument("start"), onChange })
    try {
      const editable = view.container.querySelector(".tiptap") as HTMLElement
      editable.dispatchEvent(pasteTextEvent("typed"))
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      const snapshot = onChange.mock.calls.at(-1)?.[0] as HnnDocument
      expect(snapshot.schemaVersion).toBe(1)
      expect(JSON.stringify(snapshot)).toContain("typed")
    } finally {
      view.unmount()
    }
  })

  it("保存按钮以 CAS 契约调用 onSave（HNN 快照 + revision），成功后回到已保存", async () => {
    const pending = deferred<{ kind: "saved"; revision?: string }>()
    const snapshots: HnnDocument[] = []
    const contexts: Array<{ documentId: string; baseRevision?: string }> = []
    const onSave = vi.fn<NoteSave>((snapshot, context) => {
      snapshots.push(snapshot)
      contexts.push({ documentId: context.documentId, ...(context.baseRevision === undefined ? {} : { baseRevision: context.baseRevision }) })
      return pending.promise
    })
    const view = renderEditor({ documentId: "doc-1", loadKey: "v1", initialDocument: paragraphsDocument("start"), initialRevision: "r1", onSave })
    try {
      const editable = view.container.querySelector(".tiptap") as HTMLElement
      editable.dispatchEvent(pasteTextEvent("draft"))
      await waitFor(() => expect(within(view.container).getByText("有未保存的修改")).toBeDefined())

      fireEvent.click(within(view.container).getByText("保存"))
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(snapshots[0]?.schemaVersion).toBe(1)
      expect(JSON.stringify(snapshots[0])).toContain("draft")
      expect(contexts[0]).toEqual({ documentId: "doc-1", baseRevision: "r1" })

      pending.resolve({ kind: "saved", revision: "r2" })
      await waitFor(() => expect(within(view.container).getByText("已保存")).toBeDefined())
    } finally {
      view.unmount()
    }
  })

  it("显式导出无诊断时直接写出，且不改动文档/baseline", async () => {
    const exported: string[] = []
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>((result) => { exported.push(result.markdown) })
    const onSave: NoteSave = vi.fn(() => Promise.resolve({ kind: "saved" as const }))
    const view = renderEditor({ documentId: "A", loadKey: "v1", initialDocument: paragraphsDocument("hello"), onSave, onExportMarkdown: onExport })
    try {
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
      expect(exported[0]).toContain("hello")
      expect(within(view.container).getByText("已保存")).toBeDefined()
    } finally {
      view.unmount()
    }
  })

  it("显式导出有诊断时等待确认，未确认不写出", async () => {
    const onExport = vi.fn<NonNullable<MarkdownExportProps["onExport"]>>()
    const view = renderEditor({ documentId: "A", loadKey: "v1", initialDocument: degradedDocument("不是公式"), onExportMarkdown: onExport })
    try {
      fireEvent.click(within(view.container).getByText("导出 Markdown"))
      const dialog = await within(document.body).findByRole("dialog")
      expect(onExport).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByText("确认导出"))
      await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
    } finally {
      view.unmount()
    }
  })

  it("公开组件可独立从根入口装配（NoteSaveStatus / MarkdownExport 可构造）", () => {
    const status = render(
      <NoteSaveStatus state={{ dirty: false, status: "idle" }} onSave={() => undefined} />
    )
    const exportView = render(
      <MarkdownExport snapshot={() => paragraphsDocument("x")} onExport={() => undefined} sessionKey="k" />
    )
    try {
      expect(status.container.textContent).toContain("已保存")
      expect(exportView.container.textContent).toContain("导出 Markdown")
    } finally {
      status.unmount()
      exportView.unmount()
    }
  })
})
