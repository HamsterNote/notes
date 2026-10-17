# Historical Research Probes

Preserved verbatim from attachment `01a14997-e358-757b-ba4a-93e89906ad01`
(freeze fix `378aba1`). These files are not exported by the library and do not
prove formal Provider behavior.

Run `corepack yarn test --config vitest.historical.config.ts` separately.
The selective undo assertion at `session.test.ts:151` is a known unsatisfied
historical B requirement, removed from the approved A scope. All original
assertions remain enabled. A nonzero exit is reported as a failure, never as a
passing formal test run.
