# Baseline Evidence

Source: notes 3.0.0 `2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c`.
Node v24.15.0, Yarn 1.22.22, Linux.

- `baseline-compat.log`: 6 files / 162 tests pass, exit 0.
- `baseline-typecheck.log`: exit 0.
- `baseline-build.log`: library build exit 0.
- `inventory.json`: root runtime/type/source and CSS package export inventory.
- `index.d.ts`: original built root declaration.
- `consumer.tsx`: root-only legacy consumer fixture for pack verification.
- `publicApi*.txt`: exact original tests, preserved for comparison.

Inputs match the original HAM-36 attachment bytes:

| Attachment | SHA-256 |
| --- | --- |
| `01a14a1a-b3d2-7575-a2bc-7b09eb6c5d93` upstream API | `2a971eefa30cc3070e6a555e682ff45c6fc9d4f59b57b21d75e5433c6473b4dc` |
| `01a14a1a-b27f-7d99-947b-6b55997e7f79` migration plan | `032529d72766a64a7770370abbc1e74b842384469a02a2e1a0f5c9c25fcd7137` |
| `01a14997-e358-757b-ba4a-93e89906ad01` prototype patch | `c1435c925fd7e5c000270b3d934c7fdae335de439675274bd25bad1820709d66` |
| `01a1498f-f3de-7acc-89eb-78b816588882` review boundaries | `73865c65b26718262a8bb3875ae5ba607b25e963544bccb4c9ad61cf5292e005` |

`review-boundaries.test.ts` matches the separate reviewer attachment byte for byte.
Historical probes: 41 passed / 1 failed, exit 1; see `historical-probes.log`.
The sole failure is the original selective undo counterexample, not a formal A
acceptance test. Neither assertions nor skip/xfail status were modified.
