// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { encodeHnn } from "../hnn/codec"
import { createEditorSession, type EditorSession } from "./session"
import type { PictureResolveResult } from "./types"

const nodeId = "123e4567-e89b-42d3-a456-426614174000"
const managedSrc = "hamster_note_data/images/0123456789abcdef0123456789abcdef.png"

function documentWithPicture(src = managedSrc) {
  return {
    schemaVersion: 1 as const,
    data: {
      type: "doc",
      content: [{ type: "picture", attrs: { nodeId, src, alt: "图片" } }]
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const sessions: EditorSession[] = []
afterEach(() => {
  while (sessions.length) sessions.pop()?.destroy()
})

function mount(src = managedSrc, resolve?: (src: string, context: { signal: AbortSignal; documentId: string; loadKey: string | number }) => Promise<PictureResolveResult>) {
  const session = createEditorSession({
    documentId: "doc-A",
    loadKey: "load-1",
    initialDocument: documentWithPicture(src),
    ...(resolve ? { onPictureResolve: resolve } : {})
  })
  sessions.push(session)
  return session
}

function image(session: EditorSession): HTMLImageElement {
  const element = session.editor.view.dom.querySelector<HTMLImageElement>(".hn-editor-picture-img")
  expect(element).not.toBeNull()
  return element!
}

function placeholder(session: EditorSession): HTMLElement {
  const element = session.editor.view.dom.querySelector<HTMLElement>(".hn-editor-picture-placeholder")
  expect(element).not.toBeNull()
  return element!
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("图片运行时解析", () => {
  it("普通 HTTP 图片无 resolver 时直显；托管路径缺能力时显示可重试占位", () => {
    const external = mount("https://cdn.example.test/image.png")
    expect(image(external).getAttribute("src")).toBe("https://cdn.example.test/image.png")
    expect(placeholder(external).hidden).toBe(true)

    const managed = mount()
    expect(image(managed).hasAttribute("src")).toBe(false)
    expect(placeholder(managed).hidden).toBe(false)
    expect(placeholder(managed).textContent).toContain("缺少图片解析能力")
    expect(placeholder(managed).querySelector("button")?.hidden).toBe(false)
  })

  it("成功解析只更新 DOM，正文、dirty、history 与持久 src 不变", async () => {
    const dispose = vi.fn()
    const resolve = vi.fn().mockResolvedValue({ url: "blob:https://example.test/image", dispose })
    const session = mount(managedSrc, resolve)
    await flush()
    expect(resolve).toHaveBeenCalledWith(managedSrc, expect.objectContaining({ documentId: "doc-A", loadKey: "load-1" }))
    expect(image(session).getAttribute("src")).toBe("blob:https://example.test/image")
    expect(session.state.dirty).toBe(false)
    expect(session.undo()).toBe(false)
    expect(encodeHnn(session.editor.state.doc)).toEqual(documentWithPicture())
    expect(dispose).not.toHaveBeenCalled()
  })

  it("失败可重试；危险运行时 URL 被拒绝且结果资源立即释放", async () => {
    const invalidDispose = vi.fn()
    const resolve = vi.fn()
      .mockRejectedValueOnce(new Error("文件不存在"))
      .mockResolvedValueOnce({ url: "javascript:alert(1)", dispose: invalidDispose })
      .mockResolvedValueOnce({ url: "blob:https://example.test/retry" })
    const session = mount(managedSrc, resolve)
    await flush()
    expect(placeholder(session).textContent).toContain("图片加载失败")
    const retry = placeholder(session).querySelector<HTMLButtonElement>("button")!
    retry.click()
    await flush()
    expect(image(session).hasAttribute("src")).toBe(false)
    expect(invalidDispose).toHaveBeenCalledTimes(1)
    expect(placeholder(session).textContent).toContain("不安全")
    retry.click()
    await flush()
    expect(image(session).getAttribute("src")).toBe("blob:https://example.test/retry")
    expect(resolve).toHaveBeenCalledTimes(3)
  })

  it("src 替换会 abort 旧请求；迟到结果立即 dispose，当前结果在销毁时恰好释放一次", async () => {
    const first = deferred<PictureResolveResult>()
    const second = deferred<PictureResolveResult>()
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const contexts: AbortSignal[] = []
    const resolve = vi.fn((_: string, context: { signal: AbortSignal }) => {
      contexts.push(context.signal)
      return contexts.length === 1 ? first.promise : second.promise
    })
    const session = mount(managedSrc, resolve)
    const nextSrc = "hamster_note_data/images/abcdef0123456789abcdef0123456789.jpg"
    session.editor.view.dispatch(session.editor.state.tr.setNodeMarkup(0, undefined, {
      ...session.editor.state.doc.firstChild!.attrs,
      src: nextSrc
    }))
    expect(contexts[0]?.aborted).toBe(true)
    second.resolve({ url: "blob:https://example.test/second", dispose: secondDispose })
    await flush()
    expect(image(session).getAttribute("src")).toBe("blob:https://example.test/second")
    first.resolve({ url: "blob:https://example.test/first", dispose: firstDispose })
    await flush()
    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(image(session).getAttribute("src")).toBe("blob:https://example.test/second")
    session.destroy()
    session.destroy()
    expect(secondDispose).toHaveBeenCalledTimes(1)
  })

  it("运行中替换 resolver 不重建会话，旧结果释放并按当前源重新解析", async () => {
    const firstDispose = vi.fn()
    const first = vi.fn().mockResolvedValue({ url: "blob:https://example.test/first", dispose: firstDispose })
    const second = vi.fn().mockResolvedValue({ url: "blob:https://example.test/second" })
    const session = mount(managedSrc, first)
    await flush()
    const editor = session.editor
    session.configurePictureResolver(second)
    await flush()
    expect(session.editor).toBe(editor)
    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith(managedSrc, expect.anything())
    expect(image(session).getAttribute("src")).toBe("blob:https://example.test/second")
  })
})
