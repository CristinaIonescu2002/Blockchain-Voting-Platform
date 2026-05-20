# Benchmark Results

## Local Rust Scenario VM

These runs use `cargo test` with MultiversX Rust scenario VM only. They do not
use `deploy.sh`, `mxpy --send`, Docker, or Devnet transactions.

| Scenario | Voters | Candidates | Covered operations | Result | Notes |
| --- | ---: | ---: | --- | --- | --- |
| small | 3 eligible voters | 2 | local VM deploy, registerAssociation, createVotingSession, 2 valid castVote calls, 1 duplicate castVote rejection, finalizeSession | passed | Build/test finished after compilation; scenario execution reported `0.12s` |
| medium | 5 eligible voters | 3 | local VM deploy, registerAssociation, createVotingSession, 5 valid castVote calls, finalizeSession | passed | Scenario execution reported `0.03s` |
| large | 10 eligible voters | 5 | local VM deploy, registerAssociation, createVotingSession, 10 valid castVote calls, finalizeSession | passed | Scenario execution reported `0.03s` |
| fault_cases | 3 eligible voters + 1 non-eligible | 3 | 6 rejected attempts (invalid candidate, non-eligible voter, too many choices, duplicate candidate in vote, duplicate vote, vote after deadline) + 1 valid vote + finalize | passed | Scenario execution reported `0.07s`. Each fault step matched `status:4` with its expected require! message |
| multi_choice_vote | 5 eligible voters | 4 | mix of single-, two- and three-choice votes (`max_choices=3`), 4 scQueries asserting final tallies, finalize | passed | Scenario execution reported `0.05s`. Vote tallies verified: c1=4, c2=2, c3=2, c4=1 |
| no_quorum_finalize | 3 eligible voters | 2 | 1 valid vote with `quorum=3`, advance past deadline, finalize, scQuery winner | passed | Scenario execution reported `0.06s`. After finalize: `status=2`, `total_votes=1`, `winner=0x00…00` |

Current limitation: the default scenario test output confirms pass/fail and
execution time, but it does not print real Devnet transaction costs. The
scenario files use `"gas": "*"` to accept any gas value, not to export gas
metrics.

Useful metrics available from the current output:

- scenario pass/fail status
- local scenario execution time
- number and type of local VM operations covered

Metrics still needed for the final Devnet cost table:

- gas used by `registerAssociation`
- gas used by `createVotingSession`
- gas used by each `castVote`
- gas used by `finalizeSession`
- fee paid for each transaction
- payer for each transaction (`relayer` when present, otherwise `sender`)

To collect those values safely, use existing Devnet transaction hashes with
`benchmarks/collect-devnet-tx-costs.mjs`. The script only performs HTTP GET
requests against the Devnet API and does not submit transactions.

## Devnet Transaction Cost Data

Source input: `benchmarks/tx-hashes.csv`

Generated output: `benchmarks/results/devnet_tx_costs.csv`

Wallet legend (test environment):

- `erd1q87vn73…wepdv` — admin wallet (also configured as the association paymaster)
- `erd1nxeujly…r64m` — bridge wallet (`smart-contracts/deployer.pem`, used by the backend for auto-initiated calls like finalize)
- `erd1qqq…wepdv` — `receiver` for every row is the deployed smart contract address

| Operation | Status | Gas limit | Gas used | Fee (EGLD) | Sender role | Sender | Relayer | Effective payer |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| registerAssociation | success | 5,000,000 | 2,547,537 | 0.00011952537 | admin (PEM-signed in browser) | `erd1q87vn73…` | none | admin |
| createVotingSession | success | 20,000,000 | 20,000,000 | 0.00071876 | admin (PEM-signed in browser) | `erd1q87vn73…` | none | admin |
| stopSession | success | 5,000,000 | 2,649,955 | 0.00010124455 | admin (PEM-signed in browser) | `erd1q87vn73…` | none | admin |
| finalizeSession | success | 10,000,000 | 10,000,000 | 0.000180685 | bridge (auto, no admin interaction) | `erd1nxeujly…` | none | bridge |
| castVoteByPaymaster_1 | success | 12,000,000 | 6,659,968 | 0.00105164968 | paymaster (= admin wallet here) submits `castVoteBySignature` | `erd1q87vn73…` | none | paymaster |
| castVoteByPaymaster_2 | success | 12,000,000 | 6,603,494 | 0.00105108494 | same paymaster, second voter | `erd1q87vn73…` | none | paymaster |

### Who pays the EGLD — semantics

The Phase 3 PDF promises that voters can cast votes without holding EGLD. The
current implementation delivers this through a **paymaster pattern**, not
through MultiversX native relayed transactions. Concretely:

- Admin actions (`registerAssociation`, `createVotingSession`, `stopSession`):
  the admin signs the transaction locally with their PEM and submits it via
  `POST /bridge/tx/submit`. Sender = admin = payer.
- Auto-initiated finalize (`finalizeSession`): the backend calls the smart
  contract using the bridge wallet (`smart-contracts/deployer.pem`).
  Sender = bridge = payer.
- Voter actions (`castVoteBySignature` aka `castVoteByPaymaster_*` above): the
  voter signs an **intent** off-chain (Ed25519 signature, sent via
  `POST /bridge/tx/vote/submit-intent`); the bridge wraps it into a
  `castVoteBySignature` transaction signed and submitted by the association's
  configured paymaster wallet. Sender = paymaster wallet = payer. The voter
  pays zero EGLD.

The `relayer` column is empty for every row because none of these calls use
the MultiversX *relayed transaction* feature. The previous iteration
(now removed) did use native relayed txs labelled `castVoteRelayed`, and that
flow required voter and relayer to be on the **same shard**. The paymaster
pattern replaces it and removes that shard constraint, because there is no
relayer field at all — the paymaster is just the regular `sender` of the
transaction, and the voter authorization travels inside the call data.

### Cost observations

- `createVotingSession` and `finalizeSession` hit their `gasLimit` exactly,
  meaning the gas limit was set generously and `gasUsed` was capped at the
  limit, not the actual consumption. A re-submission with a higher gas limit
  would give a more accurate `gasUsed` number for these two.
- A paymaster vote costs about **0.00105 EGLD** at devnet prices, compared to
  about **0.00012 EGLD** for `registerAssociation`. The vote is ~9× more
  expensive because `castVoteBySignature` runs the on-chain Ed25519 signature
  verification (`self.crypto().verify_ed25519(...)`) before applying the vote.
- `stopSession` is the cheapest non-trivial operation at **0.00010 EGLD**
  because it only flips a status flag.

## Backend API Latency

Source script: `benchmarks/api-latency.mjs`
Generated output: `benchmarks/results/api_latency.csv`

Each row reports observed latency percentiles and throughput for one endpoint.
Numbers below should be filled in after running the script against the local
stack (backend services running via `docker compose up -d`).

Run conditions: backend running locally via `docker compose`, no other load on
the machine, Node 24 client, concurrency 5 (3 for `/auth/login`), 100 requests
per endpoint (30 for `/auth/login`).

| Endpoint | Method | Requests | Errors | p50 (ms) | p95 (ms) | p99 (ms) | Throughput (req/s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/auth/login` | POST | 30 | 0 | 366.4 | 492.5 | 509.4 | 7.4 |
| `/associations` | GET | 100 | 0 | 20.8 | 77.2 | 144.0 | 165.7 |
| `/associations/:id` | GET | 100 | 0 | 19.5 | 55.8 | 87.8 | 201.7 |
| `/votes/sessions?associationId=` | GET | 100 | 0 | 26.0 | 59.7 | 68.4 | 170.5 |
| `/votes/sessions/:id` | GET | 100 | 0 | 28.3 | 44.6 | 57.8 | 170.1 |
| `/votes/sessions/:id/results` | GET | 100 | 0 | 31.0 | 51.7 | 55.2 | 152.3 |
| `/bridge/tx/register-association` | GET | 100 | 0 | 76.5 | 123.6 | 132.8 | 60.5 |

All endpoints listed are either read-only or transaction-BUILDING. None of them
submit a signed transaction on-chain.

Observations:

- `POST /auth/login` is the slowest by an order of magnitude (~366ms p50). The
  cost is dominated by bcrypt password hashing, which is expected behavior for
  a secure login path.
- Read endpoints from the association and vote services consistently respond
  under 35ms at p50 and sustain 150–200 req/s on a single-process Nest backend.
- `GET /bridge/tx/register-association` is heavier (~76ms p50, ~60 req/s)
  because the bridge builds a fully encoded MultiversX transaction and queries
  Devnet API for the current account nonce on every call.

## Container Resource Usage

Source script: `benchmarks/capture-docker-stats.ps1`
Generated output: `benchmarks/results/docker_stats.csv`

Captured while `api-latency.mjs` was running. Aggregate per container as
average / peak from the CSV (e.g. with a quick PowerShell or pandas pass).

Run conditions: 90s capture window at 3s sample interval (17 samples per
container), aggregated from `benchmarks/results/docker_stats.csv` with a
PowerShell `Import-Csv | Group-Object container` pass. Captured concurrently
with the API latency run above.

| Container | Avg CPU % | Peak CPU % | Avg memory % | Peak memory | Notes |
| --- | ---: | ---: | ---: | --- | --- |
| `voting-postgres-1` | 2.09 | 25.31 | 0.31 | ~20.7 MiB | Serves every read/write across the 7 endpoints |
| `voting-auth-service-1` | 5.79 | 98.25 | 0.60 | ~46.9 MiB | Peak driven by bcrypt during `/auth/login` |
| `voting-vote-service-1` | 8.73 | 148.01 | 0.95 | ~78.1 MiB | Highest CPU — receives 300 requests (3 endpoints x 100) |
| `voting-association-service-1` | 0.00 | 0.04 | 0.64 | ~50.6 MiB | Sample-window artifact: requests complete between snapshots |
| `voting-blockchain-bridge-1` | 0.00 | 0.05 | 0.60 | ~47.4 MiB | Same artifact as above; latency for `/bridge/tx/register-association` shows real work, just not caught by 3s sampling |
| `voting-frontend-1` | 0.00 | 0.04 | 0.59 | ~45.8 MiB | Idle — frontend was not exercised by the benchmark |

## Single-Run On-Chain Timings

These two metrics from the Phase 3 plan are recorded from one controlled
manual run rather than from a script:

| Metric | Value | How measured |
| --- | --- | --- |
| Transaction confirmation time (Devnet `castVoteBySignature`) | _to fill_ s | Timestamp difference between bridge log "submitted tx <hash>" and "tx <hash> confirmed" |
| End-to-end vote time (UI → results updated) | _to fill_ s | Browser DevTools: time from clicking *Vote* in `sessions/[sessionId]/page.tsx` to the results refetch returning the new count |

A single sample is sufficient for the report because both metrics are
dominated by Devnet block time (~6s/block) rather than backend processing,
and the smart contract benchmarks already cover gas usage with multiple
configurations.
