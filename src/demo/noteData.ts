export const demoMarkdownDocument: string = `\`\`\`json
{
  "title": "Launch Notes for the first public package",
  "summary": "An editorial note surface for changelogs, meeting recaps, or product knowledge cards.",
  "tagLabel": "Release candidate",
  "updatedAt": "2026-07-11"
}
\`\`\`

# Ship a note component that feels editorial instead of generic

This demo shows a single React component rendering structured note content with visual hierarchy, callouts, checklists, and code snippets for product notes, changelogs, or knowledge cards.

> Readable note surfaces are not just about markdown support. They are about pacing, contrast, and helping important details stay visible after the first skim.
> — Design note

## What the first version should prove

- [x] Export a typed NoteContent component from the package entry.
- [x] Keep a Vite demo page that exercises the component with realistic content.
- [x] Publish stable tags as latest and beta tags with a prerelease dist-tag.

> [!info] Structured input, flexible visuals
> The component consumes a typed block array instead of raw markdown so product teams can map CMS content, database rows, or editor output into one stable UI surface.

### Consumer example

\`\`\`tsx filename="App.tsx"
import { NoteContent } from "@hamster-note/notes"

export const App = () => (
  <NoteContent
    title="Launch Notes"
    summary="Structured content blocks with a polished card layout"
    blocks={blocks}
  />
)
\`\`\`

The current component intentionally focuses on note reading, not editing. That keeps the API small and makes it a clean base for changelog cards, docs highlights, meeting summaries, or AI-generated note capsules.

> [!warning] Versioning rule
> Tag v1.0.0 publishes the latest release. Tag v1.0.0-beta.1 publishes the same package under the beta dist-tag without replacing latest.

| Feature | Status | Notes |
| --- | --- | --- |
| Theme color | Done | Customizable via themeColor prop |
| Inline editing | Done | Title, summary, blocks all editable |
| Table operations | In Progress | Row/column add/delete via edge buttons |
| Code highlight | Done | highlight.js with language selector |

\`\`\`collapsible
{"title":"Roadmap","collapsed":false}

### Next up

- [ ] Add drag-and-drop for nested blocks
- [ ] Export collapsible state to markdown

Collapsible blocks can hold any combination of notes, lists, and callouts.
\`\`\``
