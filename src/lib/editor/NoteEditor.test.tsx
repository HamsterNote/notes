// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Editor } from "@tiptap/core"
import type { DrawingValue } from "@hamster-note/painting"
import { decodeHnn, encodeHnn, type HnnDocument } from "../hnn/codec"
import { HNN_CARD_EMPTY_DATA } from "../hnn/cardPayload"
import { HNN_DRAWING_EMPTY_DATA } from "../hnn/drawingPayload"
import { NoteEditor } from "./NoteEditor"
import { EditorSession } from "./session"
import { encodeNoteEditorSessionKey } from "./sessionKey"
import type { EditorSessionOptions, NoteSave } from "./types"

const createdSessions = vi.hoisted(() => [] as EditorSession[])
const createdOptions = vi.hoisted(() => [] as EditorSessionOptions[])
// jsdom 无 canvas：DrawingSurface 测试替身的可编程状态（nextValue = 下次点击要 onChange 的值）
interface DrawingStubState {
  lastValue: DrawingValue | undefined
  nextValue: DrawingValue | undefined
}
const drawingStub = vi.hoisted((): DrawingStubState => ({
  lastValue: undefined,
  nextValue: undefined
}))

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

vi.mock("@hamster-note/painting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hamster-note/painting")>()
  const { createElement } = await import("react")
  return {
    ...actual,
    // 替身只记录受控 value 并提供一个可点击按钮触发 onChange（模拟一笔绘制）
    DrawingSurface(props: { value?: DrawingValue; onChange?: (value: DrawingValue) => void }) {
      drawingStub.lastValue = props.value
      return createElement(
        "button",
        {
          type: "button",
          "data-testid": "drawing-surface-stub",
          onClick: () => {
            if (drawingStub.nextValue !== undefined) props.onChange?.(drawingStub.nextValue)
          }
        },
        "画板画布"
      )
    }
  }
})

// 包装 encodeHnn 为可编程 spy：默认行为不变，shell 预算失败用例可令其抛错一次
vi.mock("../hnn/codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hnn/codec")>()
  return { ...actual, encodeHnn: vi.fn(actual.encodeHnn) }
})

const mockedEncodeHnn = vi.mocked(encodeHnn)

// Drawer 以 portal 渲染进 document.body；必须显式清理，避免打开的抽屉/编辑器跨用例残留。
afterEach(() => cleanup())

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

  it("custom node 渲染为封闭 NodeView 界面，未激活时不产生 dialog 或危险交互入口", () => {
    const customDocument = {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{ type: "formula", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174000", latex: "x^2" } }]
      }
    }
    const { container } = render(<NoteEditor documentId="A" loadKey="custom" initialDocument={customDocument} />)

    const formula = container.querySelector("[data-hnn-node='formula']")
    // 原子节点整块不可进入文本编辑；编辑入口是带可访问名称的预览按钮
    expect(formula?.getAttribute("contenteditable")).toBe("false")
    const preview = formula?.querySelector(".hn-editor-formula-preview")
    expect(preview?.getAttribute("aria-label")).toBe("编辑公式")
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

/** 覆盖全部 Phase 6.1 标准块类型的合法初始 HNN；nodeId 必须是小写 UUID v4 且文档内唯一。 */
function standardDocument(): Record<string, unknown> {
  let n = 0
  const nid = () => `123e4567-e89b-42d3-a456-${String(++n).padStart(12, "0")}`
  const para = (text: string) => ({ type: "paragraph", attrs: { nodeId: nid() }, content: [{ type: "text", text }] })
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [
        { type: "heading", attrs: { nodeId: nid(), level: 2 }, content: [{ type: "text", text: "标题" }] },
        para("正文段落"),
        { type: "bulletList", attrs: { nodeId: nid() }, content: [{ type: "listItem", attrs: { nodeId: nid() }, content: [para("无序项")] }] },
        { type: "orderedList", attrs: { nodeId: nid(), start: 1 }, content: [{ type: "listItem", attrs: { nodeId: nid() }, content: [para("有序项")] }] },
        {
          type: "taskList",
          attrs: { nodeId: nid() },
          content: [
            { type: "taskItem", attrs: { nodeId: nid(), checked: false }, content: [para("待办")] },
            { type: "taskItem", attrs: { nodeId: nid(), checked: true }, content: [para("已办")] }
          ]
        },
        { type: "blockquote", attrs: { nodeId: nid() }, content: [para("引用内容")] },
        { type: "codeBlock", attrs: { nodeId: nid(), language: "typescript", filename: "demo.ts" }, content: [{ type: "text", text: "const x = 1" }] },
        {
          type: "table",
          attrs: { nodeId: nid() },
          content: [
            {
              type: "tableRow",
              attrs: { nodeId: nid() },
              content: [
                { type: "tableHeader", attrs: { nodeId: nid() }, content: [para("表头")] },
                { type: "tableHeader", attrs: { nodeId: nid() }, content: [para("表头二")] }
              ]
            },
            {
              type: "tableRow",
              attrs: { nodeId: nid() },
              content: [
                { type: "tableCell", attrs: { nodeId: nid() }, content: [para("单元格")] },
                { type: "tableCell", attrs: { nodeId: nid() }, content: [para("单元格二")] }
              ]
            }
          ]
        }
      ]
    }
  }
}

/** 文档中首个指定类型节点的位置。 */
function posOfFirst(editor: Editor, type: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos
    return found < 0
  })
  if (found < 0) throw new Error(`文档中未找到 ${type}`)
  return found
}

/** 在目标块内第一个 textblock 的起始处插入文本，模拟对该块的编辑。 */
function insertIntoBlock(editor: Editor, type: string, text: string): void {
  const pos = posOfFirst(editor, type)
  const node = editor.state.doc.nodeAt(pos)
  if (!node) throw new Error(`文档中未找到 ${type}`)
  let target = node.isTextblock ? pos + 1 : -1
  node.descendants((child, childPos) => {
    if (target < 0 && child.isTextblock) target = pos + 1 + childPos + 1
    return target < 0
  })
  if (target < 0) throw new Error(`${type} 内没有可编辑 textblock`)
  expect(editor.commands.insertContentAt(target, text)).toBe(true)
}

/** 文档中首个完全匹配文本节点的起始位置。 */
function posOfText(editor: Editor, text: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === text) found = pos
    return found < 0
  })
  if (found < 0) throw new Error(`文档中未找到文本 ${text}`)
  return found
}

/** 把选区放进包含指定文本的位置（用于让表格删除控件获得本表选区）。 */
function focusText(editor: Editor, text: string): void {
  expect(editor.commands.setTextSelection(posOfText(editor, text) + 1)).toBe(true)
}

describe("内部 NoteEditor 标准块呈现（Phase 6.1）", () => {
  beforeEach(() => {
    createdSessions.splice(0)
    createdOptions.splice(0)
  })

  it("段落、标题、列表、任务列表、引用、代码、表格全部以可编辑 DOM 呈现", () => {
    const { container } = render(<NoteEditor documentId="S" loadKey="std" initialDocument={standardDocument()} />)

    // 清晰编辑区域容器与可访问编辑根。
    expect(container.querySelector(".hn-editor")).not.toBeNull()
    const editable = container.querySelector(".tiptap")
    expect(editable?.getAttribute("contenteditable")).toBe("true")
    expect(editable?.getAttribute("role")).toBe("textbox")
    expect(editable?.getAttribute("aria-multiline")).toBe("true")
    expect(editable?.getAttribute("aria-label")).toBeTruthy()

    // 标题与段落。
    expect(container.querySelector("h2")?.textContent).toContain("标题")
    expect(container.querySelector("p")?.textContent).toContain("正文段落")

    // 无序与有序列表。
    expect(container.querySelector("ul:not([data-type='taskList']) li")?.textContent).toContain("无序项")
    expect(container.querySelector("ol li")?.textContent).toContain("有序项")

    // 任务列表：原生 checkbox 可聚焦、不禁用，勾选状态如实呈现且带可访问名称。
    // TaskItem NodeView 的 li 只带 data-checked（data-type 不会落到 NodeView DOM）。
    const checkboxes = container.querySelectorAll("ul[data-type='taskList'] li[data-checked] input[type='checkbox']")
    expect(checkboxes).toHaveLength(2)
    const [pending, done] = [...checkboxes] as HTMLInputElement[]
    expect(pending?.disabled).toBe(false)
    expect(pending?.checked).toBe(false)
    expect(done?.checked).toBe(true)
    expect(done?.closest("[data-checked]")?.getAttribute("data-checked")).toBe("true")
    expect(done?.getAttribute("aria-label")).toBeTruthy()

    // 引用、代码与表格。
    expect(container.querySelector("blockquote")?.textContent).toContain("引用内容")
    expect(container.querySelector("pre code")?.textContent).toContain("const x = 1")
    expect(container.querySelectorAll("table th")).toHaveLength(2)
    expect(container.querySelectorAll("table td")).toHaveLength(2)
    expect(container.querySelector("table th")?.textContent).toContain("表头")
    expect(container.querySelector("table td")?.textContent).toContain("单元格")
  })

  it("theme 始终输出显式 light/dark 修饰类且只切换类名，不重建会话", () => {
    const view = render(<NoteEditor documentId="T" loadKey="t" initialDocument={standardDocument()} />)
    // 缺省为 light；显式类保证 light 可覆盖暗色祖先 token。
    expect(view.container.querySelector(".hn-editor--light")).not.toBeNull()
    expect(view.container.querySelector(".hn-editor--dark")).toBeNull()

    view.rerender(<NoteEditor documentId="T" loadKey="t" theme="dark" initialDocument={standardDocument()} />)
    expect(view.container.querySelector(".hn-editor--dark")).not.toBeNull()
    expect(view.container.querySelector(".hn-editor--light")).toBeNull()

    view.rerender(<NoteEditor documentId="T" loadKey="t" theme="light" initialDocument={standardDocument()} />)
    expect(view.container.querySelector(".hn-editor--light")).not.toBeNull()
    expect(view.container.querySelector(".hn-editor--dark")).toBeNull()
    expect(createdSessions).toHaveLength(1)
  })

  it("每种标准块的编辑都经会话编码为合法 HNN，保存快照可无损回读", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const onSave: NoteSave = (snapshot) => {
      saved.push(snapshot)
      return Promise.resolve({ kind: "saved", revision: "r2" })
    }
    render(<NoteEditor
      documentId="P"
      loadKey="p"
      initialDocument={standardDocument()}
      onSave={onSave}
      onChange={(snapshot) => changes.push(snapshot)}
    />)
    const session = createdSessions.at(-1)
    if (!session) throw new Error("session 未创建")
    const editor = session.editor

    // 逐类编辑：文本块插入文本，任务项切换勾选状态。
    insertIntoBlock(editor, "heading", "改")
    insertIntoBlock(editor, "paragraph", "改")
    insertIntoBlock(editor, "listItem", "改")
    insertIntoBlock(editor, "taskItem", "改")
    insertIntoBlock(editor, "blockquote", "改")
    insertIntoBlock(editor, "codeBlock", "// 改\n")
    insertIntoBlock(editor, "tableCell", "改")
    const taskPos = posOfFirst(editor, "taskItem")
    const taskNode = editor.state.doc.nodeAt(taskPos)
    expect(editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(taskPos, undefined, { ...taskNode?.attrs, checked: true })
      return true
    })).toBe(true)

    // DOM 立即反映编辑结果。
    expect(editor.getText()).toContain("改标题")
    expect(editor.getText()).toContain("改正文段落")
    expect(editor.getText()).toContain("改引用内容")
    expect(editor.getText()).toContain("改单元格")
    expect(session.state.dirty).toBe(true)

    // 保存快照与最后一次 onChange 快照一致，且可重新解码为合法 HNN。
    await expect(session.save()).resolves.toEqual({ kind: "saved", revision: "r2" })
    expect(saved).toHaveLength(1)
    expect(changes.length).toBeGreaterThan(0)
    expect(saved[0]).toEqual(changes.at(-1))
    expect(() => decodeHnn(saved[0] as HnnDocument)).not.toThrow()
    expect(session.state.dirty).toBe(false)

    // 快照结构：顶层块类型完整，任务项勾选与代码块文本均被持久化。
    const data = saved[0]?.data as { content: Array<{ type: string; content?: unknown[]; attrs?: Record<string, unknown> }> }
    expect(data.content.map((node) => node.type)).toEqual([
      "heading", "paragraph", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "table"
    ])
    const taskList = data.content.find((node) => node.type === "taskList") as { content: Array<{ attrs: { checked: boolean } }> }
    expect(taskList.content.map((item) => item.attrs.checked)).toEqual([true, true])
    const codeBlock = data.content.find((node) => node.type === "codeBlock") as { attrs: Record<string, unknown>; content: Array<{ text: string }> }
    expect(codeBlock.attrs).toMatchObject({ language: "typescript", filename: "demo.ts" })
    expect(codeBlock.content[0]?.text).toContain("// 改")
  })
})

describe("内部 NoteEditor 标准块控件（Phase 6.1 Gate）", () => {
  beforeEach(() => {
    // 每个用例重新渲染真实组件前先清空会话追踪
    createdSessions.length = 0
  })

  function quoteDocument(): Record<string, unknown> {
    // author 对 codec 是可选 attr，这里先缺省以覆盖 null 归一化路径
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "blockquote",
          attrs: { nodeId: "123e4567-e89b-42d3-b456-426614174000" },
          content: [{ type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-b456-426614174001" }, content: [{ type: "text", text: "引用内容" }] }]
        }]
      }
    }
  }

  function codeDocument(language = "typescript", filename = "demo.ts", code = "const x = 1"): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "codeBlock",
          attrs: { nodeId: "123e4567-e89b-42d3-b456-426614174010", language, filename },
          content: [{ type: "text", text: code }]
        }]
      }
    }
  }

  function tableDocument(rows: number, cols: number): Record<string, unknown> {
    let seq = 20
    const nid = () => `123e4567-e89b-42d3-b456-${String(++seq).padStart(12, "0")}`
    // 空段落省略 content（codec 允许 EMPTY_CONTENT_TYPES 缺省，空数组形式属非规范）
    const cell = () => ({
      type: "tableCell",
      attrs: { nodeId: nid() },
      content: [{ type: "paragraph", attrs: { nodeId: nid() } }]
    })
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "table",
          attrs: { nodeId: nid() },
          content: Array.from({ length: rows }, () => ({
            type: "tableRow",
            attrs: { nodeId: nid() },
            content: Array.from({ length: cols }, cell)
          }))
        }]
      }
    }
  }

  /** 每个单元格带唯一文本 r{行}c{列} 的表格，便于断言删除的具体逻辑行/列。 */
  function textTableDocument(rows: number, cols: number): Record<string, unknown> {
    let seq = 500
    const nid = () => `123e4567-e89b-42d3-b456-${String(++seq).padStart(12, "0")}`
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "table",
          attrs: { nodeId: nid() },
          content: Array.from({ length: rows }, (_r, r) => ({
            type: "tableRow",
            attrs: { nodeId: nid() },
            content: Array.from({ length: cols }, (_c, c) => ({
              type: "tableCell",
              attrs: { nodeId: nid() },
              content: [{ type: "paragraph", attrs: { nodeId: nid() }, content: [{ type: "text", text: `r${r + 1}c${c + 1}` }] }]
            }))
          }))
        }]
      }
    }
  }

  /** 单行、唯一单元格 colspan=2：行 childCount 为 1，但 TableMap 逻辑宽度为 2。 */
  function colspanTableDocument(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "table",
          attrs: { nodeId: "123e4567-e89b-42d3-b456-426614174600" },
          content: [{
            type: "tableRow",
            attrs: { nodeId: "123e4567-e89b-42d3-b456-426614174601" },
            content: [{
              type: "tableCell",
              attrs: { nodeId: "123e4567-e89b-42d3-b456-426614174602", colspan: 2 },
              content: [{ type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-b456-426614174603" }, content: [{ type: "text", text: "wide" }] }]
            }]
          }]
        }]
      }
    }
  }

  /** 跨列表格：首行 wide(colspan=2)+x，次行 b1/b2/x2，逻辑宽度 3。 */
  function spanTableDocument(): Record<string, unknown> {
    let seq = 610
    const nid = () => `123e4567-e89b-42d3-b456-${String(++seq).padStart(12, "0")}`
    const cell = (text: string, attrs: Record<string, unknown> = {}) => ({
      type: "tableCell",
      attrs: { nodeId: nid(), ...attrs },
      content: [{ type: "paragraph", attrs: { nodeId: nid() }, content: [{ type: "text", text }] }]
    })
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "table",
          attrs: { nodeId: nid() },
          content: [
            { type: "tableRow", attrs: { nodeId: nid() }, content: [cell("wide", { colspan: 2 }), cell("x")] },
            { type: "tableRow", attrs: { nodeId: nid() }, content: [cell("b1"), cell("b2"), cell("x2")] }
          ]
        }]
      }
    }
  }

  /** 前置段落 + 表格：初始选区落在表格外，用于验证无本表选区时的禁用态。 */
  function paragraphThenTableDocument(): Record<string, unknown> {
    const doc = tableDocument(2, 2) as { data: { content: Record<string, unknown>[] } }
    doc.data.content.unshift({
      type: "paragraph",
      attrs: { nodeId: "123e4567-e89b-42d3-b456-426614174700" },
      content: [{ type: "text", text: "表格外" }]
    })
    return doc
  }

  type SnapshotNode = { attrs?: Record<string, unknown>; content?: SnapshotNode[] }

  function snapshotBlocks(changes: HnnDocument[]): SnapshotNode[] {
    return (changes.at(-1)!.data as { content: SnapshotNode[] }).content
  }

  it("blockquote NodeView：正文 contentDOM 可编辑，署名输入一次事务持久化并可一步撤销，保存重载保留", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="Q"
        loadKey="q1"
        initialDocument={quoteDocument() as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const quote = view.container.querySelector("blockquote")!
    // 正文走独立 contentDOM，署名输入是正文之外的封闭控件
    expect(quote.querySelector(".hn-editor-quote-body")?.textContent).toContain("引用内容")
    const author = quote.querySelector<HTMLInputElement>(".hn-editor-quote-author")!
    expect(author.getAttribute("aria-label")).toBe("引用署名")
    expect(author.value).toBe("")

    insertIntoBlock(session.editor, "blockquote", "改")
    expect(session.editor.getText()).toContain("改引用内容")

    fireEvent.change(author, { target: { value: "Ada" } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["author"]).toBe("Ada")

    // 一次控件操作只产生一个事务：一步 undo 即可还原，redo 恢复
    session.editor.commands.undo()
    expect(author.value).toBe("")
    session.editor.commands.redo()
    expect(author.value).toBe("Ada")

    await session.save()
    view.unmount()
    const reload = render(<NoteEditor documentId="Q" loadKey="q2" initialDocument={saved[0]!} />)
    expect(reload.container.querySelector<HTMLInputElement>(".hn-editor-quote-author")!.value).toBe("Ada")
  })

  it("blockquote NodeView：紧邻正文输入后的署名提交是独立 undo step，一步 undo 只撤署名", () => {
    const view = render(<NoteEditor documentId="QH" loadKey="qh1" initialDocument={quoteDocument() as never} />)
    const session = createdSessions.at(-1)!
    const author = view.container.querySelector<HTMLInputElement>(".hn-editor-quote-author")!

    // 紧邻的正文输入与署名提交必须被 closeHistory 切分，否则会合并成一步。
    insertIntoBlock(session.editor, "blockquote", "改")
    fireEvent.change(author, { target: { value: "Ada" } })

    session.editor.commands.undo()
    // 只撤销署名属性，正文输入保留
    expect(author.value).toBe("")
    expect(session.editor.getText()).toContain("改引用内容")

    session.editor.commands.undo()
    expect(session.editor.getText()).not.toContain("改引用内容")
  })

  it("blockquote NodeView：连续署名提交各自成为独立 undo step", () => {
    const view = render(<NoteEditor documentId="QH2" loadKey="qh2" initialDocument={quoteDocument() as never} />)
    const session = createdSessions.at(-1)!
    const author = view.container.querySelector<HTMLInputElement>(".hn-editor-quote-author")!

    fireEvent.change(author, { target: { value: "Ada" } })
    fireEvent.change(author, { target: { value: "Bob" } })
    expect(author.value).toBe("Bob")

    session.editor.commands.undo()
    expect(author.value).toBe("Ada")
    session.editor.commands.undo()
    expect(author.value).toBe("")
  })

  it("codeBlock NodeView：语言 combobox、文件名 textbox 与安全高亮层，控件单事务持久化，保存重载保留", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="C"
        loadKey="c1"
        initialDocument={codeDocument() as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const card = view.container.querySelector(".hn-editor-code-card")!
    const select = card.querySelector<HTMLSelectElement>("select.hn-editor-code-lang")!
    expect(select.getAttribute("aria-label")).toBe("代码语言")
    expect(select.value).toBe("typescript")
    const filename = card.querySelector<HTMLInputElement>("input.hn-editor-code-filename")!
    expect(filename.getAttribute("aria-label")).toBe("代码文件名")
    expect(filename.value).toBe("demo.ts")

    // 高亮层对辅助技术隐藏，文本与代码一致，token 全部由元素承载（无 innerHTML 注入）
    const highlight = card.querySelector(".hn-editor-code-highlight")!
    expect(highlight.getAttribute("aria-hidden")).toBe("true")
    expect(highlight.textContent).toBe("const x = 1")
    expect(highlight.querySelector("span.hljs-keyword")?.textContent).toBe("const")
    expect(highlight.querySelector("span.hljs-number")?.textContent).toBe("1")

    // 编辑层仍是 PM contentDOM：代码可编辑，高亮层同步
    const editorLayer = card.querySelector(".hn-editor-code-editor")!
    expect(editorLayer.textContent).toContain("const x = 1")
    insertIntoBlock(session.editor, "codeBlock", "// hi\n")
    expect(editorLayer.textContent).toContain("// hi")
    expect(highlight.querySelector("span.hljs-comment")?.textContent).toBe("// hi")

    // 语言 combobox：change 即持久化，单步 undo/redo
    fireEvent.change(select, { target: { value: "python" } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["language"]).toBe("python")
    session.editor.commands.undo()
    expect(select.value).toBe("typescript")
    session.editor.commands.redo()
    expect(select.value).toBe("python")

    // 文件名 textbox：change 持久化；清空回落 codec 要求的非空默认值
    fireEvent.change(filename, { target: { value: "main.py" } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["filename"]).toBe("main.py")
    fireEvent.change(filename, { target: { value: "  " } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["filename"]).toBe("untitled")

    await session.save()
    view.unmount()
    const reload = render(<NoteEditor documentId="C" loadKey="c2" initialDocument={saved[0]!} />)
    expect(reload.container.querySelector<HTMLSelectElement>("select.hn-editor-code-lang")!.value).toBe("python")
    expect(reload.container.querySelector<HTMLInputElement>("input.hn-editor-code-filename")!.value).toBe("untitled")
  })

  it("codeBlock NodeView 回显 schema 外的持久化语言值", () => {
    const view = render(<NoteEditor documentId="C2" loadKey="c3" initialDocument={codeDocument("wren") as never} />)
    expect(view.container.querySelector<HTMLSelectElement>("select.hn-editor-code-lang")!.value).toBe("wren")
  })

  it("table NodeView：添加行/列作用于逻辑末边界，单事务可撤销，保存重载保留", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="TB"
        loadKey="t1"
        initialDocument={textTableDocument(2, 2) as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
    const buttonByLabel = (label: string): HTMLButtonElement => wrapper.querySelector(`[aria-label="${label}"]`)!
    const addRow = buttonByLabel("添加行")
    const addColumn = buttonByLabel("添加列")
    const rowCount = () => session.editor.state.doc.firstChild!.childCount
    const colCount = () => session.editor.state.doc.firstChild!.firstChild!.childCount
    const snapshotTable = () => snapshotBlocks(changes)[0]!

    // 添加行落在真实逻辑末行之后：原有行文本保持原位，新行追加在末尾
    fireEvent.click(addRow)
    expect(rowCount()).toBe(3)
    expect(snapshotTable().content).toHaveLength(3)
    expect(session.editor.getText()).toMatch(/r1c1[\s\S]*r2c2/)
    fireEvent.click(addColumn)
    expect(colCount()).toBe(3)
    expect(snapshotTable().content?.[0]?.content).toHaveLength(3)

    // 每个控件操作都是一个完整事务，可独立撤销
    session.editor.commands.undo()
    expect(colCount()).toBe(2)
    expect(rowCount()).toBe(3)

    await session.save()
    view.unmount()
    const reload = render(<NoteEditor documentId="TB" loadKey="t2" initialDocument={saved[0]!} />)
    const reloaded = reload.container.querySelector(".hn-editor-table-wrapper")!
    expect(reloaded.querySelectorAll("tr")).toHaveLength(3)
    expect(reloaded.querySelectorAll("tr")[0]!.querySelectorAll("td")).toHaveLength(2)
  })

  it("table NodeView：删除行/列需两步确认，作用于当前选区所在逻辑行/列", () => {
    const view = render(<NoteEditor documentId="TB3" loadKey="t5" initialDocument={textTableDocument(3, 3) as never} />)
    const session = createdSessions.at(-1)!
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
    const rowCount = () => session.editor.state.doc.firstChild!.childCount
    const colCount = () => session.editor.state.doc.firstChild!.firstChild!.childCount
    const deleteRow = (): HTMLButtonElement => wrapper.querySelector('[aria-label="删除行"]')!
    const deleteColumn = (): HTMLButtonElement => wrapper.querySelector('[aria-label="删除列"]')!

    // 聚焦第 2 行：首次点击只进入确认态，结构不变
    focusText(session.editor, "r2c2")
    expect(deleteRow().disabled).toBe(false)
    fireEvent.click(deleteRow())
    expect(rowCount()).toBe(3)
    const armedRow = wrapper.querySelector<HTMLButtonElement>('[aria-label="确认删除行（再次点击）"]')!
    expect(armedRow.classList.contains("is-confirming")).toBe(true)
    // 第二次点击才执行：删除选区所在的逻辑第 2 行
    fireEvent.click(armedRow)
    expect(rowCount()).toBe(2)
    expect(session.editor.getText()).not.toContain("r2c1")
    expect(session.editor.getText()).toContain("r1c1")
    expect(session.editor.getText()).toContain("r3c1")
    // 执行后确认态复位
    expect(wrapper.querySelector(".is-confirming")).toBeNull()

    // 聚焦（新）第 2 行第 3 列，两次点击删除该逻辑列
    focusText(session.editor, "r3c3")
    fireEvent.click(deleteColumn())
    fireEvent.click(wrapper.querySelector<HTMLButtonElement>('[aria-label="确认删除列（再次点击）"]')!)
    expect(colCount()).toBe(2)
    expect(session.editor.getText()).not.toContain("r1c3")
    expect(session.editor.getText()).toContain("r1c1")

    // 删除仍是简单 undo：一步恢复整行结构
    session.editor.commands.undo()
    expect(colCount()).toBe(3)
    session.editor.commands.undo()
    expect(rowCount()).toBe(3)
    expect(session.editor.getText()).toContain("r2c2")
  })

  it("table NodeView：删除确认态在失焦、超时或其它操作时复位", () => {
    vi.useFakeTimers()
    try {
      const view = render(<NoteEditor documentId="TB4" loadKey="t6" initialDocument={textTableDocument(2, 2) as never} />)
      const session = createdSessions.at(-1)!
      const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
      const rowCount = () => session.editor.state.doc.firstChild!.childCount
      focusText(session.editor, "r1c1")
      const deleteRow = (): HTMLButtonElement => wrapper.querySelector('[aria-label="删除行"]')!

      // 失焦复位：armed 后 blur，再点击仍只是进入确认态
      fireEvent.click(deleteRow())
      expect(wrapper.querySelector(".is-confirming")).not.toBeNull()
      fireEvent.blur(wrapper.querySelector(".is-confirming")!)
      expect(wrapper.querySelector(".is-confirming")).toBeNull()
      fireEvent.click(deleteRow())
      expect(rowCount()).toBe(2)

      // 超时复位：armed 后超过 4s，确认态消失，结构不变
      fireEvent.blur(wrapper.querySelector(".is-confirming")!)
      fireEvent.click(deleteRow())
      vi.advanceTimersByTime(4500)
      expect(wrapper.querySelector(".is-confirming")).toBeNull()
      expect(rowCount()).toBe(2)

      // 其它操作复位：armed 删除行后点击添加列，确认态消失且不删除
      fireEvent.click(deleteRow())
      fireEvent.click(wrapper.querySelector('[aria-label="添加列"]')!)
      expect(wrapper.querySelector(".is-confirming")).toBeNull()
      expect(rowCount()).toBe(2)
      expect(session.editor.state.doc.firstChild!.firstChild!.childCount).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("table NodeView：确认期间选区移动取消确认，第二次点击只重新 arm、绝不删除新目标（行/列对称）", () => {
    const view = render(<NoteEditor documentId="TBD" loadKey="td1" initialDocument={textTableDocument(3, 3) as never} />)
    const session = createdSessions.at(-1)!
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
    const rowCount = () => session.editor.state.doc.firstChild!.childCount
    const colCount = () => session.editor.state.doc.firstChild!.firstChild!.childCount
    const deleteRow = (): HTMLButtonElement => wrapper.querySelector('[aria-label="删除行"]')!
    const deleteColumn = (): HTMLButtonElement => wrapper.querySelector('[aria-label="删除列"]')!

    // 行：arm 第 2 行后把选区移到第 1 行
    focusText(session.editor, "r2c2")
    fireEvent.click(deleteRow())
    expect(wrapper.querySelector(".is-confirming")).not.toBeNull()
    focusText(session.editor, "r1c1")
    // 任意 transaction（选区移动）立即取消确认
    expect(wrapper.querySelector(".is-confirming")).toBeNull()
    // 第二次点击只能重新 arm，绝不能删除新选区所在的第 1 行
    fireEvent.click(deleteRow())
    expect(rowCount()).toBe(3)
    expect(session.editor.getText()).toContain("r1c1")
    expect(session.editor.getText()).toContain("r2c2")
    expect(wrapper.querySelector(".is-confirming")).not.toBeNull()

    // 列：arm 第 2 列后把选区移到第 1 列
    focusText(session.editor, "r2c2")
    fireEvent.click(deleteColumn())
    expect(wrapper.querySelector(".is-confirming")).not.toBeNull()
    focusText(session.editor, "r2c1")
    expect(wrapper.querySelector(".is-confirming")).toBeNull()
    fireEvent.click(deleteColumn())
    expect(colCount()).toBe(3)
    expect(session.editor.getText()).toContain("r2c1")
    expect(session.editor.getText()).toContain("r2c2")
    expect(wrapper.querySelector(".is-confirming")).not.toBeNull()
  })

  it("table NodeView：Escape、外部 pointerdown、scroll、resize 均取消删除确认", () => {
    const view = render(<NoteEditor documentId="TBC" loadKey="tc1" initialDocument={textTableDocument(2, 2) as never} />)
    const session = createdSessions.at(-1)!
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
    const rowCount = () => session.editor.state.doc.firstChild!.childCount
    focusText(session.editor, "r1c1")
    const deleteRow = (): HTMLButtonElement => wrapper.querySelector('[aria-label="删除行"]')!
    const arm = (): void => {
      fireEvent.click(deleteRow())
      expect(wrapper.querySelector(".is-confirming")).not.toBeNull()
    }
    const expectCancelled = (): void => {
      expect(wrapper.querySelector(".is-confirming")).toBeNull()
      expect(rowCount()).toBe(2)
    }

    arm()
    fireEvent.keyDown(document, { key: "Escape" })
    expectCancelled()

    arm()
    fireEvent.pointerDown(document.body)
    expectCancelled()

    arm()
    fireEvent.scroll(window)
    expectCancelled()

    arm()
    fireEvent(window, new Event("resize"))
    expectCancelled()
  })

  it("table NodeView：destroy 移除全部取消监听器与确认定时器", () => {
    vi.useFakeTimers()
    const docRemove = vi.spyOn(document, "removeEventListener")
    const winRemove = vi.spyOn(window, "removeEventListener")
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")
    try {
      const view = render(<NoteEditor documentId="TBX" loadKey="tx1" initialDocument={textTableDocument(2, 2) as never} />)
      const session = createdSessions.at(-1)!
      const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
      focusText(session.editor, "r1c1")
      // arm 产生确认定时器，随后卸载触发 NodeView destroy
      fireEvent.click(wrapper.querySelector('[aria-label="删除行"]')!)
      expect(wrapper.querySelector(".is-confirming")).not.toBeNull()
      view.unmount()

      expect(docRemove).toHaveBeenCalledWith("keydown", expect.any(Function), true)
      expect(docRemove).toHaveBeenCalledWith("pointerdown", expect.any(Function), true)
      expect(winRemove).toHaveBeenCalledWith("scroll", expect.any(Function), true)
      expect(winRemove).toHaveBeenCalledWith("resize", expect.any(Function))
      expect(clearTimeoutSpy).toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  })

  it("table NodeView：选区不在本表格时禁用删除，进入本表后启用", () => {
    const view = render(<NoteEditor documentId="TB5" loadKey="t7" initialDocument={paragraphThenTableDocument() as never} />)
    const session = createdSessions.at(-1)!
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
    const deleteRow = wrapper.querySelector<HTMLButtonElement>('[aria-label="删除行"]')!
    const deleteColumn = wrapper.querySelector<HTMLButtonElement>('[aria-label="删除列"]')!

    // 初始选区在前置段落：删除入口禁用，点击无副作用
    expect(deleteRow.disabled).toBe(true)
    expect(deleteColumn.disabled).toBe(true)
    fireEvent.click(deleteRow)
    expect(wrapper.querySelector(".is-confirming")).toBeNull()

    focusText(session.editor, "表格外")
    expect(deleteRow.disabled).toBe(true)

    // 选区进入本表单元格后启用（表格单元格为空文本，直接定位首个单元格段落）
    const cellPos = posOfFirst(session.editor, "tableCell")
    expect(session.editor.commands.setTextSelection(cellPos + 2)).toBe(true)
    expect(deleteRow.disabled).toBe(false)
    expect(deleteColumn.disabled).toBe(false)

    // 选区再次离开本表后立即禁用
    focusText(session.editor, "表格外")
    expect(deleteRow.disabled).toBe(true)
    expect(deleteColumn.disabled).toBe(true)
  })

  it("table NodeView：colspan 单元格按 TableMap 逻辑宽度计算禁用态", () => {
    const view = render(<NoteEditor documentId="TB6" loadKey="t8" initialDocument={colspanTableDocument() as never} />)
    const session = createdSessions.at(-1)!
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!

    focusText(session.editor, "wide")
    // 行 childCount 为 1，但逻辑宽度是 2：删除行因逻辑高度 1 禁用，删除列保持可用
    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="删除行"]')!.disabled).toBe(true)
    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="删除列"]')!.disabled).toBe(false)
  })

  it("table NodeView：删除选区所在逻辑列会正确收缩跨列单元格", () => {
    const view = render(<NoteEditor documentId="TB61" loadKey="t81" initialDocument={spanTableDocument() as never} />)
    const session = createdSessions.at(-1)!
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!

    // 聚焦逻辑第 2 列（wide 的右半格 / b2 所在列），两次点击删除该列
    focusText(session.editor, "b2")
    const deleteColumn = wrapper.querySelector<HTMLButtonElement>('[aria-label="删除列"]')!
    fireEvent.click(deleteColumn)
    fireEvent.click(wrapper.querySelector<HTMLButtonElement>('[aria-label="确认删除列（再次点击）"]')!)

    // 逻辑宽度 3 → 2：wide 的 colspan 收缩为 1，b2 被移除，其余单元格保留
    expect(session.editor.getText()).not.toContain("b2")
    expect(session.editor.getText()).toContain("wide")
    expect(session.editor.getText()).toContain("b1")
    expect(session.editor.getText()).toContain("x2")
    const wideCell = session.editor.state.doc.firstChild!.firstChild!.firstChild!
    expect(wideCell.attrs["colspan"]).toBe(1)
    expect(session.editor.state.doc.firstChild!.childCount).toBe(2)
  })

  it("table NodeView：达到 HNN_TABLE_LIMITS 边界时禁用添加控件", () => {
    const maxRows = render(<NoteEditor documentId="TB7" loadKey="t9" initialDocument={tableDocument(64, 1) as never} />)
    const maxRowsWrapper = maxRows.container.querySelector(".hn-editor-table-wrapper")!
    // 64 行 × 1 列：行数达上限禁用添加行；加列后网格 64×2 未超限，添加列可用
    expect(maxRowsWrapper.querySelector<HTMLButtonElement>('[aria-label="添加行"]')!.disabled).toBe(true)
    expect(maxRowsWrapper.querySelector<HTMLButtonElement>('[aria-label="添加列"]')!.disabled).toBe(false)
    maxRows.unmount()

    const maxCols = render(<NoteEditor documentId="TB8" loadKey="t10" initialDocument={tableDocument(1, 64) as never} />)
    const maxColsWrapper = maxCols.container.querySelector(".hn-editor-table-wrapper")!
    expect(maxColsWrapper.querySelector<HTMLButtonElement>('[aria-label="添加列"]')!.disabled).toBe(true)
    expect(maxColsWrapper.querySelector<HTMLButtonElement>('[aria-label="添加行"]')!.disabled).toBe(false)
  })

  it("table NodeView：紧邻单元格输入后的表格操作是独立 undo step，一步 undo 只撤结构", () => {
    const view = render(<NoteEditor documentId="TB9" loadKey="t11" initialDocument={tableDocument(2, 2) as never} />)
    const session = createdSessions.at(-1)!
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
    const rowCount = () => session.editor.state.doc.firstChild!.childCount

    // 单元格输入与随后的添加行必须被 closeHistory 切分为两个 undo step
    insertIntoBlock(session.editor, "tableCell", "改")
    expect(session.editor.getText()).toContain("改")
    fireEvent.click(wrapper.querySelector('[aria-label="添加行"]')!)
    expect(rowCount()).toBe(3)

    session.editor.commands.undo()
    // 只撤销结构变更，单元格输入保留
    expect(rowCount()).toBe(2)
    expect(session.editor.getText()).toContain("改")

    session.editor.commands.undo()
    expect(session.editor.getText()).not.toContain("改")
  })

  it("table NodeView：单行单列时禁用删除行/列入口", () => {
    const view = render(<NoteEditor documentId="TB2" loadKey="t3" initialDocument={tableDocument(1, 1) as never} />)
    const wrapper = view.container.querySelector(".hn-editor-table-wrapper")!
    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="删除行"]')!.disabled).toBe(true)
    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="删除列"]')!.disabled).toBe(true)
  })
})

describe("内部 NoteEditor 自定义块界面（Phase 6.2/6.3）", () => {
  beforeEach(() => {
    createdSessions.length = 0
    drawingStub.lastValue = undefined
    drawingStub.nextValue = undefined
  })

  // 6.2 文档构造器统一使用独立 nodeId 序列（b456 变体段满足 RFC 4122 variant）
  const nid = (seq: number) => `123e4567-e89b-42d3-b456-${String(seq).padStart(12, "0")}`

  type SnapshotNode = { type?: string; attrs?: Record<string, unknown>; content?: SnapshotNode[] }

  function snapshotBlocks(changes: HnnDocument[]): SnapshotNode[] {
    return (changes.at(-1)!.data as { content: SnapshotNode[] }).content
  }

  function calloutDocument(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "callout",
          attrs: { nodeId: nid(900), tone: "info", title: "Callout" },
          content: [{ type: "paragraph", attrs: { nodeId: nid(901) }, content: [{ type: "text", text: "提示内容" }] }]
        }]
      }
    }
  }

  function collapsibleDocument(collapsed = false): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "collapsible",
          attrs: { nodeId: nid(910), title: "Details", collapsed },
          content: [{ type: "paragraph", attrs: { nodeId: nid(911) }, content: [{ type: "text", text: "折叠内容" }] }]
        }]
      }
    }
  }

  function formulaDocument(latex = "x^2"): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: { type: "doc", content: [{ type: "formula", attrs: { nodeId: nid(920), latex } }] }
    }
  }

  function inlineFormulaDocument(latex = "e^{i\\pi}"): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "paragraph",
          attrs: { nodeId: nid(930) },
          content: [
            { type: "text", text: "见 " },
            { type: "inlineFormula", attrs: { nodeId: nid(931), latex } },
            { type: "text", text: " 式" }
          ]
        }]
      }
    }
  }

  function pictureDocument(src = "https://example.com/p.png", alt = "示意图"): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: { type: "doc", content: [{ type: "picture", attrs: { nodeId: nid(940), src, alt } }] }
    }
  }

  function dataBlockDocument(kind: "card" | "drawing", data: string): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: { type: "doc", content: [{ type: kind, attrs: { nodeId: nid(950), data } }] }
    }
  }

  /** 目录块 + 一组正文 heading：目录条目必须由这些 heading 实时派生（Phase 6.4）。 */
  function directoryWithHeadingsDocument(
    headings: ReadonlyArray<{ readonly level: number; readonly text: string }>,
    config = "headings"
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [
          { type: "directory", attrs: { nodeId: nid(960), config } },
          ...headings.map((heading, index) => ({
            type: "heading",
            attrs: { nodeId: nid(980 + index), level: heading.level },
            content: [{ type: "text", text: heading.text }]
          }))
        ]
      }
    }
  }

  function inlineRefsDocument(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "paragraph",
          attrs: { nodeId: nid(970) },
          content: [
            { type: "text", text: "引用 " },
            { type: "mention", attrs: { nodeId: nid(971), resourceId: "note-42", name: "设计稿" } },
            { type: "text", text: " 与 " },
            { type: "resource", attrs: { nodeId: nid(972), resourceId: "res-7", name: "需求文档" } }
          ]
        }]
      }
    }
  }

  function externalItemDocument(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      data: { type: "doc", content: [{ type: "externalItem", attrs: { nodeId: nid(980), resourceId: "ext-9", name: "外部看板" } }] }
    }
  }

  it("callout NodeView：色调 combobox 与标题 textbox 单事务持久化、独立 undo，正文可编辑，保存重载保留", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="CB"
        loadKey="cb1"
        initialDocument={calloutDocument() as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const callout = view.container.querySelector(".hn-editor-callout")!
    const toneSelect = callout.querySelector<HTMLSelectElement>(".hn-editor-callout-tone")!
    const titleInput = callout.querySelector<HTMLInputElement>(".hn-editor-callout-title")!
    expect(toneSelect.getAttribute("aria-label")).toBe("提示类型")
    expect(titleInput.getAttribute("aria-label")).toBe("提示标题")
    expect(titleInput.value).toBe("Callout")

    // 正文走独立 contentDOM，保持 PM 可编辑
    const body = callout.querySelector(".hn-editor-callout-body")!
    expect(body.textContent).toContain("提示内容")
    insertIntoBlock(session.editor, "callout", "改")
    expect(body.textContent).toContain("改提示内容")

    fireEvent.change(toneSelect, { target: { value: "warning" } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["tone"]).toBe("warning")
    expect(callout.classList.contains("hn-editor-callout--warning")).toBe(true)
    fireEvent.change(titleInput, { target: { value: "注意" } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["title"]).toBe("注意")

    // 两次控件操作各自成为独立 undo step；验证后 redo 恢复再保存
    session.editor.commands.undo()
    expect(titleInput.value).toBe("Callout")
    expect(toneSelect.value).toBe("warning")
    session.editor.commands.undo()
    expect(toneSelect.value).toBe("info")
    session.editor.commands.redo()
    session.editor.commands.redo()
    expect(titleInput.value).toBe("注意")

    await session.save()
    view.unmount()
    const reload = render(<NoteEditor documentId="CB" loadKey="cb2" initialDocument={saved[0]!} />)
    const reloaded = reload.container.querySelector(".hn-editor-callout")!
    expect(reloaded.querySelector<HTMLSelectElement>(".hn-editor-callout-tone")!.value).toBe("warning")
    expect(reloaded.querySelector<HTMLInputElement>(".hn-editor-callout-title")!.value).toBe("注意")
  })

  it("collapsible NodeView：折叠开关 aria-expanded 与标题独立持久化，折叠隐藏正文，保存重载保留", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="CL"
        loadKey="cl1"
        initialDocument={collapsibleDocument() as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const block = view.container.querySelector(".hn-editor-collapsible")!
    const toggle = block.querySelector<HTMLButtonElement>(".hn-editor-collapsible-toggle")!
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(block.classList.contains("is-collapsed")).toBe(false)

    fireEvent.click(toggle)
    expect(snapshotBlocks(changes)[0]!.attrs?.["collapsed"]).toBe(true)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(block.classList.contains("is-collapsed")).toBe(true)

    const titleInput = block.querySelector<HTMLInputElement>(".hn-editor-collapsible-title")!
    fireEvent.change(titleInput, { target: { value: "实现细节" } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["title"]).toBe("实现细节")

    // 标题提交与折叠切换是独立 undo step；验证后 redo 恢复再保存
    session.editor.commands.undo()
    expect(titleInput.value).toBe("Details")
    session.editor.commands.undo()
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    session.editor.commands.redo()
    session.editor.commands.redo()
    expect(toggle.getAttribute("aria-expanded")).toBe("false")

    await session.save()
    view.unmount()
    const reload = render(<NoteEditor documentId="CL" loadKey="cl2" initialDocument={saved[0]!} />)
    const reloaded = reload.container.querySelector(".hn-editor-collapsible")!
    expect(reloaded.classList.contains("is-collapsed")).toBe(true)
    expect(reloaded.querySelector<HTMLInputElement>(".hn-editor-collapsible-title")!.value).toBe("实现细节")
  })

  it("formula NodeView：预览按钮打开弹出编辑器，草稿即时预览，Escape 提交并还原焦点，保存重载保留", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="F"
        loadKey="f1"
        initialDocument={formulaDocument() as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-formula-preview")!
    expect(preview.getAttribute("aria-label")).toBe("编辑公式")
    // KaTeX 渲染产物（含 application/x-tex 注解）保留原始源码
    expect(preview.textContent).toContain("x^2")

    fireEvent.click(preview)
    const popover = document.querySelector(".hn-editor-mini-popover")!
    expect(popover.getAttribute("role")).toBe("dialog")
    const textarea = popover.querySelector<HTMLTextAreaElement>(".hn-editor-mini-textarea")!
    expect(textarea.value).toBe("x^2")

    // 草稿即时更新预览，但不产生任何事务（changes 不增长）
    const before = changes.length
    fireEvent.input(textarea, { target: { value: "a+b" } })
    expect(view.container.querySelector(".hn-editor-formula-rendered")!.textContent).toContain("a+b")
    expect(changes).toHaveLength(before)

    // Escape：提交一次事务、关闭 popover、焦点还原到预览按钮（DESIGN.md §11）
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.querySelector(".hn-editor-mini-popover")).toBeNull()
    expect(document.activeElement).toBe(preview)
    expect(snapshotBlocks(changes)[0]!.attrs?.["latex"]).toBe("a+b")

    // 一次编辑会话恰好一个 undo step：撤销后回到原始源码；redo 恢复再保存
    session.editor.commands.undo()
    expect(view.container.querySelector(".hn-editor-formula-rendered")!.textContent).toContain("x^2")
    session.editor.commands.redo()
    expect(view.container.querySelector(".hn-editor-formula-rendered")!.textContent).toContain("a+b")

    await session.save()
    view.unmount()
    const reload = render(<NoteEditor documentId="F" loadKey="f2" initialDocument={saved[0]!} />)
    expect(reload.container.querySelector(".hn-editor-formula")!.textContent).toContain("a+b")
  })

  it("formula NodeView：恶意 latex 只以文本呈现，不产生任何注入元素", () => {
    const malicious = "<img src=x onerror=alert(1)>"
    const view = render(<NoteEditor documentId="FX" loadKey="fx1" initialDocument={formulaDocument(malicious) as never} />)

    const rendered = view.container.querySelector(".hn-editor-formula-rendered")!
    // KaTeX 转义 + DOMParser 解析：源码只以文本出现，绝不生成 img/script
    expect(rendered.querySelector("img, script")).toBeNull()
    expect(rendered.textContent).toContain("<img")
  })

  it("inlineFormula NodeView：行内原子随文呈现，点击打开编辑器提交 latex，undo 单步", () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor documentId="IF" loadKey="if1" initialDocument={inlineFormulaDocument() as never} onChange={(snapshot) => changes.push(snapshot)} />
    )
    const session = createdSessions.at(-1)!
    const inline = view.container.querySelector<HTMLButtonElement>(".hn-editor-inline-formula")!
    expect(inline.getAttribute("aria-label")).toBe("编辑行内公式")
    expect(inline.getAttribute("contenteditable")).toBe("false")

    fireEvent.click(inline)
    const textarea = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-popover textarea")!
    expect(textarea.value).toBe("e^{i\\pi}")
    fireEvent.input(textarea, { target: { value: "\\frac{a}{b}" } })
    // 外部 pointerdown：提交并关闭（jsdom 无 PointerEvent，用普通 Event 派发）
    fireEvent(document.body, new Event("pointerdown", { bubbles: true }))
    expect(document.querySelector(".hn-editor-mini-popover")).toBeNull()
    const paragraph = snapshotBlocks(changes)[0]!
    const inlineNode = paragraph.content?.find((child) => child.type === "inlineFormula")
    expect(inlineNode?.attrs?.["latex"]).toBe("\\frac{a}{b}")

    session.editor.commands.undo()
    let latex = ""
    session.editor.state.doc.descendants((node) => {
      if (node.type.name === "inlineFormula") latex = String(node.attrs["latex"])
    })
    expect(latex).toBe("e^{i\\pi}")
  })

  it("picture NodeView：安全 src 渲染 img，alt textbox 持久化并同步 img alt，undo 单步", () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor documentId="P2" loadKey="p2" initialDocument={pictureDocument() as never} onChange={(snapshot) => changes.push(snapshot)} />
    )
    const session = createdSessions.at(-1)!
    const figure = view.container.querySelector(".hn-editor-picture")!
    const img = figure.querySelector<HTMLImageElement>(".hn-editor-picture-img")!
    expect(img.getAttribute("src")).toBe("https://example.com/p.png")
    expect(img.hidden).toBe(false)
    const altInput = figure.querySelector<HTMLInputElement>(".hn-editor-picture-alt")!
    expect(altInput.getAttribute("aria-label")).toBe("图片描述")
    expect(altInput.value).toBe("示意图")

    fireEvent.change(altInput, { target: { value: "架构草图" } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["alt"]).toBe("架构草图")
    expect(img.alt).toBe("架构草图")

    session.editor.commands.undo()
    expect(altInput.value).toBe("示意图")
    expect(img.alt).toBe("示意图")
  })

  it("picture NodeView：运行时被写入不安全 src 时不落 img src，只显占位", () => {
    const view = render(<NoteEditor documentId="P3" loadKey="p3" initialDocument={pictureDocument() as never} />)
    const session = createdSessions.at(-1)!

    // codec 在解码时已拒绝危险 src；这里模拟运行时事务写入，渲染层必须二次设防
    const pos = posOfFirst(session.editor, "picture")
    const current = session.editor.state.doc.nodeAt(pos)!
    session.editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...current.attrs, src: "javascript:alert(1)" })
      return true
    })

    const img = view.container.querySelector<HTMLImageElement>(".hn-editor-picture-img")!
    expect(img.getAttribute("src")).toBeNull()
    expect(img.hidden).toBe(true)
    const placeholder = view.container.querySelector<HTMLElement>(".hn-editor-picture-placeholder")!
    expect(placeholder.hidden).toBe(false)
    expect(placeholder.textContent).toBe("图片不可用")
  })

  // ===== Phase 6.3 card/drawing 底部 Drawer =====

  const sampleCardPayload = JSON.stringify({
    schemaVersion: 1,
    cards: [
      { id: "card-1", title: "概览", content: "第一张", x: 0, y: 0, width: 240, height: 160 },
      { id: "card-2", title: "细节", content: "第二张", x: 280, y: 0, width: 240, height: 160, parentId: "card-1" }
    ]
  })

  const oneStrokeValue: DrawingValue = {
    strokes: [{
      id: "s1",
      tool: "pen",
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      strokeColor: "#111111",
      strokeWidth: 2
    }]
  }

  const openDrawer = (preview: HTMLElement): HTMLElement => {
    fireEvent.click(preview)
    const panel = document.querySelector<HTMLElement>(".hn-drawer__panel")!
    expect(panel).not.toBeNull()
    expect(panel.getAttribute("role")).toBe("dialog")
    expect(panel.getAttribute("aria-modal")).toBe("true")
    return panel
  }

  /** Drawer 退场动画 180ms 后才卸载 portal；关闭断言统一走 waitFor。 */
  const expectDrawerClosed = async (): Promise<void> => {
    await waitFor(() => expect(document.querySelector(".hn-drawer__panel")).toBeNull())
  }

  it("card Drawer：打开即为临时草稿，编辑与取消/Escape/backdrop 全程零事务，关闭还原焦点", async () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="CD"
        loadKey="cd1"
        theme="dark"
        initialDocument={dataBlockDocument("card", sampleCardPayload) as never}
        onChange={(snapshot) => changes.push(snapshot)}
      />
    )
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    expect(preview.getAttribute("aria-label")).toBe("编辑卡片")
    expect(preview.getAttribute("aria-haspopup")).toBe("dialog")
    expect(preview.textContent).toContain("卡片")
    expect(view.container.querySelector(".hn-editor-data-meta")!.textContent).toBe("2 张卡片")

    const closers: Array<[string, (panel: HTMLElement) => void]> = [
      ["取消按钮", (panel) => fireEvent.click(within(panel).getByText("取消"))],
      ["Escape", (panel) => fireEvent.keyDown(panel, { key: "Escape" })],
      ["backdrop pointerdown", () => fireEvent.pointerDown(document.querySelector(".hn-drawer__backdrop")!)]
    ]

    for (const [label, close] of closers) {
      const panel = openDrawer(preview)
      // 暗色主题 token 修饰类落在 Drawer 面板上（portal 在 body，拿不到 .hn-editor 祖先）
      expect(panel.classList.contains("hn-editor--dark"), label).toBe(true)
      expect(preview.getAttribute("aria-expanded"), label).toBe("true")

      // 草稿编辑不产生任何 PM 事务
      fireEvent.change(within(panel).getByLabelText("卡片 card-1 标题"), { target: { value: "临时草稿" } })
      expect(changes, label).toHaveLength(0)

      close(panel)
      await expectDrawerClosed()
      expect(changes, label).toHaveLength(0)
      expect(view.container.querySelector(".hn-editor-data-meta")!.textContent, label).toBe("2 张卡片")
      expect(preview.getAttribute("aria-expanded"), label).toBe("false")
      // DESIGN.md §15：关闭后键盘焦点还原到预览触发入口
      expect(document.activeElement, label).toBe(preview)
    }
  })

  it("card Drawer：合法完成恰好单事务并 canonical 持久化，undo/redo 独立步，保存重载保留", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="CC"
        loadKey="cc1"
        initialDocument={dataBlockDocument("card", sampleCardPayload) as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!

    const panel = openDrawer(preview)
    fireEvent.change(within(panel).getByLabelText("卡片 card-1 标题"), { target: { value: "路线图" } })
    expect(changes).toHaveLength(0)
    fireEvent.click(within(panel).getByText("完成"))
    await expectDrawerClosed()

    // 恰好一个事务：canonical JSON（固定字段顺序、minified）
    expect(changes).toHaveLength(1)
    const data = snapshotBlocks(changes)[0]!.attrs?.["data"] as string
    expect(data).toBe(JSON.stringify({
      schemaVersion: 1,
      cards: [
        { id: "card-1", title: "路线图", content: "第一张", x: 0, y: 0, width: 240, height: 160 },
        { id: "card-2", title: "细节", content: "第二张", x: 280, y: 0, width: 240, height: 160, parentId: "card-1" }
      ]
    }))

    // 原子块 NodeSelection 依旧可用
    const pos = posOfFirst(session.editor, "card")
    expect(session.editor.commands.setNodeSelection(pos)).toBe(true)
    expect(view.container.querySelector(".hn-editor-data-block")!.classList.contains("ProseMirror-selectednode")).toBe(true)

    // closeHistory 切分：一步 undo 恢复整段旧 data，redo 重放整段新 data
    session.editor.commands.undo()
    expect(session.editor.state.doc.nodeAt(pos)!.attrs["data"]).toBe(sampleCardPayload)
    session.editor.commands.redo()
    expect(session.editor.state.doc.nodeAt(pos)!.attrs["data"]).toBe(data)

    // 保存后重载：新会话 Drawer 中仍是修改后的草稿种子
    await session.save()
    expect(saved).toHaveLength(1)
    const view2 = render(<NoteEditor documentId="CC" loadKey="cc2" initialDocument={saved[0] as never} />)
    const preview2 = view2.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    const panel2 = openDrawer(preview2)
    expect((within(panel2).getByLabelText<HTMLInputElement>("卡片 card-1 标题")).value).toBe("路线图")
  })

  it("card Drawer：增删卡片与预算展示，删除时清理引用保持可提交", async () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="CA"
        loadKey="ca1"
        initialDocument={dataBlockDocument("card", sampleCardPayload) as never}
        onChange={(snapshot) => changes.push(snapshot)}
      />
    )
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    const panel = openDrawer(preview)

    // 大小预算展示（原始/序列化/上限）
    expect(panel.querySelector(".hn-editor-data-drawer-budget")!.textContent).toContain("上限 8192 字节")

    // 添加卡片：生成不冲突 id 与默认几何；草稿仍零事务
    fireEvent.click(within(panel).getByText("添加卡片"))
    expect((within(panel).getByLabelText<HTMLInputElement>("卡片 card-3 标题")).value).toBe("新卡片")
    expect(changes).toHaveLength(0)

    // 删除 card-1：card-2 对它的 parentId 引用被清理，payload 仍合法可提交
    fireEvent.click(within(panel).getByLabelText("删除卡片 card-1"))
    expect(within(panel).queryByLabelText("卡片 card-1 标题")).toBeNull()
    fireEvent.click(within(panel).getByText("完成"))
    await expectDrawerClosed()

    expect(changes).toHaveLength(1)
    const parsed = JSON.parse(snapshotBlocks(changes)[0]!.attrs?.["data"] as string) as {
      cards: Array<{ id: string; parentId?: string }>
    }
    expect(parsed.cards.map((card) => card.id)).toEqual(["card-2", "card-3"])
    expect(parsed.cards[0]!.parentId).toBeUndefined()
  })

  it("card Drawer：原始/转义超 attr 预算与整文档 shell 预检失败都不提交，Drawer 保持开启且草稿保留", async () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="CO"
        loadKey="co1"
        initialDocument={dataBlockDocument("card", sampleCardPayload) as never}
        onChange={(snapshot) => changes.push(snapshot)}
      />
    )
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    const panel = openDrawer(preview)
    const content = within(panel).getByLabelText<HTMLTextAreaElement>("卡片 card-1 内容")
    const alert = panel.querySelector(".hn-editor-data-drawer-error")!
    const finish = () => fireEvent.click(within(panel).getByText("完成"))

    // 原始 UTF-8 超 8192：预算行提示超限；完成被拒、保持开启、草稿保留
    fireEvent.change(content, { target: { value: "x".repeat(9000) } })
    expect(panel.querySelector(".hn-editor-data-drawer-budget")!.textContent).toContain("已超限")
    finish()
    expect(changes).toHaveLength(0)
    expect(alert.getAttribute("role")).toBe("alert")
    expect(alert.textContent).toContain("/cards/0/content")
    expect(alert.textContent).toContain("8192")
    expect(document.querySelector(".hn-drawer__panel")).not.toBeNull()
    expect(content.value).toBe("x".repeat(9000))

    // 原始未超但序列化后超（双重预算）：content 3000 个引号 → data 原始约 6.2KB ≤ 8192，
    // 但 data 作为 HNN attr 再序列化时每个 \" 变 \\\" → 约 12KB > 8192，同样拒绝
    fireEvent.change(content, { target: { value: "\"".repeat(3000) } })
    finish()
    expect(changes).toHaveLength(0)
    expect(alert.textContent).toContain("序列化")

    // 合法 attr 但整文档 shell 预检失败（encodeHnn 抛错一次）：不 dispatch、保持开启
    fireEvent.change(content, { target: { value: "短内容" } })
    mockedEncodeHnn.mockImplementationOnce(() => { throw new Error("shell 预算超限") })
    finish()
    expect(changes).toHaveLength(0)
    expect(alert.textContent).toContain("shell 预算超限")
    expect(document.querySelector(".hn-drawer__panel")).not.toBeNull()

    // 预检恢复后同一草稿可正常提交
    finish()
    await expectDrawerClosed()
    expect(changes).toHaveLength(1)
    const parsed = JSON.parse(snapshotBlocks(changes)[0]!.attrs?.["data"] as string) as { cards: Array<{ content: string }> }
    expect(parsed.cards[0]!.content).toBe("短内容")
  })

  it("card Drawer：非法既有 payload 只读保护，取消原样保留、绝不自动重置", async () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="CI"
        loadKey="ci1"
        initialDocument={dataBlockDocument("card", "[1,2,3]") as never}
        onChange={(snapshot) => changes.push(snapshot)}
      />
    )
    const session = createdSessions.at(-1)!
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    expect(view.container.querySelector(".hn-editor-data-meta")!.textContent).toBe("数据无效")

    const panel = openDrawer(preview)
    expect(panel.textContent).toContain("已有数据无效")
    const raw = within(panel).getByLabelText<HTMLTextAreaElement>("原始数据（只读）")
    expect(raw.value).toBe("[1,2,3]")
    expect(raw.readOnly).toBe(true)
    // 只读模式不提供完成按钮：非法旧数据不可能被覆盖为空卡片
    expect(within(panel).queryByText("完成")).toBeNull()

    fireEvent.click(within(panel).getByText("取消"))
    await expectDrawerClosed()
    expect(changes).toHaveLength(0)
    const pos = posOfFirst(session.editor, "card")
    expect(session.editor.state.doc.nodeAt(pos)!.attrs["data"]).toBe("[1,2,3]")
    expect(view.container.querySelector(".hn-editor-data-meta")!.textContent).toBe("数据无效")
  })

  it("drawing Drawer：DrawingSurface 草稿零事务，完成单事务 canonical 持久化，undo/redo/保存重载", async () => {
    drawingStub.nextValue = oneStrokeValue
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="DR"
        loadKey="dr1"
        initialDocument={dataBlockDocument("drawing", "{\"strokes\":[]}") as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const block = view.container.querySelector(".hn-editor-data-block--drawing")!
    const preview = block.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    expect(preview.getAttribute("aria-label")).toBe("编辑画板")
    expect(preview.textContent).toContain("画板")
    expect(block.querySelector(".hn-editor-data-meta")!.textContent).toBe("0 条笔画")

    const panel = openDrawer(preview)
    expect(within(panel).getByRole("toolbar", { name: "画板工具" })).not.toBeNull()
    // 画布绘制只更新 React 草稿：零 PM 事务
    fireEvent.click(within(panel).getByTestId("drawing-surface-stub"))
    expect(changes).toHaveLength(0)

    fireEvent.click(within(panel).getByText("完成"))
    await expectDrawerClosed()
    expect(changes).toHaveLength(1)
    const data = snapshotBlocks(changes)[0]!.attrs?.["data"] as string
    const parsed = JSON.parse(data) as { schemaVersion: number; strokes: Array<{ id: string }> }
    expect(parsed.schemaVersion).toBe(2)
    expect(parsed.strokes[0]!.id).toBe("s1")

    const pos = posOfFirst(session.editor, "drawing")
    session.editor.commands.undo()
    expect(session.editor.state.doc.nodeAt(pos)!.attrs["data"]).toBe("{\"strokes\":[]}")
    session.editor.commands.redo()
    expect(session.editor.state.doc.nodeAt(pos)!.attrs["data"]).toBe(data)

    await session.save()
    expect(saved).toHaveLength(1)
    // 保存重载：DrawingSurface 收到的受控 value 含持久化的笔画
    const view2 = render(<NoteEditor documentId="DR" loadKey="dr2" initialDocument={saved[0] as never} />)
    openDrawer(view2.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!)
    expect((drawingStub.lastValue as { strokes: Array<{ id: string }> }).strokes[0]!.id).toBe("s1")
  })

  it("drawing Drawer：超限草稿不提交保持开启，非法旧 data 只读保护", async () => {
    // 129 条笔画 > MAX_STROKES(128)：prepare 拒绝
    drawingStub.nextValue = {
      strokes: Array.from({ length: 129 }, (_, index) => ({ id: `s${index}`, tool: "pen", points: [{ x: 0, y: 0 }] }))
    }
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="DO"
        loadKey="do1"
        initialDocument={dataBlockDocument("drawing", "{\"strokes\":[]}") as never}
        onChange={(snapshot) => changes.push(snapshot)}
      />
    )
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    const panel = openDrawer(preview)
    fireEvent.click(within(panel).getByTestId("drawing-surface-stub"))
    fireEvent.click(within(panel).getByText("完成"))
    expect(changes).toHaveLength(0)
    const alert = panel.querySelector(".hn-editor-data-drawer-error")!
    expect(alert.getAttribute("role")).toBe("alert")
    expect(alert.textContent).toContain("strokes")
    expect(document.querySelector(".hn-drawer__panel")).not.toBeNull()
    fireEvent.click(within(panel).getByText("取消"))
    await expectDrawerClosed()

    // 非法旧 data：只读展示 + 取消保留，attr 原样不动
    const changes2: HnnDocument[] = []
    const view2 = render(
      <NoteEditor
        documentId="DI"
        loadKey="di1"
        initialDocument={dataBlockDocument("drawing", "{\"strokes\":{}}") as never}
        onChange={(snapshot) => changes2.push(snapshot)}
      />
    )
    const session2 = createdSessions.at(-1)!
    const preview2 = view2.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    expect(view2.container.querySelector(".hn-editor-data-meta")!.textContent).toBe("数据无效")
    const panel2 = openDrawer(preview2)
    expect((within(panel2).getByLabelText<HTMLTextAreaElement>("原始数据（只读）")).value).toBe("{\"strokes\":{}}")
    expect(within(panel2).queryByText("完成")).toBeNull()
    fireEvent.click(within(panel2).getByText("取消"))
    await expectDrawerClosed()
    expect(changes2).toHaveLength(0)
    const pos = posOfFirst(session2.editor, "drawing")
    expect(session2.editor.state.doc.nodeAt(pos)!.attrs["data"]).toBe("{\"strokes\":{}}")
  })

  it("Drawer 随会话卸载清理 portal 与 bridge 注册，新会话可重新打开", () => {
    const view = render(
      <NoteEditor documentId="CL" loadKey="cl1" initialDocument={dataBlockDocument("card", sampleCardPayload) as never} />
    )
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    openDrawer(preview)
    expect(document.querySelector(".hn-drawer__panel")).not.toBeNull()

    view.unmount()
    expect(document.querySelector(".hn-drawer__panel")).toBeNull()
    expect(document.querySelector(".hn-drawer__backdrop")).toBeNull()

    const view2 = render(
      <NoteEditor documentId="CL" loadKey="cl2" initialDocument={dataBlockDocument("card", sampleCardPayload) as never} />
    )
    const preview2 = view2.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    const panel2 = openDrawer(preview2)
    expect((within(panel2).getByLabelText<HTMLInputElement>("卡片 card-1 标题")).value).toBe("概览")
  })

  it("会话切换 A→B：A 已开 Drawer 的 portal/草稿/request/anchor 整体丢弃，不提交 A、不触发旧保存、焦点不回旧 anchor，B 可开新 Drawer", async () => {
    const changesA: HnnDocument[] = []
    const savesA: string[] = []
    const onSaveA: NoteSave = (_snapshot, context) => {
      savesA.push(context.documentId)
      return Promise.resolve({ kind: "saved" as const })
    }
    const view = render(
      <NoteEditor
        documentId="SWA"
        loadKey="swa1"
        initialDocument={dataBlockDocument("card", sampleCardPayload) as never}
        onSave={onSaveA}
        onChange={(snapshot) => changesA.push(snapshot)}
      />
    )
    const aSession = createdSessions.at(-1)!
    const previewA = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    const panelA = openDrawer(previewA)
    // A 的临时草稿：编辑全程零事务
    fireEvent.change(within(panelA).getByLabelText("卡片 card-1 标题"), { target: { value: "A 的未提交草稿" } })
    expect(changesA).toHaveLength(0)
    expect(document.querySelector(".hn-drawer__panel")).not.toBeNull()

    // A→B 会话切换（B 携带不同卡片标题，用于识别草稿串扰）
    const payloadB = JSON.stringify({
      schemaVersion: 1,
      cards: [{ id: "card-1", title: "B 的卡片", content: "乙", x: 0, y: 0, width: 240, height: 160 }]
    })
    const changesB: HnnDocument[] = []
    view.rerender(
      <NoteEditor
        documentId="SWB"
        loadKey="swb1"
        initialDocument={dataBlockDocument("card", payloadB)}
        onChange={(snapshot) => changesB.push(snapshot)}
      />
    )

    // portal/backdrop 随卸载立即移除；A 草稿被丢弃，从未提交、从未触发 A 保存
    expect(document.querySelector(".hn-drawer__panel")).toBeNull()
    expect(document.querySelector(".hn-drawer__backdrop")).toBeNull()
    expect(changesA).toHaveLength(0)
    // 让任何潜在的在途保存/微任务结算后再断言：切换不触发旧保存
    await waitFor(() => expect(createdSessions.length).toBeGreaterThanOrEqual(2))
    expect(savesA).toHaveLength(0)
    expect(aSession.editor.isDestroyed).toBe(true)

    // A 的 anchor 已随旧会话断开，焦点绝不可回到它
    expect(previewA.isConnected).toBe(false)
    expect(document.activeElement).not.toBe(previewA)

    // B 是全新编辑器实例，可打开自己的新 Drawer，且不残留 A 的草稿
    const previewB = view.container.querySelector<HTMLButtonElement>(".hn-editor-data-preview")!
    expect(previewB).not.toBe(previewA)
    const panelB = openDrawer(previewB)
    expect((within(panelB).getByLabelText<HTMLInputElement>("卡片 card-1 标题")).value).toBe("B 的卡片")
    expect(within(panelB).queryByDisplayValue("A 的未提交草稿")).toBeNull()

    // B 内正常完成：恰好一个事务落到 B，与 A 无关
    fireEvent.change(within(panelB).getByLabelText("卡片 card-1 标题"), { target: { value: "B 已保存" } })
    fireEvent.click(within(panelB).getByText("完成"))
    expect(changesB).toHaveLength(1)
    expect(changesA).toHaveLength(0)
    expect(savesA).toHaveLength(0)
    await expectDrawerClosed()
    const bSession = createdSessions.at(-1)!
    expect(bSession.editor.state.doc.nodeAt(posOfFirst(bSession.editor, "card"))!.attrs["data"]).toContain("B 已保存")
  })

  it("canonical 默认 payload 的新 card/drawing 节点可直接打开编辑（非只读）", async () => {
    // card：HNN_CARD_EMPTY_DATA 打开即为可编辑空卡片列表
    const cardChanges: HnnDocument[] = []
    const cardView = render(
      <NoteEditor
        documentId="EDC"
        loadKey="edc1"
        initialDocument={dataBlockDocument("card", HNN_CARD_EMPTY_DATA) as never}
        onChange={(snapshot) => cardChanges.push(snapshot)}
      />
    )
    const cardPanel = openDrawer(cardView.container.querySelector<HTMLElement>(".hn-editor-data-preview")!)
    expect(cardPanel.textContent).not.toContain("已有数据无效")
    fireEvent.click(within(cardPanel).getByText("添加卡片"))
    expect(within(cardPanel).getByLabelText<HTMLInputElement>("卡片 card-1 标题").value).toBe("新卡片")
    fireEvent.click(within(cardPanel).getByText("完成"))
    expect(cardChanges).toHaveLength(1)
    await expectDrawerClosed()
    cardView.unmount()

    // drawing：HNN_DRAWING_EMPTY_DATA 打开即为可绘制的空画布
    const drawingChanges: HnnDocument[] = []
    const drawingView = render(
      <NoteEditor
        documentId="EDD"
        loadKey="edd1"
        initialDocument={dataBlockDocument("drawing", HNN_DRAWING_EMPTY_DATA) as never}
        onChange={(snapshot) => drawingChanges.push(snapshot)}
      />
    )
    const drawingPanel = openDrawer(drawingView.container.querySelector<HTMLElement>(".hn-editor-data-preview")!)
    expect(drawingPanel.textContent).not.toContain("已有数据无效")
    expect(within(drawingPanel).queryByText("完成")).not.toBeNull()
    drawingStub.nextValue = oneStrokeValue
    fireEvent.click(within(drawingPanel).getByTestId("drawing-surface-stub"))
    fireEvent.click(within(drawingPanel).getByText("完成"))
    expect(drawingChanges).toHaveLength(1)
    await expectDrawerClosed()
    const session = createdSessions.at(-1)!
    expect(session.editor.state.doc.nodeAt(posOfFirst(session.editor, "drawing"))!.attrs["data"]).toContain("s1")
  })

  it("directory NodeView：只读展示 config 与派生条目，无编辑控件，可整体 NodeSelection", () => {
    const view = render(
      <NoteEditor
        documentId="D2"
        loadKey="d2"
        initialDocument={directoryWithHeadingsDocument([{ level: 1, text: "概览" }], "all") as never}
      />
    )
    const session = createdSessions.at(-1)!
    const directory = view.container.querySelector<HTMLElement>(".hn-editor-directory")!
    expect(directory.getAttribute("role")).toBe("group")
    expect(directory.getAttribute("aria-label")).toBe("目录")
    expect(directory.textContent).toContain("配置：all")
    // 条目为只读定位按钮，不存在任何表单编辑控件
    expect(directory.querySelector("input, textarea, select")).toBeNull()
    const entry = directory.querySelector<HTMLButtonElement>(".hn-editor-directory-entry")!
    expect(entry.type).toBe("button")
    expect(entry.textContent).toBe("概览")

    // 原子块可整体选中
    const pos = posOfFirst(session.editor, "directory")
    expect(session.editor.commands.setNodeSelection(pos)).toBe(true)
    expect(directory.classList.contains("ProseMirror-selectednode")).toBe(true)
  })

  it("directory 条目实时派生：heading 增/改/删立即更新，无 heading 时显示空态", () => {
    const view = render(
      <NoteEditor
        documentId="D3"
        loadKey="d3"
        initialDocument={directoryWithHeadingsDocument([
          { level: 1, text: "概览" },
          { level: 2, text: "细节" }
        ]) as never}
      />
    )
    const session = createdSessions.at(-1)!
    const directory = view.container.querySelector<HTMLElement>(".hn-editor-directory")!
    const texts = () => Array.from(directory.querySelectorAll(".hn-editor-directory-entry")).map((el) => el.textContent)
    const levels = () => Array.from(directory.querySelectorAll(".hn-editor-directory-item")).map((el) => el.getAttribute("data-level"))
    const deleteHeading = (text: string): void => {
      let target = -1
      session.editor.state.doc.descendants((node, p) => {
        if (node.type.name === "heading" && node.textContent === text) target = p
      })
      if (target < 0) throw new Error(`未找到 heading：${text}`)
      session.editor.chain().setNodeSelection(target).deleteSelection().run()
    }

    expect(texts()).toEqual(["概览", "细节"])
    expect(levels()).toEqual(["1", "2"])

    // 改：重命名第一个 heading，条目立即跟随
    const pos = posOfFirst(session.editor, "heading")
    session.editor.chain().setTextSelection({ from: pos + 1, to: pos + 1 + "概览".length }).insertContent("总览").run()
    expect(texts()).toEqual(["总览", "细节"])

    // 增：文末插入新 heading（nodeId 由插件自动分配），条目立即出现
    session.editor.chain().focus("end").insertContent({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "附录" }]
    }).run()
    expect(texts()).toEqual(["总览", "细节", "附录"])
    expect(levels()).toEqual(["1", "2", "3"])

    // 删：删除中间 heading，条目立即消失
    deleteHeading("细节")
    expect(texts()).toEqual(["总览", "附录"])

    // 全部删除：显示空态而非陈旧条目
    deleteHeading("总览")
    deleteHeading("附录")
    expect(directory.querySelector(".hn-editor-directory-entry")).toBeNull()
    expect(directory.querySelector(".hn-editor-directory-empty")!.textContent).toBe("暂无标题")
  })

  it("directory 条目绝不持久化：attrs 仅 nodeId/config，保存后重载由 heading 重新派生", () => {
    const view = render(
      <NoteEditor
        documentId="D4"
        loadKey="d4"
        initialDocument={directoryWithHeadingsDocument([
          { level: 1, text: "甲" },
          { level: 2, text: "乙" }
        ]) as never}
      />
    )
    const session = createdSessions.at(-1)!
    const directoryJson = (snapshot: HnnDocument): Record<string, unknown> => {
      const blocks = (snapshot.data as { content: Array<{ type: string; attrs?: Record<string, unknown> }> }).content
      const directoryNode = blocks.find((block) => block.type === "directory")
      if (!directoryNode?.attrs) throw new Error("快照中未找到 directory 节点")
      return directoryNode.attrs
    }

    // 序列化只携带 nodeId/config：没有 entries，也没有任何 heading 文本快照
    const attrs = directoryJson(encodeHnn(session.editor.state.doc))
    expect(Object.keys(attrs).sort()).toEqual(["config", "nodeId"])
    expect(JSON.stringify(attrs)).not.toContain("entries")
    expect(JSON.stringify(attrs)).not.toContain("甲")

    // 改标题后保存 → 重载的目录由新 heading 重新派生，而非恢复陈旧快照
    const pos = posOfFirst(session.editor, "heading")
    session.editor.chain().setTextSelection({ from: pos + 1, to: pos + 2 }).insertContent("丙").run()
    const saved = encodeHnn(session.editor.state.doc)
    expect(Object.keys(directoryJson(saved)).sort()).toEqual(["config", "nodeId"])
    view.unmount()

    const reload = render(<NoteEditor documentId="D4" loadKey="d4r" initialDocument={saved as never} />)
    const entries = Array.from(reload.container.querySelectorAll(".hn-editor-directory-entry")).map((el) => el.textContent)
    expect(entries).toEqual(["丙", "乙"])
  })

  it("directory 条目点击：纯 DOM 定位/高亮 heading，零 PM 事务、零 history、不置脏", () => {
    // jsdom 未实现 scrollIntoView：以 prototype mock 断言定位目标
    // （经属性函数签名存取，方法声明不含 this 依赖）
    const proto = Element.prototype as { scrollIntoView?: (options?: ScrollIntoViewOptions) => void }
    const original = proto.scrollIntoView
    const scrollSpy = vi.fn()
    proto.scrollIntoView = scrollSpy
    try {
      const changes: HnnDocument[] = []
      const view = render(
        <NoteEditor
          documentId="D5"
          loadKey="d5"
          initialDocument={directoryWithHeadingsDocument([
            { level: 1, text: "概览" },
            { level: 2, text: "细节" }
          ]) as never}
          onChange={(snapshot) => changes.push(snapshot)}
        />
      )
      const session = createdSessions.at(-1)!
      const directory = view.container.querySelector<HTMLElement>(".hn-editor-directory")!
      const heading = view.container.querySelector("h2")!
      expect(heading.textContent).toBe("细节")

      const baseline = session.editor.state.doc
      fireEvent.click(within(directory).getByRole("button", { name: "细节" }))

      // 定位：scrollIntoView 作用于对应 heading DOM，并附加临时高亮 class
      expect(scrollSpy).toHaveBeenCalledTimes(1)
      expect(scrollSpy.mock.instances[0]).toBe(heading)
      expect(heading.classList.contains("hn-editor-directory-target")).toBe(true)

      // 零 PM 事务：doc 引用不变、无 onChange 快照、无 undo 步骤、不置脏
      expect(session.editor.state.doc).toBe(baseline)
      expect(changes).toHaveLength(0)
      expect(session.editor.can().undo()).toBe(false)
      expect(session.state.dirty).toBe(false)

      // 再次点击另一条目：高亮转移到新目标，仍零事务
      const first = view.container.querySelector("h1")!
      fireEvent.click(within(directory).getByRole("button", { name: "概览" }))
      expect(scrollSpy).toHaveBeenCalledTimes(2)
      expect(scrollSpy.mock.instances[1]).toBe(first)
      expect(first.classList.contains("hn-editor-directory-target")).toBe(true)
      expect(heading.classList.contains("hn-editor-directory-target")).toBe(false)
      expect(session.editor.state.doc).toBe(baseline)
      expect(changes).toHaveLength(0)
    } finally {
      if (original === undefined) delete proto.scrollIntoView
      else proto.scrollIntoView = original
    }
  })

  it("directory 高亮生命周期：任意 editor update 先清高亮与 timer 再重派生（fake timer）", () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="D6"
        loadKey="d6"
        initialDocument={directoryWithHeadingsDocument([
          { level: 1, text: "概览" },
          { level: 2, text: "细节" }
        ]) as never}
        onChange={(snapshot) => changes.push(snapshot)}
      />
    )
    const session = createdSessions.at(-1)!
    const directory = view.container.querySelector<HTMLElement>(".hn-editor-directory")!
    // 文本/结构/level 事务可能让 PM 重建或换标签（h2→h3），高亮检查按文本取实时 DOM
    const liveHeading = (text: string) =>
      Array.from(view.container.querySelectorAll("h1,h2,h3,h4,h5,h6")).find((el) => el.textContent === text)
    const isHighlighted = (text: string) => liveHeading(text)?.classList.contains("hn-editor-directory-target") ?? false
    const findHeading = (text: string): number => {
      let target = -1
      session.editor.state.doc.descendants((node, p) => {
        if (node.type.name === "heading" && node.textContent === text) target = p
      })
      if (target < 0) throw new Error(`未找到 heading：${text}`)
      return target
    }
    const baseline = session.editor.state.doc

    // 渲染完成后再启用 fake timer，避免装配期调度干扰计时器计数
    vi.useFakeTimers()
    // PM 在文本事务中会自调度计时器，绝对计数不可靠；以 clearTimeout spy
    // 佐证高亮 timer 被清理（主要断言是 class 移除与迟到 timer 行为探针）。
    const clearSpy = vi.spyOn(globalThis, "clearTimeout")
    try {
      const timerBase = vi.getTimerCount()

      // 点击条目：高亮 + 恰好一个 1.5s timer；点击本身零事务
      fireEvent.click(within(directory).getByRole("button", { name: "细节" }))
      expect(isHighlighted("细节")).toBe(true)
      expect(vi.getTimerCount()).toBe(timerBase + 1)
      expect(session.editor.state.doc).toBe(baseline)
      expect(changes).toHaveLength(0)
      expect(session.editor.can().undo()).toBe(false)
      expect(session.state.dirty).toBe(false)

      // heading 文本编辑（用户事务）→ update：先撤高亮、清 timer，再重派生
      clearSpy.mockClear()
      const detailPos = findHeading("细节")
      session.editor.chain().setTextSelection({ from: detailPos + 1, to: detailPos + 1 + "细节".length }).insertContent("细目").run()
      expect(isHighlighted("细目")).toBe(false)
      expect(clearSpy).toHaveBeenCalled()
      // timer 已清：推进时间不再触碰任何 DOM；再次点击后新 timer 正常到期自撤
      vi.advanceTimersByTime(2000)
      expect(isHighlighted("细目")).toBe(false)
      fireEvent.click(within(directory).getByRole("button", { name: "细目" }))
      expect(isHighlighted("细目")).toBe(true)
      vi.advanceTimersByTime(1500)
      expect(isHighlighted("细目")).toBe(false)

      // level 变更同样先清高亮/timer，重派生后 data-level 跟随
      fireEvent.click(within(directory).getByRole("button", { name: "细目" }))
      expect(isHighlighted("细目")).toBe(true)
      clearSpy.mockClear()
      const current = session.editor.state.doc.nodeAt(findHeading("细目"))!
      session.editor.commands.command(({ tr }) => {
        tr.setNodeMarkup(findHeading("细目"), undefined, { ...current.attrs, level: 3 })
        return true
      })
      expect(isHighlighted("细目")).toBe(false)
      expect(clearSpy).toHaveBeenCalled()
      expect(directory.querySelector('.hn-editor-directory-item[data-level="3"] .hn-editor-directory-entry')!.textContent).toBe("细目")

      // heading 删除：即便目标 DOM 已脱离文档，高亮与 timer 也立即清理
      fireEvent.click(within(directory).getByRole("button", { name: "细目" }))
      expect(isHighlighted("细目")).toBe(true)
      const doomed = liveHeading("细目")!
      clearSpy.mockClear()
      session.editor.chain().setNodeSelection(findHeading("细目")).deleteSelection().run()
      expect(liveHeading("细目")).toBeUndefined()
      expect(doomed.classList.contains("hn-editor-directory-target")).toBe(false)
      expect(clearSpy).toHaveBeenCalled()
      vi.advanceTimersByTime(2000)
      expect(doomed.classList.contains("hn-editor-directory-target")).toBe(false)
      expect(within(directory).queryByRole("button", { name: "细目" })).toBeNull()
    } finally {
      clearSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it("directory 高亮 timer 不越界：删除 directory 或切换 session 后运行 timer 不触旧 DOM", () => {
    // 路径一：删除 directory 节点 → NodeView destroy 清理高亮与 timer
    const view = render(
      <NoteEditor
        documentId="D7"
        loadKey="d7"
        initialDocument={directoryWithHeadingsDocument([{ level: 1, text: "概览" }]) as never}
      />
    )
    const session = createdSessions.at(-1)!
    const directory = view.container.querySelector<HTMLElement>(".hn-editor-directory")!
    const heading = view.container.querySelector("h1")!
    vi.useFakeTimers()
    try {
      fireEvent.click(within(directory).getByRole("button", { name: "概览" }))
      expect(heading.classList.contains("hn-editor-directory-target")).toBe(true)

      session.editor.chain().setNodeSelection(posOfFirst(session.editor, "directory")).deleteSelection().run()
      expect(view.container.querySelector(".hn-editor-directory")).toBeNull()
      expect(heading.classList.contains("hn-editor-directory-target")).toBe(false)
      // 无残留 timer：推进时间不触已卸载的旧 DOM
      vi.advanceTimersByTime(2000)
      expect(heading.classList.contains("hn-editor-directory-target")).toBe(false)
    } finally {
      vi.useRealTimers()
    }
    view.unmount()

    // 路径二：session 切换 A→B → A 的 NodeView destroy 清理；迟到的 timer 不得复活旧 DOM
    const docA = directoryWithHeadingsDocument([{ level: 1, text: "概览" }])
    const docB = directoryWithHeadingsDocument([{ level: 1, text: "乙章" }])
    const viewA = render(<NoteEditor documentId="D8A" loadKey="d8a" initialDocument={docA as never} />)
    const directoryA = viewA.container.querySelector<HTMLElement>(".hn-editor-directory")!
    const headingA = viewA.container.querySelector("h1")!
    vi.useFakeTimers()
    try {
      fireEvent.click(within(directoryA).getByRole("button", { name: "概览" }))
      expect(headingA.classList.contains("hn-editor-directory-target")).toBe(true)

      viewA.rerender(<NoteEditor documentId="D8B" loadKey="d8b" initialDocument={docB} />)
      // A 的高亮已随 destroy 撤下（A 的 DOM 已脱离，断言读取的是保留的元素引用）
      expect(headingA.classList.contains("hn-editor-directory-target")).toBe(false)
      vi.advanceTimersByTime(2000)
      expect(headingA.classList.contains("hn-editor-directory-target")).toBe(false)

      // B 的目录用自己的 heading 重新派生，互不受旧 timer 影响
      const directoryB = viewA.container.querySelector<HTMLElement>(".hn-editor-directory")!
      expect(within(directoryB).getByRole("button", { name: "乙章" })).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("mention/resource NodeView：宿主引用 pill 如实呈现并携带资源标识，可 NodeSelection", () => {
    const view = render(<NoteEditor documentId="MR" loadKey="mr1" initialDocument={inlineRefsDocument() as never} />)
    const session = createdSessions.at(-1)!
    const mention = view.container.querySelector(".hn-editor-mention")!
    expect(mention.textContent).toBe("@设计稿")
    expect(mention.getAttribute("data-note-link-id")).toBe("note-42")
    const resource = view.container.querySelector(".hn-editor-resource")!
    expect(resource.textContent).toBe("需求文档")
    expect(resource.getAttribute("data-resource-id")).toBe("res-7")

    // 行内原子节点整体可选中
    const pos = posOfFirst(session.editor, "mention")
    expect(session.editor.commands.setNodeSelection(pos)).toBe(true)
    expect(mention.classList.contains("ProseMirror-selectednode")).toBe(true)
  })

  it("externalItem NodeView：虚线下划线呈现宿主引用，无内嵌编辑控件，NodeSelection 整块删除", () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor documentId="EX" loadKey="ex1" initialDocument={externalItemDocument() as never} onChange={(snapshot) => changes.push(snapshot)} />
    )
    const session = createdSessions.at(-1)!
    const item = view.container.querySelector(".hn-editor-external-item")!
    expect(item.querySelector(".hn-editor-external-item-name")!.textContent).toBe("外部看板")
    expect(item.getAttribute("data-resource-id")).toBe("ext-9")
    expect(item.querySelector("input, textarea, select")).toBeNull()

    // 原子块：NodeSelection 选中后一次删除整块
    const pos = posOfFirst(session.editor, "externalItem")
    expect(session.editor.commands.setNodeSelection(pos)).toBe(true)
    expect(item.classList.contains("ProseMirror-selectednode")).toBe(true)
    expect(session.editor.commands.deleteSelection()).toBe(true)
    expect(snapshotBlocks(changes).some((block) => block.type === "externalItem")).toBe(false)
  })

  it("callout 标题按 UTF-8 字节精确限长：边界值提交，超限零事务、恢复最近持久值并给出可访问错误", () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor documentId="CBL" loadKey="cbl1" initialDocument={calloutDocument() as never} onChange={(snapshot) => changes.push(snapshot)} />
    )
    const titleInput = view.container.querySelector<HTMLInputElement>(".hn-editor-callout-title")!
    const error = view.container.querySelector(".hn-editor-callout .hn-editor-field-error")!

    // 170 个汉字（510 字节）+ 2 个 ASCII = 恰好 512 字节（maxLabelBytes）：允许提交
    fireEvent.change(titleInput, { target: { value: `${"汉".repeat(170)}ab` } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["title"]).toBe(`${"汉".repeat(170)}ab`)
    expect(error.textContent).toBe("")

    // 171 个汉字 = 513 字节：零事务、输入恢复最近持久值、role=alert 播报字节上限
    const before = changes.length
    fireEvent.change(titleInput, { target: { value: "汉".repeat(171) } })
    expect(changes).toHaveLength(before)
    expect(titleInput.value).toBe(`${"汉".repeat(170)}ab`)
    expect(error.getAttribute("role")).toBe("alert")
    expect(error.textContent).toContain("512")

    // 再次输入（合法值）即清除错误提示
    fireEvent.input(titleInput, { target: { value: "汉" } })
    expect(error.textContent).toBe("")
  })

  it("picture 描述超限零事务、恢复最近持久值、给出可访问错误", () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor documentId="PL" loadKey="pl1" initialDocument={pictureDocument() as never} onChange={(snapshot) => changes.push(snapshot)} />
    )
    const altInput = view.container.querySelector<HTMLInputElement>(".hn-editor-picture-alt")!
    const error = view.container.querySelector(".hn-editor-picture .hn-editor-field-error")!

    fireEvent.change(altInput, { target: { value: "图".repeat(171) } })
    expect(changes).toHaveLength(0)
    expect(altInput.value).toBe("示意图")
    expect(error.getAttribute("role")).toBe("alert")
    expect(error.textContent).toContain("512")
  })

  it("formula 编辑器：latex 超限时关闭不提交，预览恢复持久值，文档保持可保存", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="FL"
        loadKey="fl1"
        initialDocument={formulaDocument() as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-formula-preview")!

    fireEvent.click(preview)
    const textarea = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-popover textarea")!
    // 8193 个 ASCII = 8193 字节，超过 maxAttrBytes(8192)
    fireEvent.input(textarea, { target: { value: "x".repeat(8193) } })
    expect(view.container.querySelector(".hn-editor-formula-rendered")!.textContent?.length).toBeGreaterThan(8000)

    const before = changes.length
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.querySelector(".hn-editor-mini-popover")).toBeNull()
    expect(changes).toHaveLength(before)
    // 预览恢复最近持久值；可访问错误提示字节上限
    expect(view.container.querySelector(".hn-editor-formula-rendered")!.textContent).toContain("x^2")
    const error = view.container.querySelector(".hn-editor-formula .hn-editor-field-error")!
    expect(error.getAttribute("role")).toBe("alert")
    expect(error.textContent).toContain("8192")

    // 失败未污染文档：会话仍可直接保存，快照保持原始 latex
    await session.save()
    expect((saved[0]!.data as { content: SnapshotNode[] }).content[0]!.attrs?.["latex"]).toBe("x^2")
  })

  it("有效修改后清空 title/alt 恢复最近持久值而非初始值", () => {
    // callout：先有效提交“注意”，再清空 → 恢复“注意”而不是初始“Callout”
    const viewA = render(<NoteEditor documentId="R1" loadKey="r1" initialDocument={calloutDocument() as never} />)
    const titleInput = viewA.container.querySelector<HTMLInputElement>(".hn-editor-callout-title")!
    fireEvent.change(titleInput, { target: { value: "注意" } })
    expect(titleInput.value).toBe("注意")
    fireEvent.change(titleInput, { target: { value: "" } })
    expect(titleInput.value).toBe("注意")

    // collapsible：先有效提交“实现细节”，再清空 → 恢复“实现细节”而不是初始“Details”
    const viewB = render(<NoteEditor documentId="R2" loadKey="r2" initialDocument={collapsibleDocument() as never} />)
    const collapsibleTitle = viewB.container.querySelector<HTMLInputElement>(".hn-editor-collapsible-title")!
    fireEvent.change(collapsibleTitle, { target: { value: "实现细节" } })
    fireEvent.change(collapsibleTitle, { target: { value: "" } })
    expect(collapsibleTitle.value).toBe("实现细节")

    // picture：先有效提交“架构草图”，再清空（纯空白）→ 恢复“架构草图”而不是初始“示意图”
    const viewC = render(<NoteEditor documentId="R3" loadKey="r3" initialDocument={pictureDocument() as never} />)
    const altInput = viewC.container.querySelector<HTMLInputElement>(".hn-editor-picture-alt")!
    fireEvent.change(altInput, { target: { value: "架构草图" } })
    fireEvent.change(altInput, { target: { value: "   " } })
    expect(altInput.value).toBe("架构草图")
  })

  it("formula 编辑器：latex 双重限制与 strict codec 精确等价——转义后 JSON 字节恰好 8192 提交并可保存，多一字符零事务", async () => {
    const changes: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const view = render(
      <NoteEditor
        documentId="FJ"
        loadKey="fj1"
        initialDocument={formulaDocument() as never}
        onChange={(snapshot) => changes.push(snapshot)}
        onSave={(snapshot) => { saved.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const preview = view.container.querySelector<HTMLButtonElement>(".hn-editor-formula-preview")!

    // 4095 个引号：原始 4095 字节 ≤ 8192，JSON 序列化恰好 2+2×4095 = 8192 → codec/UI 双双接受
    fireEvent.click(preview)
    const textarea = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-popover textarea")!
    fireEvent.input(textarea, { target: { value: "\"".repeat(4095) } })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(snapshotBlocks(changes)[0]!.attrs?.["latex"]).toBe("\"".repeat(4095))
    // 边界值同样能通过 strict codec 编码（等价性证明）：保存成功且快照保留原值
    await session.save()
    expect((saved[0]!.data as { content: SnapshotNode[] }).content[0]!.attrs?.["latex"]).toBe("\"".repeat(4095))

    // 4096 个引号：原始 4096 仍未超原始上限，但 JSON 序列化 8194 > 8192 → 零事务、恢复预览、aria-live 错误
    fireEvent.click(preview)
    const textarea2 = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-popover textarea")!
    const before = changes.length
    fireEvent.input(textarea2, { target: { value: "\"".repeat(4096) } })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(changes).toHaveLength(before)
    const error = view.container.querySelector(".hn-editor-formula .hn-editor-field-error")!
    expect(error.getAttribute("role")).toBe("alert")
    expect(error.textContent).toContain("转义后")
    expect(error.textContent).toContain("8192")

    // 失败未污染文档：会话仍可保存上一有效文档
    await session.save()
    expect((saved[1]!.data as { content: SnapshotNode[] }).content[0]!.attrs?.["latex"]).toBe("\"".repeat(4095))
  })

  it("callout 标题多字节类别精确计数：emoji 边界、控制字符、连续未配对低代理项", () => {
    const changes: HnnDocument[] = []
    const view = render(
      <NoteEditor documentId="CM" loadKey="cm1" initialDocument={calloutDocument() as never} onChange={(snapshot) => changes.push(snapshot)} />
    )
    const titleInput = view.container.querySelector<HTMLInputElement>(".hn-editor-callout-title")!
    const error = view.container.querySelector(".hn-editor-callout .hn-editor-field-error")!

    // 128 个 emoji（合法代理对各 4 字节）= 恰好 512 UTF-8 字节 → 允许
    fireEvent.change(titleInput, { target: { value: "😀".repeat(128) } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["title"]).toBe("😀".repeat(128))

    // 129 个 emoji = 516 字节 → 零事务 + 恢复 + 可访问错误
    let before = changes.length
    fireEvent.change(titleInput, { target: { value: "😀".repeat(129) } })
    expect(changes).toHaveLength(before)
    expect(titleInput.value).toBe("😀".repeat(128))
    expect(error.getAttribute("role")).toBe("alert")
    expect(error.textContent).toContain("512")

    // 255 + 1（tab 控制字符，原始计 1 字节）+ 256 = 恰好 512 → 允许
    fireEvent.change(titleInput, { target: { value: `${"a".repeat(255)}\t${"b".repeat(256)}` } })
    expect(snapshotBlocks(changes)[0]!.attrs?.["title"]).toBe(`${"a".repeat(255)}\t${"b".repeat(256)}`)

    // 169 汉字 + 连续两个未配对低代理项 = 507 + 3+3 = 513 字节 → 拒绝
    // （若误把两个低代理项当成代理对会算成 511 而放行；codec 口径是各计 3 字节）
    before = changes.length
    fireEvent.change(titleInput, { target: { value: `${"汉".repeat(169)}\udc00\udc00` } })
    expect(changes).toHaveLength(before)
    expect(titleInput.value).toBe(`${"a".repeat(255)}\t${"b".repeat(256)}`)
    expect(error.textContent).toContain("512")
  })

  it("清空 title/alt/latex 是失败提交：写可访问错误、恢复最近持久值、零事务、会话仍可保存", async () => {
    // callout 标题清空
    const changesA: HnnDocument[] = []
    const viewA = render(
      <NoteEditor documentId="E1" loadKey="e1" initialDocument={calloutDocument() as never} onChange={(snapshot) => changesA.push(snapshot)} />
    )
    const titleInput = viewA.container.querySelector<HTMLInputElement>(".hn-editor-callout-title")!
    const errorA = viewA.container.querySelector(".hn-editor-callout .hn-editor-field-error")!
    fireEvent.change(titleInput, { target: { value: "" } })
    expect(changesA).toHaveLength(0)
    expect(titleInput.value).toBe("Callout")
    expect(errorA.getAttribute("role")).toBe("alert")
    expect(errorA.textContent).toContain("不得为空")
    // 下一次输入清除错误
    fireEvent.input(titleInput, { target: { value: "新" } })
    expect(errorA.textContent).toBe("")

    // collapsible 标题清空
    const changesB: HnnDocument[] = []
    const viewB = render(
      <NoteEditor documentId="E2" loadKey="e2" initialDocument={collapsibleDocument() as never} onChange={(snapshot) => changesB.push(snapshot)} />
    )
    const collapsibleTitle = viewB.container.querySelector<HTMLInputElement>(".hn-editor-collapsible-title")!
    const errorB = viewB.container.querySelector(".hn-editor-collapsible .hn-editor-field-error")!
    fireEvent.change(collapsibleTitle, { target: { value: "" } })
    expect(changesB).toHaveLength(0)
    expect(collapsibleTitle.value).toBe("Details")
    expect(errorB.getAttribute("role")).toBe("alert")
    expect(errorB.textContent).toContain("不得为空")

    // picture 描述清空
    const changesC: HnnDocument[] = []
    const viewC = render(
      <NoteEditor documentId="E3" loadKey="e3" initialDocument={pictureDocument() as never} onChange={(snapshot) => changesC.push(snapshot)} />
    )
    const altInput = viewC.container.querySelector<HTMLInputElement>(".hn-editor-picture-alt")!
    const errorC = viewC.container.querySelector(".hn-editor-picture .hn-editor-field-error")!
    fireEvent.change(altInput, { target: { value: "" } })
    expect(changesC).toHaveLength(0)
    expect(altInput.value).toBe("示意图")
    expect(errorC.getAttribute("role")).toBe("alert")
    expect(errorC.textContent).toContain("不得为空")

    // formula latex 清空：预览恢复、零事务、错误播报、会话仍可保存旧文档
    const changesF: HnnDocument[] = []
    const savedF: HnnDocument[] = []
    const viewF = render(
      <NoteEditor
        documentId="E4"
        loadKey="e4"
        initialDocument={formulaDocument() as never}
        onChange={(snapshot) => changesF.push(snapshot)}
        onSave={(snapshot) => { savedF.push(snapshot); return Promise.resolve({ kind: "saved" }) }}
      />
    )
    const session = createdSessions.at(-1)!
    const preview = viewF.container.querySelector<HTMLButtonElement>(".hn-editor-formula-preview")!
    fireEvent.click(preview)
    const textarea = document.querySelector<HTMLTextAreaElement>(".hn-editor-mini-popover textarea")!
    fireEvent.input(textarea, { target: { value: "   " } })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(changesF).toHaveLength(0)
    expect(viewF.container.querySelector(".hn-editor-formula-rendered")!.textContent).toContain("x^2")
    const errorF = viewF.container.querySelector(".hn-editor-formula .hn-editor-field-error")!
    expect(errorF.getAttribute("role")).toBe("alert")
    expect(errorF.textContent).toContain("不得为空")
    await session.save()
    expect((savedF[0]!.data as { content: SnapshotNode[] }).content[0]!.attrs?.["latex"]).toBe("x^2")
  })
})
