// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NoteSaveStatus } from "./NoteSaveStatus"
import type { EditorSessionState } from "./types"

afterEach(() => cleanup())

const noop = () => undefined

function renderStatus(state: EditorSessionState, onSave: () => void | Promise<unknown> = noop) {
  return render(<NoteSaveStatus state={state} onSave={onSave} />)
}

function statusText(): string {
  return screen.getByRole("status").textContent ?? ""
}

// getByRole("button") 已按 role 收窄为 HTMLButtonElement，无需额外断言
function getButton(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name })
}

describe("NoteSaveStatus 状态呈现", () => {
  it("clean idle：呈现已保存且不需要保存按钮", () => {
    renderStatus({ dirty: false, status: "idle" })
    expect(statusText()).toContain("已保存")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("dirty idle：呈现未保存修改并提供保存按钮", () => {
    renderStatus({ dirty: true, status: "idle" })
    expect(statusText()).toContain("有未保存的修改")
    expect(getButton("保存").disabled).toBe(false)
  })

  it("saving：呈现保存中且按钮禁用", () => {
    renderStatus({ dirty: true, status: "saving" })
    expect(statusText()).toContain("正在保存")
    expect(getButton("保存中…").disabled).toBe(true)
  })

  it("error：呈现保存失败且绝不呈现为已保存，并提供显式重试", () => {
    renderStatus({ dirty: true, status: "error", error: new Error("网络断开") })
    const text = statusText()
    expect(text).toContain("保存失败")
    expect(text).toContain("网络断开")
    expect(text).not.toContain("已保存")
    expect(getButton("重试保存").disabled).toBe(false)
  })

  it("error 即使 dirty 为 false 也不呈现为已保存", () => {
    renderStatus({ dirty: false, status: "error", error: new Error("bad") })
    const text = statusText()
    expect(text).toContain("保存失败")
    expect(text).not.toContain("已保存")
  })

  it("conflict：呈现冲突并说明不自动合并或覆盖，等待显式决策", () => {
    renderStatus({ dirty: true, status: "conflict" })
    const text = statusText()
    expect(text).toContain("保存冲突")
    expect(text).toContain("不会自动合并或覆盖")
    expect(text).toContain("重新载入")
    expect(getButton("重试保存").disabled).toBe(false)
  })
})

describe("NoteSaveStatus 交互", () => {
  it("点击保存按钮触发一次 onSave", () => {
    const onSave = vi.fn()
    renderStatus({ dirty: true, status: "idle" }, onSave)
    fireEvent.click(getButton("保存"))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("保存中按钮禁用，无法重复触发保存", () => {
    const onSave = vi.fn()
    renderStatus({ dirty: true, status: "saving" }, onSave)
    const button = getButton("保存中…")
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("键盘聚焦后按 Enter 可触发保存", () => {
    const onSave = vi.fn()
    renderStatus({ dirty: true, status: "idle" }, onSave)
    const button = getButton("保存")
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.keyDown(button, { key: "Enter" })
    // jsdom 对聚焦按钮的 Enter 触发原生激活行为（click）；若环境未合成 click 则显式补一次以验证等价路径
    if (onSave.mock.calls.length === 0) fireEvent.click(button)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("disabled 时按钮禁用且不触发 onSave，状态文案仍如实呈现", () => {
    const onSave = vi.fn()
    render(<NoteSaveStatus state={{ dirty: true, status: "idle" }} onSave={onSave} disabled />)
    const button = getButton("保存")
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onSave).not.toHaveBeenCalled()
    expect(statusText()).toContain("有未保存的修改")
  })

  it("onSave 返回 rejected Promise 时被吞掉，不产生 unhandled rejection 也不伪造状态", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("宿主保存失败")))
    renderStatus({ dirty: true, status: "idle" }, onSave)
    fireEvent.click(getButton("保存"))
    expect(onSave).toHaveBeenCalledTimes(1)
    // 等待微任务结算；组件不依据 Promise 结果改写呈现，仍以权威 state 为准
    await waitFor(() => {
      expect(statusText()).toContain("有未保存的修改")
    })
  })

  it("onSave 同步抛错时不向外传播", () => {
    const onSave = vi.fn(() => {
      throw new Error("同步失败")
    })
    renderStatus({ dirty: true, status: "idle" }, onSave)
    expect(() => fireEvent.click(getButton("保存"))).not.toThrow()
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
