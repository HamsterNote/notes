import { NoteContent } from "../lib"

import { demoBlocks } from "./noteData"
import "./app.css"

export const App = () => {
  return (
    <main className="demo-page">
      <section className="demo-shell">
        <div className="demo-copy">
          <p className="demo-kicker">Component library demo</p>
          <h1>@hamster-note/notes</h1>
          <p>
            A React 19 note-content component built as a publishable library, with a local demo and a
            tag-driven release workflow.
          </p>
        </div>

        <NoteContent
          blocks={demoBlocks}
          summary="An editorial note surface for changelogs, meeting recaps, or product knowledge cards."
          tagLabel="Release candidate"
          title="Launch Notes for the first public package"
          updatedAt="2026-07-11"
        />
      </section>
    </main>
  )
}
