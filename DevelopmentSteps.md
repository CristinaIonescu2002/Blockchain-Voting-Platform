# Development Steps — Blockchain Voting Platform (branch: voting)

Jurnal tehnic al implementării. Bifat = finalizat, compilat, typecheck trecut.

---

## ✅ FINALIZAT

### Setup & Infrastructură
- [x] Inițializare repository, creare branch `voting`
- [x] Root `package.json` (fără workspaces — fiecare serviciu e independent)
- [x] `.env` cu toate variabilele: PostgreSQL, JWT, MultiversX, porturi servicii, URL-uri interne Docker, BRIDGE_WALLET_PEM_PATH
- [x] `.env.example` — versiune fără secrete pentru repository
- [x] `.gitignore` — node_modules, dist, .env, *.pem, target/, .next/, output/*.wasm, AGENTS.md, CLAUDE.md, .claude/
- [x] `docker-compose.yml` — PostgreSQL 16, 4 servicii NestJS, frontend Next.js; healthcheck pe postgres; mount PEM bridge wallet via volume
- [x] `infra/postgres/init.sql` — scheme `auth`, `association`, `vote` cu toate tabelele și FK-uri; coloana `max_choices INT DEFAULT 1` în `vote.sessions`

### Smart Contract (`smart-contracts/association-manager/`)
- [x] Creat cu `sc-meta new --template empty --name association-manager`
- [x] `Cargo.toml` — multiversx-sc 0.63.2
- [x] Implementare completă `src/association_manager.rs`:
  - **Endpoints**: `registerAssociation`, `registerMember`, `removeMember`, `createVotingSession` (cu `#[allow_multiple_var_args]`, parametru `max_choices: u64`), `castVote` (cu mai mulți candidați — multi-choice), `stopSession`, `finalizeSession`
  - **Views**: `getAssocCount`, `getAssocName`, `getAssocAdmin`, `isMember`, `getMembers`, `getSessionCount`, `getSessionStatus`, `getSessionDeadline`, `getSessionResult`, `getCandidatesWithVotes`, `getEligibleVoters`, `getHasVoted`, `getVoteCount`
  - **Storage mappers**: SingleValueMapper + UnorderedSetMapper per asociație/sesiune
  - **Events**: `associationRegistered`, `memberRegistered`, `memberRemoved`, `sessionCreated`, `voteCast`, `sessionStopped`, `sessionFinalized`
  - **Helpers private**: `require_assoc_exists`, `require_session_exists`, `require_admin`
- [x] `deploy.sh` — funcții bash: `deploySC`, `upgradeSC`, `registerAssociation`, `getAssocCount`; SC_ADDRESS setat după deploy
- [x] Build WASM: `sc-meta all build` — zero erori, zero warnings
- [x] Deploy pe **Devnet** — adresă: `erd1qqqqqqqqqqqqqpgqfuxy2dg9r3hsp2epyx78w4g09xlh8qzx086qgwepdv`
- [x] `CONTRACT_ADDRESS` salvat în `.env`
- [x] Evenimente on-chain verificate în Devnet Explorer (associationRegistered, sessionCreated, voteCast, sessionFinalized)
- [ ] Teste SC în Rust VM sandbox (opțional — acoperit de testele E2E pe Devnet)

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
- [x] `Session` entity extins cu câmpul `maxChoices` (int, default 1)
- [x] DTOs: `CreateSessionDto` (cu `CandidateInputDto`, `EligibleVoterInputDto`, `maxChoices`), `UpdateSessionDto`, `RecordVoteDto`
- [x] `RecordVoteDto` extins cu `candidateWallets?: string[]` — suport multi-choice
- [x] `JwtStrategy` + guard + decorator
- [x] `VotesService`:
  - `onModuleInit` — migrare live: `ALTER TABLE vote.sessions ADD COLUMN IF NOT EXISTS max_choices INT DEFAULT 1` (compatibilitate DB fără restart)
  - `createSession` — verifică că requester e admin asociație; salvează sesiunea + candidați + electori eligibili în DB; status inițial `draft`; stochează `maxChoices`
  - `findByAssociation`, `findOne` (cu relații)
  - `syncScId` — endpoint intern (fără auth): setează `scSessionId` și/sau `status`; apelat exclusiv de bridge
  - `updateSession` — admin only (cu auth); pentru acțiuni user-facing
  - `getResults` — returnează candidați sortați, câștigător, `totalEligible`, `totalVoted`, quorum reached, `maxChoices`; `winner` setat doar după `status = finalized`
  - `recordVote` — endpoint intern (fără auth); suport multi-choice (`candidateWallets[]`); tranzacție cu `pessimistic_write` + idempotent
  - `deleteUnpublishedSession` — admin only; șterge sesiune draft care nu e publicată on-chain (`scSessionId` null); ștergere în cascadă candidați + electori
- [x] Endpoints: `POST /votes/sessions`, `GET /votes/sessions?associationId=`, `GET /votes/sessions/:id`, `PATCH /votes/sessions/:id/sc-sync` (intern, fără auth), `PATCH /votes/sessions/:id` (auth), `DELETE /votes/sessions/:id` (auth, draft only), `GET /votes/sessions/:id/results`, `POST /votes/sessions/:id/record-vote`
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
  - `buildUnsignedTxObject(...)` — returnează obiect JSON nesemnat pentru client; câmp `relayer` opțional
  - `wrapAndSendRelayed(innerTxObj)` — Relayed Tx v1: bridge semnează outer tx, plătește gas
  - `buildSignAndSend(...)` — bridge semnează și trimite direct (ex: finalizeSession)
  - `getSessionStatus(scAssocId, scSessionId)` — view query SC: status sesiune
  - `getSessionDeadline(scAssocId, scSessionId)` — view query SC: deadline sesiune (u64 timestamp)
  - `getIndexedEventU64(txHash, identifier, topicIndex)` — parsare topic u64 din event log tx (fallback ID resolution)
  - `getNestedEventTopicU64(txHash, identifier, nestedEventName, topicIndex)` — parsare topic u64 din event nested în SCR (sessionCreated)
  - `waitForReturnU64(txHash)` — polling confirmare tx + extragere return value u64 din `@6f6b@<hex>`
  - `waitForSuccess(txHash)` — polling confirmare tx simplă (fără return value)
  - `getShardOfAddress(bech32)` — calcul shard adresă (AddressComputer) pentru decizia relayed/direct
  - `pickVmReturnData/Code/Message` — normalizare robustă a răspunsurilor VM query (camelCase + PascalCase + nested `data.data`)
- [x] `BridgeService`:
  - `buildRegisterAssociationTx` — unsigned tx cu hex encoding pentru name
  - `buildRegisterMemberTx` — unsigned tx `registerMember(assocId, wallet)`
  - `buildCreateSessionTx` — unsigned tx `createVotingSession` cu `maxChoices`, candidați + electori (count prefix pentru `#[allow_multiple_var_args]`)
  - `buildStopSessionTx` — unsigned tx `stopSession`
  - `buildVoteTx` — unsigned inner tx `castVote` cu suport multi-candidat (`candidateWallets[]`); verificare on-chain status + deadline înainte de construire; decizie relayed vs direct bazată pe shard
  - `submitAdminTx` — forward signed tx pe chain; rezolvare robustă ID după confirmare:
    - `waitForReturnU64` (return value SC)
    - `getIndexedEventU64` pentru `associationRegistered`
    - `getNestedEventTopicU64` pentru `sessionCreated`
    - fallback polling `resolveAssocIdAfterCreate` / `resolveSessionIdAfterCreate`
    - mod `stopOnly` (sessionSyncStatus='stopped'): doar `waitForSuccess` + patch status DB
  - `submitVote` — relayed vote (dacă inner tx are `relayer`) sau direct; parsare `candidateWallets` din data base64 după confirmare; notificare vote-service
  - `finalizeSession` — bridge semnează și trimite `finalizeSession`; actualizează status DB la `finalized`
  - `patchSessionStatus` — helper intern: PATCH `sc-sync` cu status
- [x] Endpoints: `GET /bridge/tx/register-association`, `GET /bridge/tx/register-member`, `POST /bridge/tx/create-session`, `GET /bridge/tx/stop-session`, `GET /bridge/tx/vote`, `POST /bridge/tx/submit`, `POST /bridge/tx/vote/submit`, `POST /bridge/finalize/:sessionId`
- [x] DTOs extinse:
  - `BuildVoteTxDto` — adăugat `candidateWallets?: string[]` pentru multi-choice
  - `SubmitSignedTxDto` — adăugat `sessionSyncStatus?: 'stopped'` pentru stopSession flow
  - `BuildCreateSessionTxDto` — DTO nou pentru `POST /bridge/tx/create-session`
- [x] TypeScript typecheck: zero erori

### Frontend (`frontend/`)
- [x] Next.js 16.2.1, React 19, Tailwind CSS v4, App Router, TypeScript
- [x] Dependențe instalate: `@multiversx/sdk-core` v15, TanStack Query v5, Zustand v5, axios
- [x] Dockerfile multi-stage
- [x] `lib/store.ts` — Zustand store: accessToken, refreshToken, user, pemContent (in-memory), walletAddress
- [x] `lib/api.ts` — axios clients pentru toate 4 servicii; interceptor Bearer token + refresh automat la 401
- [x] `lib/wallet.ts` — browser-safe PEM parsing (fără `fs`): two-stage decode base64→hex→bytes; `parsePem(pem)` (UserSecretKey + UserSigner); `signTx(pem, unsignedTxObj)` — TransactionComputer + suport câmp `relayer` + fix zero-padding signatură ed25519 (Buffer.from(sig).toString('hex'))
- [x] `lib/datetime.ts` — `parseLocalDateTimeInput(value)` (conversie `datetime-local` → Date local, timezone-safe); `formatLocalDateTime(value)` (ro-RO format cu Intl.DateTimeFormat)
- [x] `app/providers.tsx` — QueryClientProvider ('use client')
- [x] `app/layout.tsx` — Geist font, Providers wrapper, Navbar, container
- [x] `app/page.tsx` — redirect → /associations
- [x] `components/Navbar.tsx` — link-uri nav, logout cu POST /auth/logout
- [x] `app/login/page.tsx` — formular email+parolă + upload PEM opțional; JWT în Zustand, PEM în memorie
- [x] `app/register/page.tsx` — formular înregistrare → POST /auth/register → redirect login
- [x] `app/profile/page.tsx` — date cont, link wallet (upload PEM → extrage adresă → POST /auth/link-wallet → setPem în Zustand)
- [x] `app/associations/page.tsx` — lista asociații + creare: POST /associations → GET /bridge/tx/register-association → semnare PEM → POST /bridge/tx/submit
- [x] `app/associations/[id]/page.tsx` — detalii asociație, management membri (adăugare by email, ștergere soft)
- [x] `app/associations/[id]/sessions/page.tsx` — lista sesiuni + creare cu:
  - suport multi-choice (toggle Single/Multiple + input maxChoices)
  - selecție candidați și electori din membri cu wallet linked; "Select all / Clear all"
  - admin inclus automat în opțiunile de vot dacă are wallet
  - `parseLocalDateTimeInput` pentru deadline timezone-safe
  - buton ștergere sesiuni draft nepublicate on-chain
  - smart routing: click pe sesiune duce la rezultate când deadline trecut sau status stopped/finalized
- [x] `app/associations/[id]/sessions/[sessionId]/page.tsx` — vot activ cu:
  - vot modal cu checkbox (multi-choice) sau radio (single-choice) bazat pe `maxChoices`
  - contor selecții `X/maxChoices selected`
  - panou "Close voting early" pentru admin când toți eligibilii au votat înainte de deadline (`stopSession` on-chain → redirect results)
  - tracking status vot per voter (hasVoted) vizibil pentru admin
  - banner redirect spre results când deadline trecut sau sesiune stopped/finalized
- [x] `app/associations/[id]/sessions/[sessionId]/results/page.tsx` — rezultate cu:
  - auto-finalizare la mount când `canFinalize` (deadline trecut sau status stopped) — `useRef` guard anti-double-call
  - panou "Close voting early" (stopSession + finalizare) accesibil și din pagina de rezultate
  - vizualizare pie chart cu `conic-gradient` per candidat
  - contoare `totalVotes`, `totalEligible`, quorum reached
  - winner afișat doar după `status = finalized` (consistent cu logica SC)
- [x] `.env.local.example` — URL-uri servicii pentru development local

### Shared
- [x] `shared/types/index.ts` — tipuri TypeScript comune: `User`, `AuthTokens`, `Association`, `Member`, `VoteSession` (cu `maxChoices`), `Candidate`, `EligibleVoter` (cu `userId`), `UnsignedTransaction`

### Documentație
- [x] `DEVELOPMENT.md` — ghid complet setup, prerequisites, comenzi
- [x] `DevelopmentSteps.md` — acest fișier
- [x] `docs/Technical_Report_1_Voting.md` — raport Phase 1

---

## ✅ Integrare End-to-End (finalizat)

- [x] Test flux complet pe Devnet: register user → login → link wallet → creare asociație → register on-chain → adăugare membri → creare sesiune → submit sesiune on-chain → vot relayed → finalizare → rezultate
- [x] Test vot multi-choice (maxChoices > 1)
- [x] Test flux "close voting early" (stopSession → finalizare prematură)
- [x] Verificare evenimente on-chain în [Devnet Explorer](https://devnet-explorer.multiversx.com/accounts/erd1qqqqqqqqqqqqqpgqfuxy2dg9r3hsp2epyx78w4g09xlh8qzx086qgwepdv)
- [x] `docker compose up` — pornire completă stack verificată

---

## 🔜 OPȚIONAL (nesolicitat pentru livrare)

### Testare SC în sandbox (skipped — acoperit de E2E pe Devnet)
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
│              │                                      │
│         PostgreSQL                                  │
│         (3 scheme)                                  │
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
