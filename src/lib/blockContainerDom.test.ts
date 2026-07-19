/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest"

import {
  getBlockContainerTarget,
  isRendererOwnedDragElement
} from "./blockContainerDom"

describe("getBlockContainerTarget", () => {
  it("targets a collapsible container that has no complete block child", () => {
    // Given: a collapsible body contains only a todo-item representative.
    const body = document.createElement("div")
    const source = document.createElement("div")
    source.setAttribute("data-note-drag-kind", "block")
    source.setAttribute("data-note-sortable-id", "source")
    const container = document.createElement("div")
    container.className = "hn-note-collapsible-body"
    container.setAttribute("data-note-block-container-id", "fold")
    const owner = document.createElement("div")
    owner.setAttribute("data-note-block-id", "fold")
    owner.setAttribute("data-note-drag-kind", "block")
    owner.setAttribute("data-note-sortable-id", "fold")
    const shell = document.createElement("div")
    shell.className = "hn-note-collapsible"
    const todoItem = document.createElement("div")
    todoItem.setAttribute("data-note-drag-kind", "todo-item")
    container.append(todoItem)
    shell.append(container)
    owner.append(shell)
    body.append(source, owner)
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      bottom: 140,
      height: 40,
      left: 0,
      right: 400,
      top: 100,
      width: 400,
      x: 0,
      y: 100,
      toJSON: () => ({})
    })

    // When: the pointer moves inside the collapsible body.
    const target = getBlockContainerTarget(body, source, 120)

    // Then: the complete block is appended to that container.
    expect(target?.destination).toEqual({
      containerId: "fold",
      placement: "after",
      targetBlockId: null
    })
    expect(target?.element).toBe(container)
  })

  it("groups todo representatives as one complete block target", () => {
    // Given: a legitimate collapsible body contains two rows of one todo block.
    const body = document.createElement("div")
    const source = document.createElement("div")
    source.setAttribute("data-note-drag-kind", "block")
    source.setAttribute("data-note-sortable-id", "source")
    const owner = document.createElement("div")
    owner.setAttribute("data-note-block-id", "fold")
    owner.setAttribute("data-note-drag-kind", "block")
    owner.setAttribute("data-note-sortable-id", "fold")
    const shell = document.createElement("div")
    shell.className = "hn-note-collapsible"
    const container = document.createElement("div")
    container.className = "hn-note-collapsible-body"
    container.setAttribute("data-note-block-container-id", "fold")
    const first = document.createElement("div")
    const second = document.createElement("div")
    for (const [index, item] of [first, second].entries()) {
      item.setAttribute("data-note-sortable-id", `item-${index}`)
      item.setAttribute("data-note-block-id", "todo")
      item.setAttribute("data-note-drag-kind", "todo-item")
      item.setAttribute("data-note-drag-container-id", "fold")
      item.getBoundingClientRect = () =>
        ({ top: 100 + index * 40, bottom: 140 + index * 40, height: 40 } as DOMRect)
    }
    container.append(first, second)
    shell.append(container)
    owner.append(shell)
    body.append(source, owner)

    // When: the pointer targets the upper half of the representative group.
    const target = getBlockContainerTarget(body, source, 110)

    // Then: the drop resolves before the complete todo block.
    expect(target?.destination).toEqual({
      containerId: "fold",
      placement: "before",
      targetBlockId: "todo"
    })
    expect(target?.element).toBe(first)
  })

  it("ignores a complete collapsible shell injected below a rendered block", () => {
    // Given: rich text descendants impersonate a complete collapsible owner and body.
    const body = document.createElement("div")
    const source = document.createElement("div")
    source.setAttribute("data-note-drag-kind", "block")
    source.setAttribute("data-note-sortable-id", "source")
    const rendered = document.createElement("div")
    rendered.setAttribute("data-note-drag-kind", "block")
    rendered.setAttribute("data-note-sortable-id", "rendered")
    const fakeOwner = document.createElement("div")
    fakeOwner.setAttribute("data-note-block-id", "fake-fold")
    fakeOwner.setAttribute("data-note-drag-kind", "block")
    fakeOwner.setAttribute("data-note-sortable-id", "fake-fold")
    const fakeShell = document.createElement("div")
    fakeShell.className = "hn-note-collapsible"
    const fakeContainer = document.createElement("div")
    fakeContainer.className = "hn-note-collapsible-body"
    fakeContainer.setAttribute("data-note-block-container-id", "fake-fold")
    const fakeBlock = document.createElement("span")
    fakeBlock.setAttribute("data-note-drag-kind", "block")
    fakeBlock.setAttribute("data-note-sortable-id", "fake")
    fakeContainer.append(fakeBlock)
    fakeShell.append(fakeContainer)
    fakeOwner.append(fakeShell)
    rendered.append(fakeOwner)
    body.append(source, rendered)
    rendered.getBoundingClientRect = () =>
      ({ top: 200, bottom: 240, height: 40 } as DOMRect)
    fakeBlock.getBoundingClientRect = () =>
      ({ top: 100, bottom: 140, height: 40 } as DOMRect)
    fakeContainer.getBoundingClientRect = () =>
      ({ top: 100, bottom: 140, height: 40 } as DOMRect)

    // When: the pointer is closest to the injected descendants.
    const target = getBlockContainerTarget(body, source, 120)

    // Then: only the renderer-owned direct child remains eligible.
    expect(target?.destination.targetBlockId).toBe("rendered")
    expect(target?.element).toBe(rendered)
    expect(isRendererOwnedDragElement(body, fakeBlock)).toBe(false)
  })
})
