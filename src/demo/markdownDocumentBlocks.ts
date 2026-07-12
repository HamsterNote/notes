import type {
  Blockquote,
  Code,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root
} from "mdast"

import type {
  NoteBlock,
  NoteCalloutTone,
  NoteChecklistItem
} from "../lib/types"
import type {
  BlockDirective,
  ChecklistDirective
} from "./markdownDocumentDirectives"
import { parseAttributes, parseHnDirective } from "./markdownDocumentDirectives"

export const parseMarkdownBlocks = (tree: Root): readonly NoteBlock[] => {
  const blocks: NoteBlock[] = []
  let blockDirective: BlockDirective | undefined
  let checklistDirective: ChecklistDirective | undefined

  for (const node of tree.children) {
    switch (node.type) {
      case "html": {
        const directive = parseHnDirective(node)
        if (directive?.directive === "block") {
          if (directive.empty === true) {
            blocks.push(parseEmptyParagraph(directive))
            blockDirective = undefined
          } else {
            blockDirective = directive
          }
        }
        if (directive?.directive === "checklist") checklistDirective = directive
        break
      }
      case "heading": {
        const block = parseHeading(node, blockDirective, blocks.length)
        blockDirective = undefined
        if (block !== undefined) blocks.push(block)
        break
      }
      case "paragraph":
        blocks.push(parseParagraph(node, blockDirective, blocks.length))
        blockDirective = undefined
        break
      case "blockquote":
        blocks.push(parseBlockquote(node, blockDirective, blocks.length))
        blockDirective = undefined
        break
      case "list":
        if (checklistDirective !== undefined && isChecklistList(node)) {
          blocks.push(parseChecklist(node, checklistDirective))
          checklistDirective = undefined
        }
        break
      case "code":
        blocks.push(parseCode(node, blockDirective, blocks.length))
        blockDirective = undefined
        break
      default:
        break
    }
  }

  return blocks
}

const parseHeading = (
  node: Heading,
  directive: BlockDirective | undefined,
  index: number
): NoteBlock | undefined => {
  if (!isHeadingLevel(node.depth)) return undefined

  return {
    id: directive?.id ?? fallbackBlockId(index),
    kind: "heading",
    level: node.depth,
    text: textFromPhrasing(node.children),
    ...(directive?.eyebrow === undefined ? {} : { eyebrow: directive.eyebrow })
  }
}

const parseParagraph = (
  node: Paragraph,
  directive: BlockDirective | undefined,
  index: number
): NoteBlock => ({
  id: directive?.id ?? fallbackBlockId(index),
  kind: "paragraph",
  text: textFromPhrasing(node.children),
  ...(directive?.tone === undefined ? {} : { tone: directive.tone })
})

const parseEmptyParagraph = (directive: BlockDirective): NoteBlock => ({
  id: directive.id,
  kind: "paragraph",
  text: "",
  ...(directive.tone === undefined ? {} : { tone: directive.tone })
})

const parseBlockquote = (
  node: Blockquote,
  directive: BlockDirective | undefined,
  index: number
): NoteBlock => {
  const id = directive?.id ?? fallbackBlockId(index)
  const lines = textFromBlockquote(node).split("\n")
  const header = parseCalloutHeader(lines[0])

  if (header !== undefined) {
    return {
      id,
      kind: "callout",
      tone: header.tone,
      title: header.title,
      text: lines.slice(1).join("\n").trim()
    }
  }

  const lastLine = lines.at(-1)
  const author = lastLine?.startsWith("— ")
    ? lastLine.slice(2).trim()
    : undefined

  return {
    id,
    kind: "quote",
    text: (author === undefined ? lines : lines.slice(0, -1)).join("\n").trim(),
    ...(author === undefined ? {} : { author })
  }
}

const parseChecklist = (
  node: List,
  directive: ChecklistDirective
): NoteBlock => ({
  id: directive.id,
  kind: "checklist",
  title: directive.title,
  items: node.children.flatMap(parseChecklistItem)
})

const parseChecklistItem = (
  item: ListItem,
  index: number
): readonly NoteChecklistItem[] => {
  if (typeof item.checked !== "boolean") return []
  const paragraph = item.children[0]
  if (paragraph?.type !== "paragraph") return []

  const firstInline = paragraph.children[0]
  const directive =
    firstInline?.type === "html" ? parseHnDirective(firstInline) : undefined
  const hasItemId = directive?.directive === "item"
  const children = hasItemId ? paragraph.children.slice(1) : paragraph.children

  return [
    {
      id: hasItemId ? directive.id : `item-${index + 1}`,
      checked: item.checked,
      text: textFromPhrasing(children).trim()
    }
  ]
}

const parseCode = (
  node: Code,
  directive: BlockDirective | undefined,
  index: number
): NoteBlock => {
  const filename = parseAttributes(node.meta ?? "").filename

  return {
    id: directive?.id ?? fallbackBlockId(index),
    kind: "code",
    language: node.lang ?? "",
    code: node.value,
    ...(filename === undefined ? {} : { filename })
  }
}

const parseCalloutHeader = (
  firstLine: string | undefined
): { readonly tone: NoteCalloutTone; readonly title: string } | undefined => {
  const match = /^\[!(info|success|warning)]\s+(.+)$/.exec(firstLine ?? "")
  const tone = parseCalloutTone(match?.[1])
  const title = match?.[2]

  return tone === undefined || title === undefined ? undefined : { tone, title }
}

const parseCalloutTone = (
  value: string | undefined
): NoteCalloutTone | undefined => {
  switch (value) {
    case "info":
    case "success":
    case "warning":
      return value
    default:
      return undefined
  }
}

const textFromBlockquote = (node: Blockquote): string =>
  node.children
    .map((child) => {
      if (child.type === "paragraph") return textFromPhrasing(child.children)
      return ""
    })
    .join("\n\n")

const textFromPhrasing = (children: readonly PhrasingContent[]): string =>
  children.map(textFromInline).join("")

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
      return isSoftBreakHtml(node.value) ? "\n" : ""
    case "image":
    case "imageReference":
      return node.alt ?? ""
    case "footnoteReference":
      return node.identifier
    default:
      return ""
  }
}

const isChecklistList = (node: List): boolean =>
  node.children.length > 0 &&
  node.children.every((item) => typeof item.checked === "boolean")

const isSoftBreakHtml = (value: string): boolean => /^<br\s*\/?>$/i.test(value)

const isHeadingLevel = (value: number): value is 1 | 2 | 3 | 4 | 5 =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5

const fallbackBlockId = (index: number): string => `block-${index + 1}`
