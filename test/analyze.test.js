import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeWorkflowText, severityAtLeast } from '../src/analyze.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function fixture(name) {
  return readFile(path.join(here, 'fixtures', name), 'utf8');
}

test('efficient workflow has transparent low maximum and no findings', async () => {
  const result = analyzeWorkflowText(await fixture('efficient.yml'), 'efficient.yml');
  assert.equal(result.valid, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.summary.configuredMaximumUsdPerRun, 0.12);
  assert.equal(result.jobs[0].matrixCount, 2);
});

test('risky workflow exposes missing timeout, macOS, matrix, concurrency, and retention', async () => {
  const result = analyzeWorkflowText(await fixture('risky.yml'), 'risky.yml');
  const rules = new Set(result.findings.map((item) => item.rule));
  assert.equal(result.valid, true);
  assert.equal(result.jobs[0].matrixCount, 18);
  assert.equal(result.summary.knownConfiguredMaximumUsdPerRun, 168.48);
  assert.ok(rules.has('ACG001'));
  assert.ok(rules.has('ACG002'));
  assert.ok(rules.has('ACG003'));
  assert.ok(rules.has('ACG004'));
  assert.ok(rules.has('ACG005'));
  assert.ok(result.summary.high >= 3);
});

test('dynamic runners are reported as unknown instead of guessed', () => {
  const result = analyzeWorkflowText(`
name: Dynamic
on: workflow_dispatch
jobs:
  test:
    runs-on: \${{ inputs.runner }}
    timeout-minutes: 15
    steps: []
`, 'dynamic.yml');
  assert.equal(result.summary.configuredMaximumUsdPerRun, null);
  assert.equal(result.summary.hasUnknownCost, true);
  assert.ok(result.findings.some((item) => item.rule === 'ACG007'));
});

test('invalid YAML produces a high-severity parse finding', () => {
  const result = analyzeWorkflowText('jobs:\n  test: [', 'broken.yml');
  assert.equal(result.valid, false);
  assert.equal(result.findings[0].rule, 'ACG000');
  assert.equal(result.findings[0].severity, 'high');
});

test('severity thresholds are ordered', () => {
  assert.equal(severityAtLeast('high', 'medium'), true);
  assert.equal(severityAtLeast('medium', 'high'), false);
  assert.equal(severityAtLeast('low', 'low'), true);
});
