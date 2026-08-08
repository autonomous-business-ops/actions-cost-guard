import { analyzeWorkflowText } from '../src/analyze.js';

const repositories = [
  'django/django',
  'microsoft/vscode',
  'nodejs/node',
  'pnpm/pnpm',
  'rails/rails',
  'supabase/supabase',
  'vercel/next.js',
  'vitejs/vite',
];

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'actions-cost-guard-validation',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

function deterministicSample(items, count = 2) {
  const sorted = items
    .filter((item) => item.type === 'file' && /\.ya?ml$/i.test(item.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (sorted.length <= count) return sorted;
  return [sorted[0], sorted[sorted.length - 1]];
}

const results = [];
for (const repository of repositories) {
  try {
    const items = await getJson(`https://api.github.com/repos/${repository}/contents/.github/workflows`);
    for (const item of deterministicSample(items)) {
      const text = await getText(item.download_url);
      const analysis = analyzeWorkflowText(text, `${repository}/${item.name}`);
      results.push({
        repository,
        workflow: item.name,
        sourceUrl: item.html_url,
        valid: analysis.valid,
        jobs: analysis.summary.jobs,
        configuredMaximumUsdPerRun: analysis.summary.configuredMaximumUsdPerRun,
        high: analysis.summary.high,
        medium: analysis.summary.medium,
        low: analysis.summary.low,
        findings: analysis.findings.map((item) => ({
          rule: item.rule,
          severity: item.severity,
          job: item.job,
          message: item.message,
        })),
      });
    }
  } catch (error) {
    results.push({ repository, error: error.message });
  }
}

const successful = results.filter((result) => !result.error);
const summary = {
  checkedAt: new Date().toISOString(),
  methodology: 'First and last workflow filename alphabetically from each repository; public workflows are a rule-quality proxy only.',
  repositories: repositories.length,
  workflows: successful.length,
  errors: results.length - successful.length,
  workflowsWithHigh: successful.filter((result) => result.high > 0).length,
  highFindings: successful.reduce((sum, result) => sum + result.high, 0),
  mediumFindings: successful.reduce((sum, result) => sum + result.medium, 0),
  lowFindings: successful.reduce((sum, result) => sum + result.low, 0),
};

console.log(JSON.stringify({ summary, results }, null, 2));
