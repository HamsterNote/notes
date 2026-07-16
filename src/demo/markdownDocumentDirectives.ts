import type { Html } from "mdast"

export type ParagraphTone = "default" | "muted" | "accent"

type AttributeName =
  | "empty"
  | "eyebrow"
  | "filename"
  | "height"
  | "id"
  | "kind"
  | "title"
  | "tone"
  | "width"

export type ParsedAttributes = Partial<Record<AttributeName, string>>

export type BlockDirective = {
  readonly directive: "block"
  readonly id: string
  readonly empty?: true
  readonly eyebrow?: string
  readonly kind?: "formula"
  readonly tone?: ParagraphTone
  readonly width?: number
  readonly height?: number
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
  const kind = attributes.kind === "formula" ? "formula" : undefined
  const width = parsePositiveInteger(attributes.width)
  const height = parsePositiveInteger(attributes.height)

  return {
    directive: "block",
    id,
    ...(empty === undefined ? {} : { empty }),
    ...(eyebrow === undefined ? {} : { eyebrow }),
    ...(kind === undefined ? {} : { kind }),
    ...(tone === undefined ? {} : { tone }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height })
  }
}

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

const isAttributeName = (value: string | undefined): value is AttributeName => {
  switch (value) {
    case "empty":
    case "eyebrow":
    case "filename":
    case "height":
    case "id":
    case "kind":
    case "title":
    case "tone":
    case "width":
      return true
    default:
      return false
  }
}
