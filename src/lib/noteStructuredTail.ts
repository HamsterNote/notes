import { replacementForRegion } from "./noteRegionCodec"
import type { NoteBlock } from "./types"

const findCodeBlock = (
  blocks: readonly NoteBlock[],
  regionId: string,
): Extract<NoteBlock, { readonly kind: "code" }> | null => {
  for (const block of blocks) {
    if (block.kind === "code" && block.id === regionId) return block
    if (block.kind === "collapsible") {
      const nested = findCodeBlock(block.blocks, regionId)
      if (nested) return nested
    }
  }
  return null
}

export const createStructuredTailBlock = (
  blocks: readonly NoteBlock[],
  endRegionId: string | null,
  id: string,
  clipboardTailHtml: string,
  targetSuffix: string,
): NoteBlock => {
  const code = endRegionId ? findCodeBlock(blocks, endRegionId) : null
  return code
    ? {
        ...code,
        id,
        code: `${replacementForRegion(clipboardTailHtml, "code")}${targetSuffix}`,
      }
    : { id, kind: "paragraph", text: `${clipboardTailHtml}${targetSuffix}` }
}
