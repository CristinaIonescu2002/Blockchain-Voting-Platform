# Blockchain Voting Platform

> Branch: `voting` — aplicație completă și funcțională, livrabil independent.
> Branch: `main` — extindere pentru Dizertație (Volunteering Platform complet).

Platformă de vot on-chain pentru asociații, construită pe **MultiversX Devnet**.
Fiecare vot este o tranzacție blockchain — transparent, imutabil, verificabil public.
Voluntarii plătesc **0 EGLD**: ei semnează local intenția de vot, iar walletul
paymaster al asociației trimite automat tranzacția on-chain și plătește gas.

---

## Cuprins

- [Funcționalități](#funcționalități)
- [Arhitectură](#arhitectură)
- [Tech Stack](#tech-stack)
- [API — Endpoints](#api--endpoints)
- [Pornire rapidă](#pornire-rapidă)
- [Flux utilizator](#flux-utilizator)
- [Smart Contract](#smart-contract)
- [Variabile de mediu](#variabile-de-mediu)
- [Structura proiectului](#structura-proiectului)

---

## Funcționalități

### Admin asociație
- Creare asociație înregistrată on-chain (`registerAssociation`)
- Adăugare / eliminare membri (soft delete cu reactivare)
- Creare sesiune de vot — single-choice sau multi-choice — cu candidați și electori selectați
- Sesiunea publicată on-chain (`createVotingSession`) cu deadline și quorum configurabile
- Închidere prematură a votării când toți eligibilii au votat (`stopSession`)
- Ștergere sesiuni draft nepublicate

### Voter
- Autentificare email + parolă (JWT)
- Wallet PEM încărcat în browser (niciodată trimis la server)
- Vot semnat local cu sdk-core ca intenție off-chain și trimis automat on-chain de paymaster-ul asociației
- Suport vot multi-choice (checkbox selecție până la `maxChoices` candidați)

### Rezultate
- Vizualizare live cu contor voturi, total eligibili, quorum reached
- Finalizare on-chain automată la deschiderea paginii de rezultate (`finalizeSession`)
- Pie chart cu distribuția voturilor
- Câștigător afișat exclusiv după confirmare on-chain (consistent cu smart contract)

---

## Arhitectură

```
Browser
  ├── JWT (Zustand, in-memory)
  ├── PEM wallet (Zustand, in-memory — cleared on logout)
  └── @multiversx/sdk-core (semnare client-side)
          │
          ▼
┌─────────────────────────────────────────────────────┐
│  NestJS Microservices (Docker Compose)              │
│  ┌──────────────┐  ┌──────────────────┐             │
│  │ auth-service │  │assoc-service     │             │
│  │ :3001        │  │:3002             │             │
│  └──────────────┘  └──────────────────┘             │
│  ┌──────────────┐  ┌──────────────────┐             │
│  │ vote-service │  │blockchain-bridge │             │
│  │ :3003        │  │:3004             │             │
│  └──────────────┘  └──────────────────┘             │
│              │                                      │
│         PostgreSQL                                  │
│         (3 scheme)                                  │
└─────────────────────────────────────────────────────┘
          │
          ▼
  MultiversX Devnet
  SC: erd1qqqqqqqqqqqqqpgqfuxy2dg9r3hsp2epyx78w4g09xlh8qzx086qgwepdv
```

### Decizii arhitecturale cheie

| Decizie | Motivație |
|---|---|
| Multi-tenant SC (un singur contract pentru toate asociațiile) | Evită factory pattern + deploy per asociație |
| Association paymaster pentru `castVoteBySignature` | Votanții plătesc 0 EGLD; walletul asociației plătește gas automat |
| PEM rămâne în browser memory (Zustand) | Niciodată trimis la server; șters la logout |
| JWT secret partajat între servicii | Fiecare serviciu validează token independent |
| Soft delete pentru membri | Permite reactivare; păstrează istoricul |
| `synchronize: false` TypeORM | Schema gestionată exclusiv prin `init.sql` |
| `record-vote` endpoint fără auth (intern) | Apelat doar de bridge după confirmare on-chain |

---

## Tech Stack

| Layer | Tehnologie |
|---|---|
| Blockchain | MultiversX Devnet |
| Smart Contract | Rust, `multiversx-sc` 0.63.2 |
| Backend | NestJS, TypeScript, TypeORM, Passport-JWT |
| Frontend | Next.js (App Router), React 19, Tailwind CSS v4 |
| Blockchain SDK | `@multiversx/sdk-core` v15 |
| State management | Zustand v5, TanStack Query v5 |
| Database | PostgreSQL 16 (3 scheme: auth, association, vote) |
| Containers | Docker Compose |

---

## API — Endpoints

### Auth Service `:3001`

| Metodă | Endpoint | Descriere |
|---|---|---|
| `POST` | `/auth/register` | Înregistrare user |
| `POST` | `/auth/login` | Login → JWT + refresh token |
| `POST` | `/auth/refresh` | Rotire refresh token |
| `POST` | `/auth/logout` | Invalidare refresh tokens |
| `POST` | `/auth/link-wallet` | Salvare adresă MultiversX |
| `GET` | `/auth/me` | Profil curent |

### Association Service `:3002`

| Metodă | Endpoint | Descriere |
|---|---|---|
| `POST` | `/associations` | Creare asociație |
| `GET` | `/associations/all` | Toate asociațiile |
| `GET` | `/associations/my` | Asociațiile mele |
| `GET` | `/associations/:id` | Detalii asociație |
| `PATCH` | `/associations/:id` | Actualizare |
| `POST` | `/associations/:id/members` | Adăugare membru |
| `DELETE` | `/associations/:id/members/:userId` | Eliminare (soft) |
| `GET` | `/associations/:id/members` | Listă membri activi |

### Vote Service `:3003`

| Metodă | Endpoint | Auth | Descriere |
|---|---|---|---|
| `POST` | `/votes/sessions` | JWT | Creare sesiune |
| `GET` | `/votes/sessions?associationId=` | JWT | Sesiuni asociație |
| `GET` | `/votes/sessions/:id` | JWT | Detalii sesiune |
| `PATCH` | `/votes/sessions/:id/sc-sync` | — (intern) | Sync on-chain ID/status de la bridge |
| `PATCH` | `/votes/sessions/:id` | JWT | Actualizare |
| `DELETE` | `/votes/sessions/:id` | JWT | Ștergere draft |
| `GET` | `/votes/sessions/:id/results` | JWT | Rezultate |
| `POST` | `/votes/sessions/:id/record-vote` | — (intern) | Înregistrare vot confirmat on-chain |

### Blockchain Bridge `:3004`

Current free-vote flow uses `POST /bridge/tx/vote/submit-intent`: the voter
signs a vote intent locally, and the bridge submits it automatically from the
association paymaster PEM, so the association wallet pays gas.

| Metodă | Endpoint | Descriere |
|---|---|---|
| `GET` | `/bridge/tx/register-association` | Unsigned tx `registerAssociation` |
| `GET` | `/bridge/tx/register-member` | Unsigned tx `registerMember` |
| `POST` | `/bridge/tx/create-session` | Unsigned tx `createVotingSession` |
| `GET` | `/bridge/tx/stop-session` | Unsigned tx `stopSession` |
| `GET` | `/bridge/tx/vote` | Legacy unsigned inner tx `castVote` |
| `POST` | `/bridge/tx/submit` | Submit tx admin semnat + sync DB |
| `POST` | `/bridge/tx/vote/submit` | Legacy submit vote inner tx |
| `POST` | `/bridge/tx/vote/submit-intent` | Submit signed vote intent; association paymaster pays gas |
| `POST` | `/bridge/finalize/:sessionId` | Bridge semnează `finalizeSession` |

---

## Pornire rapidă

> Ghid detaliat cu prerequisites, compilare SC și opțiuni dev local: [DEVELOPMENT.md](./DEVELOPMENT.md)

### Cerințe
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- Fișier `.env` (vezi mai jos)
- Fișier `smart-contracts/deployer.pem` (wallet bridge cu EGLD pe Devnet)

### Pași

```bash
# 1. Clonare
git clone <repo-url> && cd Blockchain-Volunteering-Platform
git checkout voting

# 2. Variabile de mediu
cp .env.example .env
# Editează .env și setează CONTRACT_ADDRESS cu adresa SC-ului deployat

# 3. Pornire completă
docker compose up --build
```

Aplicația e disponibilă la **http://localhost:3000**.

Prima pornire: 2-3 minute (build imagini Docker). Repornirile sunt rapide.

### Reset complet (ștergere date)

```bash
docker compose down -v
```

---

## Flux utilizator

### Admin — creare asociație și sesiune de vot

```
1. Register / Login  →  JWT în memorie (Zustand)
2. Profile page      →  Upload PEM → adresă extrasă în browser → POST /auth/link-wallet
3. Associations      →  New association → POST /associations
                         → GET /bridge/tx/register-association (unsigned tx)
                         → Semnat cu PEM → POST /bridge/tx/submit
                         → Bridge confirmă on-chain → scAssocId salvat în DB
4. Members           →  Adaugă membri by email (wallet lor trebuie linked)
5. Sessions          →  New session → configurează title, deadline, quorum, maxChoices
                         → Selectează candidați + electori din membrii cu wallet
                         → POST /votes/sessions (draft în DB)
                         → POST /bridge/tx/create-session (unsigned tx)
                         → Semnat cu PEM → POST /bridge/tx/submit
                         → Bridge confirmă on-chain → scSessionId + status=open
```

### Voter — vot

```
1. Login  →  JWT + PEM încărcat pe Profile page
2. Associations → Sessions → sesiune activă
3. Apasă "Vote"  →  modal cu opțiuni (radio single / checkbox multi-choice)
4. Selectează → Submit
   → Semnează local mesajul BVOTE cu PEM-ul votantului
   → POST /bridge/tx/vote/submit-intent (signed vote intent)
   → Bridge trimite castVoteBySignature din PEM-ul paymaster al asociației
   → Paymaster-ul asociației plătește gas; votantul plătește 0 EGLD
   → Confirmat on-chain → bridge notifică vote-service → vot înregistrat în DB
```

### Association paymaster voting

Flow-ul curent pentru vot gratuit nu mai depinde de shardul votantului:

```
1. Adminul asociatiei configureaza un PEM paymaster separat pentru asociatie.
2. Paymaster-ul asociatiei este alimentat cu EGLD.
3. Votantul semneaza local mesajul BVOTE cu PEM-ul lui.
4. Frontendul trimite intent-ul semnat la /bridge/tx/vote/submit-intent.
5. Bridge-ul trimite automat tranzactia castVoteBySignature din paymaster PEM.
6. Smart contractul verifica semnatura votantului si marcheaza votul pentru voterWallet.
7. Gas-ul este platit de walletul paymaster al asociatiei.
```

PEM-ul paymaster este separat de PEM-ul adminului si de PEM-urile
voluntarilor/votantilor. Este un wallet operational al asociatiei.

### Cum functioneaza mecanismul paymaster

Mecanismul nou inlocuieste relayed transactions pentru vot cu o meta-tranzactie
la nivel de smart contract. Votantul nu trimite direct tranzactia on-chain si nu
plateste gas. In schimb, votantul semneaza local un mesaj `BVOTE` care contine
identitatea votului: asociatia on-chain, sesiunea on-chain, walletul votantului
si candidatii selectati.

Frontendul trimite catre bridge:

```
voterWallet
candidateWallets[]
signed_message
signature
associationId / sessionId
scAssocId / scSessionId
```

Bridge-ul incarca PEM-ul paymaster configurat pentru asociatia respectiva si
trimite o tranzactie normala catre contract:

```
paymaster wallet -> castVoteBySignature(...)
```

Smart contractul verifica semnatura Ed25519 folosind cheia publica a votantului
derivata din `voterWallet`. Daca semnatura este valida, contractul inregistreaza
votul pentru `voterWallet`, nu pentru walletul care a platit tranzactia. Asta
inseamna ca paymaster-ul poate plati gas fara sa poata vota in locul membrilor:
nu poate fabrica un vot valid fara semnatura votantului.

Acest flow nu mai are restrictia relayed transaction v1 conform careia senderul
si relayerul trebuie sa fie in acelasi shard. Paymaster-ul trimite o tranzactie
cross-shard normala catre smart contract, iar MultiversX o proceseaza ca orice
apel cross-shard de contract.

Rolurile walleturilor sunt separate:

| Wallet | Rol |
|---|---|
| Admin wallet | Creeaza asociatia, membri si sesiuni; semneaza actiunile administrative. |
| Voter wallet | Semneaza intentia de vot local; nu plateste gas pentru vot. |
| Association paymaster wallet | Wallet operational al asociatiei; este alimentat cu EGLD si plateste automat gas pentru voturile membrilor. |
| Bridge wallet | Ramane folosit pentru operatiuni globale/legacy, de exemplu finalizare automata unde este cazul. |

### Finalizare

```
1. La expirarea deadline-ului SAU după "Close voting early" (toți eligibilii au votat)
2. Admin / orice user deschide Results page
3. Pagina detectează canFinalize=true → auto-trimite POST /bridge/finalize/:sessionId
4. Bridge semnează finalizeSession → confirmat on-chain → status=finalized
5. Winner afișat cu pie chart + breakdown voturi
```

---

## Smart Contract

### Endpoints

```
registerAssociation(name: bytes) → assoc_id: u64
registerMember(assoc_id: u64, wallet: Address)
removeMember(assoc_id: u64, wallet: Address)
createVotingSession(
  assoc_id: u64, title: bytes, deadline: u64,
  quorum: u64, max_choices: u64,
  num_candidates: u64, num_voters: u64,
  candidates: Address[], voters: Address[]
) → session_id: u64
castVote(assoc_id: u64, session_id: u64, candidates: Address[])
castVoteBySignature(
  assoc_id: u64, session_id: u64,
  voter: Address, voter_pubkey: bytes32, signed_message: bytes, signature: bytes64,
  candidates: Address[]
)
stopSession(assoc_id: u64, session_id: u64)
finalizeSession(assoc_id: u64, session_id: u64)
```

### Views

```
getAssocCount() → u64
getAssocName(assoc_id) → bytes
getAssocAdmin(assoc_id) → Address
isMember(assoc_id, wallet) → bool
getMembers(assoc_id) → Address[]
getSessionCount(assoc_id) → u64
getSessionStatus(assoc_id, session_id) → u64   // 0=open 1=stopped 2=finalized
getSessionDeadline(assoc_id, session_id) → u64  // unix timestamp
getSessionResult(assoc_id, session_id) → Address
getCandidatesWithVotes(assoc_id, session_id) → multi
getEligibleVoters(assoc_id, session_id) → Address[]
getHasVoted(assoc_id, session_id, wallet) → bool
getVoteCount(assoc_id, session_id, wallet) → u64
```

### Events

```
associationRegistered(assoc_id, name, admin)
memberRegistered(assoc_id, wallet)
memberRemoved(assoc_id, wallet)
sessionCreated(assoc_id, session_id, deadline, quorum)
voteCast(assoc_id, session_id, voter, candidates)
sessionStopped(assoc_id, session_id)
sessionFinalized(assoc_id, session_id, winner)
```

### Compilare & deploy

```bash
cd smart-contracts/association-manager
sc-meta all build        # → output/association_manager.wasm

mxpy contract deploy \
  --bytecode output/association_manager.wasm \
  --pem deployer.pem \
  --gas-limit 60000000 \
  --proxy https://devnet-api.multiversx.com \
  --chain D --send
```

### Upgrade contract existent

`castVoteBySignature` este endpoint nou, deci un contract deja deployat trebuie
upgradat dupa rebuild:

```bash
cd smart-contracts/association-manager
sc-meta all build

mxpy contract upgrade <CONTRACT_ADDRESS> \
  --bytecode output/association_manager.wasm \
  --pem deployer.pem \
  --gas-limit 60000000 \
  --proxy https://devnet-api.multiversx.com \
  --chain D --send
```

---

## Variabile de mediu

Copiază `.env.example` în `.env` și completează `CONTRACT_ADDRESS`:

```env
COMPOSE_PROJECT_NAME=voting

POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=voting_user
POSTGRES_PASSWORD=voting_pass
POSTGRES_DB=voting_db

JWT_SECRET=change_me_in_production_please
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

MVX_NETWORK=devnet
MVX_API_URL=https://devnet-api.multiversx.com
MVX_CHAIN_ID=D
CONTRACT_ADDRESS=erd1qqq...     # ← adresa SC deployat

# Path-ul PEM din container (montat via docker-compose volume)
BRIDGE_WALLET_PEM_PATH=/run/secrets/bridge-wallet.pem

# URL-uri interne Docker Compose
ASSOC_SERVICE_URL=http://association-service:3002
VOTE_SERVICE_URL=http://vote-service:3003

AUTH_SERVICE_PORT=3001
ASSOCIATION_SERVICE_PORT=3002
VOTE_SERVICE_PORT=3003
BLOCKCHAIN_BRIDGE_PORT=3004
FRONTEND_PORT=3000
```

> **Fișierul `smart-contracts/deployer.pem`** este montat ca volum read-only în containerul `blockchain-bridge`. Obține EGLD de test din [Devnet Faucet](https://devnet-wallet.multiversx.com/faucet).

---

## Structura proiectului

```
Blockchain-Volunteering-Platform/   (branch: voting)
├── .env                            ← variabile mediu (gitignored)
├── .env.example                    ← template fără secrete
├── docker-compose.yml              ← orchestrare completă
├── smart-contracts/
│   └── association-manager/        ← SC Rust (multiversx-sc 0.63.2)
│       ├── src/association_manager.rs
│       ├── output/                 ← ABI + MXSC (WASM gitignored)
│       └── wasm/
├── services/
│   ├── auth-service/               ← NestJS: JWT, register, login, wallet linking
│   ├── association-service/        ← NestJS: asociații, membri, sc-sync
│   ├── vote-service/               ← NestJS: sesiuni, voturi, rezultate
│   └── blockchain-bridge/          ← NestJS: tx builder, paymaster submit, finalizare
├── frontend/                       ← Next.js 16 App Router
│   ├── app/
│   │   ├── login/
│   │   ├── register/
│   │   ├── profile/
│   │   └── associations/
│   │       └── [id]/
│   │           ├── page.tsx        ← detalii asociație + membri
│   │           └── sessions/
│   │               ├── page.tsx    ← lista sesiuni + creare
│   │               └── [sessionId]/
│   │                   ├── page.tsx        ← pagina vot activ
│   │                   └── results/page.tsx ← rezultate + finalizare
│   ├── components/Navbar.tsx
│   └── lib/
│       ├── api.ts                  ← axios clients cu refresh interceptor
│       ├── store.ts                ← Zustand store (JWT + PEM in-memory)
│       ├── wallet.ts               ← PEM parse + tx signing (browser-safe)
│       └── datetime.ts             ← timezone-safe date helpers
├── shared/
│   └── types/index.ts              ← tipuri TypeScript comune
└── infra/
    └── postgres/init.sql           ← schema DB (auth + association + vote)
```
