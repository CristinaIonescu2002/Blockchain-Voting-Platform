# Problems Encountered

This document summarizes the main issues encountered while implementing and debugging the voting flow, together with the likely root causes and the fixes that were applied or discussed.

## 1. Smart contract build errors in `association_manager.rs`

### Symptoms
- Rust compilation errors around comparing `ManagedRef` and `ManagedAddress`
- Type inference failures such as:
  - `can't compare ManagedRef ... with ManagedAddress`
  - `type annotations needed`

### Cause
The contract logic for duplicate candidate detection mixed `ManagedRef` values from iterators with owned `ManagedAddress` values.

### Fix
The comparison logic was adjusted to clone concrete `ManagedAddress` values before comparing them.

## 2. `max_choices` missing from the database

### Symptoms
- Creating a voting session failed with:
  - `column "max_choices" of relation "sessions" does not exist`

### Cause
The backend entity and DTOs were updated for multi-choice voting, but the existing Postgres schema was not updated in running environments.

### Fix
- `max_choices` was added to the schema
- `vote-service` was updated to ensure the column exists on module initialization for older local databases

## 3. `bad array length` when calling `createVotingSession`

### Symptoms
- Chain execution failed with:
  - `argument decode error (var args): bad array length`

### Cause
The ABI expected by the smart contract did not match the argument layout produced by the bridge. The original version used multiple variadic groups, which proved fragile.

### Fix
The contract endpoint was redesigned to use:
- fixed arguments for `candidate_count` and `eligible_voter_count`
- one single variadic list of participant addresses

The bridge was updated to encode the call in the same order.

## 4. Relayed vote transactions failed with shard mismatch

### Symptoms
- Vote submission failed with:
  - `transaction generation failed: shard ID missmatch`

### Cause
MultiversX relayed transactions require sender and relayer compatibility at shard level. The bridge wallet and the voter wallet were not always in the same shard.

### Fix
The bridge now:
- uses relayed voting only when shards match
- falls back to direct signed voting when they do not

## 5. Votes were not reflected in the database

### Symptoms
- A vote succeeded on-chain, but `hasVoted` and candidate vote counts were not updated correctly in the local database

### Cause
The bridge decoded candidate addresses incorrectly when parsing signed vote data. A wrong SDK helper was used for hex-to-bech32 conversion.

### Fix
The address decoding was corrected, and vote recording was moved into a transaction so that:
- the voter is marked as having voted
- candidate vote counters are incremented
- duplicate local recording is avoided

## 6. Double voting had to be prevented locally and on-chain

### Symptoms
- A user could still appear eligible to vote again in the app after voting

### Cause
Even though the smart contract prevents double voting, the local session state also needed to reflect the vote immediately and consistently.

### Fix
- `hasVoted` is now updated in the database after confirmed chain success
- the frontend checks local `hasVoted` and hides voting controls afterward

## 7. Sessions needed to finalize early when all eligible voters had voted

### Symptoms
- A session stayed open locally even after all eligible voters had already voted

### Cause
The original local status flow only considered manual finalization or deadline-based finalization.

### Fix
After recording a vote, the backend checks whether all eligible voters have voted. If yes, the session is marked `finalized` locally.

## 8. Unpublished sessions needed to be deletable

### Symptoms
- Sessions that never reached chain publication cluttered the UI and could not be cleaned up safely

### Cause
There was no admin-only delete flow for sessions that had no on-chain identity yet.

### Fix
- Backend delete endpoint added
- UI delete button shown only for admin and only when `scSessionId` is missing

## 9. Final results were not visible after deadline

### Symptoms
- A voting session could be over, but the frontend still did not show final results
- Users had no clear path to trigger result loading

### Cause
Finalization depended on an explicit backend/chain action, but the UI did not guide or trigger it reliably once the deadline passed.

### Fix
The results page was updated so that when the deadline has passed:
- it can trigger finalization
- it can attempt automatic finalization
- it explains why final results are not yet visible

## 10. Deadline confusion between UI and chain

### Symptoms
- The app displayed a deadline that looked valid
- Voting still failed with:
  - `Session deadline has passed`

### Cause
There were two separate problems here:

1. `datetime-local` parsing had to be normalized so local input would map consistently to both:
   - database timestamps
   - on-chain UNIX timestamps

2. More importantly, some sessions were not actually linked to the correct `scSessionId`, so the app was querying the wrong on-chain session and reading the wrong deadline.

### Fix
- Frontend parsing for `datetime-local` was made explicit
- Deadline display was made clearer
- Bridge-side validation now checks on-chain status and deadline before building vote transactions

## 11. `Session is not open` and `Session does not exist`

### Symptoms
- Voting failed with:
  - `Session is not open`
  - later, more explicitly:
  - `View getSessionStatus failed: Session does not exist`

### Root cause
This was the key synchronization problem.

The transaction that created a session on-chain could succeed, but the local database sometimes received the wrong `scSessionId`, or no valid one at all. Because of that:
- vote requests pointed to a non-existent session for that association
- reading `getSessionDeadline` or `getSessionStatus` returned invalid or empty data
- the app then treated the missing deadline as `0`, which produced misleading errors such as:
  - `Session deadline has passed (on-chain deadline: 0, current time: ...)`

### Why this happened
Several low-level integration issues stacked together:
- transaction return values were not always read from the correct response field
- some MultiversX endpoints returned VM query data with different shapes
- nested event names inside transaction logs were base64-encoded and were initially compared as plain text
- relying only on `sessionCount + 1` was too fragile when synchronization lagged

### Fix
The bridge logic was hardened to resolve `scSessionId` using multiple sources:

1. direct smart contract return value
2. transaction logs / operations containing `@6f6b@...`
3. nested `sessionCreated` event decoding
4. fallback polling of `getSessionCount()` after confirmation

Additionally, frontend synchronization was made more defensive by patching the local session immediately when `submit` returns a valid `scSessionId`.

## 12. Most likely final resolved issue

Based on the debugging trail, the most important root cause was not the contract rule for deadline validation itself.

The real issue was the mismatch between:
- the session created on-chain
- the `scSessionId` stored locally
- the parsing of MultiversX transaction/query responses

Once the wrong or missing `scSessionId` entered the local database, every downstream check became misleading:
- status checks
- deadline checks
- result finalization
- delete visibility in the UI

In short:

The system behaved as if the deadline logic was broken, but the deeper problem was that the frontend and bridge were sometimes talking to the wrong on-chain session.
