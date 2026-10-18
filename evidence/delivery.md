# HAM-39 Delivery

PR: https://github.com/HamsterNote/notes/pull/12

Branch: `agent/agent/6c0d60915bac`, base: `main`.
Packed source: `a8c5c8ea48bd2cdd1212bcd5b349e68ddbee98f6`.
Package: `@hamster-note/notes@3.1.0`.
Tarball: `hamster-note-notes-3.1.0-portal-composition-fix.tgz`.
Tarball SHA-256: `ecd5326a9065de9b269218c61a5f1a00b58d6ec2b262a37e3c2db68588beb7c4`.
This supersedes the original and autosave-only packs and contains both rounds
of fixes. See `review-portal-composition-fix.md` for the current verification,
and `review-autosave-fixes.md` for the preceding autosave follow-up.

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

All formal checks passed locally: 38 files / 780 tests, typecheck, build, lint.
No npm publication, merge, WebBase edit or HAM-36 checkbox update was performed.
Physical IME and the real host bridge/navigation/storage still need acceptance
in the host environment. GitHub CI is an external follow-up, not a claimed local
result.
