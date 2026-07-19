/** @vitest-environment jsdom */
import { useState } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// 该测试文件含两个用例，且菜单通过 portal 渲染到 document.body，
// RTL 在 vitest 环境下未自动 cleanup，导致 test1 的菜单残留到 test2，
// 造成 getByRole 重复匹配。显式 afterEach cleanup 保证 document.body 干净。
afterEach(cleanup)

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

describe("NoteContent picture upload", () => {
  it("focuses the first conversion item for an existing picture block", async () => {
    // Given: a picture block has no matching current-format item in the menu.
    const view = render(
      <NoteContent
        blocks={[
          {
            id: "picture",
            kind: "picture",
            url: "blob:http://localhost/picture",
            filename: "picture.png"
          }
        ]}
        title="Picture menu test"
        editable
      />
    )

    // When: its left-side conversion menu is opened from the keyboard target.
    const handle = view.container.querySelector(
      '[data-block-id="picture"][data-block-menu-mode="convert"]'
    )
    if (!handle) throw new Error("Expected picture block handle.")
    fireEvent.click(handle)

    // Then: 主菜单首项 "转换成" 拿到焦点（新结构：picture 块也走主菜单+子菜单，
    // 不再有指向 H1 的默认焦点回退）。
    await waitFor(() =>
      expect(document.activeElement?.textContent?.startsWith("转换成")).toBe(
        true
      )
    )
  })

  it("preserves edits made while the upload is pending", async () => {
    // Given: a controlled note whose picture upload has not resolved yet.
    let resolveUpload: ((url: string) => void) | undefined
    const uploadPromise = new Promise<string>((resolve) => {
      resolveUpload = resolve
    })
    const onPictureUpload = vi.fn(() => uploadPromise)
    const initialBlocks: readonly NoteBlock[] = [
      { id: "intro", kind: "paragraph", text: "Replace with picture" },
      { id: "status", kind: "paragraph", text: "Original status" }
    ]
    const Harness = () => {
      const [blocks, setBlocks] = useState(initialBlocks)
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setBlocks((current) =>
                current.map((block) =>
                  block.id === "status" && block.kind === "paragraph"
                    ? { ...block, text: "Edited while uploading" }
                    : block
                )
              )
            }
          >
            Edit status
          </button>
          <NoteContent
            blocks={blocks}
            title="Upload test"
            editable
            onBlocksChange={setBlocks}
            onPictureUpload={onPictureUpload}
          />
        </>
      )
    }
    const view = render(<Harness />)

    // When: another block changes before the selected picture finishes uploading.
    const introHandle = view.container.querySelector(
      '[data-block-id="intro"][data-block-menu-mode="convert"]'
    )
    if (!introHandle) throw new Error("Expected intro block handle.")
    // 新结构：先点开 convert handle 显示主菜单（"转换成/删除/创建副本"），
    // 再点击主菜单的 "转换成" 项展开右侧子菜单（含 H1..图片 等格式选项）
    fireEvent.click(introHandle)
    // 主菜单的 "转换成" 出现后再点击展开右侧子菜单
    // （主菜单项包含 › 箭头，accessible name 是 "转换成›"，用正则匹配）
    // 菜单通过 portal 渲染到 document.body，必须使用 screen 而非 view.container。
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /转换成/ })).toBeDefined()
    )
    fireEvent.click(screen.getByRole("menuitem", { name: /转换成/ }))
    // 子菜单渲染出来后，"图片" menuitem 才存在
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "图片" })).toBeDefined()
    )
    fireEvent.click(screen.getByRole("menuitem", { name: "图片" }))
    const input = document.querySelector<HTMLInputElement>(
      ".hn-note-picture-input"
    )
    if (!input) throw new Error("Expected picture file input.")
    fireEvent.change(input, {
      target: { files: [new File(["picture"], "cover.png", { type: "image/png" })] }
    })
    await waitFor(() => expect(onPictureUpload).toHaveBeenCalledOnce())
    fireEvent.click(view.getByRole("button", { name: "Edit status" }))
    await act(async () => {
      resolveUpload?.("blob:http://localhost/cover")
      await uploadPromise
    })

    // Then: the upload replaces only its source and retains the intervening edit.
    expect(
      view.getByRole("img", { name: "cover.png" }).getAttribute("src")
    ).toBe("blob:http://localhost/cover")
    expect(view.getByText("Edited while uploading").textContent).toBe(
      "Edited while uploading"
    )
  })
})
