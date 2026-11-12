// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PictureUploadDialog } from "./PictureUploadDialog"
import type { PictureUploadInstaller } from "./pictureUpload"
import type { PictureUploadItem } from "./types"

const png = (name = "photo.png") => new File([
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
], name, { type: "image/png" })

const revokeObjectURL = vi.fn()

function installerFixture() {
  let items: PictureUploadItem[] = []
  const listeners = new Set<(state: { items: readonly PictureUploadItem[] }) => void>()
  const retry = vi.fn(() => true)
  const installer: PictureUploadInstaller = {
    enqueue: vi.fn(() => []),
    retry,
    cancel: vi.fn(() => true),
    getState: () => ({ items }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    flushCompletions: vi.fn(),
    destroy: vi.fn()
  }
  return {
    installer,
    retry,
    setItems(next: PictureUploadItem[]) {
      items = next
      for (const listener of listeners) listener({ items })
    }
  }
}

beforeEach(() => {
  let id = 0
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:https://test.local/${++id}`) })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL })
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderDialog(uploadId?: string) {
  const fixture = installerFixture()
  const onConfirm = vi.fn(() => "upload-1")
  const onClose = vi.fn()
  const anchor = document.createElement("button")
  document.body.appendChild(anchor)
  const props = {
    installer: fixture.installer,
    anchor,
    onConfirm,
    onClose,
    ...(uploadId ? { uploadId } : {})
  }
  const view = render(<PictureUploadDialog {...props} />)
  return { ...view, ...fixture, onConfirm, onClose, anchor, props }
}

async function select(view: ReturnType<typeof renderDialog>, file: File) {
  const input = view.container.querySelector<HTMLInputElement>("input[type='file']")!
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect((view.getByRole("button", { name: "确认插入" }) as HTMLButtonElement).disabled).toBe(false))
}

describe("图像确认模态框", () => {
  it("点击选择只预览不上传；确认一次后禁用，重选释放旧预览", async () => {
    const view = renderDialog()
    expect(view.getByRole("dialog", { name: "插入图像" })).toBeDefined()
    expect((view.getByRole("button", { name: "确认插入" }) as HTMLButtonElement).disabled).toBe(true)
    await select(view, png("first.png"))
    expect(view.onConfirm).not.toHaveBeenCalled()
    expect(view.getByAltText("图片预览").getAttribute("src")).toBe("blob:https://test.local/1")
    fireEvent.click(view.getByRole("button", { name: "确认插入" }))
    expect(view.onConfirm).toHaveBeenCalledTimes(1)
    view.rerender(<PictureUploadDialog {...view.props} uploadId="upload-1" />)
    expect((view.getByRole("button", { name: "确认插入" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByRole("button", { name: "确认插入" }))
    expect(view.onConfirm).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://test.local/1")
  })

  it("拖放与点击共用校验；伪图和超限文件不能确认，重选后恢复", async () => {
    const view = renderDialog()
    const dropzone = view.getByRole("button", { name: "点击选择或拖入一张图片" })
    fireEvent.drop(dropzone, { dataTransfer: { files: [new File(["fake"], "fake.png", { type: "image/png" })] } })
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("PNG"))
    expect((view.getByRole("button", { name: "确认插入" }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.onConfirm).not.toHaveBeenCalled()

    const oversized = png("large.webp")
    Object.defineProperty(oversized, "size", { value: 104_857_601 })
    fireEvent.drop(dropzone, { dataTransfer: { files: [oversized] } })
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("100 MiB"))
    await select(view, png("valid.jpg"))
    expect(view.getByAltText("图片预览")).toBeDefined()
    expect((view.getByRole("button", { name: "确认插入" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("Esc 和关闭按钮取消，遮罩不关闭；Tab 在对话框内循环", () => {
    const view = renderDialog()
    const backdrop = view.container.querySelector(".hn-picture-dialog-backdrop")!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(view.onClose).not.toHaveBeenCalled()
    const close = view.getByRole("button", { name: "关闭图像对话框" })
    const cancel = view.getByRole("button", { name: "取消" })
    cancel.focus()
    fireEvent.keyDown(cancel, { key: "Tab" })
    expect(document.activeElement).toBe(close)
    close.focus()
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(close, { key: "Escape" })
    expect(view.onClose).toHaveBeenCalledTimes(1)
    view.rerender(<PictureUploadDialog {...view.props} />)
    view.getByRole("button", { name: "关闭图像对话框" }).click()
    expect(view.onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(document.activeElement).toBe(view.anchor)
    view.anchor.remove()
  })

  it("上传失败保留文件与预览，可重试；成功消失后关闭", async () => {
    const view = renderDialog()
    await select(view, png())
    view.rerender(<PictureUploadDialog {...view.props} uploadId="upload-1" />)
    view.setItems([{ uploadId: "upload-1", fileName: "photo.png", attempt: 1, status: "failed", error: new Error("网络失败") }])
    await waitFor(() => expect(view.getByText("网络失败")).toBeDefined())
    expect(view.getByAltText("图片预览")).toBeDefined()
    fireEvent.click(view.getByRole("button", { name: "重试上传" }))
    expect(view.retry).toHaveBeenCalledWith("upload-1")
    view.setItems([])
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1))
  })
})
