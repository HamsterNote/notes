export const demoNoteIds = {
  hero: "1ef93f82-e86f-4795-b249-3f6011a20c87",
  intro: "7aae3014-c9ae-42f1-893a-586ecd7d4a88",
  principle: "e2a94251-8e53-4f70-8042-99589ebd11c9",
  subheading: "312b5791-987a-4faa-858e-d1c1255e697b",
  checklist: "edf8b3e9-3228-4ca1-967b-6465043453a9",
  library: "a9470f81-f2f9-49bc-8061-7bb3b076663c",
  demo: "3f195613-59b0-470c-8f1d-16bdd46feb2b",
  publish: "13a8f2ac-28ab-4d09-8469-1bda8d0efa3d",
  callout: "ace4b19e-fda1-4113-b5aa-75f826b53670",
  codeHeading: "b802f4c0-135e-483e-b087-c86f8b50acc9",
  code: "a6f7a6c1-8dc0-45b2-9014-d989968d7b9e",
  ending: "40db2881-c3b9-4198-b5ec-20d1b05d9706",
  warning: "86774170-028f-4184-b2c6-51523255cd8f",
  table: "41fe1a0b-737e-4f28-8854-5247d8cb4d99"
} as const

export const demoMarkdownDocument: string = `\`\`\`json
{
  "title": "Launch Notes for the first public package",
  "summary": "An editorial note surface for changelogs, meeting recaps, or product knowledge cards.",
  "tagLabel": "Release candidate",
  "updatedAt": "2026-07-11"
}
\`\`\`

<!-- hn:block id="${demoNoteIds.hero}" eyebrow="Hamster Note" -->
# Ship a note component that feels editorial instead of generic

<!-- hn:block id="${demoNoteIds.intro}" tone="accent" -->
This demo shows a single React component rendering structured note content with visual hierarchy, callouts, checklists, and code snippets for product notes, changelogs, or knowledge cards.

<!-- hn:block id="${demoNoteIds.principle}" -->
> Readable note surfaces are not just about markdown support. They are about pacing, contrast, and helping important details stay visible after the first skim.
> — Design note

<!-- hn:block id="${demoNoteIds.subheading}" eyebrow="Launch checklist" -->
## What the first version should prove

<!-- hn:checklist id="${demoNoteIds.checklist}" title="Release readiness" -->
- [x] <!-- hn:item id="${demoNoteIds.library}" --> Export a typed NoteContent component from the package entry.
- [x] <!-- hn:item id="${demoNoteIds.demo}" --> Keep a Vite demo page that exercises the component with realistic content.
- [x] <!-- hn:item id="${demoNoteIds.publish}" --> Publish stable tags as latest and beta tags with a prerelease dist-tag.

<!-- hn:block id="${demoNoteIds.callout}" -->
> [!info] Structured input, flexible visuals
> The component consumes a typed block array instead of raw markdown so product teams can map CMS content, database rows, or editor output into one stable UI surface.

<!-- hn:block id="${demoNoteIds.codeHeading}" -->
### Consumer example

<!-- hn:block id="${demoNoteIds.code}" -->
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

<!-- hn:block id="${demoNoteIds.ending}" tone="muted" -->
The current component intentionally focuses on note reading, not editing. That keeps the API small and makes it a clean base for changelog cards, docs highlights, meeting summaries, or AI-generated note capsules.

<!-- hn:block id="${demoNoteIds.warning}" -->
> [!warning] Versioning rule
> Tag v1.0.0 publishes the latest release. Tag v1.0.0-beta.1 publishes the same package under the beta dist-tag without replacing latest.

<!-- hn:block id="${demoNoteIds.table}" -->
| Feature | Status | Notes |
| --- | --- | --- |
| Theme color | Done | Customizable via themeColor prop |
| Inline editing | Done | Title, summary, blocks all editable |
| Table operations | In Progress | Row/column add/delete via edge buttons |
| Code highlight | Done | highlight.js with language selector |`
