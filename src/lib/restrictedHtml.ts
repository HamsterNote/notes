type HtmlProfile = "body" | "code" | "title"

const titleTags = new Set(["B", "CODE", "DEL", "EM", "I", "S", "STRIKE", "STRONG", "U"])
const bodyTags = new Set([
  ...titleTags,
  "A",
  "BR",
  "MARK",
  "SPAN",
  "SUB",
  "SUP",
  "FONT",
])
const codeTags = new Set(["SPAN"])
const discardedTags = new Set(["IFRAME", "NOSCRIPT", "OBJECT", "SCRIPT", "STYLE", "TEMPLATE"])
const safeClassNames = new Set([
  "hn-note-inline-code",
  "hn-note-inline-formula",
  "hn-note-link-mention",
])
const safeTextColors = new Set(["#ef4444", "#3b82f6", "#22c55e", "#000000", "#6b7280"])

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const readableText = (value: string): string =>
  value
    .replace(/<(script|style|template|noscript|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")

export const sanitizeRestrictedHref = (value: string): string | null => {
  const normalized = value.trim()
  if (
    normalized.startsWith("#") ||
    normalized.startsWith("/") ||
    /^(https?:|mailto:|tel:)/i.test(normalized) ||
    normalized.startsWith("hnmagic://")
  ) {
    return normalized
  }
  return null
}

const copyAllowedAttributes = (source: Element, target: Element): void => {
  const classes = Array.from(source.classList).filter(
    (name) => safeClassNames.has(name) || name.startsWith("hljs-"),
  )
  if (classes.length > 0) target.setAttribute("class", classes.join(" "))

  if (source.tagName === "A") {
    const href = source.getAttribute("href")
    const sanitizedHref = href === null ? null : sanitizeRestrictedHref(href)
    if (sanitizedHref !== null) target.setAttribute("href", sanitizedHref)
  }
  if (source.tagName !== "SPAN") return

  const color = source.getAttribute("data-hn-color")
  if (color !== null && safeTextColors.has(color.toLowerCase())) {
    target.setAttribute("data-hn-color", color.toLowerCase())
  }

  const formula = source.getAttribute("data-hn-inline-formula")
  const noteLinkId = source.getAttribute("data-note-link-id")
  const rendererBoundaryAttributes = [
    "data-note-drag-kind",
    "data-note-drag-parent-id",
    "data-note-select-id",
    "data-note-sortable-id",
    "id",
  ] as const
  if (formula !== null) target.setAttribute("data-hn-inline-formula", formula)
  if (noteLinkId !== null) target.setAttribute("data-note-link-id", noteLinkId)
  if (formula !== null && source.getAttribute("contenteditable") === "false") {
    target.setAttribute("contenteditable", "false")
  }
  for (const name of rendererBoundaryAttributes) {
    const value = source.getAttribute(name)
    if (value !== null) target.setAttribute(name, value)
  }
}

const sanitizeChildren = (
  source: ParentNode,
  target: Node,
  documentNode: Document,
  profile: HtmlProfile,
): void => {
  const allowedTags = profile === "title"
    ? titleTags
    : profile === "code"
      ? codeTags
      : bodyTags
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(documentNode.createTextNode(child.textContent ?? ""))
      continue
    }
    if (!(child instanceof Element) || discardedTags.has(child.tagName)) continue
    if (!allowedTags.has(child.tagName)) {
      sanitizeChildren(child, target, documentNode, profile)
      continue
    }
    const isColorFont = profile === "body" && child.tagName === "FONT"
    const fontColor = child.getAttribute("color")?.toLowerCase() ?? ""
    const sanitized = documentNode.createElement(isColorFont ? "span" : child.tagName.toLowerCase())
    if (isColorFont && safeTextColors.has(fontColor)) {
      sanitized.setAttribute("data-hn-color", fontColor)
    }
    copyAllowedAttributes(child, sanitized)
    sanitizeChildren(child, sanitized, documentNode, profile)
    target.appendChild(sanitized)
  }
}

const sanitizeHtml = (value: string, profile: HtmlProfile): string => {
  if (typeof DOMParser === "undefined") return escapeHtml(readableText(value))
  const parsed = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html")
  const output = parsed.createElement("div")
  sanitizeChildren(parsed.body, output, parsed, profile)
  return output.innerHTML
}

export const sanitizeTitleHtml = (value: string): string => sanitizeHtml(value, "title")

export const sanitizeBodyHtml = (value: string): string => sanitizeHtml(value, "body")

export const sanitizeCodeHighlightHtml = (value: string): string => sanitizeHtml(value, "code")

export const plainTextToRestrictedHtml = (value: string): string =>
  escapeHtml(value).replaceAll("\n", "<br>")

export const restrictedHtmlTextLength = (value: string): number => {
  if (typeof DOMParser === "undefined") return readableText(value).length
  return noteTextLength(
    new DOMParser().parseFromString(`<body>${value}</body>`, "text/html").body,
  )
}
import { noteTextLength } from "./noteTextOffset"
