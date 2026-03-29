# Development Setup Guide

Pași completi pentru a porni aplicația local, de la zero.

---

## Cerințe prealabile

Asigură-te că ai instalat:

| Tool | Versiune minimă | Link |
|---|---|---|
| Node.js | 22+ | https://nodejs.org |
| npm | 11+ | (vine cu Node) |
| Docker Desktop | orice recentă | https://www.docker.com/products/docker-desktop |
| Rust | stable | https://rustup.rs |
| mxpy | orice recentă | `pip install multiversx-sdk-cli` |
| sc-meta | orice recentă | `cargo install multiversx-sc-meta` |

Verificare rapidă:
```bash
node --version      # v22+
docker --version    # Docker version 24+
rustc --version     # rustc 1.85+
mxpy --version      # mxpy x.x.x
sc-meta --version   # x.x.x
```

---

## 1. Clonare & branch

```bash
git clone <repo-url>
cd Blockchain-Volunteering-Platform
git checkout voting
```

---

## 2. Variabile de mediu

```bash
cp .env.example .env
```

`.env` este deja configurat pentru development local. Nu trebuie modificat nimic pentru a porni.

> **Atenție**: Nu comite niciodată fișierul `.env` — este în `.gitignore`.

---

## 3. Smart Contract — compilare & deploy (prima rulare)

### 3.1 Compilare

```bash
cd smart-contracts/association-manager
sc-meta all build
```

Va genera: `output/association_manager.wasm`

### 3.2 Wallet deployer pe Devnet

Dacă nu ai deja un wallet de test:
```bash
mxpy wallet new --format pem --outfile deployer.pem
```

> `deployer.pem` este în `.gitignore` — nu se commitează niciodată.

Încarcă test EGLD din faucet:
- https://devnet-wallet.multiversx.com/faucet

### 3.3 Deploy pe Devnet

```bash
mxpy contract deploy \
  --bytecode output/association_manager.wasm \
  --pem deployer.pem \
  --gas-limit 60000000 \
  --proxy https://devnet-api.multiversx.com \
  --chain D \
  --send
```

Copiază adresa contractului din output și pune-o în `.env`:
```
CONTRACT_ADDRESS=erd1qqqqqqqqqqqqqpgq...
```

---

## 4. Pornire aplicație (Docker)

Din root-ul proiectului:

```bash
docker compose up --build
```

Prima pornire durează 2-3 minute (build imagini). Repornirile ulterioare sunt rapide.

### Servicii disponibile după pornire:

| Serviciu | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Auth Service | http://localhost:3001 |
| Association Service | http://localhost:3002 |
| Vote Service | http://localhost:3003 |
| Blockchain Bridge | http://localhost:3004 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

---

## 5. Development local (fără Docker)

Dacă vrei să rulezi serviciile direct (hot reload):

### PostgreSQL & Redis via Docker (doar infrastructura):
```bash
docker compose up postgres redis
```

### Fiecare serviciu separat (în terminale diferite):

```bash
# auth-service
cd services/auth-service && npm run start:dev

# association-service
cd services/association-service && npm run start:dev

# vote-service
cd services/vote-service && npm run start:dev

# blockchain-bridge
cd services/blockchain-bridge && npm run start:dev

# frontend
cd frontend && npm run dev
```

---

## 6. Comenzi utile

```bash
# Oprire toate containerele
docker compose down

# Oprire + ștergere volume (reset complet baza de date)
docker compose down -v

# Rebuild un singur serviciu
docker compose up --build auth-service

# Logs un singur serviciu
docker compose logs -f vote-service

# Acces direct în baza de date
docker compose exec postgres psql -U voting_user -d voting_db
```

---

## 7. Structura proiectului

```
Blockchain-Volunteering-Platform/   (branch: voting)
├── .env                            ← variabile de mediu (nu se commitează)
├── .env.example                    ← template .env (se commitează)
├── docker-compose.yml              ← orchestrare servicii
├── smart-contracts/
│   └── association-manager/        ← SC Rust (mx-sdk-rs)
├── services/
│   ├── auth-service/               ← NestJS: autentificare
│   ├── association-service/        ← NestJS: asociații & membri
│   ├── vote-service/               ← NestJS: sesiuni de vot
│   └── blockchain-bridge/          ← NestJS: interacțiune blockchain
├── frontend/                       ← Next.js 14
├── shared/types/                   ← tipuri TypeScript comune
└── infra/
    └── postgres/init.sql           ← schema inițială DB
```
