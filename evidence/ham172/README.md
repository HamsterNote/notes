# HAM-172: IME investigation — original defect is not yet established

This draft contains diagnostic tools and evidence only. It does not enable an
IME workaround or change the notes runtime. The original report remains open.

## Findings and limits

- WebBase baseline: `cc8a87b`, installed `@hamster-note/notes@3.2.0`.
  notes baseline: `6c923ec841396b71fcfcd4a3429add2da7b525aa`.
- The earlier HAM-107 report was **not** fixed in the input engine. Its developer
  and reviewer explicitly recorded that the original Chinese duplication could
  not be reproduced; the merged changes concerned presentation and block handles.
  It was later accepted by the user. We cannot name an IME-fix commit that regressed.
- HAM-76 was cancelled after the user said it was not a defect. The final comment
  explains that CDP's synthetic preedit could differ from a physical IME's blur
  commit. Its save gate was not adopted. It is not evidence for this issue's cause.
- HAM-107's original screenshot is from an iPhone-shaped native UI and contains
  separate `ni hao` / `你好` and `ha ha` / `哈哈` blocks. It establishes appearance,
  not the current reproduction platform or the event sequence.

The following WebKit experiment is a **hypothesis**, not a physical IME repro:

1. Dispatch synthetic composition events and manually put `nihao` in the DOM.
2. Dispatch synthetic `compositionend`, then press a real, ordinary Enter.
3. Manually replace text at the current caret with `你好`.

This produces two paragraphs in both published 3.2.0 and old 3.1.3-ham133.3, in
both a public Provider/View fixture and the WebBase HNN presentation fixture.
It only proves that inserting a native paragraph before a manual replacement can
strand the old text. **No observed physical IME trace establishes steps 2–3.**
The experiment therefore does not establish a 3.2.0 upgrade regression.

Chromium CDP's ordinary native composition/commit path produces one paragraph
(`你你好` after two successive compositions), in source and both package versions.
CDP is browser-level evidence; it still is not a physical input method.

## Layer boundaries

- `src/lib/editor/documentSession.ts:199`: the source Editor uses HNN extensions.
  At `:322`, local transactions apply once to authoritative state and update the
  source and peer views. At `:365`, the host receives an encoded snapshot.
- WebBase `webview/src/window-content/HnnDocumentSession.tsx:49` passes the loaded
  initial document, stable load key and `onBodyChange` into one Provider.
  `useHnnNotesDocument.ts:144` stores received body snapshots; it does not append
  the incoming text back into the editor. Provider callback updates do not replace
  the document for the same documentId/loadKey (`NoteDocumentProvider.tsx:27`).
  This rules out double writing **in these inspected paths**, not every runtime
  bridge behavior on an unobserved device.
- prosemirror-view `src/input.ts:107` returns early for `inOrNearComposition`.
  At `:496`, that includes composing state and a Safari 500 ms heuristic. A skipped
  keymap does not cancel the browser's default `beforeinput:insertParagraph`.
  This explains the synthetic experiment's native split, but does not prove the
  reported physical IME followed this path.

## HAM-173 / notes PR #22

PR #22 was OPEN during this investigation, with head
`3f0421270685a5bee4f91371b73c076a1fbbe306`. It modifies touch/pen hold focus,
selection and callout suppression in `blockReorder.ts`, not composition or input
bridging. Both main and that branch refuse to start a hold when `view.composing`.

The same WebKit experiment remains two paragraphs with the PR #22 file substituted
alone; adding the experimental guard gives one paragraph after a touch tap.
This shows PR #22 does not fix or introduce **this synthetic event-order result**.
Touch interactions on the user's actual platform remain unverified.

## Experimental guard — not enabled

`experimental-guard.patch` preserves a tested candidate for review. It cancels
Safari's native `insertParagraph` after a confirmation Enter, matching PM's
composition window. The laboratory screenshot changes from two lines to one.
It passes 14 focused checks and a full 904-test experimental suite, typecheck,
targeted lint and library build.

This patch is **not** included in runtime sources. It must not be promoted as the
reported fix: a genuine newline immediately after clicking a candidate could also
fall within the heuristic. Suppressing that newline without an observed IME trace
would repeat HAM-76's mistake. No package was published or integrated into WebBase.

## Tools and reproduction

From the notes repo with dependencies and Playwright browsers installed:

```sh
node scripts/probe-composition-input-browser.mjs
node scripts/probe-composition-input-browser.mjs --consumer=../WebBase/webview --label=published-3.2.0
node scripts/probe-composition-input-browser.mjs --consumer=../WebBase/old-notes/package --label=previous-ham133.3
node scripts/probe-composition-input-browser.mjs --reorder-ref=origin/agent/agent/9f56fbe6398a --label=with-pr22-before
```

`--reorder-source=<file>` accepts a `git show <ref>:src/lib/editor/blockReorder.ts`
export when running in a container without Git. The installed old package is an
investigation fixture, not a new dependency. `--expect-no-native-paragraph` can
compare a future candidate; it is not the expected baseline behavior.

The probe checks DOM, a second shared view and save payload agreement, plus a
later intentional Enter. It also checks that the event recorder observes input
and mutations, records defaultPrevented, and removes listeners on stop.

The final diagnostics branch passes `corepack yarn typecheck` and the unchanged
runtime's 41-file / 890-test suite. Both new scripts pass `node --check`.

WebKit ran in the existing local Ubuntu 24.04 container because this Ubuntu 26.04
host lacks the matching libraries. Results: WebKit 26.4 and Chromium 148; host
presentation comparison: WebKit 26.6. All browser processes and Vite servers were
closed before handoff. No existing tmux service was changed.

## Capture the missing real event sequence

Use an **empty test note** on the environment where the defect occurs. In the
HNN frame's browser console, run `scripts/capture-hnn-ime-events.js`, then input
one character and one word with the actual input method. Try the original
confirmation gesture, then one explicit newline. Once finished, run:

```js
ham172Ime.download() // local JSON download, stops recording
// or ham172Ime.stop() to inspect the returned object without downloading
```

The recorder observes composition, keyboard, beforeinput/input, focus, pointer,
selection and DOM mutations. It never changes selection, cancels events or sends
network requests. Output includes test-note text and input data, so do not use a
private note. Logs are capped at 1000 events and report truncation.

Needed to continue: current OS/app-or-browser/input-method versions and whether
confirmation uses a candidate tap, Space or Enter; ideally the above event trace.
We can then compare the actual sequence in standalone notes and WebBase and fix
the first incorrect transition. Until then, the original root cause, upgrade
attribution and original-platform before/after acceptance remain **unverified**.
