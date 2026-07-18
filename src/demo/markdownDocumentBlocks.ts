import type {
  Blockquote,
  Code,
  Heading,
  List,
  ListItem,
  Paragraph,
  Root,
  Table
} from "mdast"
import { createNoteId } from "../lib/noteId"
import type {
  NoteBlock,
  NoteCalloutTone,
  NoteChecklistItem
} from "../lib/types"
import {
  pictureFromParagraph,
  textFromBlockquote,
  textFromPhrasing
} from "./markdownDocumentPhrasing"

export const parseMarkdownBlocks = (tree: Root): readonly NoteBlock[] => {
  const blocks: NoteBlock[] = []

  for (const node of tree.children) {
    switch (node.type) {
      case "heading": {
        const block = parseHeading(node)
        if (block !== undefined) blocks.push(block)
        break
      }
      case "paragraph":
        blocks.push(parseParagraph(node))
        break
      case "blockquote":
        blocks.push(parseBlockquote(node))
        break
      case "list":
        if (isChecklistList(node)) {
          blocks.push(parseChecklist(node))
        }
        break
      case "code":
        blocks.push(parseCode(node))
        break
      case "table":
        blocks.push(parseTable(node))
        break
      default:
        break
    }
  }

  return blocks
}

const parseHeading = (node: Heading): NoteBlock | undefined => {
  if (!isHeadingLevel(node.depth)) return undefined

  return {
    id: createNoteId(),
    kind: "heading",
    level: node.depth,
    text: textFromPhrasing(node.children)
  }
}

const parseParagraph = (node: Paragraph): NoteBlock => {
  const id = createNoteId()
  const picture = pictureFromParagraph(node, id)
  return picture ?? {
    id,
    kind: "paragraph",
    text: textFromPhrasing(node.children)
  }
}

const parseBlockquote = (node: Blockquote): NoteBlock => {
  const id = createNoteId()
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

const parseChecklist = (node: List): NoteBlock => ({
  id: createNoteId(),
  kind: "checklist",
  title: "",
  items: node.children.flatMap(parseChecklistItem)
})

const parseChecklistItem = (item: ListItem): readonly NoteChecklistItem[] => {
  if (typeof item.checked !== "boolean") return []
  const paragraph = item.children[0]
  if (paragraph?.type !== "paragraph") return []

  return [
    {
      id: createNoteId(),
      checked: item.checked,
      text: textFromPhrasing(paragraph.children).trim()
    }
  ]
}

const parseCode = (node: Code): NoteBlock => {
  if (node.lang === "math") {
    return {
      id: createNoteId(),
      kind: "formula",
      formula: node.value
    }
  }

  const filename = parseFilename(node.meta)

  return {
    id: createNoteId(),
    kind: "code",
    language: node.lang ?? "",
    code: node.value,
    ...(filename === undefined ? {} : { filename })
  }
}

const parseTable = (node: Table): NoteBlock => ({
  id: createNoteId(),
  kind: "table",
  rows: node.children.map((row) =>
    row.children.map((cell) => textFromPhrasing(cell.children))
  )
})

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

const isChecklistList = (node: List): boolean =>
  node.children.length > 0 &&
  node.children.every((item) => typeof item.checked === "boolean")

const isHeadingLevel = (value: number): value is 1 | 2 | 3 | 4 | 5 =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5

const parseFilename = (meta: string | null | undefined): string | undefined => {
  const match = /(?:^|\s)filename="((?:\\.|[^"\\])*)"(?:\s|$)/u.exec(meta ?? "")
  return match?.[1]?.replaceAll('\\"', '"').replaceAll("\\\\", "\\")
}
