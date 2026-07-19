/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const EditorHarness = ({ initialBlock }: { readonly initialBlock: NoteBlock }) => {
  const [blocks, setBlocks] = useState<readonly NoteBlock[]>([initialBlock])

  return (
    <>
      <NoteContent
        blocks={blocks}
        title="Editor regressions"
        editable
        onBlocksChange={setBlocks}
      />
      <output data-testid="blocks-state">{JSON.stringify(blocks)}</output>
    </>
  )
}

describe("editor regressions", () => {
  it("renders a checklist shortcut with the todo item class", async () => {
    // Given: 一个空段落。
    const view = render(
      <EditorHarness
        initialBlock={{ id: "paragraph", kind: "paragraph", text: "" }}
      />
    )
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="paragraph"]'
    )
    if (!editable) throw new Error("Expected an editable paragraph.")

    // When: 输入 checklist 快捷 marker。
    editable.textContent = "[] "
    fireEvent.input(editable, { data: " ", inputType: "insertText" })

    // Then: 快捷输入使用当前 todo item 的 class 契约。
    await waitFor(() => {
      const item = view.container.querySelector<HTMLElement>(
        ".hn-note-todo-item[data-note-sortable-id]"
      )
      expect(item?.parentElement?.classList.contains("hn-note-body")).toBe(true)
      expect(item?.id).not.toBe("paragraph")
      expect(item?.getAttribute("data-note-block-id")).toBe("paragraph")
    })
  })

  it("keeps Enter inside a callout as a persisted line break", async () => {
    // Given: a callout body with the caret between two words.
    const view = render(
      <EditorHarness
        initialBlock={{
          id: "callout",
          kind: "callout",
          tone: "info",
          title: "Notice",
          text: "AlphaBeta"
        }}
      />
    )
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="callout"]'
    )
    if (!editable) throw new Error("Expected an editable callout body.")
    const textNode = editable.firstChild
    if (!textNode) throw new Error("Expected callout text.")
    const range = document.createRange()
    range.setStart(textNode, 5)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    // When: Enter is pressed without Shift.
    fireEvent.keyDown(editable, { key: "Enter" })
    fireEvent.blur(editable)

    // Then: the same callout contains a line break and blur persists it to state.
    expect(view.container.querySelectorAll(".hn-note-callout")).toHaveLength(1)
    expect(editable.innerHTML).toBe("Alpha<br>Beta")
    await waitFor(() => {
      expect(
        view.container.querySelector('[data-testid="blocks-state"]')?.textContent
      ).toContain(
        '"text":"Alpha<br>Beta"'
      )
    })
  })

  it("splits and focuses an item in a persisted legacy checklist", async () => {
    // Given: a persisted checklist item with the caret between two words.
    const view = render(
      <EditorHarness
        initialBlock={{
          id: "legacy-checklist",
          kind: "checklist",
          title: "Imported tasks",
          items: [
            { id: "legacy-item", checked: true, text: "AlphaBeta" }
          ]
        }}
      />
    )
    const editable = view.container.querySelector<HTMLElement>(
      '[data-editable-block-id="legacy-item"]'
    )
    if (!editable) throw new Error("Expected a legacy checklist item.")
    const textNode = editable.firstChild
    if (!textNode) throw new Error("Expected legacy checklist text.")
    const range = document.createRange()
    range.setStart(textNode, 5)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    // When: Enter is pressed in the middle of the legacy item.
    fireEvent.keyDown(editable, { key: "Enter" })

    // Then: a second item is created and receives focus at its start.
    await waitFor(() => {
      const editables = view.container.querySelectorAll<HTMLElement>(
        ".hn-note-checklist-item [data-editable-block-id]"
      )
      expect(editables).toHaveLength(2)
      expect(editables[0]?.innerHTML).toBe("Alpha")
      expect(editables[1]?.innerHTML).toBe("Beta")
      expect(document.activeElement).toBe(editables[1])
    })
  })

  it("uses a native multiline textarea while editing code so one Enter creates one line", async () => {
    // Given: 一个可编辑代码块。
    const view = render(
      <EditorHarness
        initialBlock={{
          id: "code",
          kind: "code",
          language: "text",
          code: "first"
        }}
      />
    )

    // When: 聚焦代码预览进入编辑态。
    fireEvent.focus(view.getByRole("button", { name: "编辑代码" }))

    // Then: 编辑面使用浏览器原生多行输入控件，Enter 无需自定义插入两次。
    await waitFor(() => {
      const editor = view.getByRole("textbox", { name: "编辑代码" })
      expect(editor.tagName).toBe("TEXTAREA")
      expect(editor instanceof HTMLTextAreaElement && editor.value).toBe("first")
    })
  })
})
