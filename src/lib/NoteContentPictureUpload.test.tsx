/** @vitest-environment jsdom */
import { useState } from "react"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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

    // Then: keyboard focus falls back to the first conversion action.
    await waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe("H1")
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
    fireEvent.click(introHandle)
    fireEvent.click(view.getByRole("menuitem", { name: "图片" }))
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
