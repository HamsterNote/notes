# Keyboard Enter Split Observation

## Summary

Pressing **Enter** at the midpoint of a paragraph block splits it into two separate blocks, preserving the text before and after the caret position.

## Test Setup

- **Block targeted:** `intro` (paragraph block, id="intro")
- **Initial text length:** 188 characters
- **Caret position:** offset 94 (midpoint)
- **Block count before:** 10
- **Block count after:** 11

## Observation

1. The `intro` paragraph was focused and the caret was placed at character offset 94 (the midpoint of its 188-character text).
2. Pressing **Enter** triggered `handleTextBlockKeyDown` in `NoteContent.tsx`, which called `splitTextBlockAtHtml` from `blockEditing.ts`.
3. The original block retained the first half of the text (before the caret).
4. A new block with id `intro-line` was inserted immediately after, containing the second half of the text: `"hy, callouts, checklists, and code snippets for pr..."`.
5. The block count increased from 10 to 11, confirming exactly one new block was created.
6. Focus was moved to the new block's start position via `requestFocus`.

## Verification

- Block count delta: +1 (10 -> 11)
- New block `intro-line` exists: true
- New block contains the text after the split point
- Screenshot: `enter-split.png`

## Screenshot

The screenshot `enter-split.png` shows the demo page after the Enter split, with the sidebar block count updated to 11 and the two split paragraphs visible in the editor.
