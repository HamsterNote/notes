import type {
  BlockContainerDestination,
  BlockContainerId
} from "./blockContainerMove"

export type BlockContainerTarget = {
  readonly destination: BlockContainerDestination
  readonly element: HTMLElement
}

type ContainerTargetCandidate = BlockContainerTarget &
  Readonly<{ depth: number; distance: number }>

const getPersistedBlockId = (element: HTMLElement): string | null =>
  element.getAttribute("data-note-block-id") ??
  element.getAttribute("data-note-sortable-id")

export const getBlockContainerId = (
  element: HTMLElement
): BlockContainerId => element.getAttribute("data-note-drag-container-id")

const isCollapsibleBody = (
  body: HTMLElement,
  container: HTMLElement
): boolean => {
  if (!container.classList.contains("hn-note-collapsible-body")) return false
  const containerId = container.getAttribute("data-note-block-container-id")
  const shell = container.parentElement
  if (
    containerId === null ||
    !(shell instanceof HTMLElement) ||
    !shell.classList.contains("hn-note-collapsible")
  ) {
    return false
  }
  const owner = shell.parentElement
  if (
    !(owner instanceof HTMLElement) ||
    owner.getAttribute("data-note-drag-kind") !== "block" ||
    owner.getAttribute("data-note-block-id") !== containerId ||
    owner.closest("[data-note-sortable-id]") !== owner
  ) {
    return false
  }
  const parentContainer = owner.parentElement
  return (
    parentContainer === body ||
    (parentContainer instanceof HTMLElement &&
      isCollapsibleBody(body, parentContainer))
  )
}

export const getBlockContainerElement = (
  body: HTMLElement,
  containerId: BlockContainerId
): HTMLElement | null => {
  if (containerId === null) return body
  return (
    Array.from(
      body.querySelectorAll<HTMLElement>("[data-note-block-container-id]")
    ).find(
      (element) =>
        element.getAttribute("data-note-block-container-id") === containerId &&
        isCollapsibleBody(body, element)
    ) ?? null
  )
}

export const isRendererOwnedDragElement = (
  body: HTMLElement,
  element: HTMLElement
): boolean => {
  if (element.closest("[data-note-sortable-id]") !== element) return false
  const container = element.parentElement
  return (
    container === body ||
    (container instanceof HTMLElement && isCollapsibleBody(body, container))
  )
}

const getElementDepth = (element: HTMLElement, body: HTMLElement): number => {
  let depth = 0
  let current = element.parentElement
  while (current !== null && current !== body) {
    depth++
    current = current.parentElement
  }
  return depth
}

const getBlockCandidates = (
  body: HTMLElement,
  sourceElement: HTMLElement,
  clientY: number
): ContainerTargetCandidate[] => {
  const groups = new Map<string, HTMLElement[]>()
  for (const element of body.querySelectorAll<HTMLElement>("[data-note-drag-kind]")) {
    if (!isRendererOwnedDragElement(body, element) || sourceElement.contains(element)) continue
    const blockId = getPersistedBlockId(element)
    if (blockId === null) continue
    const key = `${getBlockContainerId(element) ?? ""}\u0000${blockId}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [element])
    else group.push(element)
  }
  return Array.from(groups.values()).flatMap((group): readonly ContainerTargetCandidate[] => {
    const first = group[0]
    const last = group.at(-1)
    if (first === undefined || last === undefined) return []
    const blockId = getPersistedBlockId(first)
    if (blockId === null) return []
    const firstRect = first.getBoundingClientRect()
    const lastRect = last.getBoundingClientRect()
    const top = firstRect.top
    const bottom = lastRect.bottom
    const placement = clientY >= top + (bottom - top) / 2 ? "after" : "before"
    const element = placement === "after" ? last : first
    return [
      {
        depth: getElementDepth(element, body),
        distance:
          clientY < top ? top - clientY : clientY > bottom ? clientY - bottom : 0,
        destination: {
          containerId: getBlockContainerId(first),
          placement,
          targetBlockId: blockId
        },
        element
      }
    ]
  })
}

const getContainerCandidates = (
  body: HTMLElement,
  sourceElement: HTMLElement,
  clientY: number
): ContainerTargetCandidate[] =>
  Array.from(
    body.querySelectorAll<HTMLElement>("[data-note-block-container-id]")
  ).flatMap((container): readonly ContainerTargetCandidate[] => {
    if (sourceElement.contains(container) || !isCollapsibleBody(body, container)) return []
    const containerId = container.getAttribute("data-note-block-container-id")
    if (containerId === null) return []
    const rect = container.getBoundingClientRect()
    if (clientY < rect.top || clientY > rect.bottom) return []
    return [
      {
        depth: getElementDepth(container, body),
        distance: 0,
        destination: {
          containerId,
          placement: "after",
          targetBlockId: null
        },
        element: container
      }
    ]
  })

export const getBlockContainerTarget = (
  body: HTMLElement,
  sourceElement: HTMLElement,
  clientY: number
): BlockContainerTarget | null => {
  const candidates = [
    ...getBlockCandidates(body, sourceElement, clientY),
    ...getContainerCandidates(body, sourceElement, clientY)
  ]
  candidates.sort(
    (left, right) =>
      left.distance - right.distance || right.depth - left.depth
  )
  const target = candidates[0]
  return target === undefined
    ? null
    : { destination: target.destination, element: target.element }
}

export const getContainerRepresentatives = (
  body: HTMLElement,
  containerId: BlockContainerId
): HTMLElement[] => {
  const container = getBlockContainerElement(body, containerId)
  if (container === null) return []

  const blockIds = new Set<string>()
  return Array.from(container.children).filter(
    (element): element is HTMLElement => {
      if (
        !(element instanceof HTMLElement) ||
        !element.hasAttribute("data-note-sortable-id") ||
        !isRendererOwnedDragElement(body, element)
      ) {
        return false
      }
      const blockId = getPersistedBlockId(element)
      if (blockId === null || blockIds.has(blockId)) return false
      blockIds.add(blockId)
      return true
    }
  )
}
