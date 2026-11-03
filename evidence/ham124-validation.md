# HAM-124 Web implementation verification

Change: `improve-notes-mobile-interactions`, spec-driven, **15/15 tasks complete**. Proposal, design, three delta specs and checked tasks are included with the implementation.

## Delivered behavior

| Issue requirement | Implementation and evidence |
| --- | --- |
| Long-press block sorting | `blockReorder.ts`: body touch/pen entry, 500ms/10px threshold on an initially unfocused block, captured pointer on stable editor root, persistent source highlight/drop line, final-up coordinates, single transaction + history fences. Unit tests cover pending/active cancellation, second contact, freeze, document changes, breakpoint, unmount, identity and vibration failure. The focused top-level block is determined from the focused view and selection head before pointerdown; its hold remains native. Pending and active holds temporarily disable text selection on the stable editor root, with scoped selectstart prevention and selectionchange cleanup. All exit paths restore original inline values/priorities. Other-block/blurred nonempty ranges cannot veto an unfocused target. All contextmenu handlers, including the handle handler, were removed. Regression tests cover touch/pen focus, pending/active range cleanup, external ranges, composition, retained ranges and lifecycle restoration. Browser matrix confirms trusted touch focused/unfocused holds, sorting and undo. |
| Hide mobile left handle | Shared matchMedia/CSS boundary ≤840px, hidden gutter and handle, no hit/Tab/accessibility reachability. 840px and 841px unit + browser cases pass. |
| Mobile focus popover | Per-view toolbar below the owning top-level block: 转换为、插入、加粗、斜体、下划线、上移、下移. Horizontal same-surface expansion, live block validation, capability/structure/boundary reasons, stored marks at collapsed cursor. |
| Desktop selection popover | Exactly 加粗、斜体、下划线; native mouse and keyboard text ranges, mixed/full mark behavior, excludes nodes/cells/code/IME/freeze. |
| Text labels | All toolbar actions and expansion items use visible Chinese labels, with pressed/disabled semantics and keyboard navigation. |

Single editor and Provider views install and clean up the same toolbar. Shared formatting/sorting undo, freeze, destroyed callbacks, selection retention and focus ownership are tested. Toolbar geometry handles visualViewport offsets, below/above placement, scroll clipping and horizontal overflow. Documentation updated in DESIGN.md and README.md.

## Commands and actual results

- `corepack yarn lint`: PASS.
- `corepack yarn typecheck`: PASS.
- `corepack yarn test`: PASS, **41 files / 859 tests** (formal suite).
- `corepack yarn build`: PASS, library and Demo. Existing dependency sourcemap / chunk size warnings remain warnings.
- `openspec validate improve-notes-mobile-interactions --strict`: PASS.
- `node scripts/check-mobile-interactions.mjs`: PASS, **10/10 cases**, Chromium **148.0.7778.96**.

Browser widths: **320, 390, 840, 841, 1440 CSS px**, each in light/dark theme. Script starts and closes the repository Demo and browser synchronously. It opens an HNN fixture through the Demo file input, uses native mouse drag and keyboard selection, and uses CDP `Input.dispatchTouchEvent` for browser-generated touch/pointer events (`isTrusted=true`). It checks focused-block hold without drag/vibration, unfocused-block hold/sort/undo, pending selection protection and contextmenu pass-through throughout the gesture, scroll-before-threshold cancellation with actual editor/page scroll deltas, labels, keyboard arrows/Home/End/Enter/Space/Escape, long wrapped text, visible-height changes, offscreen anchors, cross-breakpoint toolbar replacement and no page/toolbar horizontal overflow. Exact results: `ham124-browser-results.json`; screenshots: `ham124-<width>-<theme>.png`.

The script verifies the focused paragraph and actual touch hit target before each gesture, and measures both editor and page scrolling to handle browser scroll chaining.

Contextmenu cancellation is measured using explicitly **synthetic cancelable MouseEvent probes** in the real browser; these are separate from trusted touch input and do not prove that an OS menu was displayed or hidden. All contextmenu probes in all six mobile cases are unprevented, including pending, active and post-cancel phases. Headless Chromium produced an empty native text range after the focused hold: this verifies non-interference (no drag or vibration), not successful OS word-selection UI. Physical-device word selection and system menu appearance remain acceptance checks.

The browser test found a real DOM-target regression: applying a widget-only class to content caused PM to replace the native touch target. The final implementation captures on the stable editor root and renders content feedback only through PM decorations. Nonpassive touchmove registration precedes touchstart; pending touches retain native scrolling.

## Long-hold regression: actual before / after comparison

Run these commands in the same checkout (no dev server restart or checkout mutation):

```sh
node scripts/check-mobile-hold.mjs --before-ref=66034bb
node scripts/check-mobile-hold.mjs
```

Before mode overrides only `blockReorder.ts` with that Git revision through a Vite pre-transform; all other source and fixtures are identical. The script uses real Chromium at 390px, CDP `Input.dispatchTouchEvent` and keyboard `Home` / `Shift+ArrowRight` to create the prior range. It records preconditions, pending at 100ms, held state at 650ms, trusted pointer/touch and selectionchange observations, drop order, CSS restoration, screenshots and traces. JSON: `ham124-hold-before.json` / `ham124-hold-after.json`.

| Scenario / observation | Before (`66034bb`) | After |
| --- | --- | --- |
| Other block has collapsed cursor | Drag and reorder succeed; pending `user-select:auto` | Drag and reorder succeed; pending `user-select:none`, no text selected |
| Other block has native nonempty range `H` | No drag; order first/second/third unchanged; range `H` remains | Old range cleared at pending start; drag activates; order second/third/first; no range during hold |
| Focused target long hold | No drag or reorder | No drag or reorder; native selection CSS/events unchanged |
| Pending synthetic selectstart probe | Unprevented | Prevented only for unfocused drag intent |
| Pending / active synthetic contextmenu probes | Prevented for normal drag | Always unprevented |
| Successful unfocused hold/drop pointer | No pointercancel in this browser | No pointercancel; root selection style restored to auto after drop |

The global `!selection.empty` / DOM `!isCollapsed` entry guards are a **confirmed cause** of the retained-range failure above. Pending selection protection was also absent: selectstart was blocked only after activation, leaving an opportunity for native word selection to take over. The suggested phone-native word-selection → pointercancel race **was not reproduced in headless Chromium**, so this report does not assert it as an observed root cause. The fix protects selection from pointerdown, without intercepting contextmenu or pending scrolling. Focused-block word selection and OS menu appearance still need physical-device acceptance; synthetic probes are not a substitute.

Selection observations retain `rawText` and sample `text` in the next event-loop task, after PM and the selection guard have run. PM can transiently restore an old range on a decoration update; CSS keeps selection disabled and the guard clears it. All observed pending/active final ranges are empty. After drop, the existing reorder command selects the moved block via NodeSelection (outline); its DOM range may stringify the whole block and is outside the drag protection window.

Unit regression: `corepack yarn test src/lib/editor/blockReorder.test.ts`, **86/86 passed**. Full suite includes these tests; no unit test is presented as touch/browser evidence.

## Values and compatibility limits

Spec values are retained: **≤840px**, **500ms**, **10px**, one optional **10ms** vibration attempt. No breakpoint or vibration-duration exception was needed. Input and native DOM-target handling were adapted to actual browser behavior without changing scope.

Underline is a persistent closed-schema mark, round-trips through HNN/HTML, and exports via the existing JSON-b64 Markdown fence. The HNN envelope stays v1; old documents remain readable, but **old notes consumers reject new underline marks** and must upgrade before reading such documents.

This is **Web-side evidence**. Trusted Chromium touch emulation is not a physical-device test. Viewport shrinking approximates keyboard occlusion; no system soft-keyboard or hardware vibration claim is made. Browser vibration deliberately returns false in the script to verify graceful degradation; missing/false/throwing cases are separately tested. No native build, simulator, WebBase upgrade, npm publication or merge is included.
