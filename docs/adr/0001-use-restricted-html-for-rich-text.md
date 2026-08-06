# Use restricted HTML for rich text

HamsterNote persists title, summary, and rich-text body fields as restricted HTML strings, preserving the existing string API while making its implicit HTML semantics explicit. Every field is sanitized and normalized against its own allowlist before rendering and commit; title and summary allow only bold, italic, underline, strikethrough, and inline code, while disallowed wrappers are removed without discarding readable text.

## Consequences

The component, not each host, owns the security and normalization boundary. Structured rich-text nodes were rejected because adopting them would require a breaking public API and storage migration disproportionate to the continuous-selection feature.
