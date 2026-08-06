import { describe, expect, it } from "vitest"

import { removeRegionsAfter } from "./noteNestedMutation"
import type { NoteCollapsibleBlock } from "./types"

describe("nested note-flow mutation", () => {
  it("preserves siblings outside the selected nested region", () => {
    // Given: an expanded collapsible contains three text regions.
    const block: NoteCollapsibleBlock = {
      id: "group",
      kind: "collapsible",
      title: "Group",
      collapsed: false,
      blocks: [
        { id: "first", kind: "paragraph", text: "First" },
        { id: "second", kind: "paragraph", text: "Second" },
        { id: "third", kind: "paragraph", text: "Third" },
      ],
    }

    // When: regions after the first through the second are removed.
    const result = removeRegionsAfter(block, "first", "second")

    // Then: only the selected second region is cleared; the third sibling is untouched.
    expect(result).toEqual({
      ...block,
      blocks: [
        { id: "first", kind: "paragraph", text: "First" },
        { id: "second", kind: "paragraph", text: "" },
        { id: "third", kind: "paragraph", text: "Third" },
      ],
    })
  })
})
