# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-20

### Changed
- Major version upgrade

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
