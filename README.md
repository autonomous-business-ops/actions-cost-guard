# Actions Cost Guard

An experimental local-first CLI that reviews GitHub Actions workflow YAML before it runs. It reports cost smells and a transparent **configured maximum exposure** based on literal runner, matrix, and timeout settings.

This is not a bill predictor. Actual spend depends on run duration, included minutes, public/private repository status, larger-runner selection, cancellations, and GitHub pricing. Unknown or dynamic values are surfaced rather than guessed.

## Quick start

Run directly from the public repository with Node.js 20 or newer:

```powershell
npx --yes --package=github:autonomous-business-ops/actions-cost-guard actions-cost-guard path\to\repo --monthly-runs 250
```

Or clone it for repeat use and local tests:

```powershell
git clone https://github.com/autonomous-business-ops/actions-cost-guard.git
Set-Location actions-cost-guard
npm install
npm test
node src/cli.js path\to\repo --monthly-runs 250
node src/cli.js .github\workflows\ci.yml --json
node src/cli.js path\to\repo --fail-on high
```

The one-command path downloads the package source and dependency from GitHub/npm, then the CLI reads the target files locally. It needs no GitHub token and does not upload workflow contents. See the generated [sample report](examples/sample-report.md) for the deliberately risky test fixture.

When given a repository directory, the CLI scans `.github/workflows`. Findings currently cover:

- missing job timeouts (GitHub's default maximum is 360 minutes);
- expensive macOS runner use;
- large literal matrices;
- missing cancellation of superseded PR/push runs;
- artifact uploads with missing or long retention;
- dynamic values that prevent a defensible calculation.

## Interpretation

The dollar figure is a worst-case configuration exposure, not an expected charge. For example, a 20-minute timeout on a USD 0.006/minute runner contributes USD 0.12 per matrix job. A missing timeout uses GitHub's documented 360-minute default and is labeled accordingly.

Rates are explicit in `src/analyze.js`, including the `ubuntu-slim` 1-core rate. They were checked on 2026-08-08 against GitHub's [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing). Review them again before production use because GitHub can change pricing.

## Paid pilot

Need a human-reviewed result? The [fixed-price USD 99 cost-risk audit pilot](PAID-AUDIT.md) covers up to 10 workflow files with no repository token required. A public-safe [order request](https://github.com/autonomous-business-ops/actions-cost-guard/issues/new?template=paid-audit-order.yml) starts scope confirmation; do not post private data or send funds before receiving order-specific instructions. Adoption and savings are not yet validated.

## Validation and feedback

The product-quality gate passed 5 automated tests and a deterministic benchmark of 16 current public workflows with zero parse/fetch errors. This validates feasibility, not adoption or savings. The full method, limitations, and result are in [VALIDATION.md](VALIDATION.md).

If the tool finds something useful—or produces a noisy result—open an [analysis feedback issue](https://github.com/autonomous-business-ops/actions-cost-guard/issues/new?template=analysis-feedback.yml). Do not include private workflow contents, credentials, or proprietary logs.
