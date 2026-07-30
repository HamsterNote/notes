/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest"

import { forEachEditableRootInRange } from "./editableSelection"
import {
  crossBlockClearFormatting,
  runCrossBlockFormatCommand,
} from "./inlineSelectionFormatting"

describe("editable selection roots", () => {
  it("skips editable roots inside note-level atomic units", () => {
    // Given: a range crosses an editable table cell and a normal rich-text region.
    const container = document.createElement("div")
    container.innerHTML = [
      '<table><tbody><tr data-note-atomic-id="table:table:row:0"><td><div contenteditable="true">Cell</div></td></tr></tbody></table>',
      '<p contenteditable="true">Body</p>',
    ].join("")
    document.body.append(container)
    const cellText = container.querySelector("td div")?.firstChild
    const bodyText = container.querySelector("p")?.firstChild
    if (!(cellText instanceof Text) || !(bodyText instanceof Text)) {
      throw new Error("Expected editable text roots")
    }
    const range = document.createRange()
    range.setStart(cellText, 0)
    range.setEnd(bodyText, bodyText.length)
    const visited: string[] = []

    // When: note-level formatting enumerates editable roots.
    forEachEditableRootInRange(range, container, (_, root) => {
      visited.push(root.textContent ?? "")
    })

    // Then: only the non-atomic rich-text root is eligible for formatting.
    expect(visited).toEqual(["Body"])
  })

  it("applies cross-block color only to editable roots outside atomic units", () => {
    // Given: a note-level selection crosses a table row and a normal body region.
    const container = document.createElement("div")
    container.innerHTML = [
      '<table><tbody><tr data-note-atomic-id="table:table:row:0"><td><div contenteditable="true">Cell</div></td></tr></tbody></table>',
      '<p contenteditable="true">Body</p>',
    ].join("")
    document.body.append(container)
    const cellText = container.querySelector("td div")?.firstChild
    const bodyText = container.querySelector("p")?.firstChild
    if (!(cellText instanceof Text) || !(bodyText instanceof Text)) {
      throw new Error("Expected editable text roots")
    }
    const range = document.createRange()
    range.setStart(cellText, 0)
    range.setEnd(bodyText, bodyText.length)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)
    const visitedAtomicStates: boolean[] = []
    const command = vi.fn(() => {
      const anchor = window.getSelection()?.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      visitedAtomicStates.push(Boolean(element?.closest("[data-note-atomic-id]")))
      return true
    })
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: command,
    })

    // When: a color command is applied through the cross-block formatter.
    runCrossBlockFormatCommand(container, "foreColor", "#ef4444")

    // Then: the command runs only for the non-atomic body root.
    expect(command).toHaveBeenCalledTimes(1)
    expect(visitedAtomicStates).toEqual([false])
    Reflect.deleteProperty(document, "execCommand")
  })

  it("clears cross-block formatting without issuing a full-range native command", () => {
    // Given: formatted text exists inside an atomic table row and a normal body region.
    const container = document.createElement("div")
    container.innerHTML = [
      '<table><tbody><tr data-note-atomic-id="table:table:row:0"><td><div contenteditable="true"><strong>Cell</strong></div></td></tr></tbody></table>',
      '<p contenteditable="true"><strong>Body</strong></p>',
    ].join("")
    document.body.append(container)
    const cellText = container.querySelector("td strong")?.firstChild
    const bodyText = container.querySelector("p strong")?.firstChild
    if (!(cellText instanceof Text) || !(bodyText instanceof Text)) {
      throw new Error("Expected formatted text roots")
    }
    const range = document.createRange()
    range.setStart(cellText, 0)
    range.setEnd(bodyText, bodyText.length)
    const selection = window.getSelection()
    if (!selection) throw new Error("Expected browser selection")
    selection.removeAllRanges()
    selection.addRange(range)
    const command = vi.fn(() => true)
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: command,
    })

    // When: cross-block clear formatting runs.
    crossBlockClearFormatting(container)

    // Then: body formatting is removed, the atomic cell is untouched, and no full-range command runs.
    expect(container.querySelector("p strong")).toBeNull()
    expect(container.querySelector("td strong")?.textContent).toBe("Cell")
    expect(command).not.toHaveBeenCalled()
    Reflect.deleteProperty(document, "execCommand")
  })
})
