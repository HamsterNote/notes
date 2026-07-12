export const demoMarkdownDocument: string = `\`\`\`json
{
  "title": "Launch Notes for the first public package",
  "summary": "An editorial note surface for changelogs, meeting recaps, or product knowledge cards.",
  "tagLabel": "Release candidate",
  "updatedAt": "2026-07-11"
}
\`\`\`

<!-- hn:block id="hero" eyebrow="Hamster Note" -->
# Ship a note component that feels editorial instead of generic

<!-- hn:block id="intro" tone="accent" -->
This demo shows a single React component rendering structured note content with visual hierarchy, callouts, checklists, and code snippets for product notes, changelogs, or knowledge cards.

<!-- hn:block id="principle" -->
> Readable note surfaces are not just about markdown support. They are about pacing, contrast, and helping important details stay visible after the first skim.
> — Design note

<!-- hn:block id="subheading" eyebrow="Launch checklist" -->
## What the first version should prove

<!-- hn:checklist id="checklist" title="Release readiness" -->
- [x] <!-- hn:item id="library" --> Export a typed NoteContent component from the package entry.
- [x] <!-- hn:item id="demo" --> Keep a Vite demo page that exercises the component with realistic content.
- [x] <!-- hn:item id="publish" --> Publish stable tags as latest and beta tags with a prerelease dist-tag.

<!-- hn:block id="callout" -->
> [!info] Structured input, flexible visuals
> The component consumes a typed block array instead of raw markdown so product teams can map CMS content, database rows, or editor output into one stable UI surface.

<!-- hn:block id="code-heading" -->
### Consumer example

<!-- hn:block id="code" -->
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

<!-- hn:block id="ending" tone="muted" -->
The current component intentionally focuses on note reading, not editing. That keeps the API small and makes it a clean base for changelog cards, docs highlights, meeting summaries, or AI-generated note capsules.

<!-- hn:block id="warning" -->
> [!warning] Versioning rule
> Tag v1.0.0 publishes the latest release. Tag v1.0.0-beta.1 publishes the same package under the beta dist-tag without replacing latest.`
