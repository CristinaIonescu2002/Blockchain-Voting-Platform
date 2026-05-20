#!/usr/bin/env node
// Benchmark API latency and throughput against the local backend.
// Reads endpoint definitions from a JSON config and reports p50/p95/p99/throughput per endpoint.
// SAFETY: this script only hits endpoints listed in the config. Configure it with read-only or
// transaction-BUILDING endpoints. Do NOT add endpoints that submit signed transactions on-chain.

import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

function usage() {
  console.error(
    'Usage: node benchmarks/api-latency.mjs benchmarks/api-latency.config.json [--out benchmarks/results/api_latency.csv]',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = { configPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      args.outPath = argv[++i];
    } else if (!args.configPath) {
      args.configPath = a;
    }
  }
  if (!args.configPath) usage();
  return args;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function summarise(samplesMs, wallMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    samples: sorted.length,
    minMs: sorted[0] ?? 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: sum / Math.max(sorted.length, 1),
    throughputReqPerSec: wallMs > 0 ? (sorted.length / wallMs) * 1000 : 0,
  };
}

async function timedRequest(endpoint) {
  const start = performance.now();
  let status = 0;
  let ok = false;
  let errorMessage = '';
  try {
    const response = await fetch(endpoint.url, {
      method: endpoint.method ?? 'GET',
      headers: endpoint.headers ?? undefined,
      body: endpoint.body !== undefined ? JSON.stringify(endpoint.body) : undefined,
    });
    status = response.status;
    ok = response.ok;
    // Drain body so the connection can be reused.
    await response.arrayBuffer();
  } catch (err) {
    errorMessage = err?.message ?? String(err);
  }
  return {
    latencyMs: performance.now() - start,
    status,
    ok,
    errorMessage,
  };
}

async function runWorkers(endpoint, totalRequests, concurrency) {
  const latencies = [];
  const errors = [];
  let dispatched = 0;
  const startWall = performance.now();

  async function worker() {
    while (true) {
      const myIndex = dispatched++;
      if (myIndex >= totalRequests) return;
      const result = await timedRequest(endpoint);
      if (result.ok) {
        latencies.push(result.latencyMs);
      } else {
        errors.push({ status: result.status, errorMessage: result.errorMessage });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const wallMs = performance.now() - startWall;
  return { latencies, errors, wallMs };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const { configPath, outPath } = parseArgs(process.argv.slice(2));
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

const defaults = {
  warmup: config.warmup ?? 5,
  requests: config.requests ?? 100,
  concurrency: config.concurrency ?? 4,
};

const headerRow = [
  'name',
  'method',
  'url',
  'requests',
  'errors',
  'min_ms',
  'p50_ms',
  'p95_ms',
  'p99_ms',
  'max_ms',
  'mean_ms',
  'wall_ms',
  'throughput_req_per_s',
];

const csvLines = [headerRow.join(',')];

console.error(
  `# api-latency: ${config.endpoints.length} endpoint(s), defaults requests=${defaults.requests} concurrency=${defaults.concurrency} warmup=${defaults.warmup}`,
);

for (const endpoint of config.endpoints) {
  const requests = endpoint.requests ?? defaults.requests;
  const concurrency = endpoint.concurrency ?? defaults.concurrency;
  const warmup = endpoint.warmup ?? defaults.warmup;

  console.error(
    `\n[${endpoint.name}] ${endpoint.method ?? 'GET'} ${endpoint.url}  (warmup=${warmup}, requests=${requests}, concurrency=${concurrency})`,
  );

  if (warmup > 0) {
    await runWorkers(endpoint, warmup, Math.min(concurrency, warmup));
  }

  const { latencies, errors, wallMs } = await runWorkers(endpoint, requests, concurrency);
  const stats = summarise(latencies, wallMs);

  console.error(
    `  ok=${latencies.length}  errors=${errors.length}  p50=${stats.p50Ms.toFixed(1)}ms  p95=${stats.p95Ms.toFixed(1)}ms  p99=${stats.p99Ms.toFixed(1)}ms  throughput=${stats.throughputReqPerSec.toFixed(1)} req/s`,
  );

  if (errors.length > 0) {
    const sample = errors.slice(0, 3).map((e) => `status=${e.status} ${e.errorMessage}`).join(' | ');
    console.error(`  first errors: ${sample}`);
  }

  csvLines.push(
    [
      endpoint.name,
      endpoint.method ?? 'GET',
      endpoint.url,
      latencies.length,
      errors.length,
      stats.minMs.toFixed(2),
      stats.p50Ms.toFixed(2),
      stats.p95Ms.toFixed(2),
      stats.p99Ms.toFixed(2),
      stats.maxMs.toFixed(2),
      stats.meanMs.toFixed(2),
      wallMs.toFixed(2),
      stats.throughputReqPerSec.toFixed(2),
    ]
      .map(csvEscape)
      .join(','),
  );
}

const csv = csvLines.join('\n') + '\n';
if (outPath) {
  await fs.writeFile(outPath, csv);
  console.error(`\nWrote ${outPath}`);
} else {
  process.stdout.write(csv);
}
