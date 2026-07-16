const endpointElement = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement

const editableRoot = (node: Node): HTMLElement | null => {
  const element = endpointElement(node)
  const nearest = element?.closest<HTMLElement>("[contenteditable]") ?? null
  return nearest?.getAttribute("contenteditable") === "true" ? nearest : null
}

export const isRangeInSingleEditableRoot = (
  range: Range,
  container: HTMLElement
): boolean => {
  if (!container.contains(range.startContainer)) return false
  if (!container.contains(range.endContainer)) return false

  const startRoot = editableRoot(range.startContainer)
  const endRoot = editableRoot(range.endContainer)
  return startRoot !== null && startRoot === endRoot && container.contains(startRoot)
}
