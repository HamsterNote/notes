import type { Blockquote, Paragraph, PhrasingContent } from "mdast"

import type { NotePictureBlock } from "../lib/types"

type PictureBlockMetadata = {
  readonly id: string
  readonly width: number | undefined
  readonly height: number | undefined
}

export const pictureFromParagraph = (
  node: Paragraph,
  metadata: PictureBlockMetadata
): NotePictureBlock | undefined => {
  const image = node.children.length === 1 ? node.children[0] : undefined
  if (image?.type !== "image") return undefined

  return {
    id: metadata.id,
    kind: "picture",
    url: image.url,
    filename: image.alt ?? "",
    ...(metadata.width === undefined ? {} : { width: metadata.width }),
    ...(metadata.height === undefined ? {} : { height: metadata.height })
  }
}

export const serializePicture = (block: NotePictureBlock): string => {
  const filename = block.filename
    .replaceAll("\\", "\\\\")
    .replaceAll("]", "\\]")
  const url = block.url
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")

  return `![${filename}](<${url}>)`
}

export const textFromBlockquote = (node: Blockquote): string =>
  node.children
    .map((child) => {
      if (child.type === "paragraph") return textFromPhrasing(child.children)
      return ""
    })
    .join("\n\n")

export const textFromPhrasing = (
  children: readonly PhrasingContent[]
): string => children.map(textFromInline).join("")

const textFromInline = (node: PhrasingContent): string => {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value
    case "break":
      return "\n"
    case "delete":
    case "emphasis":
    case "strong":
    case "link":
    case "linkReference":
      return textFromPhrasing(node.children)
    case "html":
      return /^<br\s*\/?>$/i.test(node.value) ? "\n" : ""
    case "image":
      return serializeInlineImage(node.alt ?? "", node.url)
    case "imageReference":
      return `![${escapeImageLabel(node.alt ?? "")}][${node.identifier}]`
    case "footnoteReference":
      return node.identifier
    default:
      return ""
  }
}

const escapeImageLabel = (label: string): string =>
  label.replaceAll("\\", "\\\\").replaceAll("]", "\\]")

const serializeInlineImage = (alt: string, url: string): string =>
  `![${escapeImageLabel(alt)}](<${url}>)`
