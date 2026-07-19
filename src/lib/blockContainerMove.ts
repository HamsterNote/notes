import type { NoteBlock } from "./types"

export type BlockContainerId = string | null

export type BlockContainerDestination = {
  readonly containerId: BlockContainerId
  readonly placement: "after" | "before"
  readonly targetBlockId: string | null
}

type MoveBlockToContainerInput = {
  readonly blocks: readonly NoteBlock[]
  readonly destination: BlockContainerDestination
  readonly sourceBlockId: string
  readonly sourceContainerId: BlockContainerId
}

type ContainerUpdate = Readonly<{
  blocks: readonly NoteBlock[]
  updated: boolean
}>

const updateContainer = (
  blocks: readonly NoteBlock[],
  containerId: BlockContainerId,
  update: (children: readonly NoteBlock[]) => ContainerUpdate
): ContainerUpdate => {
  if (containerId === null) return update(blocks)

  let updated = false
  const nextBlocks = blocks.map((block) => {
    if (block.kind !== "collapsible") return block
    if (block.id === containerId) {
      const result = update(block.blocks)
      updated = result.updated
      return result.updated ? { ...block, blocks: result.blocks } : block
    }
    const result = updateContainer(block.blocks, containerId, update)
    if (!result.updated) return block
    updated = true
    return { ...block, blocks: result.blocks }
  })
  return { blocks: updated ? nextBlocks : blocks, updated }
}

export const updateBlockContainer = (
  blocks: readonly NoteBlock[],
  containerId: BlockContainerId,
  update: (children: readonly NoteBlock[]) => readonly NoteBlock[]
): readonly NoteBlock[] =>
  updateContainer(blocks, containerId, (children) => {
    const nextChildren = update(children)
    return { blocks: nextChildren, updated: nextChildren !== children }
  }).blocks

const blockContainsContainer = (
  block: NoteBlock,
  containerId: string
): boolean => {
  if (block.kind !== "collapsible") return false
  if (block.id === containerId) return true
  return block.blocks.some((child) => blockContainsContainer(child, containerId))
}

const hasSameBlockOrder = (
  left: readonly NoteBlock[],
  right: readonly NoteBlock[]
): boolean =>
  left.length === right.length &&
  left.every((block, index) => {
    const other = right[index]
    if (other === undefined || block.id !== other.id || block.kind !== other.kind) {
      return false
    }
    return block.kind !== "collapsible" ||
      other.kind !== "collapsible"
      ? true
      : hasSameBlockOrder(block.blocks, other.blocks)
  })

export const moveBlockToContainer = ({
  blocks,
  destination,
  sourceBlockId,
  sourceContainerId
}: MoveBlockToContainerInput): readonly NoteBlock[] => {
  let sourceBlock: NoteBlock | undefined
  const extracted = updateContainer(blocks, sourceContainerId, (children) => {
    const sourceIndex = children.findIndex((child) => child.id === sourceBlockId)
    sourceBlock = children[sourceIndex]
    if (sourceBlock === undefined) return { blocks: children, updated: false }
    return {
      blocks: children.filter((_, index) => index !== sourceIndex),
      updated: true
    }
  })
  if (!extracted.updated || sourceBlock === undefined) return blocks
  const movedBlock = sourceBlock
  if (
    destination.containerId !== null &&
    blockContainsContainer(movedBlock, destination.containerId)
  ) {
    return blocks
  }

  const inserted = updateContainer(
    extracted.blocks,
    destination.containerId,
    (children) => {
      const targetIndex =
        destination.targetBlockId === null
          ? children.length
          : children.findIndex(
              (child) => child.id === destination.targetBlockId
            )
      if (targetIndex < 0) return { blocks: children, updated: false }
      const insertionIndex =
        destination.targetBlockId === null || destination.placement === "before"
          ? targetIndex
          : targetIndex + 1
      const nextChildren = children.slice()
      nextChildren.splice(insertionIndex, 0, movedBlock)
      return { blocks: nextChildren, updated: true }
    }
  )
  return inserted.updated && !hasSameBlockOrder(blocks, inserted.blocks)
    ? inserted.blocks
    : blocks
}
