# Actions Cost Guard sample report

Generated from `test/fixtures/risky.yml` with:

```powershell
node src/cli.js test/fixtures/risky.yml --monthly-runs 100
```

> Static configuration exposure, not a predicted bill.

## test/fixtures/risky.yml

- Jobs: 1
- Findings: 3 high, 2 medium, 0 low
- Known configured maximum per run: USD 168.48
- Known configured maximum at 100 runs/month: USD 16848.00

| Severity | Rule | Job | Finding |
|---|---|---|---|
| MEDIUM | ACG004 | workflow | Push or pull-request runs do not explicitly cancel superseded workflow runs. Add a concurrency group with `cancel-in-progress: true` when older runs no longer provide value. |
| HIGH | ACG001 | test | Job has no `timeout-minutes` and therefore permits up to 360 minutes. Set a realistic job-level `timeout-minutes` value based on observed healthy runs plus headroom. |
| HIGH | ACG002 | test | Job can use macOS runners (`macos-14`), modeled at over 10 times the standard Linux rate. Keep macOS only for steps that require Apple tooling; move portable lint, unit, and packaging work to Linux. |
| HIGH | ACG003 | test | Literal matrix expands to approximately 18 job combinations. Remove redundant combinations, use `include` for targeted coverage, or split full coverage into a less frequent workflow. |
| MEDIUM | ACG005 | test | Artifact upload at step 2 has no explicit retention period. Set `retention-days` to the shortest period that supports the workflow. |

## Assumptions

- Standard hosted-runner rates are hard-coded and must be checked against current GitHub billing documentation.
- Included minutes, public-repository exemptions, discounts, real runtime, and cancellations are not predicted.
