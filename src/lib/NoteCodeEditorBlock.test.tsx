/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import type { NoteBlock } from "./types"

const codeBlocks: readonly NoteBlock[] = [
  {
    id: "code",
    kind: "code",
    language: "typescript",
    filename: "example.ts",
    code: "const answer = 42"
  }
]

afterEach(cleanup)

describe("NoteCodeBlock direct editing", () => {
  it("edits immediately and commits the code on blur", () => {
    // Given: an editable note containing a code block.
    const onBlocksChange = vi.fn()
    const view = render(
      <NoteContent
        blocks={codeBlocks}
        title="Direct code editing"
        editable
        onBlocksChange={onBlocksChange}
      />
    )

    // Then: the code editor is already present without a separate edit action.
    const editor = screen.getByRole("textbox", {
      name: "编辑代码：example.ts"
    })
    expect(screen.queryByRole("button", { name: "编辑代码" })).toBeNull()
    expect(view.container.querySelector(".hn-note-code-preview")).toBeNull()

    // When: the code changes and the editor loses focus.
    fireEvent.change(editor, { target: { value: "const answer = 43" } })
    expect(onBlocksChange).not.toHaveBeenCalled()
    fireEvent.blur(editor)

    // Then: one update persists the edited code.
    expect(onBlocksChange).toHaveBeenCalledOnce()
    expect(onBlocksChange).toHaveBeenCalledWith([
      {
        ...codeBlocks[0],
        code: "const answer = 43"
      }
    ])
  })

  it("keeps read-only code as a non-editable preview", () => {
    // Given: the same note is rendered without editing enabled.
    const view = render(
      <NoteContent blocks={codeBlocks} title="Read-only code" />
    )

    // Then: only the readable code preview is exposed.
    expect(screen.queryByRole("textbox", { name: /编辑代码/ })).toBeNull()
    expect(view.container.querySelector(".hn-note-code-preview")?.textContent).toBe(
      "const answer = 42"
    )
  })
})
