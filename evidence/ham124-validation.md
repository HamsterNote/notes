# HAM-124 Web implementation verification

Change: `improve-notes-mobile-interactions`, spec-driven, **15/15 tasks complete**. Proposal, design, three delta specs and checked tasks are included with the implementation.

## Delivered behavior

| Issue requirement | Implementation and evidence |
| --- | --- |
| Long-press block sorting | `blockReorder.ts`: body touch/pen entry, 500ms/10px threshold, captured pointer on stable editor root, persistent source highlight/drop line, final-up coordinates, single transaction + history fences. Unit tests cover pending/active cancellation, second contact, freeze, document changes, breakpoint, unmount, identity and vibration failure. Browser matrix confirms trusted touch sorting and undo. |
| Hide mobile left handle | Shared matchMedia/CSS boundary ≤840px, hidden gutter and handle, no hit/Tab/accessibility reachability. 840px and 841px unit + browser cases pass. |
| Mobile focus popover | Per-view toolbar below the owning top-level block: 转换为、插入、加粗、斜体、下划线、上移、下移. Horizontal same-surface expansion, live block validation, capability/structure/boundary reasons, stored marks at collapsed cursor. |
| Desktop selection popover | Exactly 加粗、斜体、下划线; native mouse and keyboard text ranges, mixed/full mark behavior, excludes nodes/cells/code/IME/freeze. |
| Text labels | All toolbar actions and expansion items use visible Chinese labels, with pressed/disabled semantics and keyboard navigation. |

Single editor and Provider views install and clean up the same toolbar. Shared formatting/sorting undo, freeze, destroyed callbacks, selection retention and focus ownership are tested. Toolbar geometry handles visualViewport offsets, below/above placement, scroll clipping and horizontal overflow. Documentation updated in DESIGN.md and README.md.

## Commands and actual results

- `corepack yarn lint`: PASS.
- `corepack yarn typecheck`: PASS.
- `corepack yarn test`: PASS, **41 files / 840 tests** (formal suite).
- `corepack yarn build`: PASS, library and Demo. Existing dependency sourcemap / chunk size warnings remain warnings.
- `openspec validate improve-notes-mobile-interactions --strict`: PASS.
- `node scripts/check-mobile-interactions.mjs`: PASS, **10/10 cases**, Chromium **148.0.7778.96**.

Browser widths: **320, 390, 840, 841, 1440 CSS px**, each in light/dark theme. Script starts and closes the repository Demo and browser synchronously. It opens an HNN fixture through the Demo file input, uses native mouse drag and keyboard selection, and uses CDP `Input.dispatchTouchEvent` for browser-generated touch/pointer events (`isTrusted=true`). It checks hold/sort/undo, scroll-before-threshold cancellation with an actual scroll delta, labels, keyboard arrows/Home/End/Enter/Space/Escape, long wrapped text, visible-height changes, offscreen anchors, cross-breakpoint toolbar replacement and no page/toolbar horizontal overflow. Exact results: `ham124-browser-results.json`; screenshots: `ham124-<width>-<theme>.png`.

The browser test found a real DOM-target regression: applying a widget-only class to content caused PM to replace the native touch target. The final implementation captures on the stable editor root and renders content feedback only through PM decorations. Nonpassive touchmove registration precedes touchstart; pending touches retain native scrolling.

## Values and compatibility limits

Spec values are retained: **≤840px**, **500ms**, **10px**, one optional **10ms** vibration attempt. No breakpoint or vibration-duration exception was needed. Input and native DOM-target handling were adapted to actual browser behavior without changing scope.

Underline is a persistent closed-schema mark, round-trips through HNN/HTML, and exports via the existing JSON-b64 Markdown fence. The HNN envelope stays v1; old documents remain readable, but **old notes consumers reject new underline marks** and must upgrade before reading such documents.

This is **Web-side evidence**. Trusted Chromium touch emulation is not a physical-device test. Viewport shrinking approximates keyboard occlusion; no system soft-keyboard or hardware vibration claim is made. Browser vibration deliberately returns false in the script to verify graceful degradation; missing/false/throwing cases are separately tested. No native build, simulator, WebBase upgrade, npm publication or merge is included.
