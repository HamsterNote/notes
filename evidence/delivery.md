# HAM-39 Delivery

PR: https://github.com/HamsterNote/notes/pull/12

Branch: `agent/agent/6c0d60915bac`, base: `main`.
Packed source: `3895a5721fb9d0c86f4f8c246a29854c3b28623c`.
Package: `@hamster-note/notes@3.1.0`.
Tarball: `hamster-note-notes-3.1.0-autosave-fix.tgz`.
Tarball SHA-256: `bf823a96f009c946e1e4eaaa3fb9b58304e73abb7e062bffc2161dcc53360683`.
This supersedes the original pre-review pack from `645c339`, which does not
contain the two autosave fixes. See `review-autosave-fixes.md` for the follow-up.

The issue thread carries the actual package archive and verification archive as
attachments. The verification archive contains this report, raw logs, original
baseline inventories, screenshots and clean-consumer fixtures/scripts. The
package archive is not committed or published to npm.

- `validation-report.md`: formal/compatibility/history/browser/resource results,
  exact commands, installation and explicit IME/host/SSR gaps.
- `pack-identity.json`: source commit, exact version, hash and complete tar list.
- `consumer-identity.json`: independently installed package hash, runtime values
  and resolved lockfile; `consumer-*.log` and `consumer.png` are the raw evidence.
- `historical-probes.log`: 41 passed, one known selective-undo failure, exit 1;
  original assertions remain unchanged and are not marked skipped/xfail.

All formal checks passed locally: 37 files / 776 tests, typecheck, build, lint.
No npm publication, merge, WebBase edit or HAM-36 checkbox update was performed.
Physical IME and the real host bridge/navigation/storage still need acceptance
in the host environment. GitHub CI is an external follow-up, not a claimed local
result.
