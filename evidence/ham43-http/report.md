# HAM-43: Insecure HTTP UUID regression

## Baseline and scope

- PR #12 was open and unmerged when work started. This branch starts at the accepted 3.1.0 commit `c0a51f728125686f93dec81093979e113d7b0914`.
- This is a follow-up robustness fix. Package version remains 3.1.0; no package was published or repacked. The accepted A shared-history/save/freeze contracts are unchanged.
- `DocumentSession` prefers native `crypto.randomUUID`. If unavailable, its session, operation, lease and draft IDs use the existing `createHnnNodeId` UUIDv4 generator backed by `crypto.getRandomValues`.
- If neither secure random API exists, session construction throws `DocumentSession requires crypto.randomUUID or crypto.getRandomValues to generate secure UUIDv4 identifiers`. There is no weak random fallback.
- The shared demo's host request ID used the same unavailable API. That call now uses the existing secure UUIDv4 generator, allowing its freeze control to run on HTTP too.

## Before the fix

Added the regression tests first and ran:

```sh
corepack yarn test src/lib/editor/NoteDocumentProvider.test.tsx src/lib/editor/documentSession.test.ts
```

Result: 53 passed, 4 failed. The Provider mount and UUID fallback tests threw:

```text
TypeError: crypto.randomUUID is not a function
  at new DocumentSession (src/lib/editor/documentSession.ts:71:99)
  at src/lib/editor/NoteDocumentProvider.tsx:17:21
```

The two missing-random-API cases also failed because the old code produced incidental TypeErrors instead of the requested diagnostic.

The browser script was also run before the source fix, against a non-loopback HTTP address served by Vite. Chromium 148.0.7778.96 received HTTP 200 and reported:

```text
context { isSecureContext: false, randomUUID: 'undefined', getRandomValues: 'function' }
pageerror crypto.randomUUID is not a function
```

The editor never mounted; waiting for `[data-view-id="a"] .tiptap` timed out after 10 seconds (exit 1).

## After the fix

| Check | Result |
| --- | --- |
| `corepack yarn test` | 38 files, 785 tests passed; formal A suite, not the separate historical selective-undo probe |
| Focused Provider/session tests | 2 files, 57 tests passed |
| `corepack yarn typecheck` | Passed |
| `corepack yarn lint` | Passed |
| `corepack yarn build` | Library and demo passed |
| `node scripts/check-insecure-shared-browser.mjs` | Passed in a real insecure HTTP browser context |

The Provider regression removes `randomUUID` while retaining real `getRandomValues`. It checks two mounted views, peer undo/redo, draft/save blocking, all four generated ID types (distinct UUIDv4s), acquire/release, and a shared pending save barrier. An edit made during the first deferred host write forces a second serial write before completion can return `saved`; dirty state remains pending until then, and releasing the lease restores both editors.

Additional tests verify the native fast path, exact UUIDv4 version/variant masking (`ffffffff-ffff-4fff-bfff-ffffffffffff` for all-255 input bytes), and explicit errors for absent crypto/secure random APIs.

The browser script asserts `isSecureContext === false`, absent `randomUUID`, and available `getRandomValues`. It verifies Provider mount, peer undo/redo, draft open/cancel, freeze acquire/release, disabled metadata during freeze, and persistence of the edited body. No page errors occurred. Screenshots: `desktop.png` (1440 x 1000), `mobile.png` (390 x 844 viewport, full page).

The browser server and browser close in `finally`; no service is left running. The check requires a non-loopback network interface and Playwright Chromium. Existing dependency sourcemap and build chunk-size warnings did not fail the checks. Physical IME and WebBase integration were not re-run for this UUID-only fix.
