#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { analyzeWorkflowText, severityAtLeast } from './analyze.js';

function usage() {
  return `Actions Cost Guard\n\nUsage:\n  node src/cli.js <workflow-file-or-repository> [--json] [--monthly-runs N] [--fail-on high|medium|low]\n`;
}

function parseArgs(argv) {
  const options = { target: null, json: false, monthlyRuns: null, failOn: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--monthly-runs') options.monthlyRuns = Number(argv[++index]);
    else if (arg === '--fail-on') options.failOn = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.target) options.target = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (options.monthlyRuns !== null && (!Number.isFinite(options.monthlyRuns) || options.monthlyRuns < 0)) {
    throw new Error('--monthly-runs must be a non-negative number.');
  }
  if (options.failOn && !['high', 'medium', 'low'].includes(options.failOn)) {
    throw new Error('--fail-on must be high, medium, or low.');
  }
  return options;
}

async function workflowFiles(target) {
  const targetPath = path.resolve(target);
  const info = await stat(targetPath);
  if (info.isFile()) return [targetPath];
  if (!info.isDirectory()) throw new Error('Target must be a workflow file or repository directory.');

  const workflowDirectory = path.join(targetPath, '.github', 'workflows');
  let entries;
  try {
    entries = await readdir(workflowDirectory, { withFileTypes: true });
  } catch {
    entries = await readdir(targetPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => path.join(targetPath, entry.name));
  }
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(workflowDirectory, entry.name));
}

function money(value) {
  return value === null ? 'unknown' : `USD ${value.toFixed(2)}`;
}

function markdownReport(results, monthlyRuns) {
  const lines = ['# Actions Cost Guard', '', '> Static configuration exposure, not a predicted bill.', ''];
  for (const result of results) {
    lines.push(`## ${result.source}`, '');
    if (!result.valid) {
      lines.push(`Invalid workflow: ${result.error}`, '');
      continue;
    }
    lines.push(`- Jobs: ${result.summary.jobs}`);
    lines.push(`- Findings: ${result.summary.high} high, ${result.summary.medium} medium, ${result.summary.low} low`);
    lines.push(`- Known configured maximum per run: ${money(result.summary.knownConfiguredMaximumUsdPerRun)}`);
    if (monthlyRuns !== null) {
      const monthly = result.summary.knownConfiguredMaximumUsdPerRun === null
        ? null
        : result.summary.knownConfiguredMaximumUsdPerRun * monthlyRuns;
      lines.push(`- Known configured maximum at ${monthlyRuns} runs/month: ${money(monthly)}`);
    }
    if (result.summary.hasUnknownCost) lines.push('- Some cost is unknown because runner values are dynamic or unrecognized.');
    lines.push('');

    if (!result.findings.length) {
      lines.push('No current rules fired.', '');
      continue;
    }
    lines.push('| Severity | Rule | Job | Finding |', '|---|---|---|---|');
    for (const item of result.findings) {
      lines.push(`| ${item.severity.toUpperCase()} | ${item.rule} | ${item.job ?? 'workflow'} | ${item.message} ${item.remediation} |`);
    }
    lines.push('');
  }
  lines.push('## Assumptions', '', '- Standard hosted-runner rates are hard-coded and must be checked against current GitHub billing documentation.', '- Included minutes, public-repository exemptions, discounts, real runtime, and cancellations are not predicted.', '');
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help || !options.target) {
    console.log(usage());
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  try {
    const files = await workflowFiles(options.target);
    if (!files.length) throw new Error('No .yml or .yaml workflow files found.');
    const results = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      results.push(analyzeWorkflowText(text, path.relative(process.cwd(), file)));
    }

    if (options.json) console.log(JSON.stringify({ monthlyRuns: options.monthlyRuns, results }, null, 2));
    else console.log(markdownReport(results, options.monthlyRuns));

    if (options.failOn && results.some((result) => result.findings.some((item) => severityAtLeast(item.severity, options.failOn)))) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Analysis failed: ${error.message}`);
    process.exitCode = 2;
  }
}

await main();
