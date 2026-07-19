# Hamster Note Design System

This document captures the existing CSS contract from `src/lib/styles.css` so future UI work, including the block-editor interactions, stays aligned with the current tokens.

---

## 1. Theme Tokens

The `theme` prop selects the explicit `light` or `dark` token set. The theme color is injected through `--hn-theme` and its accent tokens are derived from it.

| Token               | Value / Derivation                                     | Source                 |
| ------------------- | ------------------------------------------------------ | ---------------------- |
| `--hn-theme`        | `#3b82f6` (default blue)                               | `src/lib/styles.css:4` |
| `--hn-theme-soft`   | `color-mix(in srgb, var(--hn-theme) 12%, white)`       | `src/lib/styles.css:7` |
| `--hn-theme-border` | `color-mix(in srgb, var(--hn-theme) 30%, transparent)` | `src/lib/styles.css:8` |
| `--hn-theme-text`   | `color-mix(in srgb, var(--hn-theme) 75%, #1e293b)`     | `src/lib/styles.css:9` |

The component shell is transparent and does not own a background, border, radius, shadow, or maximum width. The consuming layout owns all outer-container presentation.

---

## 2. Neutral Palette

| Token                | Value                    | Source                  |
| -------------------- | ------------------------ | ----------------------- |
| `--hn-bg`            | `#ffffff`                | `src/lib/styles.css:12` |
| `--hn-surface`       | `#f8fafc`                | `src/lib/styles.css:13` |
| `--hn-surface-hover` | `#f1f5f9`                | `src/lib/styles.css:14` |
| `--hn-border`        | `rgba(15, 23, 42, 0.08)` | `src/lib/styles.css:15` |
| `--hn-border-strong` | `rgba(15, 23, 42, 0.14)` | `src/lib/styles.css:16` |
| `--hn-text`          | `#1e293b`                | `src/lib/styles.css:17` |
| `--hn-text-muted`    | `rgba(51, 65, 85, 0.65)` | `src/lib/styles.css:18` |
| `--hn-text-soft`     | `rgba(51, 65, 85, 0.85)` | `src/lib/styles.css:19` |

These tokens cover every surface, divider, and text tone used in the note shell. No new neutral colors should be introduced for block-editor chrome.

The dark theme overrides the neutral palette with slate surfaces and high-contrast light text while preserving the same semantic token names. Theme switching is controlled only through the `theme` prop, not through a media query.

---

## 3. Radius, Spacing, and Shadow

### Radius

- `--hn-radius: 24px` — default large radius for cards and facts (`src/lib/styles.css:20`).
- Shell radius is intentionally unset; the consuming layout owns outer rounding.
- Inline pills use `999px` (`src/lib/styles.css:72`).
- Quote uses `0 20px 20px 0` (`src/lib/styles.css:247`).
- Editable line content is unframed.
- Checklist items use `18px` (`src/lib/styles.css:209`).
- Callouts use `22px` (`src/lib/styles.css:291`).
- Popover uses `10px` (`src/lib/styles.css:364`).
- Popover buttons use `7px` (`src/lib/styles.css:378`).

### Spacing Scale (from existing rules)

- `--hn-body-gap: 0.625rem`.
- Body padding is `1.5rem 4rem 2rem` above 840px and `1.5rem 1.5rem 2rem` at or below 840px.
- `--hn-hero-padding: 2rem 2rem 1.25rem` (`src/lib/styles.css:56`).
- `--hn-facts-gap: 0.9rem` (`src/lib/styles.css:108`).
- `--hn-checklist-gap: 0.8rem` (`src/lib/styles.css:197`).
- `--hn-section-header-gap: 0.8rem` (`src/lib/styles.css:186`).

### Shadow

- Shell shadow is intentionally unset; the consuming layout owns outer elevation.
- Popover: `0 8px 24px rgba(15, 23, 42, 0.28)` (`src/lib/styles.css:366`).

---

## 4. Typography Scale

| Element           | Size                          | Line Height | Notes                                                        | Source                                             |
| ----------------- | ----------------------------- | ----------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Hero h1           | `clamp(2.2rem, 4vw, 3.5rem)`  | `1.02`      | Serif stack                                                  | `src/lib/styles.css:92-95`                         |
| Heading 1         | `clamp(1.8rem, 3vw, 2.6rem)`  | default     | Serif stack                                                  | `src/lib/styles.css:155-157`                       |
| Heading 2         | `1.4rem`                      | default     | Serif stack                                                  | `src/lib/styles.css:159-161`                       |
| Heading 3         | `1.1rem`                      | default     | Serif stack                                                  | `src/lib/styles.css:163-165`                       |
| Section header h3 | `1.1rem`                      | default     |                                                              | `src/lib/styles.css:190-192`                       |
| Summary           | `1.04rem`                     | `1.8`       | `max-width: 56ch`, muted                                     | `src/lib/styles.css:98-104`                        |
| Paragraph         | default                       | `1.85`      | `max-width: 66ch`, soft                                      | `src/lib/styles.css:167-171`                       |
| Paragraph accent  | `1.05rem`                     | default     | solid text color                                             | `src/lib/styles.css:177-180`                       |
| Quote p           | `1.1rem`                      | `1.7`       |                                                              | `src/lib/styles.css:251-255`                       |
| Code              | `0.9rem`                      | `1.7`       | Shared monospace stack and syntax colors in preview and edit states; `#e2e8f0` on `#0f172a` | `src/lib/styles.css` |
| Badge / chip      | `0.75rem`                     | default     | uppercase, `letter-spacing: 0.08em`, weight 600              | `src/lib/styles.css:75-78`                         |
| Eyebrow           | `0.8rem`                      | default     | theme color, uppercase, `letter-spacing: 0.18em`, weight 700 | `src/lib/styles.css:145-153`                       |
| Popover button    | `0.8rem` / `0.78rem` for copy | default     | weight 600                                                   | `src/lib/styles.css:381`, `src/lib/styles.css:395` |

Serif headings use `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif` (`src/lib/styles.css:89`).

---

## 5. Editable Content States

Editable line content stays visually neutral while the caret or pointer moves between rows.

- Base, hover, and focus use transparent backgrounds with no border or outline treatment.
- Empty editable roots retain `min-height: 1lh` so blank rows remain targetable.
- Code blocks keep the highlighted preview beneath a transparent plain-text editing layer, preserving the same monospace font, size, line height, and syntax colors while the caret remains visible.

### Block selection

- `selectMode` takes precedence over `editable`; selectable content never exposes editing controls.
- Each top-level block is one keyboard-focusable selection boundary. Nested checklist rows select their containing checklist block.
- Hover uses a 6% `--hn-theme` mix. Keyboard focus and the selected state use `--hn-theme-soft` with a solid `2px --hn-theme` ring.

---

## 6. Popover Layer

The selection popover is a fixed-position dark surface on desktop and docks into the shell bottom bar on mobile devices.

- Positioning: `position: fixed`, `z-index: 9999` (`src/lib/styles.css:357-359`).
- Background: `#1e293b` (`src/lib/styles.css:365`).
- Shadow: `0 8px 24px rgba(15, 23, 42, 0.28)` (`src/lib/styles.css:366`).
- Radius: `10px` (`src/lib/styles.css:364`).
- Padding: `0.3rem`, internal gap `0.15rem` (`src/lib/styles.css:362-363`).
- Mobile docking: the portal target is `.hn-note-bottom-bar`, a direct sticky child positioned relative to `.hn-note-shell`.

Popover buttons:

- Base: transparent background, `#e2e8f0` text, `7px` radius (`src/lib/styles.css:377-380`).
- Hover: `rgba(255, 255, 255, 0.14)` background, `#ffffff` text (`src/lib/styles.css:387-390`).

Animation is a pure opacity fade: `@keyframes hn-popover-in` from `opacity: 0` to `opacity: 1` (`src/lib/styles.css:418-425`).

---

## 7. Responsive Breakpoints

The compact responsive breakpoint is `max-width: 840px` and is inclusive.

At that breakpoint:

- Body horizontal padding is selected from `window.innerWidth`, not the rendered body width.
- Left-side add and conversion handles, including their hover gutter, are hidden.
- Hero grid collapses to a single column (`src/lib/styles.css:350-352`).

Mobile-device detection is separate from viewport width. Mobile devices mount a sticky shell-relative bottom bar and portal the text-selection toolbar into it.

---

## 8. Accessibility Constraints

- Checkboxes use `cursor: default` in read-only mode and `cursor: pointer` only when editable (`src/lib/styles.css:222`, `src/lib/styles.css:232`).
- Checkbox hover and checked-hover rely on theme color changes rather than relying on color alone; the cursor also changes (`src/lib/styles.css:235-242`).
- Editable row content intentionally has no hover or focus border, outline, or background; the text caret communicates editing focus.
- Popover uses a high-contrast dark surface (`#1e293b` on light shell) and a large shadow to separate it from content (`src/lib/styles.css:365-366`).

---

## 9. Planned Block Handle / Menu Tokens

The block-editor handle and menu must reuse the tokens above. No new colors should be added.

### Handle

| State         | Visual treatment                                        | Grounded tokens                                                                             |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Hidden        | `opacity: 0`, no pointer events                         | Derived from transition behavior (`src/lib/styles.css:323`)                                 |
| Hover         | Background `--hn-surface-hover`, text `--hn-text-muted` | `--hn-surface-hover` (`src/lib/styles.css:14`), `--hn-text-muted` (`src/lib/styles.css:18`) |
| Focus         | `box-shadow: 0 0 0 2px var(--hn-theme)`                 | Editable focus pattern (`src/lib/styles.css:334`)                                           |
| Active / Open | Background `--hn-theme-soft`, text `--hn-theme-text`    | `--hn-theme-soft` (`src/lib/styles.css:7`), `--hn-theme-text` (`src/lib/styles.css:9`)      |

### Block Menu

| Part                      | Treatment                                                      | Grounded tokens                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container                 | Dark surface, popover shadow, `10px` radius                    | Background `#1e293b` (`src/lib/styles.css:365`), shadow `0 8px 24px rgba(15, 23, 42, 0.28)` (`src/lib/styles.css:366`), radius `10px` (`src/lib/styles.css:364`) |
| Menu item default         | Transparent background, `#e2e8f0` text                         | Popover button base (`src/lib/styles.css:377-380`)                                                                                                               |
| Menu item hover / active  | `rgba(255, 255, 255, 0.14)` background, `#ffffff` text         | Popover button hover (`src/lib/styles.css:387-390`)                                                                                                              |
| Disabled / not applicable | `--hn-text-muted` text at reduced opacity, no hover background | `--hn-text-muted` (`src/lib/styles.css:18`)                                                                                                                      |

### Open state

When the menu is open, the owning block handle should stay in the active/open treatment (`--hn-theme-soft` background) so the user can see which block the menu belongs to. The menu itself should animate with the same `hn-popover-in` opacity fade (`src/lib/styles.css:418-425`) to avoid conflicting with positioning transforms.

---

## 10. Editable Table Edge Controls

Table insertion and operation controls sit on cell boundaries rather than inside cell content.

- Left and right circular `+` controls insert columns; top and bottom circular `+` controls insert rows.
- The focused row operation control is centered on the first cell's left boundary. The focused column operation control is centered on the header cell's top boundary.
- The first row's top boundary belongs exclusively to column operations, and the first column's left boundary belongs exclusively to row operations; neither boundary renders a `+` control.
- Cells below the first row and to the right of the first column expose top, bottom, left, and right `+` controls, so internal boundaries support insertion from either adjacent cell.
- Boundary controls remain hidden until their owning cell is hovered. Focused row and column operation controls remain visible while that cell has focus.
- Controls reuse `--hn-bg`, `--hn-border-strong`, `--hn-text-muted`, and `--hn-theme`; no table-specific palette is introduced.
- While dragging a row or column control, a solid `--hn-theme` line previews the insertion boundary. Crossing the target cell's midpoint along the drag axis advances the preview to its next boundary, and releasing must place the row or column at that exact line.
- Destructive row deletion uses an in-menu two-step state: `删除行` changes to `确认删除行`, and only the second explicit activation deletes the row. Escape, outside click, scroll, or resize cancels the pending state by closing the menu.

---

## 11. Formula Block and Editor

- Formula blocks render centered display math in the original block row and remain unframed in read-only mode.
- In editable mode the complete preview row is a button with the standard editable hover and focus treatments; activating it opens the formula editor.
- The editor is a fixed portal popover using the existing dark popover surface, radius, shadow, and fade animation. Its multiline textarea uses the shared monospace stack and a visible theme-color focus ring.
- Formula source updates the original-row preview immediately. Invalid LaTeX remains editable and renders with KaTeX's non-throwing error treatment.
- Escape and outside click close the editor. Escape restores focus to the formula preview; scroll and resize close the portal to prevent stale positioning.

---

## 12. Picture Block and Upload

- Picture is a first-class block beside code, table, and formula blocks. It occupies the normal content column and preserves the uploaded asset's intrinsic aspect ratio.
- The image surface uses the existing `--hn-border` token and an `8px` radius. It does not introduce a card background, caption panel, shadow, or new palette.
- Editable picture blocks reuse the standard left block handle. The existing block menu exposes a `图片` action only when the host supplies `onPictureUpload` and can accept block changes.
- Activating `图片` opens the system image picker. While the selected file is being read and uploaded, the menu action is disabled and labelled `上传中…`; a rejected upload remains in place as `上传失败，重试` without replacing the source block.
- The image `alt` text is the original filename. Uploaded images retain their intrinsic width and height as optional block metadata so read-only and editable rendering reserve the same responsive geometry before decoding.

---

## 13. Block Move Interaction

- Editable controlled notes allow ordinary top-level blocks, checklist items, and quote lines to be reordered within their respective containers without introducing a separate palette or floating drag preview.
- Above the `840px` compact breakpoint, dragging starts from each row's existing conversion handle. Checklist items and quote lines use their own existing handles and never add a drag-only handle to the composite parent. A click without pointer travel on a conversion handle continues to open its menu.
- At and below the compact breakpoint, where handles are hidden, a stationary `500ms` touch hold on a row starts the same move interaction. Moving before the hold threshold preserves native scrolling and cancels the pending drag. Once dragging activates, native text selection is cleared for the remainder of the gesture.
- The source block remains rendered in place throughout the gesture. Crossing another block's vertical midpoint previews the corresponding insertion boundary with a `3px` `--hn-theme` line and `--hn-theme-soft` edge.
- Reordering is committed through `onBlocksChange` only on pointer release. Pointer cancellation removes all transient drag and insertion states without changing blocks.

---

## 14. Link Mention Menu

- Typing `@` in any editable text surface opens a fixed-position listbox immediately below the caret. The listbox uses the existing desktop popover surface, `10px` radius, shadow, padding, and opacity fade; it introduces no new palette or motion language.
- Options reuse the popover button states: transparent with `#e2e8f0` text by default, then `rgba(255, 255, 255, 0.14)` with white text while hovered or keyboard-selected.
- Arrow Up and Arrow Down move the active option cyclically, Enter inserts it, and Escape closes the listbox without changing the trigger text. Pointer selection preserves the editable caret.
- An inserted mention is a non-editable inline pill containing the visible `@name` and the link id in `data-note-link-id`. It uses `--hn-theme-soft`, `--hn-theme-text`, and the existing `999px` inline-pill radius.
- The menu exposes `role="listbox"`; each option exposes `role="option"` and `aria-selected`. Keyboard focus keeps the standard theme-color outline.
