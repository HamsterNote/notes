# Notes 3.1.0 Validation

HAM-39 implements the public contract delivered for HAM-36. Baseline is notes
3.0.0 `2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c`. Environment: Node v24.15.0,
Yarn 1.22.22 (invoked with `corepack yarn`), Linux, Chromium 148.0.7778.96.

## Formal Checks

| Command | Result | Raw log |
| --- | --- | --- |
| `corepack yarn test` | 37 files, 767 passed; exit 0 | formal-tests.log |
| `corepack yarn typecheck` | exit 0 | typecheck.log |
| `corepack yarn build` | library and both demo pages; exit 0 | build.log |
| `corepack yarn lint` | exit 0 | lint.log |
| `node scripts/check-shared-browser.mjs` | exit 0 | browser.log |
| root ESM / CJS with jsdom | 10 expected value exports; exit 0 | root-esm.log, root-cjs.log |

Logs are produced by `node scripts/capture-check.mjs <label> <command> ...`.
The baseline checks and input attachment hashes are documented in `baseline/README.md`.
Only additive public exports changed: the eight old runtime values, old NoteSave
CAS/saved/conflict/revision contracts and CSS subpaths remain covered.

## Component Coverage

- `documentApi.types.test.tsx`: complete root Provider/View/Controller props,
  method signatures and outcome discriminants; old NoteSave still compiles;
  no Editor/PM/schema injection in the public API.
- `documentSession.test.ts` (24 tests): shared ABA undo/redo, grouping, peer
  selection/stored marks, stale atomic rejection, detach/reopen, all demo
  fixture node types, metadata validation, serial saves and barriers, encoding
  failure, abort, lease ownership/queue/reentry/tombstones, composition and
  pending candidate gates, late reference candidates, resource budget.
- `NoteDocumentProvider.test.tsx` (16 tests): real root components, native paste,
  load/error/replacement, StrictMode, synchronous acquire/release notification
  unmount, both modal drafts, invalid draft/focus, single commit and peer undo,
  real callout/collapsible/picture/code inputs, focused input blur before freeze,
  formula portal flush before freeze and peer undo.
- Existing formal suites continue to test full NodeViews, block menus/reorder,
  clipboard, marks/tables/formulas, async references and legacy uploads,
  deletion/mapping/late callbacks, NoteEditor saves and original root API/CSS.

The formal Chromium page imports the production root components. Desktop
1440x1000 and mobile 390x844 checks cover native keyboard interleaving,
keyboard/toolbar undo/redo, pane reopen, freeze, card completion and real
localStorage saves. Screenshots are `shared-desktop.png` and `shared-mobile.png`.
The script confirms the native selection before right-pane typing; a preceding
run exposed an automation timing issue and was not counted as a passing run.
React teardown and async invalidation boundaries are tested in jsdom, not
claimed as physical browser/host integration acceptance.

## Historical Counterexample

`corepack yarn test --config vitest.historical.config.ts`: 41 passed, 1 failed,
exit 1 (`historical-probes.log`). `src/prototype/session.test.ts:151` is the
original selective-undo counterexample (B共享正文 expected, 共享正文 received).
All original assertions are preserved, with no skip/xfail. It is a known
unsatisfied research requirement, excluded from the formal A shared-history
contract. The full historical files and the separate P2 reviewer probe are
preserved verbatim; they are not the implementation or browser demo.

## Resource Budget

`corepack yarn test src/lib/editor/documentSession.test.ts -t budgets --disableConsoleIntercept`
passes (one selected test; the full suite runs all 24). Raw output:
`resource-budget.log`. After 300 alternating edits: 2 views, 111 undo events,
0 redo, 0 mapping entries. After 200 acquisitions + 200 releases and reopening
a view + undo: 1 view, 200 request tombstones, 0 live leases, 110 undo, 1 redo.

History uses the proven PM history default depth 100 and overflow margin 20.
No session mapping ledger is retained: current transactions apply synchronously,
stale ones are rejected atomically. Request tombstones are O(distinct requests)
until disposal; no TTL or eviction permits a late request to reacquire. This is
an explicit long-session memory cost; only session disposal clears it.

## Package Boundary And Remaining Validation

The original 3.0.0 root failed bare Node imports due to multi-drag directory
imports (`baseline-runtime-{esm,cjs}.log`). Bundling that transitive browser
dependency removes the resolution failure. ESM/CJS are verified with a DOM;
bare Node/SSR is not supported or claimed (browser code requires document).
Existing dependency sourcemap/peer warnings and the demo chunk-size warning
are recorded; none failed the commands above.

Physical IME has NOT been tested. Simulated composition gates are covered,
but cannot substitute for a real OS keyboard/IME. Actual WebBase bridge,
host navigation and remote persistence are NOT tested. No WebBase files,
HAM-36 task checkboxes, npm releases or release tags are changed.

## Pack And Clean Consumption

Packed source commit: `645c3398b82f694465258b9ea82de9c3c62c2b6c`.
Package: `@hamster-note/notes@3.1.0`, `hamster-note-notes-3.1.0.tgz`.
SHA-256: `a7bbfe56e5dc18be8cec031c7bb2e286a04c464fd12182cc6b05fb04ef21d97e`.
`pack-identity.json` records all 145 tar entries and separate hashes for root
ESM/CJS/declarations and both CSS assets, including fonts and declaration closure.
Later commits only add evidence/tooling/task completion; this source identity
is the pack's origin, not the later PR head. The buffer limit in the evidence
hash script was corrected after packing; the library and pack were unchanged.

`node scripts/verify-pack-consumer.mjs` created a new directory outside the
repository, installed only the tarball and declared dependencies/tooling, and
passed install, jsdom root ESM/CJS export allowlists, TypeScript, Vite build
and Chromium editing/saving in new dual views alongside old NoteEditor/NoteSave.
The old save receives baseRevision r1 and returns revision r2. No source aliases,
private imports or dependency patches were used. `consumer-identity.json`
contains the actual tarball hash and full resolved consumer lockfile.

Raw logs: `pack.log`, `pack-consumer.log`, `consumer-{install,esm,cjs,typecheck,build}.log`.
The additional command `corepack yarn --cwd ../pack-consumer typecheck --skipLibCheck false`
also passed (`consumer-declarations.log`), verifying declarations with dependency
checking enabled. Browser screenshot: `consumer.png`.

To install the attached artifact in a separate React 19 project:

```sh
corepack yarn add ./hamster-note-notes-3.1.0.tgz
```

Import components/types from `@hamster-note/notes`, plus
`@hamster-note/notes/styles.css` and `@hamster-note/notes/formula.css`.
Peer warnings for painting/react-native and Tiptap optional menu extensions
remain visible in the clean installation log. Runtime/browser/type checks
above pass with that actual resolution; this is not a claim that those warnings
or every possible host dependency combination have been resolved.
