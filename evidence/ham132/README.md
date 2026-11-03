# HAM-132 IME investigation

Status: **not reproduced; not fixed**. No production editor code changed.
The passing checks below characterize the ordinary composition path and provide
a fixture for collecting the failing iOS sequence. They are not evidence that
the reported App issue is resolved.

## Host and package

Read-only inspection of WebBase commit `614f9e776643ec68038d04c05b7d1926f92cbbbc`:

- `webview/src/window-content/HnnDocumentSession.tsx` uses the public
  `NoteDocumentProvider`; `HnnWindowDocumentView.tsx:118` mounts `NoteEditorView`.
  Title/summary are separate input/textarea controls. The reported body is PM.
- `webview/package.json` pins `vendor/hamster-note-notes-3.1.3-ham107.1.tgz` and
  patches its shared-session explicit selection synchronization. That predates
  HAM-124; the screenshot's visible mobile handles are consistent with this,
  but the actual installed App build/version remains unconfirmed.
- Vendored tgz SHA-256:
  `698deac6a44bf52623e861ee3d56b05eadaf57f8ecddba5ccd6913a7afec8111`.
- Patch SHA-256:
  `2f5005781f458319ddbc60f0515e4e1869051f56419aa260e5444c94bbb43822`.
- The tarball was extracted into an isolated directory and its existing patch
  applied there; no WebBase working copy or dependency was modified.

## Executed checks (2026-11-03)

Playwright 1.60.0, WebKit 26.4, Chromium 148.0.7778.96. Source baseline
`0e402ec`, plus the exact vendored package and patch above, each passed:

| Entry | API | Viewports | DOM composition | Chromium CDP composition |
| --- | --- | --- | --- | --- |
| source | NoteEditor | 390 / 1440 | passed | passed |
| source | Provider / View | 390 / 1440 | passed | passed |
| patched host package | NoteEditor | 390 / 1440 | passed | passed |
| patched host package | Provider / View | 390 / 1440 | passed | passed |

DOM cases: empty paragraph `ni hao → 你好`; append `ha ha → 哈哈` in that same
paragraph; replace a nonempty range with `中文`; cancel a composition; then
an intentional Enter creates exactly one additional paragraph. Assertions check
both HNN and DOM block count, exact text, retained original nodeId, and that the
composing text node stays connected during the host's React rerender.

Chromium additionally uses native `Input.imeSetComposition` followed by
`Input.insertText`, with trusted composition events checked in the log. This
still does not exercise an OS Chinese candidate keyboard. WebKit has no CDP;
its composition events and mutations are explicitly simulated. An iPhone UA
and touch/mobile viewport are emulation, not an iOS device.

Lint and typecheck pass. No production code was changed, so unrelated full unit
and build suites were not rerun. The standalone fixture follows the existing
public-host fixtures' ESLint exclusion because it is outside the src tsconfig.

## Repeat or collect real input

Install dependencies with `corepack yarn install --frozen-lockfile`, and install
Playwright WebKit/Chromium with their OS dependencies on a supported host.

```sh
node scripts/check-body-composition-browser.mjs
# Chromium only:
CHROMIUM_ONLY=1 node scripts/check-body-composition-browser.mjs
# Same cases against an extracted package (apply any host patch first):
COMPOSITION_PACKAGE=/absolute/path/to/extracted/package node scripts/check-body-composition-browser.mjs
```

The script starts/closes Vite and browsers in the foreground and writes raw
event/HNN/DOM JSON plus a summary under `evidence/ham132/source` or `package`.
Only the summaries are committed; the original full JSON logs are supplied as
the HAM-132 issue attachment. Ubuntu 26.04 on this runner cannot execute the
Noble WebKit binaries directly; both browsers were run inside its existing
`localhost/ham40-webkit:noble` Podman image, with Node, repo and browser-cache
mounts, networking disabled and proxy environment variables cleared.

For manual iOS testing, run `corepack yarn dev`, then open
`http://<development-host>:9235/scripts/fixtures/body-composition/index.html?mode=shared`
in the simulator/device browser; `?mode=single` selects the other API. Use the
system Chinese keyboard and export the log with the page button. It records
only this blank test document: composition/key/beforeinput/input/selection
events, target ranges, DOM selection paths, DOM and HNN snapshots. Record
device/iOS, keyboard, and candidate confirmation method alongside the JSON.

Mac operator task HAM-135 owns real iOS IME/App evidence, not business code.
Remaining acceptance: capture the first unexpected block split, replay its
actual event sequence in a failing regression, fix the demonstrated cause,
then validate the upgraded host. Do not suppress all composition transactions
based solely on the screenshot; PM must still reconcile native text mutations.
