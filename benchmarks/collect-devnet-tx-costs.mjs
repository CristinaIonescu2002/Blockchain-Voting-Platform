#!/usr/bin/env node

import fs from 'node:fs/promises';

const API_URL = 'https://devnet-api.multiversx.com';

function usage() {
  console.error(
    'Usage: node benchmarks/collect-devnet-tx-costs.mjs benchmarks/tx-hashes.csv > benchmarks/results/devnet_tx_costs.csv',
  );
  process.exit(1);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function getFeeEgld(fee) {
  if (fee === undefined || fee === null || fee === '') return '';
  const atomic = BigInt(fee);
  const whole = atomic / 10n ** 18n;
  const fractional = (atomic % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

function inferPayer(tx) {
  return tx.relayer || tx.sender || '';
}

async function readRows(path) {
  const content = await fs.readFile(path, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [operation, txHash] = line.split(',').map((part) => part.trim());
      if (!operation || !txHash) {
        throw new Error(`Invalid row: ${line}`);
      }
      return { operation, txHash };
    });
}

async function fetchTx(txHash) {
  const response = await fetch(`${API_URL}/transactions/${txHash}?withResults=true`);
  if (!response.ok) {
    throw new Error(`Could not fetch ${txHash}: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return body?.data?.transaction ?? body;
}

const inputPath = process.argv[2];
if (!inputPath) usage();

const rows = await readRows(inputPath);
const headers = [
  'operation',
  'txHash',
  'status',
  'sender',
  'relayer',
  'payer',
  'receiver',
  'gasLimit',
  'gasUsed',
  'feeAtomic',
  'feeEgld',
];

console.log(headers.join(','));

for (const row of rows) {
  const tx = await fetchTx(row.txHash);
  const output = {
    operation: row.operation,
    txHash: row.txHash,
    status: tx.status ?? '',
    sender: tx.sender ?? '',
    relayer: tx.relayer ?? '',
    payer: inferPayer(tx),
    receiver: tx.receiver ?? '',
    gasLimit: tx.gasLimit ?? '',
    gasUsed: tx.gasUsed ?? '',
    feeAtomic: tx.fee ?? '',
    feeEgld: getFeeEgld(tx.fee),
  };

  console.log(headers.map((header) => csvEscape(output[header])).join(','));
}
