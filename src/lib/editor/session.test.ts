// @vitest-environment jsdom

import { TextSelection } from "@tiptap/pm/state"
import { fireEvent } from "@testing-library/dom"
import { describe, expect, it, vi } from "vitest"
import { encodeHnn, type HnnDocument } from "../hnn/codec"
import { createEditorSession } from "./session"
import type { HostCandidateProvider, HostReferenceResolve, NoteSaveContext, NoteSaveResult } from "./types"

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

describe("EditorSession 图片上传接线（6.7）", () => {
  function imageFile(name = "photo.png"): File {
    return new File([new Uint8Array(4)], name, { type: "image/png" })
  }

  it("仅提供 onPictureUpload 的会话才安装上传 installer", () => {
    const withoutUpload = createEditorSession({ documentId: "A", loadKey: "1", initialDocument: documentWith("x") })
    try {
      expect(withoutUpload.pictureUpload).toBeUndefined()
    } finally {
      withoutUpload.destroy()
    }

    const upload = vi.fn(() => new Promise<{ src: string }>(() => undefined))
    const withUpload = createEditorSession({
      documentId: "A",
      loadKey: "1",
      initialDocument: documentWith("x"),
      onPictureUpload: upload
    })
    try {
      expect(withUpload.pictureUpload).toBeDefined()
      expect(withUpload.pictureUpload?.getState().items).toEqual([])
    } finally {
      withUpload.destroy()
    }
  })

  it("destroy 中止在途上传：signal aborted，陈旧成功结果绝不写入文档", async () => {
    const pending = deferred<{ src: string }>()
    const upload = vi.fn(() => pending.promise)
    const session = createEditorSession({
      documentId: "A",
      loadKey: "1",
      initialDocument: documentWith("x"),
      onPictureUpload: upload
    })
    const installer = session.pictureUpload
    if (!installer) throw new Error("上传 installer 未安装")
    const [uploadId] = installer.enqueue([imageFile()])
    expect(uploadId).toBeDefined()
    const request = (upload.mock.calls[0] as unknown as [File, { uploadId: string; attempt: number; signal: AbortSignal }])[1]
    expect(request.attempt).toBe(1)

    session.destroy()
    expect(request.signal.aborted).toBe(true)

    // 宿主忽略 abort 迟到的成功结果：库内丢弃，文档与上传状态都不被回写。
    pending.resolve({ src: "https://example.com/stale.png" })
    await pending.promise.then(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session.editor.isDestroyed).toBe(true)
    expect(installer.getState().items).toEqual([])
  })

  it("上传成功只写入一个 picture 节点：快照含 src、placeholder 痕迹不进 HNN", async () => {
    const pending = deferred<{ src: string; alt?: string }>()
    const session = createEditorSession({
      documentId: "A",
      loadKey: "1",
      initialDocument: documentWith("x"),
      onPictureUpload: () => pending.promise
    })
    try {
      const installer = session.pictureUpload
      if (!installer) throw new Error("上传 installer 未安装")
      const [uploadId] = installer.enqueue([imageFile()])
      // 上传中：占位是 decoration，编码快照里既没有 uploadId 也没有文件名。
      const during = JSON.stringify(encodeHnn(session.editor.state.doc))
      expect(during).not.toContain(uploadId)
      expect(during).not.toContain("photo.png")

      pending.resolve({ src: "https://example.com/a.png", alt: "示意" })
      await new Promise((resolve) => setTimeout(resolve, 0))
      const snapshot = encodeHnn(session.editor.state.doc)
      const serialized = JSON.stringify(snapshot)
      expect(serialized).toContain("https://example.com/a.png")
      expect(serialized).not.toContain(uploadId)
      expect(installer.getState().items).toEqual([])
      // 成功插入使文档变脏；一步 undo 即回到插入前。
      expect(session.state.dirty).toBe(true)
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("x")
    } finally {
      session.destroy()
    }
  })
})

describe("EditorSession configurePictureUpload（6.7 同 key 动态能力）", () => {
  function imageFile(name = "photo.png"): File {
    return new File([new Uint8Array(4)], name, { type: "image/png" })
  }

  it("新增 callback 只增安装：editor/doc/selection/history/baseline 全部保留", () => {
    const session = createEditorSession({ documentId: "A", loadKey: "1", initialDocument: documentWith("x") })
    try {
      expect(session.pictureUpload).toBeUndefined()
      replaceText(session, "draft")
      const editorBefore = session.editor
      const selectionFrom = session.editor.state.selection.from
      expect(session.state.dirty).toBe(true)

      session.configurePictureUpload(vi.fn(() => new Promise<{ src: string }>(() => undefined)))
      expect(session.pictureUpload).toBeDefined()
      // 只增安装：editor 实例、文档、selection、历史、baseline 全部不动。
      expect(session.editor).toBe(editorBefore)
      expect(session.editor.getText()).toBe("draft")
      expect(session.editor.state.selection.from).toBe(selectionFrom)
      expect(session.state.dirty).toBe(true)
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("x")
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("移除 callback：abort 在途、清空状态、stale 绝不写入；同 session 可重启", async () => {
    const pending = deferred<{ src: string }>()
    const upload = vi.fn(() => pending.promise)
    const session = createEditorSession({ documentId: "A", loadKey: "1", initialDocument: documentWith("x") })
    try {
      session.configurePictureUpload(upload)
      const installer = session.pictureUpload
      if (!installer) throw new Error("上传 installer 未安装")
      installer.enqueue([imageFile()])
      const request = (upload.mock.calls[0] as unknown as [File, { uploadId: string; attempt: number; signal: AbortSignal }])[1]

      session.configurePictureUpload(undefined)
      expect(session.pictureUpload).toBeUndefined()
      expect(request.signal.aborted).toBe(true)
      expect(installer.getState().items).toEqual([])

      pending.resolve({ src: "https://example.com/stale.png" })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).not.toContain("stale.png")

      // 重启：同一 session 重新安装，doc/baseline 依旧未动。
      const restarted = vi.fn(() => new Promise<{ src: string }>(() => undefined))
      session.configurePictureUpload(restarted)
      expect(session.pictureUpload).toBeDefined()
      expect(session.editor.getText()).toBe("x")
      expect(session.state.dirty).toBe(false)
      session.pictureUpload?.enqueue([imageFile("again.png")])
      expect(restarted).toHaveBeenCalledTimes(1)
    } finally {
      session.destroy()
    }
  })

  it("更新 callback：在途请求 signal/ID 稳定且结果仍写入，未来请求用新 handler", async () => {
    const first = deferred<{ src: string }>()
    const uploadOld = vi.fn(() => first.promise)
    const uploadNew = vi.fn(() => new Promise<{ src: string }>(() => undefined))
    const session = createEditorSession({ documentId: "A", loadKey: "1", initialDocument: documentWith("x") })
    try {
      session.configurePictureUpload(uploadOld)
      session.pictureUpload?.enqueue([imageFile("old.png")])
      const oldRequest = (uploadOld.mock.calls[0] as unknown as [File, { uploadId: string; attempt: number; signal: AbortSignal }])[1]

      session.configurePictureUpload(uploadNew)
      // 在途不被 abort、uploadId 稳定；新入队走新 handler。
      expect(oldRequest.signal.aborted).toBe(false)
      session.pictureUpload?.enqueue([imageFile("new.png")])
      expect(uploadNew).toHaveBeenCalledTimes(1)

      first.resolve({ src: "https://example.com/old.png" })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).toContain("https://example.com/old.png")
    } finally {
      session.destroy()
    }
  })

  it("destroy 后 configure 是安全 no-op", () => {
    const session = createEditorSession({ documentId: "A", loadKey: "1", initialDocument: documentWith("x") })
    session.destroy()
    expect(() => session.configurePictureUpload(vi.fn())).not.toThrow()
    expect(session.pictureUpload).toBeUndefined()
  })
})

describe("EditorSession configureHostReferences（7.2 同 key 动态能力）", () => {
  const refIds = {
    paragraph: "123e4567-e89b-42d3-a456-426614174010",
    mention: "123e4567-e89b-42d3-a456-426614174011",
    mention2: "123e4567-e89b-42d3-a456-426614174012"
  }

  function documentWithMention(): HnnDocument {
    return {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "paragraph",
          attrs: { nodeId: refIds.paragraph },
          content: [
            { type: "text", text: "见 " },
            { type: "mention", attrs: { nodeId: refIds.mention, resourceId: "u1", name: "Ada" } }
          ]
        }]
      }
    }
  }

  it("构造即按真实能力安装：hasActivate 仅在有 activate 时为 true，documentId 来自会话", () => {
    const candidates = vi.fn<HostCandidateProvider>(() => [])
    const withActivate = createEditorSession({
      documentId: "doc-x",
      loadKey: 1,
      initialDocument: documentWith("x"),
      onReferenceCandidates: candidates,
      onReferenceActivate: () => undefined
    })
    const withoutActivate = createEditorSession({
      documentId: "doc-y",
      loadKey: 1,
      initialDocument: documentWith("y"),
      onReferenceResolve: () => null
    })
    const noCallbacks = createEditorSession({ documentId: "doc-z", loadKey: 1, initialDocument: documentWith("z") })
    try {
      expect(withActivate.hostReferences?.hasActivate).toBe(true)
      expect(withoutActivate.hostReferences?.hasActivate).toBe(false)
      expect(noCallbacks.hostReferences).toBeUndefined()

      withActivate.hostReferences?.requestCandidates("mention", "a")
      expect(candidates).toHaveBeenCalledTimes(1)
      expect(candidates.mock.calls[0]?.[2].documentId).toBe("doc-x")
    } finally {
      withActivate.destroy()
      withoutActivate.destroy()
      noCallbacks.destroy()
    }
  })

  it("全无 → 任一：只增安装，editor/doc/selection/history/baseline 全部保留", () => {
    const session = createEditorSession({ documentId: "A", loadKey: "1", initialDocument: documentWith("x") })
    try {
      expect(session.hostReferences).toBeUndefined()
      replaceText(session, "draft")
      const editorBefore = session.editor
      const selectionFrom = session.editor.state.selection.from

      session.configureHostReferences({ candidates: () => [] })
      expect(session.hostReferences).toBeDefined()
      expect(session.editor).toBe(editorBefore)
      expect(session.editor.getText()).toBe("draft")
      expect(session.editor.state.selection.from).toBe(selectionFrom)
      expect(session.state.dirty).toBe(true)
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("x")
      expect(session.state.dirty).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("纯 fn→fn（三 presence 全不变）：installer 不重建，在途请求稳定，未来请求用新 handler", async () => {
    const pendingResolve = deferred<{ label: string } | null>()
    const pendingCandidates = deferred<readonly { resourceId: string; name: string }[]>()
    const resolveOld = vi.fn<HostReferenceResolve>(() => pendingResolve.promise)
    const candidatesOld = vi.fn<HostCandidateProvider>(() => pendingCandidates.promise)
    const resolveNew = vi.fn<HostReferenceResolve>(() => null)
    const candidatesNew = vi.fn<HostCandidateProvider>(() => [])
    const activate = vi.fn()
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWithMention(),
      onReferenceCandidates: candidatesOld,
      onReferenceActivate: activate,
      onReferenceResolve: resolveOld
    })
    try {
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      // 初始同步即解析既有 mention；候选请求在途。
      const resolveContext = (resolveOld.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }])[1]
      installer.requestCandidates("mention", "a")
      const candidatesContext = (candidatesOld.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }])[2]

      session.configureHostReferences({ candidates: candidatesNew, activate, resolve: resolveNew })
      expect(session.hostReferences).toBe(installer)
      expect(resolveContext.signal.aborted).toBe(false)
      expect(candidatesContext.signal.aborted).toBe(false)

      // 未来请求走新 handler。
      installer.requestCandidates("mention", "b")
      expect(candidatesNew).toHaveBeenCalledTimes(1)
      // 文档新增引用按新 resolver 解析。
      const mentionType = session.editor.schema.nodes["mention"]
      if (!mentionType) throw new Error("mention 节点未装配")
      const node = mentionType.create({ nodeId: refIds.mention2, resourceId: "u2", name: "Ben" })
      session.editor.view.dispatch(session.editor.state.tr.insert(1, node))
      expect(resolveNew).toHaveBeenCalledTimes(1)
      expect((resolveNew.mock.calls[0] as unknown as [{ resourceId: string }])[0].resourceId).toBe("u2")

      // 在途旧请求迟到 settle：同 session 非 stale，结果正常落地且不抛错。
      pendingResolve.resolve({ label: "迟到标签" })
      pendingCandidates.resolve([{ resourceId: "late", name: "Late" }])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(installer.getReferenceState().entries.find((entry) => entry.resourceId === "u1")).toMatchObject({
        status: "resolved",
        label: "迟到标签"
      })
      // 解析结果绝不写入 HNN。
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).not.toContain("迟到标签")
    } finally {
      session.destroy()
    }
  })

  it("三 fn→fn 同 presence：installer/in-flight 保留，doc/selection/history/baseline 不动", async () => {
    const pending = deferred<readonly { resourceId: string; name: string }[]>()
    const candidatesOld = vi.fn<HostCandidateProvider>(() => pending.promise)
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith("x"),
      onReferenceCandidates: candidatesOld,
      onReferenceActivate: () => undefined,
      onReferenceResolve: () => null
    })
    try {
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      replaceText(session, "draft")
      installer.requestCandidates("mention", "a")
      const context = (candidatesOld.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }])[2]
      const selectionFrom = session.editor.state.selection.from

      session.configureHostReferences({ candidates: () => [], activate: () => undefined, resolve: () => null })
      expect(session.hostReferences).toBe(installer)
      expect(context.signal.aborted).toBe(false)
      expect(session.editor.getText()).toBe("draft")
      expect(session.editor.state.selection.from).toBe(selectionFrom)
      expect(session.state.dirty).toBe(true)
      // history/baseline 保持：一步 undo 回到初始文本且不再脏。
      expect(session.undo()).toBe(true)
      expect(session.editor.getText()).toBe("x")
      expect(session.state.dirty).toBe(false)

      // 同 session 的在途候选迟到 settle 仍正常落地（非 stale）。
      pending.resolve([{ resourceId: "late", name: "Late" }])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(installer.getCandidateState()).toMatchObject({ status: "ready" })
    } finally {
      session.destroy()
    }
  })

  it("resolve none→fn（保留 activate）：presence 变化重建，既有引用立刻 loading→resolved 重解析", async () => {
    const pending = deferred<{ label: string } | null>()
    const resolve = vi.fn<HostReferenceResolve>(() => pending.promise)
    const activate = vi.fn()
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWithMention(),
      onReferenceActivate: activate
    })
    try {
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      // 无 resolve：既有引用受控 missing。
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0))
      expect(installer.getReferenceState().entries[0]).toMatchObject({ resourceId: "u1", status: "missing" })
      const docJsonBefore = JSON.stringify(encodeHnn(session.editor.state.doc))

      session.configureHostReferences({ activate, resolve })
      const rebuilt = session.hostReferences
      expect(rebuilt).toBeDefined()
      expect(rebuilt).not.toBe(installer)
      // 重建重扫合法 doc：既有引用立刻按新 resolver 重新解析（loading → resolved）。
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(rebuilt?.getReferenceState().entries[0]).toMatchObject({ resourceId: "u1", status: "loading" })
      pending.resolve({ label: "新标签" })
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0))
      expect(rebuilt?.getReferenceState().entries[0]).toMatchObject({ status: "resolved", label: "新标签" })
      // 文档零变化，解析结果不进 HNN。
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).toBe(docJsonBefore)
      expect(docJsonBefore).not.toContain("新标签")
    } finally {
      session.destroy()
    }
  })

  it("resolve fn→none（保留 activate）：abort 在途 pending，late 不 resolved、转 missing 且 HNN 相等", async () => {
    const pending = deferred<{ label: string } | null>()
    const resolve = vi.fn<HostReferenceResolve>(() => pending.promise)
    const activate = vi.fn()
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWithMention(),
      onReferenceActivate: activate,
      onReferenceResolve: resolve
    })
    try {
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      const context = (resolve.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }])[1]
      expect(installer.getReferenceState().entries[0]).toMatchObject({ status: "loading" })
      const docJsonBefore = JSON.stringify(encodeHnn(session.editor.state.doc))

      session.configureHostReferences({ activate })
      const rebuilt = session.hostReferences
      expect(rebuilt).toBeDefined()
      expect(rebuilt).not.toBe(installer)
      expect(context.signal.aborted).toBe(true)
      // 重建后无 resolve：重扫受控 missing。
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0))
      expect(rebuilt?.getReferenceState().entries[0]).toMatchObject({ resourceId: "u1", status: "missing" })

      // 旧 pending 迟到：stale 在核心内丢弃，不 resolved、不写文档。
      pending.resolve({ label: "陈旧标签" })
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0))
      expect(rebuilt?.getReferenceState().entries[0]).toMatchObject({ status: "missing" })
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).toBe(docJsonBefore)
    } finally {
      session.destroy()
    }
  })

  it("candidates fn→none（保留 resolve）：abort 在途候选，late 不 ready，既有引用解析能力保留", async () => {
    const pendingCandidates = deferred<readonly { resourceId: string; name: string }[]>()
    const candidates = vi.fn<HostCandidateProvider>(() => pendingCandidates.promise)
    const resolve = vi.fn<HostReferenceResolve>(() => ({ label: "标签" }))
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWithMention(),
      onReferenceCandidates: candidates,
      onReferenceResolve: resolve
    })
    try {
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      installer.requestCandidates("mention", "a")
      const context = (candidates.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }])[2]
      expect(installer.getCandidateState()).toMatchObject({ status: "loading" })

      session.configureHostReferences({ resolve })
      const rebuilt = session.hostReferences
      expect(rebuilt).toBeDefined()
      expect(rebuilt).not.toBe(installer)
      expect(context.signal.aborted).toBe(true)
      expect(rebuilt?.getCandidateState()).toMatchObject({ status: "idle" })

      // 旧候选迟到：stale 不 ready。
      pendingCandidates.resolve([{ resourceId: "stale", name: "Stale" }])
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0))
      expect(rebuilt?.getCandidateState()).toMatchObject({ status: "idle" })
      // resolve 保留：重建重扫后既有引用仍按 resolver 解析并呈现。
      expect(rebuilt?.getReferenceState().entries[0]).toMatchObject({ resourceId: "u1", status: "resolved", label: "标签" })
    } finally {
      session.destroy()
    }
  })

  it("activate 有无翻转：保守重建 installer，在途候选 abort，hasActivate 与文档内容正确", async () => {
    const pending = deferred<readonly { resourceId: string; name: string }[]>()
    const candidates = vi.fn<HostCandidateProvider>(() => pending.promise)
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWith("x"),
      onReferenceCandidates: candidates,
      onReferenceActivate: () => undefined
    })
    try {
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      installer.requestCandidates("mention", "a")
      const context = (candidates.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }])[2]
      const textBefore = session.editor.getText()

      // 移除 activate：hasActivate 必须翻转为 false → 重建 installer（保守 abort 在途）。
      session.configureHostReferences({ candidates })
      const rebuilt = session.hostReferences
      expect(rebuilt).toBeDefined()
      expect(rebuilt).not.toBe(installer)
      expect(rebuilt?.hasActivate).toBe(false)
      expect(context.signal.aborted).toBe(true)
      expect(session.editor.getText()).toBe(textBefore)

      pending.resolve([{ resourceId: "stale", name: "Stale" }])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(rebuilt?.getCandidateState()).toMatchObject({ status: "idle" })

      // 再补回 activate：同一 session 再次重建，hasActivate 恢复 true。
      session.configureHostReferences({ candidates, activate: () => undefined })
      expect(session.hostReferences?.hasActivate).toBe(true)
      expect(session.editor.getText()).toBe(textBefore)
    } finally {
      session.destroy()
    }
  })

  it("移除全部 callback：abort 在途候选/解析，stale 绝不写入，入口消失", async () => {
    const pendingCandidates = deferred<readonly { resourceId: string; name: string }[]>()
    const pendingResolve = deferred<{ label: string } | null>()
    const candidates = vi.fn<HostCandidateProvider>(() => pendingCandidates.promise)
    const resolve = vi.fn<HostReferenceResolve>(() => pendingResolve.promise)
    const session = createEditorSession({
      documentId: "A",
      loadKey: 1,
      initialDocument: documentWithMention(),
      onReferenceCandidates: candidates,
      onReferenceResolve: resolve
    })
    try {
      const installer = session.hostReferences
      if (!installer) throw new Error("引用 installer 未安装")
      installer.requestCandidates("mention", "a")
      const candidatesContext = (candidates.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }])[2]
      const resolveContext = (resolve.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }])[1]

      session.configureHostReferences({})
      expect(session.hostReferences).toBeUndefined()
      expect(candidatesContext.signal.aborted).toBe(true)
      expect(resolveContext.signal.aborted).toBe(true)

      pendingCandidates.resolve([{ resourceId: "stale", name: "Stale" }])
      pendingResolve.resolve({ label: "陈旧标签" })
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0))
      expect(installer.getCandidateState()).toMatchObject({ status: "loading" }) // 旧 installer 已冻结，不再发布
      expect(JSON.stringify(encodeHnn(session.editor.state.doc))).not.toContain("陈旧标签")
    } finally {
      session.destroy()
    }
  })

  it("destroy 后 configure 是安全 no-op", () => {
    const session = createEditorSession({ documentId: "A", loadKey: "1", initialDocument: documentWith("x") })
    session.destroy()
    expect(() => session.configureHostReferences({ candidates: () => [] })).not.toThrow()
    expect(session.hostReferences).toBeUndefined()
  })
})

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
