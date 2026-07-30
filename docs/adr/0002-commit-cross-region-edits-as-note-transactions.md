# Commit cross-region edits as note transactions

An edit that spans title, summary, or body boundaries is committed through one whole-note transaction callback carrying the complete note snapshot and operation metadata. This preserves a single observable state transition and one-step undo/redo; existing field callbacks remain available for edits confined to one region, while cross-region mutations are disabled when the host does not provide the transaction callback.

## Considered Options

Calling `onTitleChange`, `onSummaryChange`, and `onBlocksChange` sequentially was rejected because hosts could observe partial states and could not reliably treat one user action as one undo transaction. Replacing all field props with a controlled note object was rejected as an unnecessarily broad breaking change.
