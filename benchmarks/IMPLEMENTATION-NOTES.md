# Benchmarking — note de implementare

Document complementar pentru `benchmarks/results.md`. Explică ce s-a adăugat,
de ce, cum se mapează pe cerințele din `Cristina_Ionescu-Phase3-DA.pdf`
(secțiunea 2.3 Benchmarking Plan), și ce limitări cunoscute există.

## 1. Mapping cerințe PDF → livrabile

Tabelul de mai jos arată exact ce promite PDF-ul și unde se regăsește
fiecare metrică în output-ul actual.

| Metrică promisă în PDF | Unde se regăsește | Tip de măsurare |
| --- | --- | --- |
| Gas used (deploy, registerAssociation, createVotingSession, castVote, finalizeSession) | `benchmarks/results/devnet_tx_costs.csv` + tabelul "Devnet Transaction Cost Data" din `results.md` | Real (query Devnet read-only pe tx hashes existente) |
| Functional scaling (small / medium / large) | `benchmarks/results/direct_voting_flow_{small,medium,large}_raw.txt` | Local (MultiversX Rust scenario VM) |
| Fault behavior (duplicate vote, non-eligible voter, invalid candidate, vote după deadline, too many choices, duplicate candidate in vote) | `benchmarks/results/fault_cases_raw.txt` | Local (scenario VM, fiecare fault verifică `status:4` + mesaj require!) |
| Single-choice vs multi-choice voting | `benchmarks/results/multi_choice_vote_raw.txt` | Local (scenario VM, scQuery pe vote counts) |
| Finalize fără quorum (winner = zero address) | `benchmarks/results/no_quorum_finalize_raw.txt` | Local (scenario VM, scQuery pe `getSessionResult`) |
| API latency (login, association reads, vote reads, build-tx) | `benchmarks/results/api_latency.csv` + tabelul "Backend API Latency" din `results.md` | Live (backend local prin `docker compose`) |
| Throughput | Coloana `throughput_req_per_s` din `api_latency.csv` | Live (concurrency 5, 100 requests/endpoint) |
| Resource utilization (CPU + memory pe containere) | `benchmarks/results/docker_stats.csv` + tabelul "Container Resource Usage" din `results.md` | Live (`docker stats` la 3s, 90s window) |
| Transaction confirmation time | Placeholder în "Single-Run On-Chain Timings" din `results.md` | Manual (o singură rulare Devnet) |
| End-to-end vote time | Placeholder în "Single-Run On-Chain Timings" din `results.md` | Manual (o singură rulare Devnet) |

## 2. Fișiere adăugate / modificate

### Scenarii smart contract noi
- `smart-contracts/association-manager/scenarios/fault_cases.scen.json` — 6 cazuri invalide într-un singur scenariu dedicat
- `smart-contracts/association-manager/scenarios/multi_choice_vote.scen.json` — vot single + multi într-o sesiune cu `max_choices=3`
- `smart-contracts/association-manager/scenarios/no_quorum_finalize.scen.json` — sesiune cu `quorum=3` și un singur vot, finalize → winner zero

Entry-uri test corespondente în `tests/association_manager_scenario_rs_test.rs`:
`fault_cases_rs`, `multi_choice_vote_rs`, `no_quorum_finalize_rs`.

### Scripturi benchmark noi
- `benchmarks/api-latency.mjs` — Node script (fără dependențe externe) care
  hituie endpoint-uri configurate și raportează min/p50/p95/p99/max/mean +
  throughput. Input: fișier JSON cu lista de endpoint-uri. Output: CSV.
- `benchmarks/api-latency.config.example.json` — template de configurare cu
  placeholders (BEARER, ASSOC_ID, SESSION_ID, ADMIN_WALLET, etc.). Pentru o
  rulare nouă: copiezi în `api-latency.config.json` și înlocuiești
  placeholders cu valori reale (JWT din `/auth/login`, ID-uri din baza locală).
- `benchmarks/capture-docker-stats.ps1` — PowerShell wrapper peste
  `docker stats --no-stream` care eșantionează la interval configurabil și
  scrie CSV cu `timestamp, container, cpu_pct, mem_usage, mem_pct, net_io,
  block_io, pids`.

### Documentație
- `benchmarks/README.md` — extins cu secțiunile pentru noile scenarii, scriptul
  de latency, scriptul de docker stats, lista de endpoint-uri sigure vs
  endpoint-uri interzise (cele care submit pe lanț), și notă despre
  măsurătorile manuale.
- `benchmarks/results.md` — tabel funcțional pentru toate cele 6 scenarii,
  tabel latency cu valori reale, tabel resource usage cu valori agregate,
  tabel single-run timings cu placeholders pentru cele două manuale.

## 3. Decizii de design și motivația lor

**Un singur fișier pentru fault cases, nu repetat în small/medium/large.**
Regulile `require!` din contract nu depind de numărul de votanți/candidați —
sunt verificări booleene. A le repeta în 3 scenarii nu adaugă încredere, doar
zgomot. Un scenariu dedicat citează clar fiecare cale de fault.

**`scQuery` pentru verificarea totalurilor în multi-choice.** Scenariile
direct_voting nu citesc starea după voturi (folosesc doar `"out": []` și
`"status": ""`). Pentru multi-choice e important să demonstrăm că vot pentru
3 candidați într-o singură tranzacție incrementează 3 contoare distincte —
de aceea adăugăm `scQuery` pe `getVoteCount(assoc, session, candidate)`
pentru fiecare candidat.

**`status:4` pentru fault cases.** MultiversX scenario VM raportează `status:4`
pentru orice eroare `require!`. Verificăm și `message:str:<text>` ca să fim
siguri că cade pe motivul corect, nu pe alt require! anterior.

**Latency benchmark fără dependențe.** Scriptul folosește doar `fetch` din
Node 18+ și `node:perf_hooks`. Nu adaugă autocannon, k6, sau alte tooluri.
Argumentele pro: nimic de instalat, ușor de citit/modificat, suficient pentru
percentile pe sub 1000 de cereri. Contra: nu poți tunca pe TCP setup time vs
processing time. Pentru scopul acestui raport (comparație ordin de mărime
între endpoint-uri), e mai mult decât suficient.

**Concurrency 5, requests 100.** Defaults aleși să fie reprezentativi pentru
o stație de dezvoltare, nu pentru un load test serios. Pentru `/auth/login` am
redus la concurrency 3, requests 30, pentru că bcrypt e CPU-bound și fiecare
cerere face un INSERT în `auth.refresh_tokens` — nu vrem să umplem tabela cu
date de benchmark.

**Endpoint-uri excluse intenționat.** Configul listează *doar* endpoint-uri
read-only sau build-tx. Endpoint-urile care submit tranzacții semnate pe lanț
sunt enumerate explicit ca interzise în `README.md` — regula de siguranță
e să nu creezi accidental tranzacții Devnet cu fee real în timpul
benchmark-ului.

**Docker stats prin `--no-stream` + polling.** Alternativa era streaming-ul
continuu cu `docker stats` (fără `--no-stream`), dar acela are output greu de
parsat și nu se integrează curat cu PowerShell. Polling-ul la 2-3s pierde
picurile sub-secundă, dar capturează tendința medie și peak-urile susținute
mai lungi (cum e bcrypt în `auth-service`).

**Confirmation time și end-to-end vote time rămân manuale.** Sunt dominate de
timpul de bloc MultiversX (~6s/bloc) și nu de procesarea backend-ului.
A automatiza o singură măsurătoare ar adăuga cod care nu îmbunătățește
calitatea numărului final. Sunt notate explicit în `README.md` ca metrici
manuale, cu procedura de captură (timestamp din bridge logs / DevTools).

## 4. Rezultate observate (sumar)

### Smart contract — funcțional
Toate cele 6 scenarii (`direct_voting_flow_small/medium/large`, `fault_cases`,
`multi_choice_vote`, `no_quorum_finalize`) trec local în sub 0.13s fiecare.
Detalii cu execution time per scenariu în tabelul din `results.md`.

### Smart contract — Devnet cost
Datele reale din `devnet_tx_costs.csv` (refresh după trecerea la paymaster
pattern via `castVoteBySignature`; vechiul `castVoteRelayed` din MultiversX
relayed-tx feature nu mai e folosit, pentru că impunea aceeași shard pentru
votant și relayer):

- `registerAssociation` (admin pays): 2,547,537 gas, 0.0001195 EGLD
- `createVotingSession` (admin pays): 20,000,000 gas (limită atinsă), 0.000719 EGLD
- `stopSession` (admin pays): 2,649,955 gas, 0.0001012 EGLD
- `finalizeSession` (bridge pays, auto): 10,000,000 gas (limită atinsă), 0.000181 EGLD
- `castVoteByPaymaster` x2 (paymaster pays, voter pays zero): ~6.6M gas, ~0.00105 EGLD per vot

Coloana `relayer` în CSV e goală peste tot — nu folosim feature-ul native
relayed-tx. Plata e identificată prin coloana `sender` (e wallet-ul care
chiar plătește, fie admin, fie paymaster, fie bridge).

### Backend API latency
- Read-uri (associations, sessions, results): p50 19-31 ms, throughput 150-200 req/s
- `/auth/login` (bcrypt): p50 366 ms, throughput 7.4 req/s
- `/bridge/tx/register-association` (construire tx + query nonce Devnet): p50 76 ms, throughput 60 req/s
- 0 erori pe toate cele 7 endpoint-uri din rularea curentă

### Container resource usage (90s window, 17 sample-uri/container)
- `vote-service` peak 148% CPU (1.48 cores) — primește 300 requests
- `auth-service` peak 98% CPU — bcrypt în login
- `postgres` avg 2%, peak 25%
- Memory stabil sub 80 MiB pe toate containerele

## 5. Limitări cunoscute

**Sampling docker stats prea rar.** La 3s interval, `association-service` și
`blockchain-bridge` raportează ~0% CPU pentru că request-urile (~20-80 ms)
se procesează între snapshot-uri. Latency-ul măsurat în paralel arată că
există muncă reală. Pentru o măsurătoare mai precisă, rulează capture-ul cu
`-IntervalSec 1`.

**`createVotingSession` și `finalizeSession` ating gas limit.** Coloana
"Gas used" e egală cu "Gas limit" pentru aceste două operații în
`devnet_tx_costs.csv`. Asta sugerează că request-urile au fost trimise cu
limită exact peste consum real (cum se întâmplă când gas-ul e estimat
generos). Nu e un bug, dar pentru raport ar fi mai informativ să retrimiți o
tranzacție similară cu o limită mai înaltă și să refolosești hash-ul nou.

**JWT-ul pe care îl pui în `api-latency.config.json` expiră în 15 minute.**
Dacă rerulezi benchmark-ul după ce token-ul expiră, primești 401 pe
endpoint-urile cu `Authorization`. Soluție: refă login
(`POST /auth/login` cu un user existent) și înlocuiește valoarea în config
înainte de rulare.

**Single-process Nest.** Throughput-ul observat reflectă o singură instanță
Node per microserviciu. Cifrele se pot înmulți (aproximativ) cu numărul de
instanțe într-un deployment paralel — nu sunt o limită arhitecturală a
platformei.

## 6. Cum rulezi totul de la zero

```powershell
# Pornește backend-ul
cd D:\Master\DA\proiect\Blockchain-Voting-Platform
docker compose up -d

# 1. Smart contract scenarios
cd smart-contracts\association-manager
foreach ($name in 'direct_voting_flow_small','direct_voting_flow_medium','direct_voting_flow_large','fault_cases','multi_choice_vote','no_quorum_finalize') {
    cargo test "${name}_rs" -- --nocapture *> "..\..\benchmarks\results\${name}_raw.txt"
}
cd ..\..

# 2. Devnet transaction costs (read-only)
node benchmarks\collect-devnet-tx-costs.mjs benchmarks\tx-hashes.csv > benchmarks\results\devnet_tx_costs.csv

# 3. Pregătește JWT pentru config
$body = '{"email":"bench@test.local","password":"BenchPass123!"}'
try { Invoke-RestMethod http://localhost:3001/auth/register -Method Post -Body $body -ContentType application/json } catch {}
$tok = (Invoke-RestMethod http://localhost:3001/auth/login -Method Post -Body $body -ContentType application/json).accessToken
# înlocuiește manual în benchmarks\api-latency.config.json valorile "Bearer ..." cu "Bearer $tok"

# 4. API latency + docker stats în paralel
Start-Job -Name dstats -ScriptBlock {
    Set-Location "D:\Master\DA\proiect\Blockchain-Voting-Platform"
    & .\benchmarks\capture-docker-stats.ps1 -DurationSec 90 -IntervalSec 3 -OutPath benchmarks\results\docker_stats.csv
}
node benchmarks\api-latency.mjs benchmarks\api-latency.config.json --out benchmarks\results\api_latency.csv
Wait-Job dstats; Receive-Job dstats; Remove-Job dstats
```
