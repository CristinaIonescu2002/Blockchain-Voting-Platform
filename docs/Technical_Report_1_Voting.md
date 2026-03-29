# Blockchain-based Voting Systems: A Consensus Approach — Technical Report 1

> **PDF filename**: `Ionescu_Cristina-Phase1-DA.pdf`
> **Notă**: Conținut calibrat pentru Phase 1 — "Clarity of understanding and initial planning".
> Setup detaliat și screenshots sunt rezervate pentru Phase 3.

---

# Section 1: Introduction

## 1.1 Chosen Solution

This project implements a **complete, on-chain voting system for organizational governance**, built on the MultiversX blockchain. The system allows an organization to register members, create voting sessions with a defined list of eligible participants, collect votes as signed blockchain transactions, and automatically determine and record the outcome — all enforced by a smart contract with no possibility of external manipulation.

The result is a fully functional web application covering the entire flow: organization setup, member management, session creation, voting, and result visualization.

> This project represents a core and independently deliverable component of a larger ongoing work: *"Blockchain Platform for Monitoring and Certifying Volunteer Activities in Student Associations"* — my diploma thesis. The voting system described here constitutes a fully functional, self-contained module that will be directly integrated and extended within that broader platform. Developing it as a standalone deliverable allows for thorough design and validation of the voting mechanism before it is embedded in the complete system.

## 1.2 Problem Statement

Governance processes in organizations — particularly student associations — typically rely on manual or centralized voting mechanisms: paper ballots, Google Forms, or basic digital polls. These approaches share critical limitations:

- **Lack of transparency**: There is no auditable record of who was eligible to vote, who actually voted, and what the tally was at any point in time
- **Vulnerability to manipulation**: An administrator can alter vote counts, add or remove eligible voters after the fact, or extend deadlines without any verifiable record of the change
- **No external verifiability**: Third parties cannot independently confirm that a vote took place, that its rules were followed, or that the announced result matches the actual votes cast
- **No automated consequence enforcement**: Results are announced manually, introducing a gap between the declared outcome and the actual system state

## 1.3 Proposed Solution

The proposed system addresses these limitations by encoding the complete logic of a voting session into a smart contract deployed on a public blockchain:

- Once a session is created, its parameters (eligible voters, candidates, deadline, quorum) are immutably recorded on-chain
- Every vote is a signed blockchain transaction from the voter's own wallet address, permanently stored in the ledger
- The result is computed deterministically by the contract — no administrator can alter it
- Any external party can independently verify the entire history of a session: who was eligible, who voted for whom, and what the final outcome was

The system is built as a complete web application with the following user-facing flows:

- **Admin flow**: register organization → add members → create a voting session (with a reviewable, adjustable participant list) → monitor progress → view result
- **Voter flow**: log in → profile → active voting sessions → sign and cast vote → view result

---

# Section 2: Technical Specifications

## 2.1 Blockchain: MultiversX

**Choice**: MultiversX (formerly Elrond)

MultiversX is a public, sharded blockchain with low and predictable transaction costs. It was selected over alternatives for the following reasons:

| Criterion | MultiversX | Ethereum | Solana |
|---|---|---|---|
| Transaction cost | ~$0.001 | ~$1–50 | ~$0.0001 |
| Smart contract language | Rust | Solidity | Rust |
| Throughput | ~15,000 TPS (sharded) | ~15 TPS | ~65,000 TPS |
| SDK support (JS/TS) | Official, well-documented | Very mature | Good |
| Relayed transactions | Natively supported | Via meta-tx standards | Limited |

The low and predictable transaction cost is decisive: each vote costs approximately $0.001, making on-chain voting economically viable without institutional funding. Ethereum was excluded due to prohibitive gas costs for per-vote transactions.

**Network for development and testing**: MultiversX Devnet — a public test network with free test tokens available from a faucet, at no real cost.

## 2.2 Smart Contract Language: Rust + mx-sdk-rs

Smart contracts on MultiversX are written in **Rust**, compiled to WebAssembly (WASM) and executed by the MultiversX VM.

The official **mx-sdk-rs** framework provides:
- Procedural macros for defining contract endpoints, storage, and events
- A built-in Rust VM sandbox for unit and integration testing without deploying to a network
- Automatic ABI generation from annotated Rust code

Rust was chosen for its memory safety guarantees and strong type system, which eliminate entire classes of common smart contract vulnerabilities at compile time.

## 2.3 Backend: NestJS + TypeScript

- **NestJS** (Node.js) with TypeScript for all backend services
- **@multiversx/sdk-core**: official TypeScript library for building and broadcasting transactions, querying contract state, and decoding on-chain events
- **Relayed Transactions**: voters sign their vote locally (client-side); the backend bridge wraps it in a relayed transaction and pays the gas fee on behalf of the voter — voters need 0 EGLD
- **PostgreSQL**: off-chain storage for session metadata, member profiles, and UI state
- **Redis**: cache for on-chain state to reduce RPC call frequency

## 2.4 Frontend: Next.js + TypeScript

- **Next.js 14** (App Router) with TypeScript
- **@multiversx/sdk-core** for client-side transaction signing
- Voter's PEM file is loaded into browser memory only; it is never transmitted to the server and is cleared on logout or session timeout
- **TailwindCSS + shadcn/ui** for UI components
- **TanStack Query** for server state management

**Application pages:**
1. Login (email + password)
2. Organization enrollment (create organization, link admin wallet)
3. Member enrollment + member list (add members, view all members of an organization)
4. User profile (personal info + linked wallet address)
5. Voting page / modal (create session with participant selection, active vote view, cast vote)
6. Results page (finalized sessions, winner, vote breakdown)

## 2.5 Development Environment

- **Rust** toolchain + `wasm32-unknown-unknown` compilation target
- **mxpy** (MultiversX CLI) for contract compilation, deployment, and direct interaction
- **sc-meta** (mx-sdk-rs scaffolding tool) for contract project initialization
- **Docker Compose** for local backend services (PostgreSQL, Redis)
- **MultiversX Devnet** for contract deployment and end-to-end testing

---

# Section 3: Initial Design

## 3.1 System Architecture

The system is organized into three layers:

```
┌─────────────────────────────────────────────────────────┐
│                  BROWSER (Admin / Voter)                │
│                                                         │
│  Next.js (6 pages)                                      │
│  · TanStack Query — REST calls to backend               │
│  · Zustand store — PEM key in memory (never persisted)  │
│  · @multiversx/sdk-core — sign transactions locally     │
└────────────────────────────┬────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────┐
│                     BACKEND SERVICES                    │
│                                                         │
│  auth-service          — registration, login, JWT       │
│  association-service   — org management, member list    │
│  vote-service          — session lifecycle, eligibility │
│  blockchain-bridge     — build txs, Relayed tx, events  │
│                                                         │
│  PostgreSQL (sessions, members, orgs)                   │
│  Redis (on-chain state cache)                           │
└────────────────────────────┬────────────────────────────┘
                             │ RPC / REST
┌────────────────────────────▼────────────────────────────┐
│                  MULTIVERSX DEVNET                      │
│                                                         │
│  VotingContract (AssociationManager SC)                 │
│  · registerAssociation   · registerMember               │
│  · createVotingSession   · castVote                     │
│  · stopSession           · finalizeSession              │
└─────────────────────────────────────────────────────────┘
```

## 3.2 Smart Contract Design

The `VotingContract` (AssociationManager SC) manages organization setup, member registration, and the complete voting session lifecycle in a single contract.

**Roles**: one role only — **Admin** (the wallet that calls `registerAssociation` becomes the admin). All other registered members are voters.

**Endpoints:**

| Endpoint | Caller | Description |
|---|---|---|
| `registerAssociation(name)` | Anyone | Creates organization; caller becomes admin |
| `registerMember(wallet)` | Admin | Adds a member by wallet address |
| `createVotingSession(candidates[], eligible_voters[], deadline, quorum)` | Admin | Locks session parameters on-chain |
| `castVote(session_id, candidate)` | Eligible voter | Verifies eligibility + uniqueness, records vote |
| `stopSession(session_id)` | Admin | Closes session early (emergencies) |
| `finalizeSession(session_id)` | Anyone (post-deadline) | Counts votes, records winner, emits event |

**Validation in `castVote`** (enforced by contract, not backend):
- Caller must be in `eligible_voters` for this session
- Caller must not have already voted in this session
- Session must be in `OPEN` status
- Current timestamp must be before `deadline`

**On-chain events emitted:**
- `VoteCast(session_id, voter_address, candidate_address)` — on each successful vote
- `VoteFinalized(session_id, winner_address, total_votes, quorum_reached)` — on finalization

All votes and results are permanently recorded and publicly verifiable on the MultiversX Devnet explorer.

## 3.3 Voting Session Flow

```
ADMIN                    FRONTEND             VOTE-SERVICE        CONTRACT (on-chain)
  │ Create session           │                     │                      │
  ├────────────────────────► │                     │                      │
  │                          │─── POST /sessions ──►                      │
  │                          │ ◄── unsigned tx ────┤                      │
  │  Sign with PEM (browser) │                     │                      │
  ├────────────────────────► │                     │                      │
  │                          │── signed → Relayed tx (bridge pays gas) ──►│
  │                          │                     │  createVotingSession │
  │  "Session 1 created"     │◄────────────────────┼──────────────────────┤
  │◄─────────────────────────┤                     │                      │

VOTER                    FRONTEND                            CONTRACT (on-chain)
  │  Cast vote               │                                      │
  ├────────────────────────► │                                      │
  │                          │◄── unsigned tx (bridge builds) ──────┤
  │  Sign with PEM (browser) │                                      │
  ├────────────────────────► │                                      │
  │                          │──── signed → Relayed tx ────────────►│
  │                          │     castVote(1, candidate_A)         │
  │                          │     SC: eligible? not voted? open?   │
  │  "Vote registered"       │◄─────────────────────────────────────┤
  │◄─────────────────────────┤     emit VoteCast event              │

  [At deadline or stopSession()]
  finalizeSession(1) → winner = candidate_A → emit VoteFinalized
```

## 3.4 Gas Cost Strategy

Each vote is a blockchain transaction. To ensure voters need zero EGLD, the system uses **MultiversX Relayed Transactions**:

1. Voter signs an "inner transaction" (their vote action) using their PEM key, entirely in the browser
2. The blockchain-bridge service wraps it in a relayed transaction signed by a platform wallet
3. The platform wallet pays the gas; the voter pays nothing

Estimated cost per vote: ~0.001 EGLD (~$0.01). For a typical organization with a few hundred votes per year, total gas cost is well under $5/year.

## 3.5 Initial Working Environment

The following tools have been installed and verified:

- Rust toolchain with `wasm32-unknown-unknown` target
- `mxpy` CLI connected to MultiversX Devnet
- `sc-meta` contract scaffolding tool
- Smart contract project initialized from the `empty` mx-sdk-rs template
- Test wallet generated and funded with test EGLD from the Devnet faucet

> **[Screenshot]**: Terminal output of `mxpy --version`, `rustc --version`, `sc-meta --version`

> **[Screenshot]**: MultiversX Devnet Explorer showing funded test wallet (test EGLD balance)

The contract skeleton compiles successfully to WASM, confirming the build toolchain is fully operational. Full contract logic, deployment, and end-to-end testing will be demonstrated in Phase 3.

---

# Section 4: Conclusion

## 4.1 Summary

Phase 1 established a clear foundation for the project:

- The problem is well-defined: centralized voting in organizations lacks transparency, auditability, and tamper-resistance
- MultiversX was selected for its low transaction costs, Rust-based smart contracts, and native support for relayed transactions (enabling zero-cost voting for participants)
- The system architecture is designed around a single `VotingContract` with six endpoints covering the complete lifecycle — from organization setup to result finalization
- The gas cost problem is solved through Relayed Transactions, making the system accessible without requiring voters to hold cryptocurrency
- The application is scoped as a complete, self-contained web platform with six pages covering the full admin and voter experience
- The development environment is operational and ready for implementation

## 4.2 Next Steps

- **Phase 2**: Research and analyze existing blockchain-based voting solutions (academic literature and deployed systems), discussing their approaches, limitations, and how this solution compares
- **Phase 3**: Implement the smart contract in Rust, deploy to Devnet, build all backend services and the full frontend, and demonstrate the complete working application with screenshots and transaction proofs
- **Phase 4**: Performance and security evaluation — gas cost analysis, throughput, resilience to manipulation attempts, and overall assessment of the solution

---

*Ionescu Cristina — Blockchain-based Voting Systems: A Consensus Approach*
*`Ionescu_Cristina-Phase1-DA.pdf`*
