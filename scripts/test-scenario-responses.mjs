const DEFAULT_BASE_URL = process.env.SCENARIO_TEST_BASE_URL || 'http://localhost:3000';
const DEFAULT_RUNS = Number.parseInt(process.env.SCENARIO_TEST_RUNS || '5', 10);

const SCENARIOS = [
  { id: 'well-prepared', label: 'Well-Prepared' },
  { id: 'vague-minimal', label: 'Vague / Minimal' },
  { id: 'contradictory', label: 'Contradictory' },
  { id: 'off-topic', label: 'Off-Topic / Confused' },
  { id: 'over-ambitious', label: 'Over-Ambitious' },
  { id: 'hostile-resistant', label: 'Hostile / Resistant' },
];

const STATUS_KEYS = ['addressed', 'partial', 'not-addressed'];

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    runs: DEFAULT_RUNS,
    jsonOut: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base-url' && argv[i + 1]) {
      options.baseUrl = argv[++i];
    } else if (arg === '--runs' && argv[i + 1]) {
      options.runs = Number.parseInt(argv[++i], 10);
    } else if (arg === '--json-out' && argv[i + 1]) {
      options.jsonOut = argv[++i];
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isInteger(options.runs) || options.runs <= 0) {
    throw new Error(`Invalid --runs value: ${options.runs}`);
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, '');
  return options;
}

function printHelp() {
  console.log(`Scenario response test runner

Usage:
  npm run test:scenarios
  npm run test:scenarios -- --base-url http://localhost:3000 --runs 5

Options:
  --base-url <url>   Backend base URL. Default: ${DEFAULT_BASE_URL}
  --runs <number>    Responses to generate per scenario. Default: ${DEFAULT_RUNS}
  --json-out <path>  Optional path to save raw aggregated results as JSON
`);
}

function blankCounts() {
  return {
    addressed: 0,
    partial: 0,
    'not-addressed': 0,
  };
}

function totalCount(counts) {
  return STATUS_KEYS.reduce((sum, key) => sum + counts[key], 0);
}

function statusLabel(status) {
  if (status === 'addressed') return 'Addressed';
  if (status === 'partial') return 'Partial';
  return 'Not Addressed';
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function bar(count, maxCount, width = 24) {
  if (maxCount <= 0) return '';
  const size = Math.max(1, Math.round((count / maxCount) * width));
  return '#'.repeat(size);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(`${url} failed: ${detail}`);
  }

  return payload;
}

function applyEvaluations(counts, evaluations) {
  for (const evaluation of evaluations) {
    if (STATUS_KEYS.includes(evaluation.status)) {
      counts[evaluation.status] += 1;
    }
  }
}

function printTable(results, overall) {
  console.log('\nScenario totals');
  console.log(
    [
      pad('Scenario', 24),
      pad('Addressed', 12),
      pad('Partial', 10),
      pad('Not Addressed', 16),
      pad('Total Answers', 14),
    ].join(' '),
  );
  console.log('-'.repeat(82));

  for (const result of results) {
    console.log(
      [
        pad(result.label, 24),
        pad(result.counts.addressed, 12),
        pad(result.counts.partial, 10),
        pad(result.counts['not-addressed'], 16),
        pad(totalCount(result.counts), 14),
      ].join(' '),
    );
  }

  console.log('-'.repeat(82));
  console.log(
    [
      pad('Overall', 24),
      pad(overall.addressed, 12),
      pad(overall.partial, 10),
      pad(overall['not-addressed'], 16),
      pad(totalCount(overall), 14),
    ].join(' '),
  );
}

function printCharts(results, overall) {
  const maxScenarioValue = Math.max(
    ...results.flatMap((result) => [
      result.counts.addressed,
      result.counts.partial,
      result.counts['not-addressed'],
    ]),
    1,
  );

  console.log('\nChart by scenario');
  for (const result of results) {
    console.log(`\n${result.label}`);
    for (const key of STATUS_KEYS) {
      const count = result.counts[key];
      console.log(
        `  ${pad(statusLabel(key), 14)} ${pad(count, 3)} ${bar(count, maxScenarioValue)}`,
      );
    }
  }

  const maxOverallValue = Math.max(
    overall.addressed,
    overall.partial,
    overall['not-addressed'],
    1,
  );

  console.log('\nOverall totals');
  for (const key of STATUS_KEYS) {
    const count = overall[key];
    console.log(
      `  ${pad(statusLabel(key), 14)} ${pad(count, 3)} ${bar(count, maxOverallValue, 36)}`,
    );
  }
}

async function maybeWriteJson(filepath, payload) {
  if (!filepath) return;
  const fs = await import('fs/promises');
  await fs.writeFile(filepath, JSON.stringify(payload, null, 2));
  console.log(`\nSaved JSON results to ${filepath}`);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];
  const overall = blankCounts();

  console.log(`Running scenario test against ${options.baseUrl}`);
  console.log(`Scenarios: ${SCENARIOS.length}, runs per scenario: ${options.runs}`);

  for (const scenario of SCENARIOS) {
    const counts = blankCounts();

    for (let runIndex = 1; runIndex <= options.runs; runIndex++) {
      console.log(`- ${scenario.id}: run ${runIndex}/${options.runs}`);

      const generated = await postJson(
        `${options.baseUrl}/api/generate-scenario-responses`,
        { scenario: scenario.id },
      );

      if (!generated?.responses || typeof generated.responses !== 'object') {
        throw new Error(`Scenario ${scenario.id} returned no responses payload`);
      }

      const evaluated = await postJson(
        `${options.baseUrl}/api/evaluate-assessment`,
        { responses: generated.responses },
      );

      if (!Array.isArray(evaluated?.evaluations)) {
        throw new Error(`Scenario ${scenario.id} returned no evaluations payload`);
      }

      applyEvaluations(counts, evaluated.evaluations);
    }

    for (const key of STATUS_KEYS) {
      overall[key] += counts[key];
    }

    results.push({
      id: scenario.id,
      label: scenario.label,
      runs: options.runs,
      counts,
    });
  }

  printTable(results, overall);
  printCharts(results, overall);

  await maybeWriteJson(options.jsonOut, {
    baseUrl: options.baseUrl,
    runsPerScenario: options.runs,
    scenarios: results,
    overall,
  });
}

run().catch((error) => {
  console.error('\nScenario test failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
