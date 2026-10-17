# HAM-39 Delivery

PR: https://github.com/HamsterNote/notes/pull/12

Branch: `agent/agent/6c0d60915bac`, base: `main`.
Packed source: `645c3398b82f694465258b9ea82de9c3c62c2b6c`.
Package: `@hamster-note/notes@3.1.0`.
Tarball SHA-256: `a7bbfe56e5dc18be8cec031c7bb2e286a04c464fd12182cc6b05fb04ef21d97e`.

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

All formal checks passed locally: 37 files / 767 tests, typecheck, build, lint.
No npm publication, merge, WebBase edit or HAM-36 checkbox update was performed.
Physical IME and the real host bridge/navigation/storage still need acceptance
in the host environment. GitHub CI is an external follow-up, not a claimed local
result.
