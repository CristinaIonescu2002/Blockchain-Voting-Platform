# Development Steps — Blockchain Voting Platform (branch: voting)

Jurnal tehnic al implementării. Bifat = finalizat, compilat, typecheck trecut.

---

## ✅ FINALIZAT

### Setup & Infrastructură
- [x] Inițializare repository, creare branch `voting`
- [x] Root `package.json` (fără workspaces — fiecare serviciu e independent)
- [x] `.env` cu toate variabilele: PostgreSQL, Redis, JWT, MultiversX, porturi servicii, URL-uri interne Docker, BRIDGE_WALLET_PEM_PATH
- [x] `.env.example` — versiune fără secrete pentru repository
- [x] `.gitignore` — node_modules, dist, .env, *.pem, target/, .next/, output/*.wasm, AGENTS.md, CLAUDE.md
- [x] `docker-compose.yml` — PostgreSQL 16, Redis 7, 4 servicii NestJS, frontend Next.js; healthchecks pe postgres și redis
- [x] `infra/postgres/init.sql` — scheme `auth`, `association`, `vote` cu toate tabelele și FK-uri

### Smart Contract (`smart-contracts/association-manager/`)
- [x] Creat cu `sc-meta new --template empty --name association-manager`
- [x] `Cargo.toml` — multiversx-sc 0.63.2
- [x] Implementare completă `src/association_manager.rs`:
  - **Endpoints**: `registerAssociation`, `registerMember`, `removeMember`, `createVotingSession` (cu `#[allow_multiple_var_args]`), `castVote`, `stopSession`, `finalizeSession`
  - **Views**: `getAssocCount`, `getAssocName`, `getAssocAdmin`, `isMember`, `getMembers`, `getSessionCount`, `getSessionStatus`, `getSessionDeadline`, `getSessionResult`, `getCandidatesWithVotes`, `getEligibleVoters`, `getHasVoted`, `getVoteCount`
  - **Storage mappers**: SingleValueMapper + UnorderedSetMapper per asociație/sesiune
  - **Events**: `associationRegistered`, `memberRegistered`, `memberRemoved`, `sessionCreated`, `voteCast`, `sessionStopped`, `sessionFinalized`
  - **Helpers private**: `require_assoc_exists`, `require_session_exists`, `require_admin`
- [x] `deploy.sh` — funcții bash: `deploySC`, `upgradeSC`, `registerAssociation`, `getAssocCount`; SC_ADDRESS setat după deploy
- [x] Build WASM: `sc-meta all build` — zero erori, zero warnings
- [x] Deploy pe **Devnet** — adresă: `erd1qqqqqqqqqqqqqpgqfuxy2dg9r3hsp2epyx78w4g09xlh8qzx086qgwepdv`
- [x] `CONTRACT_ADDRESS` salvat în `.env`
- [ ] Teste SC în Rust VM sandbox (de făcut înainte de livrare)

### `auth-service` (`services/auth-service/`)
- [x] Dockerfile multi-stage (build + runtime)
- [x] Entities TypeORM cu schema `auth`: `User`, `RefreshToken` — mapate exact pe `init.sql`
- [x] DTOs cu validare: `RegisterDto`, `LoginDto`, `LinkWalletDto`
- [x] `JwtStrategy` (passport-jwt) — validare access token din header Bearer
- [x] `JwtAuthGuard` + decorator `@CurrentUser()`
- [x] `AuthService`:
  - `register` — hash bcrypt, save user, emite pereche access+refresh token
  - `login` — verifică parola, emite tokeni
  - `refresh` — verifică JWT + hash în DB, **rotire token** (șterge vechi, emite nou)
  - `logout` — șterge toate refresh token-urile utilizatorului
  - `linkWallet` — salvează adresa MultiversX a utilizatorului
  - `me` — profil curent
- [x] Endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/link-wallet`, `GET /auth/me`
- [x] TypeScript typecheck: zero erori

### `association-service` (`services/association-service/`)
- [x] Dockerfile multi-stage
- [x] Entities TypeORM: `Association`, `Member` (schema `association`) + `AuthUser` (read-only din schema `auth` — pentru wallet address)
- [x] DTOs: `CreateAssociationDto`, `UpdateAssociationDto`, `AddMemberDto`
- [x] `JwtStrategy` + `JwtAuthGuard` + `@CurrentUser()` (același JWT secret din `.env`)
- [x] `AssociationsService`:
  - `create` — caller devine admin, wallet-ul admin se preia din `auth.users`
  - `findAll`, `findMine`, `findOne`
  - `update` — admin only; acceptă `scAssocId` setat de bridge după on-chain registration
  - `addMember` — admin only; re-activare dacă era removed; wallet rezolvat din `auth.users`
  - `removeMember` — soft delete (status = 'removed')
  - `getMembers` — doar activi
- [x] Endpoints: `POST`, `GET /all`, `GET /my`, `GET /:id`, `PATCH /:id`, `POST /:id/members`, `DELETE /:id/members/:userId`, `GET /:id/members`
- [x] TypeScript typecheck: zero erori

### `vote-service` (`services/vote-service/`)
- [x] Dockerfile multi-stage
- [x] Entities TypeORM: `Session`, `Candidate`, `EligibleVoter` (schema `vote`) + `AuthUser`, `AssocMember` (read-only cross-schema)
- [x] DTOs: `CreateSessionDto` (cu `CandidateInputDto`, `EligibleVoterInputDto`), `UpdateSessionDto`, `RecordVoteDto`
- [x] `JwtStrategy` + guard + decorator
- [x] `VotesService`:
  - `createSession` — verifică că requester e admin asociație; salvează sesiunea + candidați + electori eligibili în DB; status inițial `draft`
  - `findByAssociation`, `findOne` (cu relații)
  - `updateSession` — admin only; bridge apelează asta pentru a seta `scSessionId` și a schimba statusul
  - `getResults` — returnează candidați sortați, câștigător, total voturi, quorum reached
  - `recordVote` — endpoint intern (fără auth); bridge îl apelează după confirmarea on-chain; marchează `has_voted`, incrementează `vote_count`
- [x] Endpoints: `POST /votes/sessions`, `GET /votes/sessions?associationId=`, `GET /votes/sessions/:id`, `PATCH /votes/sessions/:id`, `GET /votes/sessions/:id/results`, `POST /votes/sessions/:id/record-vote`
- [x] TypeScript typecheck: zero erori

### `blockchain-bridge` (`services/blockchain-bridge/`)
- [x] Dockerfile multi-stage
- [x] `ChainService` — wraps `@multiversx/sdk-core` v15:
  - Încarcă bridge wallet din PEM la startup (`BRIDGE_WALLET_PEM_PATH`)
  - `getAccountNonce(address)` — via Axios → MultiversX API
  - `sendRawTransaction(txObj)` — submit la proxy
  - `encodeU64(n)` — encoding big-endian hex minimal pentru argumente SC
  - `encodeAddress(bech32)` — 32-byte hex pentru argumente SC
  - `buildScData(fn, args)` — construiește string-ul `functionName@arg1@arg2`
  - `buildUnsignedTxObject(...)` — returnează obiect JSON nesemnat pentru client
  - `wrapAndSendRelayed(innerTxObj)` — Relayed Tx v1: bridge semnează outer tx, plătește gas
  - `buildSignAndSend(...)` — bridge semnează și trimite direct (ex: finalizeSession)
- [x] `BridgeService`:
  - `buildRegisterAssociationTx` — unsigned tx cu `str:` encoding pentru name
  - `buildRegisterMemberTx` — unsigned tx `registerMember(assocId, wallet)`
  - `buildCreateSessionTx` — unsigned tx `createVotingSession` cu candidați + electori
  - `buildStopSessionTx` — unsigned tx `stopSession`
  - `buildVoteTx` — unsigned inner tx `castVote` (pentru voter, semnat client-side)
  - `submitAdminTx` — forward signed tx pe chain
  - `submitVote` — relayed vote; după ~8s notifică vote-service să înregistreze votul în DB
  - `finalizeSession` — bridge semnează și trimite `finalizeSession`; actualizează status DB
- [x] Endpoints: `GET /bridge/tx/register-association`, `GET /bridge/tx/register-member`, `GET /bridge/tx/stop-session`, `GET /bridge/tx/vote`, `POST /bridge/tx/submit`, `POST /bridge/tx/vote/submit`, `POST /bridge/finalize/:sessionId`
- [x] TypeScript typecheck: zero erori

### Frontend (`frontend/`)
- [x] Next.js 16.2.1, React 19, Tailwind CSS v4, App Router, TypeScript
- [x] Dependențe instalate: `@multiversx/sdk-core` v15, TanStack Query v5, Zustand v5, axios
- [x] Dockerfile multi-stage
- [x] `lib/store.ts` — Zustand store: accessToken, refreshToken, user, pemContent (in-memory), walletAddress
- [x] `lib/api.ts` — axios clients pentru toate 4 servicii; interceptor Bearer token + refresh automat la 401
- [x] `lib/wallet.ts` — `parsePem(pem)` (UserSigner.fromPem + adresă bech32), `signTx(pem, unsignedTxObj)` (sdk-core v15: TransactionComputer + tx.signature = sig + tx.toSendable())
- [x] `app/providers.tsx` — QueryClientProvider ('use client')
- [x] `app/layout.tsx` — Geist font, Providers wrapper, Navbar, container
- [x] `app/page.tsx` — redirect → /associations
- [x] `components/Navbar.tsx` — link-uri nav, logout cu POST /auth/logout
- [x] `app/login/page.tsx` — formular email+parolă + upload PEM opțional; JWT în Zustand, PEM în memorie
- [x] `app/register/page.tsx` — formular înregistrare → POST /auth/register → redirect login
- [x] `app/profile/page.tsx` — date cont, link wallet (upload PEM → extrage adresă → POST /auth/link-wallet → setPem în Zustand)
- [x] `app/associations/page.tsx` — lista asociații + creare: POST /associations → GET /bridge/tx/register-association → semnare PEM → POST /bridge/tx/submit
- [x] `app/associations/[id]/page.tsx` — detalii asociație, management membri (adăugare by email, ștergere soft)
- [x] `app/associations/[id]/sessions/page.tsx` — lista sesiuni + creare: POST /votes/sessions → GET /bridge/tx/create-session → semnare → POST /bridge/tx/submit
- [x] `app/associations/[id]/sessions/[sessionId]/page.tsx` — vot activ: GET /bridge/tx/vote → semnare inner tx cu PEM → POST /bridge/tx/vote/submit (relayed)
- [x] `app/associations/[id]/sessions/[sessionId]/results/page.tsx` — rezultate finale, breakdown voturi, buton finalizare admin (POST /bridge/finalize/:sessionId)
- [x] `.env.local.example` — URL-uri servicii pentru development local

### Shared
- [x] `shared/types/index.ts` — tipuri TypeScript comune

### Documentație
- [x] `DEVELOPMENT.md` — ghid complet setup, prerequisites, comenzi
- [x] `DevelopmentSteps.md` — acest fișier
- [x] `docs/Technical_Report_1_Voting.md` — raport Phase 1

---

## 🔜 URMEAZĂ (în ordine)

### 1. Integrare end-to-end
- [ ] Test flux complet pe Devnet: register user → login → link wallet → creare asociație → register on-chain → adăugare membri → creare sesiune → submit sesiune on-chain → vot (relayed) → finalizare → rezultate
- [ ] Verificare evenimente on-chain în [Devnet Explorer](https://devnet-explorer.multiversx.com/accounts/erd1qqqqqqqqqqqqqpgqfuxy2dg9r3hsp2epyx78w4g09xlh8qzx086qgwepdv)
- [ ] `docker compose up` — pornire completă stack

### 3. Testare SC (opțional dar recomandat pentru documentație)
- [ ] Scenarii `.scen.json` în `smart-contracts/association-manager/scenarios/`
- [ ] `sc-meta test` — rulare scenarii în VM sandbox

---

## Arhitectură curentă

```
Browser
  ├── JWT (Zustand, in-memory)
  ├── PEM wallet (Zustand, in-memory — cleared on logout/30min)
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
│              │                │                     │
│         PostgreSQL          Redis                   │
│         (3 scheme)          :6379                   │
└─────────────────────────────────────────────────────┘
          │
          ▼
  MultiversX Devnet
  SC: erd1qqqqqqqqqqqqqpgqfuxy2dg9r3hsp2epyx78w4g09xlh8qzx086qgwepdv
```

## Decizii arhitecturale cheie

| Decizie | Motivație |
|---|---|
| Multi-tenant SC (un singur SC pentru toate asociațiile) | Evită factory pattern + deploy per asociație; mai simplu, mai ieftin |
| Relayed Transactions v1 pentru `castVote` | Votanți plătesc 0 EGLD; bridge-ul plătește gas din wallet propriu |
| PEM rămâne în browser memory (Zustand) | Niciodată trimis la server; șters la logout sau 30min inactivitate |
| JWT secret partajat între servicii | Fiecare serviciu validează token-ul independent, fără call la auth-service |
| Soft delete pentru membri | Permite reactivare; păstrează istoricul |
| `synchronize: false` TypeORM | Schema gestionată exclusiv prin `init.sql` |
| `record-vote` endpoint fără auth (intern) | Apelat doar de bridge după confirmare on-chain; nu e expus public |
