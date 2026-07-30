const nodeLength = (node: Node): number => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (node instanceof HTMLBRElement) return 1
  let length = 0
  for (const child of node.childNodes) length += nodeLength(child)
  return length
}

export const noteTextLength = (root: Node): number => nodeLength(root)

export const noteTextOffset = (
  region: HTMLElement,
  node: Node,
  offset: number,
): number => {
  const range = document.createRange()
  range.selectNodeContents(region)
  range.setEnd(node, offset)
  return noteTextLength(range.cloneContents())
}

const pointWithin = (node: Node, offset: number): readonly [Node, number] | null => {
  if (node.nodeType === Node.TEXT_NODE) {
    const length = node.textContent?.length ?? 0
    return offset <= length ? [node, offset] : null
  }
  let remaining = offset
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes[index]
    if (!child) continue
    if (child instanceof HTMLBRElement) {
      if (remaining === 0) return [node, index]
      if (remaining === 1) return [node, index + 1]
      remaining -= 1
      continue
    }
    const length = nodeLength(child)
    if (remaining <= length) return pointWithin(child, remaining)
    remaining -= length
  }
  return remaining === 0 ? [node, node.childNodes.length] : null
}

export const noteDomPoint = (
  region: HTMLElement,
  offset: number,
): readonly [Node, number] => pointWithin(region, offset) ?? [region, region.childNodes.length]
