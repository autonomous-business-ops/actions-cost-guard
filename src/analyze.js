import YAML from 'yaml';

export const RUNNER_RATES_USD_PER_MINUTE = Object.freeze({
  linuxSlim: 0.002,
  linux: 0.006,
  windows: 0.010,
  macos: 0.062,
});

const DEFAULT_JOB_TIMEOUT_MINUTES = 360;
const SEVERITY_WEIGHT = Object.freeze({ high: 30, medium: 10, low: 3 });

function finding(rule, severity, message, remediation, job = null, evidence = {}) {
  return { rule, severity, job, message, remediation, evidence };
}

function workflowTriggers(workflow) {
  const value = workflow.on;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === 'object') return Object.keys(value);
  return [];
}

function literalMatrixDetails(matrix) {
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    return { count: 1, exact: true, dimensions: {} };
  }

  const dimensions = {};
  let count = 1;
  let exact = true;
  for (const [key, value] of Object.entries(matrix)) {
    if (key === 'include' || key === 'exclude') continue;
    if (Array.isArray(value)) {
      dimensions[key] = value;
      count *= Math.max(value.length, 1);
    } else {
      exact = false;
    }
  }

  const excludeCount = Array.isArray(matrix.exclude) ? matrix.exclude.length : 0;
  const includeCount = Array.isArray(matrix.include) ? matrix.include.length : 0;
  if (excludeCount > 0) {
    count = Math.max(1, count - excludeCount);
    exact = false;
  }
  if (includeCount > 0) {
    count += includeCount;
    exact = false;
  }

  return { count, exact, dimensions };
}

function runnerLabels(runsOn, dimensions) {
  const rawLabels = Array.isArray(runsOn) ? runsOn : [runsOn];
  const labels = [];
  let dynamic = false;
  let matrixDimension = null;

  for (const raw of rawLabels) {
    if (typeof raw !== 'string') {
      dynamic = true;
      continue;
    }

    const matrixMatch = raw.match(/^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/);
    if (matrixMatch) {
      const values = dimensions[matrixMatch[1]];
      if (Array.isArray(values)) {
        labels.push(...values.map(String));
        matrixDimension = matrixMatch[1];
      }
      else dynamic = true;
    } else if (raw.includes('${{')) {
      dynamic = true;
    } else {
      labels.push(raw);
    }
  }

  return { labels: [...new Set(labels)], dynamic, matrixDimension };
}

function classifyRunner(label) {
  const normalized = String(label).toLowerCase();
  if (normalized.includes('macos')) return { family: 'macos', rate: RUNNER_RATES_USD_PER_MINUTE.macos };
  if (normalized.includes('windows')) return { family: 'windows', rate: RUNNER_RATES_USD_PER_MINUTE.windows };
  if (normalized.includes('ubuntu-slim')) return { family: 'linux-slim', rate: RUNNER_RATES_USD_PER_MINUTE.linuxSlim };
  if (normalized.includes('ubuntu') || normalized.includes('linux')) {
    return { family: 'linux', rate: RUNNER_RATES_USD_PER_MINUTE.linux };
  }
  if (normalized.includes('self-hosted')) return { family: 'self-hosted', rate: null };
  return { family: 'unknown', rate: null };
}

function artifactFindings(jobName, steps) {
  const findings = [];
  for (const [index, step] of (Array.isArray(steps) ? steps : []).entries()) {
    if (!step || typeof step !== 'object') continue;
    if (!String(step.uses ?? '').toLowerCase().startsWith('actions/upload-artifact@')) continue;

    const retention = Number(step.with?.['retention-days']);
    if (!Number.isFinite(retention)) {
      findings.push(finding(
        'ACG005',
        'medium',
        `Artifact upload at step ${index + 1} has no explicit retention period.`,
        'Set retention-days to the shortest period that supports the workflow.',
        jobName,
        { step: index + 1 },
      ));
    } else if (retention > 30) {
      findings.push(finding(
        'ACG006',
        'medium',
        `Artifact upload at step ${index + 1} retains data for ${retention} days.`,
        'Confirm the retention requirement or reduce retention-days to 30 or less.',
        jobName,
        { step: index + 1, retentionDays: retention },
      ));
    }
  }
  return findings;
}

export function analyzeWorkflowText(text, source = '<memory>') {
  let workflow;
  try {
    workflow = YAML.parse(text);
  } catch (error) {
    return {
      source,
      valid: false,
      error: error.message,
      findings: [finding('ACG000', 'high', 'Workflow YAML could not be parsed.', 'Fix the YAML syntax before cost analysis.', null, { error: error.message })],
      summary: { jobs: 0, findings: 1, riskScore: 30, configuredMaximumUsdPerRun: null },
      jobs: [],
      assumptions: [],
    };
  }

  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return {
      source,
      valid: false,
      error: 'Workflow root must be a mapping.',
      findings: [finding('ACG000', 'high', 'Workflow root is not a YAML mapping.', 'Use a standard GitHub Actions workflow mapping.')],
      summary: { jobs: 0, findings: 1, riskScore: 30, configuredMaximumUsdPerRun: null },
      jobs: [],
      assumptions: [],
    };
  }

  const triggers = workflowTriggers(workflow);
  const findings = [];
  const jobs = [];
  const assumptions = [
    'Rates model standard GitHub-hosted runners and exclude included minutes, discounts, taxes, and larger runners.',
    'Configured maximum exposure uses timeout-minutes, not predicted runtime.',
  ];

  const hasChangeTrigger = triggers.includes('pull_request') || triggers.includes('pull_request_target') || triggers.includes('push');
  const concurrency = workflow.concurrency;
  const cancelsInProgress = Boolean(concurrency && typeof concurrency === 'object' && concurrency['cancel-in-progress'] === true);
  if (hasChangeTrigger && !cancelsInProgress) {
    findings.push(finding(
      'ACG004',
      'medium',
      'Push or pull-request runs do not explicitly cancel superseded workflow runs.',
      'Add a concurrency group with cancel-in-progress: true when older runs no longer provide value.',
      null,
      { triggers },
    ));
  }

  let totalConfiguredMaximum = 0;
  let hasUnknownCost = false;
  const jobEntries = workflow.jobs && typeof workflow.jobs === 'object' ? Object.entries(workflow.jobs) : [];
  for (const [jobName, job] of jobEntries) {
    if (!job || typeof job !== 'object') continue;
    const matrix = literalMatrixDetails(job.strategy?.matrix);
    const timeoutExplicit = Number.isFinite(Number(job['timeout-minutes']));
    const timeoutMinutes = timeoutExplicit ? Number(job['timeout-minutes']) : DEFAULT_JOB_TIMEOUT_MINUTES;
    const runners = runnerLabels(job['runs-on'], matrix.dimensions);
    const classified = runners.labels.map((label) => ({ label, ...classifyRunner(label) }));
    const knownRates = classified.map((item) => item.rate).filter(Number.isFinite);
    const maximumRate = knownRates.length ? Math.max(...knownRates) : null;
    let configuredMaximumUsd = maximumRate === null ? null : timeoutMinutes * matrix.count * maximumRate;
    if (configuredMaximumUsd !== null && matrix.exact && runners.matrixDimension) {
      const runnerValues = matrix.dimensions[runners.matrixDimension];
      const runnerRates = runnerValues?.map((label) => classifyRunner(label).rate) ?? [];
      if (runnerRates.length && runnerRates.every(Number.isFinite)) {
        const combinationsPerRunner = matrix.count / runnerRates.length;
        configuredMaximumUsd = timeoutMinutes
          * combinationsPerRunner
          * runnerRates.reduce((sum, rate) => sum + rate, 0);
      }
    }

    if (configuredMaximumUsd === null) hasUnknownCost = true;
    else totalConfiguredMaximum += configuredMaximumUsd;

    if (!timeoutExplicit) {
      findings.push(finding(
        'ACG001',
        maximumRate === null ? 'medium' : 'high',
        `Job has no timeout-minutes and therefore permits up to ${DEFAULT_JOB_TIMEOUT_MINUTES} minutes.`,
        'Set a realistic job-level timeout-minutes value based on observed healthy runs plus headroom.',
        jobName,
        { assumedTimeoutMinutes: DEFAULT_JOB_TIMEOUT_MINUTES, configuredMaximumUsd },
      ));
    }

    const macosLabels = classified.filter((item) => item.family === 'macos').map((item) => item.label);
    if (macosLabels.length) {
      findings.push(finding(
        'ACG002',
        'high',
        `Job can use macOS runners (${macosLabels.join(', ')}), modeled at over 10× the standard Linux rate.`,
        'Keep macOS only for steps that require Apple tooling; move portable lint, unit, and packaging work to Linux.',
        jobName,
        { labels: macosLabels, macosRate: RUNNER_RATES_USD_PER_MINUTE.macos, linuxRate: RUNNER_RATES_USD_PER_MINUTE.linux },
      ));
    }

    if (matrix.count > 12) {
      findings.push(finding(
        'ACG003',
        'high',
        `Literal matrix expands to approximately ${matrix.count} job combinations${matrix.exact ? '' : ' (includes dynamic/approximate elements)'}.`,
        'Remove redundant combinations, use include for targeted coverage, or split full coverage into a less frequent workflow.',
        jobName,
        { matrixCount: matrix.count, exact: matrix.exact, dimensions: Object.fromEntries(Object.entries(matrix.dimensions).map(([key, value]) => [key, value.length])) },
      ));
    } else if (matrix.count > 6) {
      findings.push(finding(
        'ACG003',
        'medium',
        `Literal matrix expands to approximately ${matrix.count} job combinations${matrix.exact ? '' : ' (includes dynamic/approximate elements)'}.`,
        'Confirm every combination provides decision-relevant coverage.',
        jobName,
        { matrixCount: matrix.count, exact: matrix.exact },
      ));
    }

    if (runners.dynamic || classified.some((item) => item.family === 'unknown')) {
      findings.push(finding(
        'ACG007',
        'low',
        'Runner pricing could not be fully resolved from literal workflow values.',
        'Provide an explicit pricing override in a future version or review this job manually.',
        jobName,
        { labels: runners.labels, dynamic: runners.dynamic },
      ));
      hasUnknownCost = true;
    }

    findings.push(...artifactFindings(jobName, job.steps));
    jobs.push({
      name: jobName,
      timeoutMinutes,
      timeoutExplicit,
      matrixCount: matrix.count,
      matrixExact: matrix.exact,
      runnerLabels: runners.labels,
      runnerFamilies: [...new Set(classified.map((item) => item.family))],
      maximumRateUsdPerMinute: maximumRate,
      configuredMaximumUsd: configuredMaximumUsd === null ? null : Number(configuredMaximumUsd.toFixed(4)),
    });
  }

  const riskScore = findings.reduce((sum, item) => sum + SEVERITY_WEIGHT[item.severity], 0);
  return {
    source,
    name: workflow.name ?? null,
    valid: true,
    triggers,
    findings,
    jobs,
    assumptions,
    summary: {
      jobs: jobs.length,
      findings: findings.length,
      high: findings.filter((item) => item.severity === 'high').length,
      medium: findings.filter((item) => item.severity === 'medium').length,
      low: findings.filter((item) => item.severity === 'low').length,
      riskScore,
      configuredMaximumUsdPerRun: jobs.length && !hasUnknownCost ? Number(totalConfiguredMaximum.toFixed(4)) : null,
      knownConfiguredMaximumUsdPerRun: jobs.length ? Number(totalConfiguredMaximum.toFixed(4)) : null,
      hasUnknownCost,
    },
  };
}

export function severityAtLeast(actual, threshold) {
  const rank = { low: 1, medium: 2, high: 3 };
  return (rank[actual] ?? 0) >= (rank[threshold] ?? 99);
}
