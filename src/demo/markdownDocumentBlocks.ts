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
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"
import {
  NOTE_CARD_FENCE_LANGUAGE,
  parseCardData
} from "../lib/cardData"
import { NOTE_DRAWING_FENCE_LANGUAGE } from "../lib/drawingData"
import { createNoteId } from "../lib/noteId"
import type {
  NoteBlock,
  NoteCalloutTone,
  NoteTodoItem
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
        if (isTodoList(node)) {
          blocks.push(parseTodo(node))
        } else if (node.ordered) {
          blocks.push(...parseOrderedList(node))
        } else {
          blocks.push(...parseUnorderedList(node))
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

const parseTodo = (node: List): NoteBlock => ({
  id: createNoteId(),
  kind: "todo",
  title: "",
  items: node.children.flatMap(parseTodoItem)
})

const parseTodoItem = (item: ListItem): readonly NoteTodoItem[] => {
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

const parseUnorderedList = (node: List): readonly NoteBlock[] =>
  node.children.flatMap(parseListItem).map((text) => ({
    id: createNoteId(),
    kind: "unorderedList",
    text
  }))

const parseOrderedList = (node: List): readonly NoteBlock[] =>
  node.children.flatMap(parseListItem).map((text) => ({
    id: createNoteId(),
    kind: "orderedList",
    text
  }))

const parseListItem = (item: ListItem): readonly string[] => {
  if (typeof item.checked === "boolean") return []
  const paragraph = item.children[0]
  if (paragraph?.type !== "paragraph") return []

  return [textFromPhrasing(paragraph.children).trim()]
}

const parseCode = (node: Code): NoteBlock => {
  if (node.lang === "math") {
    return {
      id: createNoteId(),
      kind: "formula",
      formula: node.value
    }
  }

  if (node.lang === "directory") {
    return {
      id: createNoteId(),
      kind: "directory"
    }
  }

  if (node.lang === "collapsible") {
    return parseCollapsibleCode(node.value)
  }

  if (node.lang === NOTE_CARD_FENCE_LANGUAGE) {
    const data = parseCardData(node.value)
    if (data !== undefined) {
      return { id: createNoteId(), kind: "card", data }
    }
  }

  // 画板块：围栏内容为 DrawingValue JSON，原样存入 data 字段
  if (node.lang === NOTE_DRAWING_FENCE_LANGUAGE) {
    return {
      id: createNoteId(),
      kind: "drawing",
      data: node.value
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

// 解析 collapsible fenced 块：首行 JSON 元数据（title + collapsed），空行后是内部 markdown，递归解析为子 blocks
const parseCollapsibleCode = (value: string): NoteBlock => {
  const separator = value.indexOf("\n\n")
  const metadataJson = separator === -1 ? value : value.slice(0, separator)
  const body = separator === -1 ? "" : value.slice(separator + 2)

  const metadata = JSON.parse(metadataJson) as {
    readonly title: string
    readonly collapsed: boolean
  }

  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(body)
  const blocks = parseMarkdownBlocks(tree)

  return {
    id: createNoteId(),
    kind: "collapsible",
    title: metadata.title,
    collapsed: metadata.collapsed,
    blocks
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

const isTodoList = (node: List): boolean =>
  node.children.length > 0 &&
  node.children.every((item) => typeof item.checked === "boolean")

const isHeadingLevel = (value: number): value is 1 | 2 | 3 | 4 | 5 =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5

const parseFilename = (meta: string | null | undefined): string | undefined => {
  const match = /(?:^|\s)filename="((?:\\.|[^"\\])*)"(?:\s|$)/u.exec(meta ?? "")
  return match?.[1]?.replaceAll('\\"', '"').replaceAll("\\\\", "\\")
}
