# Development Steps — Blockchain Voting Platform (branch: voting)

Jurnal tehnic al implementării. Bifat = finalizat.

---

## ✅ FĂCUT

### Setup & Infrastructură
- [x] Inițializare repository, creare branch `voting`
- [x] Root `package.json` (fără workspaces — fiecare serviciu e independent)
- [x] `.env` + `.env.example` cu `COMPOSE_PROJECT_NAME=voting` (volume izolate per branch)
- [x] `.gitignore` complet (node_modules, dist, .env, *.pem, Rust target/, .next/)
- [x] `docker-compose.yml` — PostgreSQL 16, Redis 7, cele 4 servicii NestJS, frontend Next.js
- [x] `infra/postgres/init.sql` — scheme `auth`, `association`, `vote` cu toate tabelele

### Smart Contract
- [x] Folder `smart-contracts/association-manager/` creat cu `sc-meta new --template empty --name association-manager`
- [x] Logică SC implementată (endpoints: registerAssociation, registerMember, createVotingSession, castVote, stopSession, finalizeSession)
- [ ] Tests SC în Rust VM sandbox
- [x] Build WASM: `sc-meta all build`
- [x] Deploy pe Devnet + adresă salvată în `.env`

### Servicii Backend (NestJS + TypeScript)
- [x] `auth-service` — scaffolding NestJS + dependențe (TypeORM, pg, JWT, bcryptjs, passport)
- [x] `association-service` — scaffolding NestJS + dependențe
- [x] `vote-service` — scaffolding NestJS + dependențe
- [x] `blockchain-bridge` — scaffolding NestJS + `@multiversx/sdk-core`
- [x] Dockerfile per serviciu
- [ ] `auth-service` — implementare completă (register, login, JWT, refresh token)
- [ ] `association-service` — implementare completă (CRUD asociație, membri)
- [ ] `vote-service` — implementare completă (sesiuni vot, eligibili, rezultate)
- [ ] `blockchain-bridge` — implementare completă (build tx, Relayed tx, SC event listener)

### Frontend (Next.js 14)
- [x] Inițializare Next.js 14 cu TypeScript + Tailwind + App Router
- [x] Instalare dependențe: `@multiversx/sdk-core`, TanStack Query, Zustand, axios
- [x] Dockerfile (multi-stage build)
- [ ] Pagina Login
- [ ] Pagina Înrolare Asociație
- [ ] Pagina Listă Membri / Înrolare Voluntar
- [ ] Pagina Profil + Wallet linking (PEM în memorie)
- [ ] Pagina Voting (creare sesiune, select/deselect participanți, vot)
- [ ] Pagina Rezultate

### Shared
- [x] `shared/types/index.ts` — tipuri TypeScript comune (User, Association, Member, VoteSession, etc.)

### Documentație
- [x] `DEVELOPMENT.md` — ghid complet de pornire a proiectului
- [x] `DevelopmentSteps.md` — acest fișier
- [x] `docs/Technical_Report_1_Voting.md` — raport Phase 1

---

## 🔜 URMEAZĂ (în ordine)

### 1. Smart Contract — logică completă
Implementare endpoints în `smart-contracts/association-manager/src/association_manager.rs`:
- `registerAssociation(name)` → caller devine admin, se generează association_id
- `registerMember(assoc_id, wallet)` → admin only
- `createVotingSession(assoc_id, candidates[], eligible_voters[], deadline, quorum)` → admin only
- `castVote(assoc_id, session_id, candidate)` → voter eligibil, o singură dată
- `stopSession(assoc_id, session_id)` → admin only
- `finalizeSession(assoc_id, session_id)` → oricine, după deadline/stop

### 2. auth-service — implementare completă
- Module: AuthModule, UsersModule
- Endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- Endpoint: `PATCH /auth/wallet` — leagă wallet address la cont
- Guards: JwtAuthGuard reutilizabil de toate serviciile
- TypeORM entities: User, RefreshToken (schema `auth`)

### 3. association-service — implementare completă
- Module: AssociationsModule, MembersModule
- Endpoints:
  - `POST /associations` — creare asociație
  - `GET /associations/:id` — detalii asociație
  - `POST /associations/:id/members` — adăugare voluntar
  - `GET /associations/:id/members` — listă membri
  - `DELETE /associations/:id/members/:userId` — eliminare membru
- TypeORM entities: Association, Member (schema `association`)

### 4. vote-service — implementare completă
- Module: SessionsModule, VotesModule
- Endpoints:
  - `POST /sessions` — creare sesiune (draft)
  - `GET /sessions/:id` — detalii sesiune
  - `GET /associations/:id/sessions` — sesiuni per asociație
  - `POST /sessions/:id/start` — lansare sesiune (trimite tx la bridge)
  - `POST /sessions/:id/stop` — oprire manuală
  - `GET /sessions/:id/results` — rezultate finale
- Logică: calculare automată eligibili din lista de membri asociație

### 5. blockchain-bridge — implementare completă
- `POST /tx/build` — construiește inner transaction nesemnată
- `POST /tx/broadcast` — primește tx semnată + o trimite ca Relayed tx pe Devnet
- SC event listener (polling Devnet API) — actualizează status sesiuni în DB
- Redis cache pentru starea on-chain

### 6. Frontend — toate paginile
- Layout comun + navbar
- Pagina Login (`/login`)
- Pagina Înrolare Asociație (`/register-association`)
- Pagina Membri (`/associations/[id]/members`)
- Pagina Profil (`/profile`) — cu wallet PEM upload (memorie browser)
- Pagina Voting (`/associations/[id]/sessions`) — creare sesiune + vot activ
- Pagina Rezultate (`/associations/[id]/sessions/[sessionId]/results`)

### 7. Integrare end-to-end & testare
- Deploy SC pe Devnet, adresă în `.env`
- Test flux complet: register → creare asociație → adăugare membri → sesiune vot → vot → rezultat
- Verificare vot on-chain în Devnet Explorer

---

## Note Arhitecturale

- **Branch `voting`**: aplicație completă, standalone, fără SFT/NFT/ESDT
- **Branch `main`** (dizertație): se creează din `voting` și extinde cu ierarhie completă roluri, activități, certificate, NFT-uri, permissions system
- **Volume Docker izolate**: `COMPOSE_PROJECT_NAME=voting` → `voting_postgres_data`, `voting_redis_data`
- **PEM în browser**: wallet-ul utilizatorului nu ajunge niciodată la server — semnarea se face client-side cu `@multiversx/sdk-core`
- **Relayed Transactions**: bridge-ul plătește gas-ul, utilizatorul plătește 0 EGLD
