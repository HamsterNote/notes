/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"

import {
  captureStableNoteSelection,
  restoreStableNoteSelection,
} from "./noteSelectionRestore"
import { noteTextLength } from "./noteTextOffset"

describe("note text offsets", () => {
  it("counts a line break once when capturing and restoring a selection", () => {
    // Given: a rich region contains text on both sides of a BR element.
    const container = document.createElement("article")
    const region = document.createElement("p")
    region.dataset["noteRegionId"] = "block:body"
    region.innerHTML = "ab<br>cd"
    container.append(region)
    const endText = region.lastChild
    if (!(endText instanceof Text)) throw new Error("Expected trailing text")
    const range = document.createRange()
    range.setStart(endText, 0)
    range.setEnd(endText, 1)

    // When: the DOM selection is captured and restored through stable offsets.
    const stable = captureStableNoteSelection(range)
    if (!stable) throw new Error("Expected stable selection")
    const restored = restoreStableNoteSelection(container, stable)

    // Then: BR contributes one UTF-16 unit and the same trailing character remains selected.
    expect(noteTextLength(region)).toBe(5)
    expect(stable).toEqual({
      start: { regionId: "block:body", offset: 3 },
      end: { regionId: "block:body", offset: 4 },
    })
    expect(restored?.toString()).toBe("c")
  })
})
