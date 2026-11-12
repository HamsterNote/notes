# HAM-237 — M1 incremental evidence (1.11–1.16)

Tested source: **f805d859f0a7fac285e70ab3ae78bab71774aea2** on `agent/ham-237-editor-refinements`, based on main `5237b9bd59ef768015c1310199dd4a23776297ab`. Specification `6d23ff2489b58a786e38d2f16022c6e6c7d9ab25` was cherry-picked as `3813dd4`. The subsequent evidence commit only adds this directory and marks task 1.16 complete; it does not change tested source.

All 13 checks exited 0. `verification.txt` contains commands, complete unedited stdout/stderr and exit codes. Individual command logs have the same source/environment header. The final suite passed **50 files / 1051 tests**; the focused verbose run passed **4 files / 83 tests**. No test timeout was increased. OpenSpec progress is **16/25**, with only M2/M3 remaining; `apply-1.11.json` through `apply-1.16.json` record each completion.

| Task | Verification and raw evidence |
| --- | --- |
| 1.11 | `listNumbering.test.ts`: five levels 1/a/i/1/a, bullet/task ancestors, non-list wrapper ignored, explicit I/A, z/aa/ab/az/ba, iv/ix/3999/4000; unchanged HNN/dirty/history. `targeted.txt`; `editor-browser.txt`; `numbering-1440.png`, `numbering-390.png`. |
| 1.12 | `listNumbering.test.ts`: second-level e/a/g with persisted 5/1/7, new/existing sink targets, source-tail 7, lift preserving subtree IDs, derived descendant styles, exact undo/redo. Existing `listCommands.test.ts` remains green. Browser verifies original top-level 5/1/7 and indent/lift: `lists-browser.txt`. |
| 1.13 | `quoteInteractions.test.ts`: bare >, literal-prefix undo, tail/marks/ID, nesting/Enter/nearest exit/soft break, exact author restoration, list coexistence, excluded contexts, nonempty selection/readonly/freeze/IME, 32-depth/512-node/512-KiB limits, two-view history and save/reopen. Native typing at both viewports: `editor-browser.txt`. |
| 1.14 | `interactionToolbar.test.ts` at 390/1000 and `linkEditing.test.ts`: labeled configuration, default/replaced title, separate/common marks, cursor/partial-link expansion, removal, Cancel/Escape/outside, Tab/focus, code/atom/hard-break/mixed/cross-block rejection. Real browser at 1440/390: `editor-browser.txt`; `link-dialog-1440.png`, `link-dialog-390.png`. |
| 1.15 | `linkEditing.test.ts`: allowed protocols, unsafe/empty/control/zero-width/unpaired-surrogate URLs and spaces-only trim, empty title, codec budget, freeze/composition/view/session mismatch, rejecting transaction filter, stale remote edit+undo vs pure selection, failed draft retained and retry, one shared history event and save/reopen. `targeted.txt`, `editor-browser.txt`. |
| 1.16 | Full commands below; joint lists/quote/link HNN save/reopen in browser, integer GFM or existing lossless fence, quote/link and special-character Markdown round-trip plus dangerous URL diagnostics. Original browser fixture now includes a quote alongside lists and actual card/drawing-line drawers, asserting locked body, accepted shared commit, undo/redo, save/reopen at both widths: `lists-browser.txt`. Screens: `saved-editor-{1440,390}.png`, `lists-{1440,390}.png`. |

Commands, all exit 0:

```sh
yarn lint
yarn typecheck
yarn test src/lib/editor/listNumbering.test.ts src/lib/editor/quoteInteractions.test.ts src/lib/editor/linkEditing.test.ts src/lib/editor/interactionToolbar.test.ts --maxWorkers=2 --reporter=verbose
yarn test --maxWorkers=2
yarn verify:tiptap-deps
yarn verify:legacy-api
yarn verify:phase1-scope
node --test scripts/phase1-ast-guards.test.mjs
yarn build
LISTS_EVIDENCE_DIR=evidence/ham237/refinements node scripts/check-lists-browser.mjs
node scripts/check-editor-refinements-browser.mjs
openspec validate add-list-conversion-and-webbase-delivery --strict
git diff --check
```

Environment: Linux 7.0.0-31-generic x86_64 / glibc 2.43; Node v24.15.0; Yarn 1.22.22; Git 2.53.0; OpenSpec 1.13.1; Vitest 4.1.10; Playwright 1.60.0; Chromium 148.0.7778.96. Browser contexts are 1440×1000 and 390×1000 (touch); the fixture consumes the public Provider/View API through source aliases. See `environment.txt` for exact run metadata.

Limits: this is notes source validation, not published-package or WebBase acceptance. M2/M3 remain unchecked and the change stays unarchived. No npm version/tag/publication or WebBase/native work was performed. The previously recorded pen `timestamp` whitelist defect remains unchanged; drawing regression uses real line strokes. Existing non-failing tool warnings (Yarn url.parse deprecation, dependency sourcemaps/jsdom scrollBy, large demo chunks) are retained in raw output. External CI is reported separately on the PR.
