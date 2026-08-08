# EXP-001 validation result

Completed: 2026-08-08

## Question tested

Can a small deterministic tool produce specific, defensible GitHub Actions cost-risk findings before workflow execution without repository tokens or a hosted service?

This experiment did **not** test willingness to install or pay. Public repositories receive free Actions usage and are used only as realistic workflow inputs.

## Product-quality gate

Commands executed:

```powershell
npm install
npm test
node src/cli.js test/fixtures/risky.yml --monthly-runs 100
npm run benchmark
```

Results:

- Dependency audit: 0 reported vulnerabilities.
- Automated tests: 5 passed, 0 failed.
- Synthetic risky fixture: five distinct rules, including three high-severity categories (missing timeout, macOS runner, and large matrix).
- Corrected an overstatement discovered during the first benchmark: literal OS-matrix rates are now summed by variant instead of applying the highest rate to every combination.
- Added the current 1-core `ubuntu-slim` rate rather than treating it as standard 2-core Linux.

## Public-workflow benchmark

Method: fetch the first and last workflow filename alphabetically from each of eight established public repositories through the GitHub API. The deterministic sample is reproducible but not statistically representative.

Repositories: Django, VS Code, Node.js, pnpm, Rails, Supabase, Next.js, and Vite.

Observed:

- 16 workflows analyzed;
- 0 fetch or parse errors;
- 13 workflows had at least one high finding;
- 16 high and 8 medium findings;
- manual high-finding review: 15 actionable, 1 clearly unactionable in context;
- clearly unactionable high rate: 6.25%, below the 20% experiment threshold.

The clear false-positive was VS Code's macOS chat-library test: the job intentionally tests all three operating systems with a 30-minute timeout, so cross-platform coverage makes the macOS warning non-actionable. Missing-timeout findings remained actionable even on short helper jobs because a small explicit bound is available. Node.js's five-minute scheduled workflow made that guardrail especially concrete.

Benchmark sources are fetched live by `scripts/benchmark.mjs`; no third-party workflow content is stored in this repository.

## Decision

The feasibility and finding-quality gate passes. Continue only to a demand/adoption test; do not build a hosted dashboard, billing integration, or organization administration yet.

Demand remains the riskiest assumption. The next bounded experiment is a factual, non-spam public adoption test:

1. publish the free local CLI and a sample report in a public repository;
2. offer a no-upload workflow audit through one or two relevant developer channels;
3. measure qualified visits, installs, completed analyses, shared findings, repeat use, and requests for organization-level paid controls.

Suggested 30-day continue signal: at least 10 independent installs, 3 users sharing a real finding, and either 2 repeat users or 1 explicit request for a paid team feature. Kill or reposition if 200 qualified page visits produce fewer than 3 installs, or if installers report that native GitHub metrics already solve the need.

## Publication path checked

Current GitHub documentation recommends a separate repository for a reusable action. A Marketplace listing additionally requires a public repository with one root `action.yml`/`action.yaml`, a unique action name, a tagged release, two-factor authentication, and acceptance of the GitHub Marketplace Developer Agreement. JavaScript actions normally commit bundled/compiled dependencies for consumers.

Those steps add packaging work and a legally significant agreement before demand is known. The lower-cost first test is therefore a standalone public repository for the tested CLI and sample report, without a Marketplace listing. Add an action wrapper only after early users show that CI installation—not local audit output—is the adoption bottleneck.

Sources checked 2026-08-08: [publishing actions](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace), [releasing and maintaining actions](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/release-and-maintain-actions), and [managing custom actions](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/manage-custom-actions).
