// @vitest-environment jsdom

import { TextSelection } from "@tiptap/pm/state"
import { fireEvent } from "@testing-library/dom"
import { describe, expect, it } from "vitest"
import { encodeHnn, type HnnDocument } from "../hnn/codec"
import { createEditorSession } from "./session"
import type { NoteSaveContext, NoteSaveResult } from "./types"

const ids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001"
]

function documentWith(text: string): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: ids[0] }, content: [{ type: "text", text }] }]
    }
  }
}

function replaceText(session: ReturnType<typeof createEditorSession>, text: string): void {
  const { state } = session.editor
  session.editor.view.dispatch(state.tr.insertText(text, 1, state.doc.content.size - 1))
}

function insertUnsafePicture(session: ReturnType<typeof createEditorSession>): void {
  const { state } = session.editor
  const picture = session.editor.schema.nodes["picture"]?.create({
    nodeId: ids[1],
    src: "javascript:alert(1)",
    alt: "unsafe"
  })
  if (!picture) throw new Error("HNN picture node 未装配")
  session.editor.view.dispatch(state.tr.insert(state.doc.content.size, picture))
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe("EditorSession", () => {
  it("先严格解码初始 HNN；失败时不构造可保存的降级会话", () => {
    expect(() => createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: { schemaVersion: 1, data: { type: "doc", content: [{ type: "unknown" }] } }
    })).toThrow(/unknown|不支持/u)
  })

  it("将严格 codec document 以 JSON 跨 schema 重新物化，并以会话 state.doc 建立 baseline", () => {
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first") })
    try {
      expect(session.editor.state.schema).toBe(session.editor.schema)
      expect(session.editor.state.doc.type.schema).toBe(session.editor.schema)
      expect(session.state).toEqual({ dirty: false, status: "idle" })
    } finally {
      session.destroy()
    }
  })

  it("以当次 editor.state.doc 建立 baseline，并按新会话重置 selection 和 history", () => {
    const first = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first"), initialRevision: "r1" })
    try {
      expect(first.state.dirty).toBe(false)
      replaceText(first, "changed")
      first.editor.view.dispatch(first.editor.state.tr.setSelection(TextSelection.create(first.editor.state.doc, 1, 4)))
      expect(first.state.dirty).toBe(true)
      expect(first.editor.state.plugins.map((plugin) => (plugin as unknown as { key: string }).key)).toContain("history$")
      expect(first.undo()).toBe(true)
      expect(first.editor.getText()).toBe("first")
      expect(first.state.dirty).toBe(false)
      expect(first.redo()).toBe(true)
      expect(first.editor.getText()).toBe("changed")

      const second = createEditorSession({ documentId: "B", loadKey: 1, initialDocument: documentWith("second"), initialRevision: "r2" })
      try {
        expect(second.editor.getText()).toBe("second")
        expect(second.editor.state.selection.empty).toBe(true)
        expect(second.undo()).toBe(false)
        expect(second.state).toEqual({ dirty: false, status: "idle" })
        expect(second.revision).toBe("r2")
      } finally {
        second.destroy()
      }
    } finally {
      first.destroy()
    }
  })

  it("封闭 StarterKit UndoRedo 支持 command 与 Ctrl+Z/Ctrl+Shift+Z", () => {
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first") })
    try {
      replaceText(session, "command")
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("first")
      expect(session.redo()).toBe(true)
      expect(session.editor.getText()).toBe("command")

      fireEvent.keyDown(session.editor.view.dom, { key: "z", ctrlKey: true })
      expect(session.editor.getText()).toBe("first")
      fireEvent.keyDown(session.editor.view.dom, { key: "z", ctrlKey: true, shiftKey: true })
      expect(session.editor.getText()).toBe("command")

      const beforeInput = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyUndo" })
      session.editor.view.dom.dispatchEvent(beforeInput)
      expect(beforeInput.defaultPrevented).toBe(true)
      // 由浏览器/ProseMirror 原生输入路径处理；HNN 不再注册自定义 history 代理。
      expect(session.editor.getText()).toBe("first")
    } finally {
      session.destroy()
    }
  })

  it("相同 documentId/loadKey 的外部初始值变化不会替换既有会话", () => {
    const session = createEditorSession({ documentId: "A", loadKey: "v1", initialDocument: documentWith("first"), initialRevision: "r1" })
    try {
      replaceText(session, "local")
      // 会话 API 没有 reload，唯一的重载边界由持有它的 React key 定义。
      expect(session.editor.getText()).toBe("local")
      expect(session.revision).toBe("r1")
    } finally {
      session.destroy()
    }
  })

  it("保存捕获触发时的快照和 CAS revision，保存期间编辑仍为脏", async () => {
    const request = deferred<NoteSaveResult>()
    const calls: Array<{ snapshot: HnnDocument; context: NoteSaveContext }> = []
    const onSave = (snapshot: HnnDocument, context: NoteSaveContext) => {
      calls.push({ snapshot, context })
      return request.promise
    }
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first"), initialRevision: "r1", onSave })
    try {
      replaceText(session, "saved text")
      const saving = session.save()
      replaceText(session, "new text")
      expect(calls).toHaveLength(1)
      expect(calls[0]?.snapshot).toEqual(encodeHnn(session.editor.schema.nodeFromJSON(documentWith("saved text").data)))
      expect(calls[0]?.context).toMatchObject({ documentId: "A", baseRevision: "r1" })
      expect(session.state).toEqual({ dirty: true, status: "saving" })

      request.resolve({ kind: "saved", revision: "r2" })
      await expect(saving).resolves.toEqual({ kind: "saved", revision: "r2" })
      expect(session.revision).toBe("r2")
      expect(session.state).toEqual({ dirty: true, status: "idle" })
    } finally {
      session.destroy()
    }
  })

  it("每个会话保存单飞，成功将快照作为 baseline，未返回 revision 时清除 revision", async () => {
    const request = deferred<NoteSaveResult>()
    const calls: NoteSaveContext[] = []
    const onSave = (_snapshot: HnnDocument, context: NoteSaveContext) => {
      calls.push(context)
      return request.promise
    }
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first"), initialRevision: "r1", onSave })
    try {
      replaceText(session, "saved text")
      const first = session.save()
      const second = session.save()
      expect(second).toBe(first)
      expect(calls).toHaveLength(1)
      request.resolve({ kind: "saved" })
      await first
      expect(session.state).toEqual({ dirty: false, status: "idle" })
      expect(session.revision).toBeUndefined()
    } finally {
      session.destroy()
    }
  })

  it("失败与 conflict 保留 baseline、文档、selection 和 history", async () => {
    const failure = deferred<NoteSaveResult>()
    const onSave = () => failure.promise
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first"), initialRevision: "r1", onSave })
    try {
      replaceText(session, "changed")
      const beforeConflict = session.editor.state.doc
      const selection = TextSelection.create(beforeConflict, 1, 3)
      session.editor.view.dispatch(session.editor.state.tr.setSelection(selection))
      const saving = session.save()
      failure.resolve({ kind: "conflict" })
      await expect(saving).resolves.toEqual({ kind: "conflict" })
      expect(session.state).toEqual({ dirty: true, status: "conflict" })
      expect(session.editor.state.doc.eq(beforeConflict)).toBe(true)
      expect(session.editor.state.selection.eq(selection)).toBe(true)
      expect(session.revision).toBe("r1")
      expect(session.undo()).toBe(true)
    } finally {
      session.destroy()
    }
  })

  it("保存失败保持脏和原 baseline", async () => {
    const onSave = (): Promise<NoteSaveResult> => Promise.reject(new Error("network"))
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first"), onSave })
    try {
      replaceText(session, "changed")
      await expect(session.save()).resolves.toBeUndefined()
      expect(session.state.status).toBe("error")
      expect(session.state.dirty).toBe(true)
    } finally {
      session.destroy()
    }
  })

  it("不可编码 transaction 不会从 dispatch 逃逸，undo 后可重新保存", async () => {
    const changed: HnnDocument[] = []
    const saved: HnnDocument[] = []
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith("first"),
      onChange: (snapshot) => changed.push(snapshot),
      onSave: (snapshot) => {
        saved.push(snapshot)
        return Promise.resolve({ kind: "saved", revision: "r2" })
      }
    })
    try {
      expect(() => insertUnsafePicture(session)).not.toThrow()
      expect(session.state.status).toBe("error")
      expect(session.state.dirty).toBe(true)
      expect(changed).toHaveLength(0)
      await expect(session.save()).resolves.toBeUndefined()
      expect(saved).toHaveLength(0)
      expect(session.revision).toBeUndefined()

      expect(session.undo()).toBe(true)
      expect(session.state).toEqual({ dirty: false, status: "idle" })
      await expect(session.save()).resolves.toEqual({ kind: "saved", revision: "r2" })
      expect(saved).toHaveLength(1)
    } finally {
      session.destroy()
    }
  })

  it("编码错误覆盖 saving；保存成功时保留编码错误，undo 恢复后回到成功 phase", async () => {
    const request = deferred<NoteSaveResult>()
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith("first"),
      onSave: () => request.promise
    })
    try {
      replaceText(session, "saved")
      const saving = session.save()
      insertUnsafePicture(session)
      expect(session.state.status).toBe("error")
      expect(session.state.dirty).toBe(true)

      request.resolve({ kind: "saved", revision: "r2" })
      await expect(saving).resolves.toEqual({ kind: "saved", revision: "r2" })
      expect(session.state.status).toBe("error")
      expect(session.revision).toBe("r2")
      expect(session.undo()).toBe(true)
      expect(session.state).toEqual({ dirty: false, status: "idle" })
    } finally {
      session.destroy()
    }
  })

  it("编码错误覆盖 conflict，undo 恢复后仍为 conflict", async () => {
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith("first"),
      onSave: () => Promise.resolve({ kind: "conflict" })
    })
    try {
      replaceText(session, "changed")
      await expect(session.save()).resolves.toEqual({ kind: "conflict" })
      insertUnsafePicture(session)
      expect(session.state.status).toBe("error")
      expect(session.undo()).toBe(true)
      expect(session.state).toEqual({ dirty: true, status: "conflict" })
    } finally {
      session.destroy()
    }
  })

  it("宿主 reject 即使是 HnnCodecError 也不会被普通编辑清除", async () => {
    const hostError = new Error("host rejected HNN")
    hostError.name = "HnnCodecError"
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith("first"),
      onSave: () => Promise.reject(hostError)
    })
    try {
      replaceText(session, "changed")
      await expect(session.save()).resolves.toBeUndefined()
      replaceText(session, "changed again")
      expect(session.state).toEqual({ dirty: true, status: "error", error: hostError })
    } finally {
      session.destroy()
    }
  })

  it("隔离宿主 onChange 异常，不影响 ProseMirror dispatch 或会话状态", () => {
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith("first"),
      onChange: () => { throw new Error("host callback error") }
    })
    try {
      expect(() => replaceText(session, "changed")).not.toThrow()
      expect(session.state).toEqual({ dirty: true, status: "idle" })
      expect(session.editor.getText()).toBe("changed")
    } finally {
      session.destroy()
    }
  })

  it("宿主同步抛错也清除 in-flight 并进入 error，不会遗留 saving", async () => {
    const onSave = (): Promise<NoteSaveResult> => {
      throw new Error("synchronous network error")
    }
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first"), onSave })
    try {
      replaceText(session, "changed")
      await expect(session.save()).resolves.toBeUndefined()
      expect(session.state.status).toBe("error")
      expect(session.state.dirty).toBe(true)
    } finally {
      session.destroy()
    }
  })

  it("旧会话保存 A1 后切换 A2 再新建 A1 时，中止旧请求并忽略陈旧结果", async () => {
    const request = deferred<NoteSaveResult>()
    const calls: NoteSaveContext[] = []
    const onSave = (_snapshot: HnnDocument, context: NoteSaveContext) => {
      calls.push(context)
      return request.promise
    }
    const a1 = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("A1"), onSave })
    replaceText(a1, "A1 local")
    const staleSave = a1.save()
    const oldSignal = calls[0]?.signal
    a1.destroy()
    const a2 = createEditorSession({ documentId: "A", loadKey: 2, initialDocument: documentWith("A2"), initialRevision: "r2" })
    const reloadedA1 = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("A1 reloaded"), initialRevision: "r3" })
    try {
      expect(oldSignal?.aborted).toBe(true)
      request.resolve({ kind: "saved", revision: "stale" })
      await expect(staleSave).resolves.toBeUndefined()
      expect(reloadedA1.editor.getText()).toBe("A1 reloaded")
      expect(reloadedA1.revision).toBe("r3")
      expect(reloadedA1.state).toEqual({ dirty: false, status: "idle" })
    } finally {
      a2.destroy()
      reloadedA1.destroy()
    }
  })

  it("destroy 会中止每次保存独有的 AbortSignal", () => {
    const request = deferred<NoteSaveResult>()
    const calls: NoteSaveContext[] = []
    const onSave = (_snapshot: HnnDocument, context: NoteSaveContext) => {
      calls.push(context)
      return request.promise
    }
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first"), onSave })
    replaceText(session, "changed")
    void session.save()
    const signal = calls[0]?.signal
    session.destroy()
    expect(signal?.aborted).toBe(true)
  })

  it("以同一 EditorState 内的 doc.eq 判定 baseline，初始 JSON 键序不影响非脏状态", () => {
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: {
        schemaVersion: 1,
        data: { content: [{ content: [{ text: "first", type: "text" }], attrs: { nodeId: ids[0] }, type: "paragraph" }], type: "doc" }
      }
    })
    try {
      // 这个输入与 documentWith 的语义相同但所有 JSON key 的插入顺序不同。不能将
      // 不同 schema 实例创建的 PM Node 彼此 Node.eq；baseline 与 current 始终同实例。
      expect(session.editor.getJSON()).toEqual(documentWith("first").data)
      expect(session.state).toEqual({ dirty: false, status: "idle" })
    } finally {
      session.destroy()
    }
  })

  it("封闭会话没有 schema/extensions/history props，未知持久结构不能保存", () => {
    const session = createEditorSession({ documentId: "A", loadKey: 1, initialDocument: documentWith("first") })
    try {
      expect(session.editor.schema.nodes["hostNode"]).toBeUndefined()
      expect(() => session.editor.schema.nodeFromJSON({ type: "hostNode" })).toThrow()
      expect(encodeHnn(session.editor.state.doc).data).not.toHaveProperty("hostNode")
    } finally {
      session.destroy()
    }
  })

  it("构造时复制 documentId、revision 与 callback，外部 options 突变不改变会话语义", async () => {
    const firstCalls: NoteSaveContext[] = []
    const secondCalls: NoteSaveContext[] = []
    const options = {
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith("first"),
      initialRevision: "r1",
      onSave: (_snapshot: HnnDocument, context: NoteSaveContext): Promise<NoteSaveResult> => {
        firstCalls.push(context)
        return Promise.resolve({ kind: "saved", revision: "r2" })
      }
    }
    const session = createEditorSession(options)
    options.documentId = "mutated"
    options.initialRevision = "mutated-revision"
    options.onSave = (_snapshot, context) => {
      secondCalls.push(context)
      return Promise.resolve({ kind: "saved", revision: "mutated" })
    }
    try {
      replaceText(session, "changed")
      await expect(session.save()).resolves.toEqual({ kind: "saved", revision: "r2" })
      expect(firstCalls).toHaveLength(1)
      expect(firstCalls[0]).toMatchObject({ documentId: "A", baseRevision: "r1" })
      expect(secondCalls).toHaveLength(0)
      expect(session.revision).toBe("r2")
    } finally {
      session.destroy()
    }
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("拒绝非有限数字 loadKey %s", (loadKey) => {
    expect(() => createEditorSession({ documentId: "A", loadKey, initialDocument: documentWith("first") })).toThrow(/loadKey/u)
  })
})
