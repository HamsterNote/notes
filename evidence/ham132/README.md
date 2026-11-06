# HAM-132 IME investigation

Status: **awaiting reproduction; not fixed**. No production editor code changed.
The passing checks below characterize the ordinary composition path and provide
a fixture for collecting the failing iOS sequence. They are not evidence that
the reported App issue is resolved.

## Host and package

Read-only inspection of WebBase commit `614f9e776643ec68038d04c05b7d1926f92cbbbc`:

- The inspected source's `webview/src/window-content/HnnDocumentSession.tsx` uses the public
  `NoteDocumentProvider`; `HnnWindowDocumentView.tsx:118` mounts `NoteEditorView`.
  Title/summary are separate input/textarea controls. This confirms the source's
  PM integration, not the editor used by the reporter's installed App.
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

## iOS evidence and reporter update

The reporter clarified **WeChat Keyboard, Space confirmation**, and currently
cannot reproduce the problem. This changes the target from the initially
assumed system Pinyin keyboard. The reporter's App, iOS and keyboard versions
and whether those changed are still unknown.

Mac operator task HAM-135 completed actual system Pinyin testing on an existing
iPhone 17e **simulator**, iOS runtime 27.2, Preview App 1.1.0 (build 1).
Candidate tap once and Space twice each produced `你好哈哈` in one body block;
closing, persisting and reopening retained the same text. Independently
analyzing all 271 logged event snapshots confirms a maximum of one body block
in each run. `ios-summary.json` records counts, the commit events, and the
original evidence attachment identity; raw logs/screenshots are on HAM-135.

The observed Space sequence was `insertCompositionText → insertFromComposition
→ compositionend`, with trusted events and `isComposing=true` on the input
events. No DOM Space keydown was emitted; Space confirmation was established
by the operator's physical soft-keyboard taps, not inferred from keyboard events.

These are **not tests of the reporter's environment or of the current PM
editor**. The installed App's DOM is
`span.hn-note-editable[data-editable-block-id]`, and its saved document uses
`notes.blocks`, unlike the current PM/HNN schema. Its exact source/package
version is unknown; the inspected WebBase checkout cannot identify that build.
The WebView UA reports iOS 18_7 while the simulator runtime reports 27.2; neither
value is substituted for the other. WeChat Keyboard was not installed/tested,
and the online Demo returned GitHub Pages 404. No reporter device was accessed.

No failing sequence has been captured, so the root cause remains unknown and
the issue awaits reproducible evidence. Preserve this draft and the capture
tools. When the same App/iOS/WeChat Keyboard combination reproduces, obtain a
keyboard-visible recording and event log, identify the actual installed editor,
then reproduce the split in a failing regression before changing that editor.
Do not suppress PM transactions or mark the issue fixed based on these
non-equivalent, passing checks.
