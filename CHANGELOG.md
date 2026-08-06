# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-08-03

### Added
- External item drag and drop support: drag files, images, links and text from outside the note into the editor
- Card block with full Dialog editing interaction and card drawer / inspector
- Drawing block with persistent bottom toolbar and @mention filtering
- Inline Markdown shortcuts (quick input with conversion to structured blocks)
- Cross-region selection and formatting across title, summary and blocks as one note text flow
- Continuous text selection with atomic selection units (image, drawing, card, directory, standalone formula block, table row)
- Structured clipboard: copy/paste preserves internal structure via `application/x-hamsternote-fragment+json` (v2)
- `useNoteContentUndoRedo` hook and `NoteContentUndoRedoHandle` for undo/redo history
- Restricted HTML sanitization for rich text at render and commit boundaries
- Always show code editor when editable
- Lock field on `NoteCardData`
- `topPadding`/`bottomPadding` support kept for Docked mode scroll
- ADR docs: restricted HTML for rich text, commit cross-region edits as note transactions

### Changed
- Migrated Dialog/Popover/Button to `@hamster-note/components`, removed custom portal overlays
- Switched package manager from pnpm to yarn
- Clipboard & selection overhaul (pointer selection, region codec, snapshot mutation)
- Refactored block editing into focused components with syntax highlight support
- README and design docs updated for continuous text selection semantics

### Fixed
- Special block ID and mention boundary handling
- Inline Markdown shortcut persistence for nested structures and popover style clearing
- Dialog content area flex layout, theme/themeColor propagation to CardBlock Dialog
- List keyboard shortcut type branch completion and multi-line input regression

### BREAKING CHANGES
- Package manager switched from pnpm to yarn (use `yarn install`)
- Internal clipboard fragment MIME bumped to v2

## [1.2.0-beta] - 2026-07-20

### Added
- Inline formula rendering and format toolbar (bold/italic/underline/strikethrough/code/formula)
- List features upgrade: todo, unordered list, ordered list, directory, collapsible blocks and text color
- Markdown quick input and empty block Backspace demote to paragraph
- Cross-block selection formatting support
- Format button highlight state and clear formatting button
- Selection popover component

### Fixed
- List keyboard shortcut type branch completion
- Editor list and multi-line input regression
- CI lint errors

## [1.1.0] - 2026-07-18

### Added
- Table block support with row/column insert and editing
- Text block editing with syntax highlight support
- Block action menu component
- Five heading levels support
- Block-level drag and drop with selection mode
- Theme prop for component customization
- Metadata panel in note header (reading time, block count, last updated)
- `topPadding`/`bottomPadding` props for Docked mode scroll
- Visible glyph to block handle

### Fixed
- Table row/column insert position and ref type compatibility
- CSS: enlarged container horizontal padding to expose add button
- Shift+Enter line break handling
- Block handle alignment

### Changed
- Extracted block editing into focused components with syntax highlight support
- Flattened content block DOM structure for drag support
- Removed note header metadata panel
- Removed shell decorations

### CI
- Added concurrency cancellation, read-only permissions, and typecheck step

### Style
- Added text block menu presentation

### Test
- Verified block editor interactions

## [1.0.0] - 2026-07-18

### Added
- Initial release
