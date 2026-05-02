# Plan: Blockchain Volunteering Platform — Arhitectură & Setup

## Context

Două proiecte, un singur repository, două branch-uri cu izolare completă de date:

| Branch | Proiect | Scop |
|---|---|---|
| `voting` | Blockchain-based Voting Systems | Full functional, minimal, livrabil independent |
| `main` | Dizertație — Volunteering Platform | Platform complet, construit peste `voting` |

**Strategia**: Branch-ul `voting` este primul deliverable — o aplicație completă și funcțională cu autentificare, înrolare asociație, voluntari și voting on-chain. Branch-ul `main` preia tot codul din `voting` și îl extinde cu toate funcționalitățile dizertației.

---

## 0. Branch Strategy & Izolare Date

### Structura branch-urilor

```
main (dizertație)
 └── voting (livrabil proiect voting — baza pe care se construiește main)
```

Branch-ul `voting` nu se șterge niciodată. `main` este creat din `voting` și extins.

### Izolare date între branch-uri (Docker Volumes)

Fiecare branch are propriul `docker-compose.yml` cu volume distincte, folosind `COMPOSE_PROJECT_NAME` în `.env`:

```
# voting branch → .env
COMPOSE_PROJECT_NAME=voting
# → volume-urile se numesc: voting_postgres_data, voting_redis_data

# main branch → .env
COMPOSE_PROJECT_NAME=platform
# → volume-urile se numesc: platform_postgres_data, platform_redis_data
```

Comutarea între branch-uri:
```bash
git checkout voting && docker compose up -d   # date voting, izolate
git checkout main  && docker compose up -d   # date platform, izolate
```

Datele nu se intersectează niciodată. Fiecare branch are propriile volume persistente.

### Diferențe structurale între branch-uri

| Componentă | `voting` branch | `main` branch |
|---|---|---|
| SC-uri | AssociationManager (voting + membrii simpli) | + ActivityEvent, PlatformFactory |
| Roluri | 1 rol: Admin (owner asociație) | Ierarhie completă + permissions system |
| Servicii | auth, association (minimal), vote, bridge | + role, activity, event, certificate, notification |
| DB | `vote_db` (simplificat) | scheme extinse per serviciu |
| Frontend | 6 pagini (login, enroll, members, profile, voting, results) | Dashboard complet |
| SFT/NFT | Nu | Da (SoulBound status, roluri, event NFTs) |
| ESDT tokens | Nu | Da (per asociație) |
| Permissions system | Nu | Da |

---

## 1. Decizii Arhitecturale Cheie

| Decizie | Alegere | Motivare |
|---|---|---|
| Blockchain | MultiversX | ESDT/NFT native protocol, sharding nativ, Rust SCs |
| SC pattern | Factory — per asociație instanțe proprii | Izolare completă, token propriu per asociație |
| Status/Role identity | SFT SoulBound (non-transferabil, persistent) | Istoric de progresie vizibil în wallet, access control nativ |
| SFT la status change | Nu se ard — atribute actualizate (historical/current) | Timeline voluntar vizibil, tokenuri rămân în wallet |
| Voting | Complet on-chain (fiecare vot = tx) | Transparență maximă, imutabilitate, verificabilitate |
| Gas pentru voluntari | 0 EGLD — Relayed Transactions | Asociația plătește prin bridge relayer wallet |
| Backend | NestJS + TypeScript | Ecosistem MultiversX nativ JS/TS, suport microservicii |
| Frontend | Next.js 14+ TypeScript | App Router, SSR, compatibil sdk-core |
| Auth | Hybrid: email+JWT (off-chain) + PEM în memorie browser (on-chain) | PEM nu părăsește clientul niciodată |
| DB | PostgreSQL per serviciu + Redis Cluster | Izolare date, caching blockchain state |
| Queue | RabbitMQ | Async events între servicii |
| Containers | Docker Compose (local) + Kubernetes + Helm (producție) | Scalabilitate independentă per serviciu |
| Autoscaling | Kubernetes HPA (CPU/memory) | bridge-listener singleton, restul N replici |
| Logging | Grafana Loki + Promtail + Prometheus + Grafana | Stack unified metrici + logs |
| Dev environment | MultiversX Devnet (EGLD gratuit din faucet) | 0 cost real pentru dizertație |

---

## 2. Smart Contracts (Rust, mx-sdk-rs)

### SC 1 — `PlatformFactory` (global, o singură instanță)

**Rol**: Registru global + factory de deployare SC per asociație.

```
registerAssociation(name_hash, admin_wallet):
  1. Deployează AssociationManager SC (instanță nouă cu adresă proprie)
  2. Deployează ActivityEvent SC (legat de AssociationManager prin adresă)
  3. Stochează: association_id → {manager_addr, activity_addr, admin_wallet}
  4. Emite event: AssociationRegistered(id, manager_addr, activity_addr)
```

Acces: platform admin only.

---

### SC 2 — `AssociationManager` (o instanță per asociație)

**Rol**: Identity (SFT), roluri, membri, voting on-chain, token management.

**Token management:**
- SC-ul deține EGLD și emite tokenul ESDT fungibil propriu asociației (Metachain system SC)
- Emis cu `canTransfer: false` → **non-transferabil** (voluntarii îl pot deține, nu trimite)
- SC-ul primește `ESDTRoleLocalMint` → mintează tokenuri la validarea activităților

**SFT SoulBound pentru status voluntar** (canTransfer: false, canUpdateAttributes: true):
- Colecție per asociație, nonce per nivel: 1=Junior, 2=Active, 3=Alumni, 4=Community
- SFT-urile **nu se ard niciodată** — rămân în wallet pe viață ca istoric de progresie
- La schimbare status:
  1. SC actualizează atributele SFT-ului vechi: `{status: "historical", until: timestamp}`
  2. SC mintează SFT nou cu nivelul nou: `{status: "current", since: timestamp}`
- Access control: verifică SFT cu `status: "current"` + nonce corespunzător
- Profilul voluntarului = timeline vizibil din wallet: [Junior: Ian–Iun 2024] → [Active: Sep 2024–prezent]

**SFT SoulBound pentru roluri** (canTransfer: false, canUpdateAttributes: true):
- Colecție separată, nonce per rol: 1=President, 2=VP, 3=DM, 4=Secretary, 5=PM, 6=Mentor
- La transfer mandat:
  1. SC actualizează SFT fostului deținător: `{status: "past", tenure_end: timestamp}`
  2. SC mintează SFT rol nou la noul wallet: `{status: "current", since: timestamp}`
- Istoricul mandatelor vizibil pe chain

**Voting complet on-chain — integrat în AssociationManager SC** (nu SC separat):

Votingul stă în AssociationManager deoarece: (1) are acces direct la SFT-uri pentru verificarea eligibilității, (2) poate executa automat `transferRole` după vot fără cross-contract calls.

```
Voting endpoints (în AssociationManager SC):
  createVotingSession(type, candidates[], eligible_voters[], deadline, quorum) → session_id
  castVote(session_id, candidate)   ← fiecare voter eligibil semnează această tx
                                       SC verifică: caller ∈ eligible_voters + nu a mai votat + sesiune activă
  stopSession(session_id)           ← admin, oricând (urgențe)
  finalizeSession(session_id)       ← numără voturi → execută consecință:
                                       ROLE_ELECTION → transferRole(old, winner, role)
                                       RESTRUCTURING → batch promoteStatus(wallets, Community)
                                       CUSTOM → doar stochează rezultat hash
```

Eligibili: snapshot livrat de admin (calculat off-chain în vote-service prin query on-chain), ajustabil de admin înainte de `createVotingSession`. Odată sesiunea creată, lista e imutabilă pe chain.

**Toate endpoints-urile AssociationManager SC:**
```
// Member Management
registerMember(wallet)                   → mint Junior SFT (status: current)
promoteStatus(wallet, new_status)        → update atribute SFT vechi (historical) + mint nou (current)

// Role Management
assignRole(wallet, role)                 → mint role SFT (status: current)
transferRole(from, to, role)             → update SFT from (past) + mint SFT to (current)

// Voting (on-chain, integrat)
createVotingSession(...)
castVote(session_id, candidate)
stopSession(session_id)
finalizeSession(session_id)

// Configuration
setActivityTypeReward(type_id, amount)
setValidationThreshold(type_id, required_validators)

// ESDT/SFT Setup (apelate o singură dată la înregistrare)
issueEsdtToken(name, ticker)             → apelează Metachain system SC
issueStatusSftCollection()              → colecție SFT status voluntari
issueRoleSftCollection()                → colecție SFT roluri
```

---

### SC 3 — `ActivityEvent` (o instanță per asociație)

**Rol**: Activități, validare multi-sursă, NFT-uri per eveniment, certificate.

**Activități:**
- `createActivity(hash, type_id, assignee_wallet)` → înregistrează keccak256 cu timestamp
- State machine: `Pending → InValidation → Validated / Rejected`
- `validateActivity(activity_id)` → înregistrează validatorul
  - Dacă `validators.len() >= threshold[type_id]`: mint ESDT tokenuri pentru assignee

**Evenimente + NFT:**
- `createEvent(name_hash, metadata_hash, image_ipfs_uri)` → înregistrează + creează NFT collection (canTransfer: false)
- `mintEventNft(event_id, participant_wallet)` → mint NFT per participant — **non-transferabil (SoulBound)**
- Configurabil: supply maxim, metadata URI
- Imaginea NFT stocată pe IPFS (via Pinata) — URI-ul IPFS intră în metadata NFT-ului pe chain

**Certificate:**
- `recordCertificate(volunteer_wallet, cert_hash)` → hash pe chain cu timestamp
- `verifyCertificate(cert_hash) → bool` → endpoint public de verificare

---

## 3. Gas Costs și Relayed Transactions

**Principiu**: Voluntarii plătesc 0 EGLD. Asociația menține un "gas pool" (EGLD în bridge relayer wallet).

**Flux Relayed Transaction:**
```
1. Frontend construiește inner tx (acțiunea voluntarului)
2. Voluntarul semnează inner tx cu PEM din memorie browser
3. Frontend trimite inner tx semnată la blockchain-bridge-api
4. Bridge-api împachetează în relayed tx + semnează cu relayer wallet (≠ utilizator)
5. Relayed tx broadcast la MultiversX → voluntarul = 0 EGLD, asociația plătește
```

**Costuri estimate (MultiversX, preț ~$10/EGLD):**

| Operație | EGLD | USD aprox. |
|---|---|---|
| Emitere token ESDT (one-time per asociație) | 0.05 | ~$0.50 |
| Emitere colecții SFT ×3 (la înregistrare) | 0.15 | ~$1.50 |
| Deploy AssociationManager + ActivityEvent | ~0.02 | ~$0.20 |
| Schimbare status voluntar | ~0.002 | ~$0.02 |
| Înregistrare activitate pe chain | ~0.002 | ~$0.02 |
| Validare activitate (per validator) | ~0.001 | ~$0.01 |
| Vot on-chain (per vot) | ~0.001 | ~$0.01 |
| Mint NFT eveniment (per participant) | ~0.005 | ~$0.05 |
| **Total anual ≈ 100 voluntari, 10 events** | **~5 EGLD** | **~$50/an** |

**Pentru dizertație:** MultiversX **Devnet** (EGLD gratuit din faucet, 0 cost real).
**Pentru producție:** Asociația topping-up relayer wallet periodic cu EGLD.

---

## 4. Ce stă On-chain vs Off-chain

### On-chain (MultiversX)
- Registry asociații (name hash, SC addresses)
- SFT balances cu atribute (status/rol voluntari, timeline)
- Activity hashes + validation records
- ESDT token balances
- NFT ownership per eveniment
- Sesiuni vot + voturi individuale (fiecare vot = tx)
- Election result finalizat
- Certificate hashes

### Off-chain (PostgreSQL)
- Conturi users (email, pw hash, wallet address)
- Date personale (nume, gen, mărimi, facultate etc.)
- Descrieri complete activități + cerințe
- Detalii complete evenimente + echipe
- Certificate PDF-uri generate
- Logs audit aplicație
- Istoric notificări

---

## 5. Autentificare

```
Email + parolă → JWT   →  acțiuni off-chain (CRUD, dashboards)
PEM în memorie browser →  acțiuni on-chain (signed → relayed tx)

1. Login email+pw → JWT (15min) + refresh token (httpOnly cookie, 7 zile)
2. Prima acțiune blockchain → UI afișează modal "Conectează wallet"
3. PEM uploadat → decodat în browser → Zustand store (memorie JS heap)
   ↳ Nu se trimite la server. Nu în localStorage. Nu în cookie.
4. Backend creează inner tx → frontend semnează cu sdk-core + PEM din memorie
5. Frontend trimite inner tx semnată la blockchain-bridge → relayed tx → broadcast
6. Logout / 30min inactivitate → Zustand cleared → PEM dispărut din memorie
```

---

## 5b. Permissions System (doar `main` branch — Dizertație)

Sistemul de permisiuni permite acordarea de drepturi specifice voluntarilor fără a le atribui un rol complet. Rolul acordă un set de permisiuni implicite, iar admin-ul poate acorda/revoca permisiuni individuale suplimentare.

### Permisiuni disponibile

```
CREATE_ACTIVITY       — poate crea activități
VALIDATE_ACTIVITY     — poate valida activitățile altora
CREATE_EVENT          — poate crea și gestiona evenimente
MANAGE_MEMBERS        — poate adăuga/modifica voluntari
CREATE_VOTE           — poate crea sesiuni de vot
VIEW_REPORTS          — poate vedea rapoarte și statistici
ISSUE_CERTIFICATE     — poate genera certificate
MANAGE_ROLES          — poate atribui/revoca roluri
```

### Permisiuni implicite per rol (definite în cod, nu în DB)

```
PRESIDENT   → toate permisiunile
VP          → CREATE_ACTIVITY, VALIDATE_ACTIVITY, CREATE_EVENT, CREATE_VOTE, VIEW_REPORTS
DM          → CREATE_ACTIVITY, VALIDATE_ACTIVITY, CREATE_EVENT, VIEW_REPORTS
PM          → CREATE_EVENT, VIEW_REPORTS
ACTIVE_VOL. → VIEW_REPORTS
JUNIOR      → (nicio permisiune implicită)
```

### Permisiuni individuale (override per user)

Un admin poate acorda unei Active Volunteer permisiunea `CREATE_ACTIVITY` fără a-l face DM:

```sql
CREATE TABLE user_permissions (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL,
  assoc_id     UUID NOT NULL,
  permission   VARCHAR(50) NOT NULL,
  granted_by   UUID NOT NULL,
  granted_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,           -- NULL = permanent
  is_revoked   BOOLEAN DEFAULT FALSE
);
```

### Verificare în API (NestJS Guard)

```
request → JWT middleware → PermissionsGuard('@CanDo(CREATE_ACTIVITY)')
  → rolul userului include permisiunea implicit?  → allow
  → user_permissions are un grant valid?          → allow
  → altfel                                        → 403 Forbidden
```

Custom decorator `@CanDo('PERMISSION_KEY')` reutilizabil pe orice endpoint.

---

## 6. Microservicii Backend

```
services/
├── api-gateway/               ← routing, JWT validation, rate limiting, CORS
├── auth-service/              ← email/pw, JWT, wallet linking
├── association-service/       ← CRUD asociații, departamente, member profiles (date personale)
├── role-service/              ← roluri, interacțiune AssociationManager SC
├── activity-service/          ← CRUD activități, hash on-chain, validare workflow
├── event-service/             ← CRUD evenimente, echipe, NFT coordination
├── vote-service/              ← calculare eligibili, creare sesiune on-chain, UI results
├── certificate-service/       ← generare PDF, hash on-chain, verificare publică (no auth)
├── blockchain-bridge-listener/← singleton: SC events → sync off-chain DB + Redis cache
├── blockchain-bridge-api/     ← N replici: build inner tx, wrap relayed tx, broadcast
└── notification-service/      ← email + in-app, async via RabbitMQ
```

**Comunicare:**
- Sincronă: REST HTTP prin API Gateway
- Asincronă: RabbitMQ (ex: `activity.validated` → notification + bridge)

---

## 7. Frontend

**Stack**: Next.js 14 App Router + TypeScript, `@multiversx/sdk-core`, TailwindCSS + shadcn/ui, TanStack Query, Zustand.

Pagini principale:
- Public: landing, `/verify/:cert_hash` (fără auth)
- Auth: login, register
- Dashboard: asociații, voluntari, activități, evenimente, voturi, certificate, profil

---

## 8. Diagrama Arhitectură

```
┌─────────────────────────────────────────────────────────────────────┐
│                          INTERNET / BROWSER                         │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  Next.js Frontend                            │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │  │
│  │  │ UI Pages │  │ TanStack     │  │ Zustand Store          │ │  │
│  │  │(shadcn/ui│  │ Query (REST) │  │ PEM în memorie (heap)  │ │  │
│  │  │+Tailwind)│  │              │  │ User state             │ │  │
│  │  └──────────┘  └──────┬───────┘  └──────────┬─────────────┘ │  │
│  │                       │                      │               │  │
│  │              ┌────────▼──────────────────────▼──────────┐    │  │
│  │              │   @multiversx/sdk-core (tx signing)      │    │  │
│  │              └───────────────────────────────────────────┘    │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                             │ HTTPS                              │
└─────────────────────────────┼──────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────┐
│                     KUBERNETES CLUSTER                             │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │           NGINX Ingress Controller                          │  │
│  └──────────────────────┬──────────────────────────────────────┘  │
│                         │                                          │
│  ┌──────────────────────▼──────────────────────────────────────┐  │
│  │           API Gateway (NestJS) [HPA: N replici]             │  │
│  │     JWT validation · Rate limiting · Routing · CORS         │  │
│  └──┬──────┬───────┬────────┬────────┬───────┬────────┬────────┘  │
│     │      │       │        │        │       │        │           │
│  ┌──▼─┐ ┌──▼──┐ ┌──▼──┐ ┌──▼──┐ ┌───▼─┐ ┌──▼──┐ ┌───▼───┐      │
│  │auth│ │assoc│ │role │ │activ│ │event│ │vote │ │certif.│      │
│  │svc │ │ svc │ │ svc │ │ svc │ │ svc │ │ svc │ │  svc  │      │
│  │[N] │ │ [N] │ │ [N] │ │ [N] │ │ [N] │ │ [N] │ │  [N]  │      │
│  └──┬─┘ └──┬──┘ └──┬──┘ └──┬──┘ └───┬─┘ └──┬──┘ └───┬───┘      │
│     │      │       │        │        │       │        │           │
│  ┌──▼──────▼───────▼────────▼────────▼───────▼────────▼────────┐ │
│  │              PostgreSQL Cluster (per-service schemas)        │ │
│  │  auth_db │ assoc_db │ role_db │ activity_db │ event_db │ ... │ │
│  │                   + PgBouncer connection pooling            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌─────────────────┐  ┌───────────────────────────────────────┐   │
│  │  Redis Cluster  │  │         RabbitMQ                      │   │
│  │ (blockchain     │  │  activity.validated → notif + bridge  │   │
│  │  state cache,   │  │  vote.finalized → role-svc + bridge   │   │
│  │  rate limits)   │  │  event.closed → NFT mint trigger      │   │
│  └─────────────────┘  └───────────────────────────────────────┘   │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              notification-service [HPA]                     │  │
│  │              email (SMTP) + in-app notifications            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐   │
│  │ blockchain-bridge-api [N]    │  │ blockchain-bridge-       │   │
│  │ · Build inner tx             │  │ listener [1 POD ONLY]    │   │
│  │ · Wrap Relayed tx            │  │ · SC event polling       │   │
│  │ · Broadcast signed tx        │  │ · Sync off-chain DB      │   │
│  │ · Query MultiversX API       │  │ · Invalidate Redis cache │   │
│  └──────────────┬───────────────┘  └───────────┬──────────────┘   │
│                 │                              │                   │
│  ┌──────────────▼──────────────────────────────▼──────────────┐   │
│  │              Grafana + Prometheus + Loki                    │   │
│  │         Promtail DaemonSet (colectare logs din pods)        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ RPC / REST API
┌────────────────────────────────▼───────────────────────────────────┐
│                    MULTIVERSX NETWORK                              │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  PlatformFactory SC         (global, una singura instanta)  │  │
│  │  · registry asociatii       · deploy per-assoc SC pairs     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌───────────────────────┐    ┌───────────────────────────────┐   │
│  │  AssociationManager SC│    │     ActivityEvent SC          │   │
│  │  (per asociatie)      │    │     (per asociatie)           │   │
│  │                       │    │                               │   │
│  │ · SFT status (Junior, │    │ · Activity hashes             │   │
│  │   Active, Alumni,     │    │ · Multi-source validation     │   │
│  │   Community)          │    │ · ESDT token minting          │   │
│  │ · SFT roluri (Pres,   │    │ · Event NFT collections       │   │
│  │   VP, DM, Sec...)     │    │ · Certificate hashes          │   │
│  │ · Voting on-chain     │    │                               │   │
│  │ · ESDT token issuance │    │                               │   │
│  └───────────────────────┘    └───────────────────────────────┘   │
│                                                                    │
│  NATIVE PROTOCOL: ESDT token balances · NFT ownership             │
└────────────────────────────────────────────────────────────────────┘
```

---

## 9. Diagrama de Flux — Validare Activitate (End-to-End)

```
COORDINATOR                 FRONTEND              API GATEWAY          ACTIVITY-SVC
     │                         │                       │                     │
     │  Creează activitate     │                       │                     │
     ├────────────────────────►│                       │                     │
     │                         │  POST /activities     │                     │
     │                         ├──────────────────────►│                     │
     │                         │                       │  Salvează detalii   │
     │                         │                       ├────────────────────►│
     │                         │                       │                     │ Calculează hash
     │                         │                       │                     │ keccak256(data)
     │                         │                       │◄────────────────────┤
     │                         │  inner_tx nesemnată   │                     │
     │                         │◄──────────────────────┤                     │
     │  Modal: "Semnează tx"   │                       │                     │
     │◄────────────────────────┤                       │                     │
     │  Semnează cu PEM        │                       │                     │
     ├────────────────────────►│                       │                     │
     │                         │  inner_tx semnată     │                     │
     │                         ├──────────────────────►│                     │
     │                         │                       │
     │                         │              BLOCKCHAIN-BRIDGE-API
     │                         │                       │
     │                         │        Relayed tx     │
     │                         │        (bridge pays   │
     │                         │         gas)          │
     │                         │                       ├──────────────────────────────────►
     │                         │                       │                     MULTIVERSX SC
     │                         │                       │                     ActivityEvent
     │                         │                       │                     .createActivity(hash)
     │                         │                       │◄──────────────────────────────────
     │                         │  activity_id          │                     │
     │   "Activitate creată"   │◄──────────────────────┤                     │
     │◄────────────────────────┤                       │                     │

        ↓ RabbitMQ: activity.created → notification-service → email validatori

VALIDATOR 1                 FRONTEND              API GATEWAY          ACTIVITY-SVC
     │                         │                       │                     │
     │  Aprobă activitate      │                       │                     │
     ├────────────────────────►│                       │                     │
     │                         │  POST /activities/:id/validate              │
     │                         ├──────────────────────►├────────────────────►│
     │                         │  inner_tx nesemnată   │                     │
     │                         │◄──────────────────────┤                     │
     │  Semnează cu PEM        │                       │                     │
     ├────────────────────────►│                       │                     │
     │                         │  inner_tx semnată → relayed tx → BROADCAST  │
     │                         │                       │                     │
     │                         │                       │              MULTIVERSX SC
     │                         │                       │              .validateActivity()
     │                         │                       │              validators: [V1]
     │                         │                       │              threshold: 2 → NU ÎNCĂ

        [VALIDATOR 2 face același flux...]
        [SC: validators: [V1, V2] → threshold atins!]
        [SC: mint ESDT tokens → wallet voluntar]
        [SC: emit event ActivityValidated(id, volunteer, amount)]

                                                  BLOCKCHAIN-BRIDGE-LISTENER (singleton)
                                                       │
                                              Prinde event ActivityValidated
                                                       │
                                              ┌────────▼──────────────────────┐
                                              │ Actualizează activity_db:     │
                                              │   status = VALIDATED          │
                                              │ Actualizează Redis cache:     │
                                              │   token_balance[volunteer]    │
                                              └────────┬──────────────────────┘
                                                       │ RabbitMQ: activity.validated
                                              ┌────────▼──────────────────────┐
                                              │ notification-service:         │
                                              │ email → voluntar              │
                                              │ "Activitate validată! Ai      │
                                              │  primit X tokenuri."          │
                                              └───────────────────────────────┘
```

---

## 10. Diagrama de Flux — Voting On-chain

```
ADMIN                       FRONTEND              VOTE-SVC         ASSOC-MANAGER SC
  │                            │                     │                    │
  │  Inițiază sesiune vot      │                     │                    │
  ├───────────────────────────►│                     │                    │
  │                            │  POST /votes/init   │                    │
  │                            ├────────────────────►│                    │
  │                            │                     │ Query on-chain:    │
  │                            │                     │ cine are Active SFT│
  │                            │                     ├───────────────────►│
  │                            │                     │◄───────────────────┤
  │                            │                     │ [wallet1, wallet2, ...]
  │   Afișează lista eligibili │                     │                    │
  │◄───────────────────────────┤                     │                    │
  │   Ajustează lista          │                     │                    │
  │   (+ adaugă / - elimină)   │                     │                    │
  ├───────────────────────────►│                     │                    │
  │   Confirmă & semnează tx   │                     │                    │
  ├───────────────────────────►│                     │                    │
  │                            │  inner_tx → relayed tx → BROADCAST       │
  │                            │                     │                    │
  │                            │              .createVotingSession(        │
  │                            │               candidates[],              │
  │                            │               eligible_voters[],         │
  │                            │               deadline, quorum)          │
  │                            │                     │◄───────────────────┤
  │   "Sesiune creată, ID: 42" │                     │  session_id = 42   │
  │◄───────────────────────────┤                     │                    │

        [Voluntarii eligibili primesc notificare prin email]

VOTER                       FRONTEND                               ASSOC-MANAGER SC
  │  Votează candidatul X      │                                         │
  ├───────────────────────────►│                                         │
  │                            │  inner_tx semnată cu PEM → relayed tx → │
  │                            │       .castVote(42, candidate_X)        │
  │                            │  SC verifică: eligible? nu a mai votat? │
  │                            │                                         │
  │   "Vot înregistrat"        │                                         │
  │◄───────────────────────────┤                                         │

        [La deadline sau stopSession()]
        .finalizeSession(42)
        → SC numără voturi → winner = candidat_X
        → transferRole(old_president, candidat_X, PRESIDENT)
        → Update SFT atribute: old_president SFT → {status: "past"}
        → Mint SFT nou la candidat_X: {status: "current", role: "president"}
        → Emit event: VoteFinalized(42, candidat_X, votes_count)

                                              BRIDGE-LISTENER prinde VoteFinalized
                                                → actualizează role_db
                                                → notifică noul Președinte
```

---

## 11. Repository Structure (Monorepo)

```
Blockchain-Volunteering-Platform/
├── smart-contracts/
│   ├── platform-factory/       ← Rust, mx-sdk-rs
│   ├── association-manager/    ← Rust, mx-sdk-rs
│   └── activity-event/         ← Rust, mx-sdk-rs
├── services/
│   ├── api-gateway/
│   ├── auth-service/
│   ├── association-service/
│   ├── role-service/
│   ├── activity-service/
│   ├── event-service/
│   ├── vote-service/
│   ├── certificate-service/
│   ├── blockchain-bridge-listener/
│   ├── blockchain-bridge-api/
│   └── notification-service/
├── frontend/
├── shared/
│   └── types/                  ← TypeScript DTOs + RabbitMQ event types
└── infra/
    ├── docker-compose.yml      ← local dev complet
    ├── k8s/
    │   ├── helm/               ← Helm chart per serviciu
    │   └── hpa/                ← HPA configs
    └── monitoring/
        ├── prometheus/
        ├── grafana/
        └── loki/
```

---

## 11b. NFT Image Storage (IPFS via Pinata)

Toate NFT-urile și tokenurile primite de voluntari sunt **non-transferabile** (`canTransfer: false` la emitere). Voluntarii le pot deține și vizualiza, dar nu le pot trimite altora.

Pe blockchain se stochează doar **URI-ul** imaginii, nu imaginea în sine. Imaginile NFT sunt stocate pe **IPFS via Pinata** (free tier: 1GB, suficient pentru proiect).

### Flux upload imagine NFT (la crearea unui eveniment)

```
1. Admin completează formularul de eveniment în frontend
   → selectează imaginea NFT (PNG/JPG, max 5MB)

2. Frontend trimite imaginea la event-service (multipart/form-data)

3. event-service uploadează imaginea la Pinata API:
   POST https://api.pinata.cloud/pinning/pinFileToIPFS
   → răspuns: { IpfsHash: "QmXxx..." }

4. event-service construiește metadata JSON pentru NFT:
   {
     "name": "Event Name 2024",
     "description": "Participation in Event X organized by Association Y",
     "image": "ipfs://QmXxx.../image.png",
     "attributes": [{ "year": "2024", "association": "AssocName" }]
   }
   → uploadează și metadata JSON pe IPFS → obține CID metadata

5. La createEvent pe SC:
   ActivityEvent.createEvent(name_hash, metadata_hash, "ipfs://QmMetadata...")
   → NFT collection creată cu URI = ipfs://QmMetadata...
   → canTransfer: false (SoulBound)

6. La mintEventNft: NFT-ul din wallet-ul voluntarului conține URI-ul IPFS
   → orice aplicație (MultiversX Explorer, wallet) afișează imaginea automat
```

### Configurare Pinata în backend

```
PINATA_API_KEY=...        # în Kubernetes Secret / .env local
PINATA_API_SECRET=...
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs/
```

**Fallback local (dev)**: în dezvoltare locală, imaginile pot fi stocate în `/uploads` pe `event-service` și servite ca `http://localhost:3004/uploads/event-img.png`. Înlocuite cu IPFS URI înainte de demo/producție.

---

## 12. Scalare Kubernetes

```
Stateless services (auth, activity, event, vote, certificate, association, role):
  HPA: min 1 / max 10 replici, trigger CPU > 70%

blockchain-bridge-api: HPA normal (N replici, stateless)
blockchain-bridge-listener: 1 replică SINGLETON (nu duplicate events)

PostgreSQL: PgBouncer connection pooler + read replicas pentru servicii read-heavy
Redis: Redis Cluster (3 noduri) pentru HA
RabbitMQ: cluster cu queues durable

Ingress: NGINX Ingress Controller
Secrets: Kubernetes Secrets (dev) / HashiCorp Vault (producție)

Logging: Promtail DaemonSet → Loki → Grafana
Metrici: Prometheus scrape endpoints → Grafana dashboards
```

---

## 13. Ordine de Implementare (Faze)

> **Strategie**: Un singur repository, două branch-uri cu date izolate.
> Branch-ul `voting` = aplicație full funcțională, livrabil complet pentru Proiectul Voting.
> Branch-ul `main` = creat din `voting` + extins pentru Dizertație.

---

### ▶ BRANCH: `voting` — Full functional, livrabil independent

**Scopul aplicației pe acest branch:**

```
Frontend (6 pagini):
  1. Login (email + parolă)
  2. Înrolare asociație (creare + admin wallet linking)
  3. Înrolare voluntar / Listă voluntari (asociați la o asociație)
  4. Profil utilizator (info + wallet asociat)
  5. Pagina/modala de voting (creare sesiune, selectare/deselectare participanți, vot activ)
  6. Pagina de rezultate (sesiuni finalizate, câștigător, număr voturi)

Roluri: un singur rol Admin (owner-ul asociației)
        → doar Admin poate crea sesiuni de vot
        → toți voluntarii înrolați pot vota

SC (AssociationManager simplificat — fără SFT/NFT/ESDT):
  registerAssociation(name)         → caller devine admin
  registerMember(wallet)            → admin adaugă voluntar
  createVotingSession(candidates[], eligible_voters[], deadline, quorum)
  castVote(session_id, candidate)
  stopSession(session_id)
  finalizeSession(session_id)

Servicii backend:
  auth-service          — email/pw, JWT
  association-service   — CRUD asociație, înrolare voluntari, Listă membri
  vote-service          — calcul eligibili, creare sesiune, rezultate
  blockchain-bridge     — build inner tx, Relayed tx, broadcast, event listener

DB: PostgreSQL (vote_db, un singur schema), Redis
Docker volumes: COMPOSE_PROJECT_NAME=voting → voting_postgres_data, voting_redis_data
```

#### Faza 1 — Setup + Infrastructură (`voting` branch)
- [x] Inițializare monorepo, creare branch `voting`
- [x] `.env` cu `COMPOSE_PROJECT_NAME=voting`
- [x] `docker-compose.yml`: PostgreSQL 16, Redis 7, 4 servicii NestJS, frontend Next.js; healthchecks + mount PEM bridge wallet
- [x] `auth-service`: email/pw, JWT issue/refresh, wallet linking
- [x] Shared types package

#### Faza 2 — Smart Contract (`voting` branch)
- [x] `AssociationManager SC` (versiunea simplificată, extinsă cu multi-choice):
  - `registerAssociation(name)` → caller = admin; returnează `assoc_id`; emite `associationRegistered`
  - `registerMember(assoc_id, wallet)` → admin only
  - `createVotingSession(assoc_id, title, deadline, quorum, max_choices, candidates[], voters[])` → admin only; returnează `session_id`; emite `sessionCreated`
  - `castVote(assoc_id, session_id, candidate_wallets[])` → eligible voter only; suport multi-choice
  - `stopSession(assoc_id, session_id)` → admin only (urgențe)
  - `finalizeSession(assoc_id, session_id)` → oricine, după deadline/stop
- [x] Build WASM zero erori, deploy pe Devnet
- [x] Evenimente verificate pe Devnet Explorer
- [ ] Tests în Rust VM sandbox (opțional — skipped; acoperit de E2E pe Devnet)

#### Faza 3 — Servicii + Frontend (`voting` branch)
- [x] `association-service`: CRUD asociație, înrolare voluntari, listă membri, sc-sync bridge endpoint
- [x] `vote-service`: creare sesiune cu maxChoices, syncScId intern, deleteUnpublishedSession, recordVote multi-choice, getResults cu totalEligible/totalVoted
- [x] `blockchain-bridge`: build inner tx + Relayed tx + broadcast; rezolvare robustă ID (event parsing + polling fallback); buildCreateSessionTx, buildStopSessionTx, shard-aware relayed vote, finalizeSession bridge-signed
- [x] Frontend complet (6 pagini + funcționalități extinse):
  - Flux admin: login → înrolare asociație (on-chain) → adăugare voluntari → creare sesiune vot cu multi-choice + selecție candidați/electori cu "Select all" → urmărire progres + close-early → rezultate cu pie chart
  - Flux voter: login → profil (wallet linking) → pagina vot → modal selecție single/multi choice → semnare cu PEM → confirmare
- [x] `lib/datetime.ts` — timezone-safe datetime handling
- [x] `lib/wallet.ts` — browser-safe PEM parse + sign cu zero-padding fix

> **Livrabil `voting` branch**: ✅ aplicație full funcțională pe Devnet, pornibilă cu `docker compose up`, testată end-to-end

---

### ▶ BRANCH: `main` — Dizertație (creat din `voting`, extins)

```bash
# Creare branch main din voting (după finalizarea voting branch)
git checkout voting
git checkout -b main
```

`.env` pe `main`: `COMPOSE_PROJECT_NAME=platform` → `platform_postgres_data`, `platform_redis_data`

#### Faza 4 — AssociationManager SC Extins + SC-uri Noi (`main` branch)
- [ ] Extinde `AssociationManager SC` cu:
  - SFT SoulBound status voluntari (Junior/Active/Alumni/Community) cu atribute istorice
  - SFT SoulBound roluri (President/VP/DM/Secretary/PM/Mentor) cu istoric mandate
  - ESDT token issuance per asociație
  - Voting extins: eligibilitate bazată pe SFT status (Active SFT holders)
- [ ] `ActivityEvent SC`: activități, validare multi-sursă, NFT events, certificate hashes
- [ ] `PlatformFactory SC`: factory deploy pair per asociație
- [ ] Tests + deploy pe localnet

#### Faza 5 — Servicii Core Extinse (`main` branch)
- [ ] `blockchain-bridge-listener` (singleton): SC event listener + Redis cache invalidation
- [ ] Extinde `blockchain-bridge-api` cu Relayed Transactions complete
- [ ] Extinde `association-service`: departamente, member profiles complete, date personale
- [ ] `role-service`: ierarhie completă roluri, interacțiune SFT SC
- [ ] `activity-service`: CRUD activități, hash on-chain, validare multi-sursă
- [ ] `api-gateway`: routing complet + PermissionsGuard (`@CanDo()` decorator)
- [ ] **Permissions system**: `user_permissions` table + Guard + rol-permisiune mapping
- [ ] Frontend: dashboard complet + activități + roluri + permisiuni

#### Faza 6 — Evenimente + NFT (`main` branch)
- [ ] `event-service`: CRUD evenimente, echipe, NFT issuance
- [ ] Frontend: management evenimente, participanți, vot integrat cu SFT eligibilitate

#### Faza 7 — Certificate + Profil + Notificări (`main` branch)
- [ ] `certificate-service`: PDF generation + hash on-chain + verificare publică
- [ ] `notification-service`: email + in-app via RabbitMQ
- [ ] Frontend: profil voluntar complet (SFT timeline, tokenuri, NFT-uri, certificate)

#### Faza 8 — Infra + Polish (`main` branch)
- [ ] Kubernetes Helm charts per serviciu
- [ ] HPA configs + teste autoscaling
- [ ] Grafana dashboards (metrici + logs Loki)
- [ ] Testing E2E (Playwright + Devnet)
- [ ] Load testing (k6) pentru validarea autoscaling

---

## 14. Verificare (Testing Strategy)
- **SC**: mx-sdk-rs Rust VM sandbox (unit + integration), deploy pe localnet
- **Services**: Jest unit tests, supertest integration tests
- **E2E**: Playwright pe frontend + MultiversX Devnet
- **Load**: k6 pentru autoscaling validation
