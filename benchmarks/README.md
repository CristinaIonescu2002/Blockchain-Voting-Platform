# Smart Contract Benchmarking

The benchmark focus is the smart contract layer, because this is the component
responsible for enforcing voting rules and recording the trusted voting state.

The local scenarios are contract-only checks. They prove that the smart contract
enforces the core voting rules in the MultiversX scenario VM. They do not prove
the full frontend/backend paymaster flow; that is covered by Devnet transaction
hashes and manual end-to-end testing.

Run the direct voting flow scenario from the smart contract folder:

```powershell
cd smart-contracts/association-manager
cargo test direct_voting_flow_rs -- --nocapture
```

Run each local scenario size separately:

```powershell
cd smart-contracts/association-manager

cargo test direct_voting_flow_small_rs -- --nocapture *> ../../benchmarks/results/direct_voting_flow_small_raw.txt
cargo test direct_voting_flow_medium_rs -- --nocapture *> ../../benchmarks/results/direct_voting_flow_medium_raw.txt
cargo test direct_voting_flow_large_rs -- --nocapture *> ../../benchmarks/results/direct_voting_flow_large_raw.txt
```

These commands run only the MultiversX Rust scenario VM. Do not run `deploy.sh`,
`mxpy contract deploy --send`, `mxpy contract upgrade --send`, or
`docker compose up` for these local benchmarks.

The Rust scenario VM output is useful for local pass/fail and execution time,
but it does not provide realistic transaction fees. For real Devnet cost and
payer data, collect the hashes of transactions that already exist and query
them read-only:

```powershell
Copy-Item benchmarks/tx-hashes.example.csv benchmarks/tx-hashes.csv
# Edit benchmarks/tx-hashes.csv and replace each placeholder with an existing Devnet tx hash.
node benchmarks/collect-devnet-tx-costs.mjs benchmarks/tx-hashes.csv > benchmarks/results/devnet_tx_costs.csv
```

On WSL/Linux shells:

```bash
cd /mnt/d/Master/DA/proiect/Blockchain-Voting-Platform
cp benchmarks/tx-hashes.example.csv benchmarks/tx-hashes.csv
# Edit benchmarks/tx-hashes.csv and replace each placeholder with an existing Devnet tx hash.
node benchmarks/collect-devnet-tx-costs.mjs benchmarks/tx-hashes.csv > benchmarks/results/devnet_tx_costs.csv
```

The direct scenario set covers:

- contract deployment
- association creation
- voting session creation
- valid votes
- duplicate vote rejection
- session finalization

In addition, three dedicated scenarios target the remaining functional checks promised by the Phase 3 plan:

```powershell
cd smart-contracts/association-manager

cargo test fault_cases_rs        -- --nocapture *> ../../benchmarks/results/fault_cases_raw.txt
cargo test multi_choice_vote_rs  -- --nocapture *> ../../benchmarks/results/multi_choice_vote_raw.txt
cargo test no_quorum_finalize_rs -- --nocapture *> ../../benchmarks/results/no_quorum_finalize_raw.txt
```

What each generated file proves:

| Output file | Scenario | What it proves |
|---|---|---|
| `benchmarks/results/direct_voting_flow_small_raw.txt` | `direct_voting_flow_small_rs` | Small direct-vote contract flow: deploy, create one association/session, submit valid votes, reject duplicate voting, finalize. |
| `benchmarks/results/direct_voting_flow_medium_raw.txt` | `direct_voting_flow_medium_rs` | Medium direct-vote contract flow with more voters/candidates, useful as a functional scaling check. |
| `benchmarks/results/direct_voting_flow_large_raw.txt` | `direct_voting_flow_large_rs` | Larger direct-vote contract flow, useful to show the same rules hold at a bigger scenario size. |
| `benchmarks/results/fault_cases_raw.txt` | `fault_cases_rs` | Each invalid vote attempt (invalid candidate, non-eligible voter, too many choices, duplicate candidate in vote, duplicate vote by same voter, vote after deadline) is rejected with `status:4`. |
| `benchmarks/results/multi_choice_vote_raw.txt` | `multi_choice_vote_rs` | Multi-choice voting (`max_choices > 1`) correctly increments multiple candidate counters per vote; query asserts final tallies. |
| `benchmarks/results/no_quorum_finalize_raw.txt` | `no_quorum_finalize_rs` | When `total_votes < quorum`, `finalizeSession` sets the winner to the zero address (no valid winner). |

The current application vote flow uses `castVoteBySignature` and an association
paymaster. Keep Devnet transaction hashes for that flow in
`benchmarks/tx-hashes.csv`, then generate fee/payer evidence with:

```powershell
node benchmarks/collect-devnet-tx-costs.mjs benchmarks/tx-hashes.csv > benchmarks/results/devnet_tx_costs.csv
```

For the report, use the local scenarios to show functional scaling across
small, medium, and larger voting flows. Use existing Devnet transaction hashes
to report real gas, fee, and payer data for each on-chain operation.

## Backend API latency and throughput

`benchmarks/api-latency.mjs` measures HTTP latency (p50/p95/p99) and throughput
for backend endpoints listed in a config file. It only sends the requests
listed in the config — it does **not** submit any transaction on-chain.

```powershell
# 1. Make sure the backend is running (docker compose up -d).
# 2. Copy the example config and replace placeholders with real values.
Copy-Item benchmarks/api-latency.config.example.json benchmarks/api-latency.config.json
# Edit api-latency.config.json: set BEARER, ASSOC_ID, SESSION_ID, wallet addresses.

node benchmarks/api-latency.mjs benchmarks/api-latency.config.json --out benchmarks/results/api_latency.csv
```

The output CSV has one row per endpoint with `requests`, `errors`,
`min_ms`, `p50_ms`, `p95_ms`, `p99_ms`, `max_ms`, `mean_ms`, `wall_ms` and
`throughput_req_per_s`. Live progress is printed on stderr.

### How to read the percentile columns (p50, p95, p99)

A latency percentile is the value below which a given share of the requests
completed. If you sort all measured response times for an endpoint in
increasing order:

- **p50** (median) — 50% of requests responded faster than this value.
  "Typical" response time.
- **p95** — 95% of requests responded faster than this value; the slowest
  5% were slower. Useful for "how bad does it usually get".
- **p99** — 99% of requests responded faster than this value; the slowest
  1% were slower. Describes the tail latency that real users occasionally
  hit.

Percentiles are preferred over a simple mean because a single very slow
request would skew the average and hide the typical experience. For example,
if `/auth/login` reports `p50=366ms, p95=492ms, p99=509ms`, the small gap
between p50 and p99 means the service is *predictable* — there are no large
spikes. A big gap (like `p50=20ms` but `p99=144ms` on `/associations`) means
most calls are fast but some take ~7× longer, usually because of a cold
database connection, garbage collection, or a one-off slow query.

`throughput_req_per_s` is the sustained rate during the benchmark: total
successful requests divided by the wall-clock duration of the run for that
endpoint (warmup excluded).

Safe endpoints to include in the config:

- `GET /associations`, `GET /associations/:id` — association service reads
- `GET /votes/sessions?...`, `GET /votes/sessions/:id`, `GET /votes/sessions/:id/results` — vote service reads
- `GET /bridge/tx/register-association`, `GET /bridge/tx/vote`, `GET /bridge/tx/stop-session` — bridge endpoints that BUILD unsigned transactions only
- `POST /auth/login` — generates a JWT; writes a refresh-token row but does not touch the chain

Do **not** add endpoints that submit signed transactions
(`POST /bridge/tx/submit`, `POST /bridge/tx/vote/submit`,
`POST /bridge/tx/vote/submit-intent`, `POST /bridge/finalize/:sessionId`),
because each call would push a real Devnet transaction.

## Container resource usage (CPU / memory)

Run the capture script in parallel with the latency benchmark to record CPU,
memory, network and block I/O per project container:

```powershell
# In one terminal:
pwsh benchmarks/capture-docker-stats.ps1 -DurationSec 60 -IntervalSec 2 -OutPath benchmarks/results/docker_stats.csv

# In another terminal at the same time:
node benchmarks/api-latency.mjs benchmarks/api-latency.config.json --out benchmarks/results/api_latency.csv
```

The output CSV has one row per container per sample: `timestamp`,
`container`, `cpu_pct`, `mem_usage`, `mem_pct`, `net_io`, `block_io`, `pids`.

## Manual single-run measurements

Two metrics from the Phase 3 plan are only meaningful from a single controlled
on-chain action and are not automated here:

- **Transaction confirmation time** — the wall-clock delay between submitting
  a transaction to MultiversX Devnet and the API marking it as `success`.
- **End-to-end vote time** — the wall-clock delay from the moment the user
  clicks *Vote* in the frontend to the moment the updated vote count appears
  in the results view.

Capture each by running one controlled vote with timestamps in the bridge logs
or the browser DevTools network tab, and copy the numbers into `results.md`.
