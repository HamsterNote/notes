import { describe, expect, it } from "vitest"

import {
  blockKindLabel,
  blockMenuItemTarget,
  blockMenuItems
} from "./BlockActionMenuTypes"

describe("BlockActionMenuTypes", () => {
  it("exposes Todo, Unordered List, and Ordered List menu items", () => {
    const labels = blockMenuItems.map((item) => item.label)

    expect(labels).toContain("Todo")
    expect(labels).toContain("Unordered List")
    expect(labels).toContain("Ordered List")
    expect(labels).toContain("Collapsible")
    expect(labels).not.toContain("List")
  })

  it("maps each structural menu item to the correct convert target", () => {
    const todo = blockMenuItems.find((item) => item.label === "Todo")
    const unordered = blockMenuItems.find(
      (item) => item.label === "Unordered List"
    )
    const ordered = blockMenuItems.find(
      (item) => item.label === "Ordered List"
    )
    const collapsible = blockMenuItems.find(
      (item) => item.label === "Collapsible"
    )

    expect(todo).toBeDefined()
    expect(unordered).toBeDefined()
    expect(ordered).toBeDefined()
    expect(collapsible).toBeDefined()

    if (todo) expect(blockMenuItemTarget(todo)).toEqual({ kind: "todo" })
    if (unordered)
      expect(blockMenuItemTarget(unordered)).toEqual({ kind: "unorderedList" })
    if (ordered)
      expect(blockMenuItemTarget(ordered)).toEqual({ kind: "orderedList" })
    if (collapsible)
      expect(blockMenuItemTarget(collapsible)).toEqual({
        kind: "collapsible"
      })
  })

  it("returns human-readable labels for list-like block kinds", () => {
    expect(blockKindLabel("todo")).toBe("Todo")
    expect(blockKindLabel("unorderedList")).toBe("Unordered List")
    expect(blockKindLabel("orderedList")).toBe("Ordered List")
    expect(blockKindLabel("collapsible")).toBe("Collapsible")
    expect(blockKindLabel("paragraph")).toBe("正文")
  })
})
