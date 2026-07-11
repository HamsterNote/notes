import type { NoteBlock } from "../lib"

export const demoBlocks: readonly NoteBlock[] = [
  {
    id: "hero",
    kind: "heading",
    level: 1,
    eyebrow: "Hamster Note",
    text: "Ship a note component that feels editorial instead of generic"
  },
  {
    id: "intro",
    kind: "paragraph",
    tone: "accent",
    text: "This demo shows a single React component rendering structured note content with visual hierarchy, callouts, checklists, and code snippets for product notes, changelogs, or knowledge cards."
  },
  {
    id: "principle",
    kind: "quote",
    text: "Readable note surfaces are not just about markdown support. They are about pacing, contrast, and helping important details stay visible after the first skim.",
    author: "Design note"
  },
  {
    id: "subheading",
    kind: "heading",
    level: 2,
    eyebrow: "Launch checklist",
    text: "What the first version should prove"
  },
  {
    id: "checklist",
    kind: "checklist",
    title: "Release readiness",
    items: [
      {
        id: "library",
        checked: true,
        text: "Export a typed NoteContent component from the package entry."
      },
      {
        id: "demo",
        checked: true,
        text: "Keep a Vite demo page that exercises the component with realistic content."
      },
      {
        id: "publish",
        checked: true,
        text: "Publish stable tags as latest and beta tags with a prerelease dist-tag."
      }
    ]
  },
  {
    id: "callout",
    kind: "callout",
    tone: "info",
    title: "Structured input, flexible visuals",
    text: "The component consumes a typed block array instead of raw markdown so product teams can map CMS content, database rows, or editor output into one stable UI surface."
  },
  {
    id: "code-heading",
    kind: "heading",
    level: 3,
    text: "Consumer example"
  },
  {
    id: "code",
    kind: "code",
    language: "tsx",
    filename: "App.tsx",
    code: `import { NoteContent } from "@hamster-note/notes"

export const App = () => (
  <NoteContent
    title="Launch Notes"
    summary="Structured content blocks with a polished card layout"
    blocks={blocks}
  />
)`
  },
  {
    id: "ending",
    kind: "paragraph",
    tone: "muted",
    text: "The current component intentionally focuses on note reading, not editing. That keeps the API small and makes it a clean base for changelog cards, docs highlights, meeting summaries, or AI-generated note capsules."
  },
  {
    id: "warning",
    kind: "callout",
    tone: "warning",
    title: "Versioning rule",
    text: "Tag v1.0.0 publishes the latest release. Tag v1.0.0-beta.1 publishes the same package under the beta dist-tag without replacing latest."
  }
] as const
