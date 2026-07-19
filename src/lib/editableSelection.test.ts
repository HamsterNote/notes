/**
 * @vitest-environment jsdom
 *
 * editableSelection helper 的单测：覆盖既有 isRangeInSingleEditableRoot 与
 * Phase 3 新增的 isRangeInNoteEditableScope / isRangeCrossMultipleEditableRoots /
 * forEachEditableRootInRange。
 *
 * 重点验证跨块场景下：
 *  - 起终点落在不同 contenteditable=true 根时 isRangeInNoteEditableScope 返回 true
 *    且 isRangeCrossMultipleEditableRoots 返回 true；
 *  - forEachEditableRootInRange 按 DOM 顺序遍历每个相交 root，构造的 sub-range
 *    边界正确（root 起止 / outer 起止的交集）。
 */
import { describe, expect, it } from "vitest"

import {
  forEachEditableRootInRange,
  isRangeCrossMultipleEditableRoots,
  isRangeInNoteEditableScope,
  isRangeInSingleEditableRoot
} from "./editableSelection"

// 构造一个带两个 contenteditable=true 子节点的容器，分别带 data-editable-block-id。
// contenteditable 上有真实文本节点，便于 Range.setStart/setEnd 落在文本内。
const mountTwoEditableBlocks = (): {
  container: HTMLElement
  block1: HTMLElement
  block2: HTMLElement
} => {
  document.body.innerHTML = ""
  const container = document.createElement("div")
  const block1 = document.createElement("div")
  block1.setAttribute("contenteditable", "true")
  block1.setAttribute("data-editable-block-id", "block-1")
  block1.textContent = "hello world"
  const block2 = document.createElement("div")
  block2.setAttribute("contenteditable", "true")
  block2.setAttribute("data-editable-block-id", "block-2")
  block2.textContent = "foo bar"
  container.appendChild(block1)
  container.appendChild(block2)
  document.body.appendChild(container)
  return { container, block1, block2 }
}

// 在某个元素内寻找第一个匹配 target 的文本节点，用于 Range.setStart/setEnd。
const findText = (root: HTMLElement, target: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node !== null) {
    if (node.nodeValue?.includes(target) === true) return node as Text
    node = walker.nextNode()
  }
  throw new Error(`findText: 文本 "${target}" 未找到`)
}

const selectRange = (
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number
): Range => {
  const selection = window.getSelection()
  selection?.removeAllRanges()
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  selection?.addRange(range)
  return range
}

describe("editableSelection - 单块守卫", () => {
  it("起终点位于同一 contenteditable 根 -> isRangeInSingleEditableRoot=true", () => {
    const { container, block1 } = mountTwoEditableBlocks()
    const text = findText(block1, "hello")
    const range = selectRange(text, 0, text, 5)

    expect(isRangeInSingleEditableRoot(range, container)).toBe(true)
  })

  it("起终点跨两个 contenteditable 根 -> isRangeInSingleEditableRoot=false", () => {
    const { container, block1, block2 } = mountTwoEditableBlocks()
    const t1 = findText(block1, "hello")
    const t2 = findText(block2, "foo")
    const range = selectRange(t1, 0, t2, 3)

    expect(isRangeInSingleEditableRoot(range, container)).toBe(false)
  })

  it("起终点位于容器外 -> isRangeInSingleEditableRoot=false", () => {
    const { container } = mountTwoEditableBlocks()
    const outside = document.createElement("div")
    outside.setAttribute("contenteditable", "true")
    outside.textContent = "outside"
    document.body.appendChild(outside)
    const text = findText(outside, "outside")
    const range = selectRange(text, 0, text, 3)

    expect(isRangeInSingleEditableRoot(range, container)).toBe(false)
  })
})

describe("editableSelection - 跨块守卫", () => {
  it("起终点跨两个 editable 根 -> isRangeInNoteEditableScope=true & isRangeCrossMultipleEditableRoots=true", () => {
    const { container, block1, block2 } = mountTwoEditableBlocks()
    const t1 = findText(block1, "hello")
    const t2 = findText(block2, "foo")
    const range = selectRange(t1, 0, t2, 3)

    expect(isRangeInNoteEditableScope(range, container)).toBe(true)
    expect(isRangeCrossMultipleEditableRoots(range)).toBe(true)
  })

  it("起终点在同一 editable 根 -> isRangeCrossMultipleEditableRoots=false", () => {
    const { block1 } = mountTwoEditableBlocks()
    const text = findText(block1, "hello")
    const range = selectRange(text, 0, text, 5)

    expect(isRangeCrossMultipleEditableRoots(range)).toBe(false)
  })

  it("起终点之一不在 editable 根 -> isRangeInNoteEditableScope=false", () => {
    const { container, block1 } = mountTwoEditableBlocks()
    const outside = document.createElement("div")
    outside.textContent = "outside"
    document.body.appendChild(outside)
    const t1 = findText(block1, "hello")
    const tout = findText(outside, "outside")
    const range = selectRange(t1, 0, tout, 3)

    expect(isRangeInNoteEditableScope(range, container)).toBe(false)
  })
})

describe("editableSelection - forEachEditableRootInRange", () => {
  it("跨两个 root 选区 -> 按 DOM 顺序回调两个 sub-range", () => {
    const { container, block1, block2 } = mountTwoEditableBlocks()
    const t1 = findText(block1, "hello world")
    const t2 = findText(block2, "foo bar")
    // outer: 从 block1 文本 offset=0 到 block2 文本 offset=7（覆盖整段 foo bar）
    const range = selectRange(t1, 0, t2, 7)

    const calls: Array<{ rootId: string; subText: string }> = []
    forEachEditableRootInRange(range, container, (sub, root) => {
      calls.push({
        rootId: root.getAttribute("data-editable-block-id") ?? "",
        subText: sub.toString()
      })
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.rootId).toBe("block-1")
    expect(calls[0]!.subText).toBe("hello world")
    expect(calls[1]!.rootId).toBe("block-2")
    expect(calls[1]!.subText).toBe("foo bar")
  })

  it("单块选区 -> 仅回调一次", () => {
    const { container, block1 } = mountTwoEditableBlocks()
    const text = findText(block1, "hello")
    const range = selectRange(text, 0, text, 5)

    const calls: string[] = []
    forEachEditableRootInRange(range, container, (_sub, root) => {
      calls.push(root.getAttribute("data-editable-block-id") ?? "")
    })

    expect(calls).toEqual(["block-1"])
  })

  it("outer 起点在 block1 中段、终点在 block2 中段 -> sub-range 取交集", () => {
    const { container, block1, block2 } = mountTwoEditableBlocks()
    const t1 = findText(block1, "hello world")
    const t2 = findText(block2, "foo bar")
    // outer: block1 文本 offset=6 (w) 到 block2 文本 offset=3 (b 之前)
    const range = selectRange(t1, 6, t2, 3)

    const calls: Array<{ rootId: string; subText: string }> = []
    forEachEditableRootInRange(range, container, (sub, root) => {
      calls.push({
        rootId: root.getAttribute("data-editable-block-id") ?? "",
        subText: sub.toString()
      })
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.rootId).toBe("block-1")
    expect(calls[0]!.subText).toBe("world")
    expect(calls[1]!.rootId).toBe("block-2")
    expect(calls[1]!.subText).toBe("foo")
  })

  it("无交集的 root -> 不回调", () => {
    const { container, block1 } = mountTwoEditableBlocks()
    const text = findText(block1, "hello")
    const range = selectRange(text, 0, text, 2)

    const calls: string[] = []
    forEachEditableRootInRange(range, container, (_sub, root) => {
      calls.push(root.getAttribute("data-editable-block-id") ?? "")
    })

    // 仅 block1 与 range 相交，block2 不应被回调
    expect(calls).toEqual(["block-1"])
  })
})
