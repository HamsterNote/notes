import type { Html } from "mdast"

export type ParagraphTone = "default" | "muted" | "accent"

type AttributeName = "empty" | "eyebrow" | "filename" | "id" | "title" | "tone"

export type ParsedAttributes = Partial<Record<AttributeName, string>>

export type BlockDirective = {
  readonly directive: "block"
  readonly id: string
  readonly empty?: true
  readonly eyebrow?: string
  readonly tone?: ParagraphTone
}

export type ChecklistDirective = {
  readonly directive: "checklist"
  readonly id: string
  readonly title: string
}

type ItemDirective = { readonly directive: "item"; readonly id: string }
type HnDirective = BlockDirective | ChecklistDirective | ItemDirective

export const parseHnDirective = (node: Html): HnDirective | undefined => {
  const match = /^<!--\s*hn:(block|checklist|item)\s*([^>]*)-->$/.exec(
    node.value
  )
  const directive = match?.[1]
  const rawAttributes = match?.[2]
  if (directive === undefined || rawAttributes === undefined) return undefined

  const attributes = parseAttributes(rawAttributes)
  const id = attributes.id
  const title = attributes.title

  switch (directive) {
    case "block":
      return id === undefined ? undefined : buildBlockDirective(id, attributes)
    case "checklist":
      return id === undefined || title === undefined
        ? undefined
        : { directive, id, title }
    case "item":
      return id === undefined ? undefined : { directive, id }
    default:
      return undefined
  }
}

export const parseAttributes = (value: string): ParsedAttributes => {
  const attributes: Partial<Record<AttributeName, string>> = {}

  for (const match of value.matchAll(/([A-Za-z][\w:-]*)="([^"]*)"/g)) {
    const key = match[1]
    const attributeValue = match[2]
    if (isAttributeName(key) && attributeValue !== undefined) {
      attributes[key] = attributeValue
    }
  }

  return attributes
}

export const parseParagraphTone = (
  value: string | undefined
): ParagraphTone | undefined => {
  switch (value) {
    case "default":
    case "muted":
    case "accent":
      return value
    default:
      return undefined
  }
}

const buildBlockDirective = (
  id: string,
  attributes: Readonly<ParsedAttributes>
): BlockDirective => {
  const eyebrow = attributes.eyebrow
  const empty = attributes.empty === "true" ? true : undefined
  const tone = parseParagraphTone(attributes.tone)

  return {
    directive: "block",
    id,
    ...(empty === undefined ? {} : { empty }),
    ...(eyebrow === undefined ? {} : { eyebrow }),
    ...(tone === undefined ? {} : { tone })
  }
}

const isAttributeName = (value: string | undefined): value is AttributeName => {
  switch (value) {
    case "empty":
    case "eyebrow":
    case "filename":
    case "id":
    case "title":
    case "tone":
      return true
    default:
      return false
  }
}
