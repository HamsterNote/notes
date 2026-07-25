/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteDrawingBlock as NoteDrawingBlockData } from "./types"

// RTL 在 vitest 环境下不自动 cleanup；编辑对话框是 portal 到 document.body 的，
// 残留会影响后续用例的查询，因此显式清理。
afterEach(cleanup)

const drawingBlock = (data: string): NoteDrawingBlockData => ({
  id: "drawing-1",
  kind: "drawing",
  data
})

const sampleData = JSON.stringify({
  schemaVersion: 2,
  strokes: [
    {
      schemaVersion: 2,
      id: "stroke-1",
      tool: "pen",
      points: [
        { x: 0, y: 0 },
        { x: 24, y: 18 }
      ]
    }
  ]
})

describe("NoteDrawingBlock", () => {
  it("renders a scaled thumbnail for stored strokes in readonly mode", () => {
    render(<NoteContent blocks={[drawingBlock(sampleData)]} title="Drawing" />)

    const thumbnail = screen.getByRole("img", { name: "画板缩略图" })
    expect(thumbnail.tagName.toLowerCase()).toBe("svg")
    expect(thumbnail.getAttribute("viewBox")).not.toBeNull()
    // 只读态不提供编辑入口
    expect(screen.queryByRole("button", { name: "编辑画板" })).toBeNull()
  })

  it("shows a placeholder when the block has no strokes", () => {
    render(<NoteContent blocks={[drawingBlock("")]} title="画板占位" />)

    expect(screen.getByText("Drawing")).toBeDefined()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("opens the drawing dialog from the editable preview and closes it", async () => {
    render(
      <NoteContent
        blocks={[drawingBlock(sampleData)]}
        title="Drawing"
        editable
        onBlocksChange={() => {}}
      />
    )

    // 焦点还原依赖打开前的 activeElement；真实浏览器点击会聚焦触发按钮，
    // fireEvent.click 不会，这里显式聚焦以对齐真实交互
    const trigger = screen.getByRole("button", { name: "编辑画板" })
    trigger.focus()
    fireEvent.click(trigger)

    expect(screen.getByRole("dialog", { name: "画板编辑器" })).toBeDefined()
    for (const label of ["画笔", "直线", "矩形", "椭圆", "橡皮"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined()
    }

    fireEvent.click(screen.getByRole("button", { name: "完成" }))

    // 组件库 Dialog 有 180ms 退场动画，动画结束后才真正卸载并回焦
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // 关闭后焦点还原到缩略图按钮
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "编辑画板" })
    )
  })

  it("closes the dialog on Escape", async () => {
    render(
      <NoteContent
        blocks={[drawingBlock(sampleData)]}
        title="Drawing"
        editable
        onBlocksChange={() => {}}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "编辑画板" }))
    const dialog = screen.getByRole("dialog")
    expect(dialog).toBeDefined()

    // 组件库 Dialog 的 Esc 处理挂在面板 onKeyDown 上（打开后焦点已被送入面板），
    // 因此事件需要派发在面板内的元素上
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})
