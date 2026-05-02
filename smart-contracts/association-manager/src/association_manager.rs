#![no_std]
#![allow(deprecated)]

#[allow(unused_imports)]
use multiversx_sc::imports::*;

const STATUS_OPEN: u8 = 0;
const STATUS_STOPPED: u8 = 1;
const STATUS_FINALIZED: u8 = 2;

/// AssociationManager — multi-tenant SC pentru proiectul Blockchain Voting.
/// O singură instanță gestionează toate asociațiile (identificate prin assoc_id).
#[multiversx_sc::contract]
pub trait AssociationManager {
    // ─────────────────────────────────────────────────────────────────────────
    // Init / Upgrade
    // ─────────────────────────────────────────────────────────────────────────

    #[init]
    fn init(&self) {}

    #[upgrade]
    fn upgrade(&self) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Association Management
    // ─────────────────────────────────────────────────────────────────────────

    /// Înregistrează o asociație nouă. Caller-ul devine admin.
    /// Returnează assoc_id-ul nou creat (1-based).
    #[endpoint(registerAssociation)]
    fn register_association(&self, name: ManagedBuffer) -> u64 {
        require!(!name.is_empty(), "Association name cannot be empty");

        let id = self.assoc_count().get() + 1;
        self.assoc_count().set(id);
        self.assoc_name(id).set(&name);
        self.assoc_admin(id).set(self.blockchain().get_caller());

        self.association_registered_event(id, &name, &self.blockchain().get_caller());

        id
    }

    /// Adaugă un voluntar la o asociație. Doar admin-ul poate apela.
    #[endpoint(registerMember)]
    fn register_member(&self, assoc_id: u64, wallet: ManagedAddress) {
        self.require_assoc_exists(assoc_id);
        self.require_admin(assoc_id);
        require!(
            !self.members(assoc_id).contains(&wallet),
            "Already a member"
        );

        self.members(assoc_id).insert(wallet.clone());
        self.member_registered_event(assoc_id, &wallet);
    }

    /// Elimină un voluntar din asociație. Doar admin-ul poate apela.
    #[endpoint(removeMember)]
    fn remove_member(&self, assoc_id: u64, wallet: ManagedAddress) {
        self.require_assoc_exists(assoc_id);
        self.require_admin(assoc_id);
        require!(
            self.members(assoc_id).contains(&wallet),
            "Not a member"
        );

        self.members(assoc_id).swap_remove(&wallet);
        self.member_removed_event(assoc_id, &wallet);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Voting Session Management
    // ─────────────────────────────────────────────────────────────────────────

    /// Creează o sesiune de vot. Doar admin-ul poate apela.
    /// Returnează session_id-ul nou creat (1-based, per asociație).
    #[allow_multiple_var_args]
    #[endpoint(createVotingSession)]
    fn create_voting_session(
        &self,
        assoc_id: u64,
        title: ManagedBuffer,
        deadline: u64,
        quorum: u64,
        max_choices: u64,
        candidate_count: u64,
        eligible_voter_count: u64,
        participants: MultiValueEncoded<ManagedAddress>,
    ) -> u64 {
        self.require_assoc_exists(assoc_id);
        self.require_admin(assoc_id);

        let now: u64 = self.blockchain().get_block_timestamp();
        require!(deadline > now, "Deadline must be in the future");
        require!(quorum > 0, "Quorum must be greater than zero");

        require!(candidate_count > 0, "Need at least one candidate");
        require!(eligible_voter_count > 0, "Need at least one eligible voter");
        require!(max_choices > 0, "Max choices must be greater than zero");
        require!(
            max_choices <= candidate_count,
            "Max choices cannot exceed candidate count"
        );

        let sid = self.session_count(assoc_id).get() + 1;
        self.session_count(assoc_id).set(sid);

        self.session_title(assoc_id, sid).set(&title);
        self.session_deadline(assoc_id, sid).set(deadline);
        self.session_quorum(assoc_id, sid).set(quorum);
        self.session_max_choices(assoc_id, sid).set(max_choices);
        self.session_status(assoc_id, sid).set(STATUS_OPEN);
        self.session_total_votes(assoc_id, sid).set(0u64);

        let mut index = 0u64;
        for participant in participants.into_iter() {
            if index < candidate_count {
                self.candidates(assoc_id, sid).insert(participant.clone());
                self.vote_count(assoc_id, sid, &participant).set(0u64);
            } else {
                self.eligible(assoc_id, sid).insert(participant);
            }
            index += 1;
        }
        require!(
            index == candidate_count + eligible_voter_count,
            "Invalid participant count"
        );

        self.session_created_event(assoc_id, sid, deadline, quorum, &title);

        sid
    }

    /// Înregistrează votul unui participant eligibil.
    #[allow_multiple_var_args]
    #[endpoint(castVote)]
    fn cast_vote(
        &self,
        assoc_id: u64,
        session_id: u64,
        selected_candidates: MultiValueEncoded<ManagedAddress>,
    ) {
        self.require_assoc_exists(assoc_id);
        self.require_session_exists(assoc_id, session_id);

        let caller = self.blockchain().get_caller();
        let now: u64 = self.blockchain().get_block_timestamp();
        let selected_vec: ManagedVec<ManagedAddress> = selected_candidates.into_iter().collect();
        let selection_count = selected_vec.len() as u64;

        require!(
            self.session_status(assoc_id, session_id).get() == STATUS_OPEN,
            "Session is not open"
        );
        require!(
            self.session_deadline(assoc_id, session_id).get() > now,
            "Session deadline has passed"
        );
        require!(
            self.eligible(assoc_id, session_id).contains(&caller),
            "Not an eligible voter"
        );
        require!(
            !self.has_voted(assoc_id, session_id, &caller).get(),
            "Already voted"
        );
        require!(
            selection_count > 0,
            "Select at least one candidate"
        );
        require!(
            selection_count <= self.session_max_choices(assoc_id, session_id).get(),
            "Too many selected candidates"
        );

        self.has_voted(assoc_id, session_id, &caller).set(true);

        let mut unique: ManagedVec<Self::Api, ManagedAddress<Self::Api>> = ManagedVec::new();
        for candidate in selected_vec.iter() {
            let candidate_value = candidate.clone_value();
            require!(
                self.candidates(assoc_id, session_id).contains(&candidate_value),
                "Invalid candidate"
            );
            let mut duplicate = false;
            for existing in unique.iter() {
                let existing_value: ManagedAddress<Self::Api> = existing.clone_value();
                if existing_value == candidate_value {
                    duplicate = true;
                    break;
                }
            }
            require!(!duplicate, "Duplicate candidate selected");
            unique.push(candidate_value);
        }

        for candidate in unique.iter() {
            let candidate_value = candidate.clone_value();
            let new_count = self.vote_count(assoc_id, session_id, &candidate_value).get() + 1;
            self.vote_count(assoc_id, session_id, &candidate_value).set(new_count);
            self.vote_cast_event(assoc_id, session_id, &caller, &candidate_value);
        }

        let new_total = self.session_total_votes(assoc_id, session_id).get() + 1;
        self.session_total_votes(assoc_id, session_id).set(new_total);
    }

    /// Oprire manuală a sesiunii (urgențe). Doar admin-ul poate apela.
    #[endpoint(stopSession)]
    fn stop_session(&self, assoc_id: u64, session_id: u64) {
        self.require_assoc_exists(assoc_id);
        self.require_session_exists(assoc_id, session_id);
        self.require_admin(assoc_id);

        require!(
            self.session_status(assoc_id, session_id).get() == STATUS_OPEN,
            "Session is not open"
        );

        self.session_status(assoc_id, session_id).set(STATUS_STOPPED);
        self.session_stopped_event(assoc_id, session_id);
    }

    /// Finalizează sesiunea și calculează câștigătorul.
    /// Poate fi apelat de oricine după ce deadline-ul a trecut sau sesiunea a fost oprită.
    #[endpoint(finalizeSession)]
    fn finalize_session(&self, assoc_id: u64, session_id: u64) {
        self.require_assoc_exists(assoc_id);
        self.require_session_exists(assoc_id, session_id);

        let status = self.session_status(assoc_id, session_id).get();
        require!(
            status == STATUS_OPEN || status == STATUS_STOPPED,
            "Session already finalized"
        );

        if status == STATUS_OPEN {
            let now: u64 = self.blockchain().get_block_timestamp();
            require!(
                now >= self.session_deadline(assoc_id, session_id).get(),
                "Deadline has not passed yet. Use stopSession to stop early."
            );
        }

        // Calculăm câștigătorul — candidatul cu cele mai multe voturi.
        let mut winner = ManagedAddress::zero();
        let mut max_votes: u64 = 0;

        for candidate in self.candidates(assoc_id, session_id).iter() {
            let votes = self.vote_count(assoc_id, session_id, &candidate).get();
            if votes > max_votes {
                max_votes = votes;
                winner = candidate;
            }
        }

        let total = self.session_total_votes(assoc_id, session_id).get();
        let quorum = self.session_quorum(assoc_id, session_id).get();
        let quorum_reached = total >= quorum;

        // Dacă quorum-ul nu a fost atins, winner rămâne zero address (sesiune fără rezultat valid).
        if !quorum_reached {
            winner = ManagedAddress::zero();
        }

        self.session_winner(assoc_id, session_id).set(&winner);
        self.session_status(assoc_id, session_id).set(STATUS_FINALIZED);

        self.session_finalized_event(
            assoc_id,
            session_id,
            &winner,
            total,
            quorum_reached,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    #[view(getAssocCount)]
    fn get_assoc_count(&self) -> u64 {
        self.assoc_count().get()
    }

    #[view(getAssocName)]
    fn get_assoc_name(&self, assoc_id: u64) -> ManagedBuffer {
        self.require_assoc_exists(assoc_id);
        self.assoc_name(assoc_id).get()
    }

    #[view(getAssocAdmin)]
    fn get_assoc_admin(&self, assoc_id: u64) -> ManagedAddress {
        self.require_assoc_exists(assoc_id);
        self.assoc_admin(assoc_id).get()
    }

    #[view(isMember)]
    fn is_member(&self, assoc_id: u64, wallet: ManagedAddress) -> bool {
        self.members(assoc_id).contains(&wallet)
    }

    #[view(getMembers)]
    fn get_members(&self, assoc_id: u64) -> MultiValueEncoded<ManagedAddress> {
        self.require_assoc_exists(assoc_id);
        let mut result = MultiValueEncoded::new();
        for m in self.members(assoc_id).iter() {
            result.push(m);
        }
        result
    }

    #[view(getSessionCount)]
    fn get_session_count(&self, assoc_id: u64) -> u64 {
        self.session_count(assoc_id).get()
    }

    #[view(getSessionStatus)]
    fn get_session_status(&self, assoc_id: u64, session_id: u64) -> u8 {
        self.require_session_exists(assoc_id, session_id);
        self.session_status(assoc_id, session_id).get()
    }

    #[view(getSessionDeadline)]
    fn get_session_deadline(&self, assoc_id: u64, session_id: u64) -> u64 {
        self.require_session_exists(assoc_id, session_id);
        self.session_deadline(assoc_id, session_id).get()
    }

    #[view(getSessionMaxChoices)]
    fn get_session_max_choices(&self, assoc_id: u64, session_id: u64) -> u64 {
        self.require_session_exists(assoc_id, session_id);
        self.session_max_choices(assoc_id, session_id).get()
    }

    /// Returnează: (status, total_votes, winner_address)
    #[view(getSessionResult)]
    fn get_session_result(
        &self,
        assoc_id: u64,
        session_id: u64,
    ) -> MultiValue3<u8, u64, ManagedAddress> {
        self.require_session_exists(assoc_id, session_id);
        let status = self.session_status(assoc_id, session_id).get();
        let total = self.session_total_votes(assoc_id, session_id).get();
        let winner = if self.session_winner(assoc_id, session_id).is_empty() {
            ManagedAddress::zero()
        } else {
            self.session_winner(assoc_id, session_id).get()
        };
        (status, total, winner).into()
    }

    /// Returnează lista candidaților cu numărul de voturi per candidat.
    #[view(getCandidatesWithVotes)]
    fn get_candidates_with_votes(
        &self,
        assoc_id: u64,
        session_id: u64,
    ) -> MultiValueEncoded<MultiValue2<ManagedAddress, u64>> {
        self.require_session_exists(assoc_id, session_id);
        let mut result = MultiValueEncoded::new();
        for candidate in self.candidates(assoc_id, session_id).iter() {
            let votes = self.vote_count(assoc_id, session_id, &candidate).get();
            result.push((candidate, votes).into());
        }
        result
    }

    #[view(getEligibleVoters)]
    fn get_eligible_voters(
        &self,
        assoc_id: u64,
        session_id: u64,
    ) -> MultiValueEncoded<ManagedAddress> {
        self.require_session_exists(assoc_id, session_id);
        let mut result = MultiValueEncoded::new();
        for voter in self.eligible(assoc_id, session_id).iter() {
            result.push(voter);
        }
        result
    }

    #[view(getHasVoted)]
    fn get_has_voted(&self, assoc_id: u64, session_id: u64, voter: ManagedAddress) -> bool {
        self.has_voted(assoc_id, session_id, &voter).get()
    }

    #[view(getVoteCount)]
    fn get_vote_count(
        &self,
        assoc_id: u64,
        session_id: u64,
        candidate: ManagedAddress,
    ) -> u64 {
        self.vote_count(assoc_id, session_id, &candidate).get()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────

    // --- Global ---
    #[storage_mapper("assocCount")]
    fn assoc_count(&self) -> SingleValueMapper<u64>;

    // --- Per Association ---
    #[storage_mapper("assocName")]
    fn assoc_name(&self, assoc_id: u64) -> SingleValueMapper<ManagedBuffer>;

    #[storage_mapper("assocAdmin")]
    fn assoc_admin(&self, assoc_id: u64) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("members")]
    fn members(&self, assoc_id: u64) -> UnorderedSetMapper<ManagedAddress>;

    #[storage_mapper("sessionCount")]
    fn session_count(&self, assoc_id: u64) -> SingleValueMapper<u64>;

    // --- Per Session ---
    #[storage_mapper("sessionTitle")]
    fn session_title(&self, assoc_id: u64, session_id: u64) -> SingleValueMapper<ManagedBuffer>;

    #[storage_mapper("sessionDeadline")]
    fn session_deadline(&self, assoc_id: u64, session_id: u64) -> SingleValueMapper<u64>;

    #[storage_mapper("sessionQuorum")]
    fn session_quorum(&self, assoc_id: u64, session_id: u64) -> SingleValueMapper<u64>;

    #[storage_mapper("sessionMaxChoices")]
    fn session_max_choices(&self, assoc_id: u64, session_id: u64) -> SingleValueMapper<u64>;

    #[storage_mapper("sessionStatus")]
    fn session_status(&self, assoc_id: u64, session_id: u64) -> SingleValueMapper<u8>;

    #[storage_mapper("sessionTotalVotes")]
    fn session_total_votes(&self, assoc_id: u64, session_id: u64) -> SingleValueMapper<u64>;

    #[storage_mapper("sessionWinner")]
    fn session_winner(
        &self,
        assoc_id: u64,
        session_id: u64,
    ) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("candidates")]
    fn candidates(
        &self,
        assoc_id: u64,
        session_id: u64,
    ) -> UnorderedSetMapper<ManagedAddress>;

    #[storage_mapper("voteCount")]
    fn vote_count(
        &self,
        assoc_id: u64,
        session_id: u64,
        candidate: &ManagedAddress,
    ) -> SingleValueMapper<u64>;

    #[storage_mapper("eligible")]
    fn eligible(
        &self,
        assoc_id: u64,
        session_id: u64,
    ) -> UnorderedSetMapper<ManagedAddress>;

    #[storage_mapper("hasVoted")]
    fn has_voted(
        &self,
        assoc_id: u64,
        session_id: u64,
        voter: &ManagedAddress,
    ) -> SingleValueMapper<bool>;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    #[event("associationRegistered")]
    fn association_registered_event(
        &self,
        #[indexed] assoc_id: u64,
        name: &ManagedBuffer,
        #[indexed] admin: &ManagedAddress,
    );

    #[event("memberRegistered")]
    fn member_registered_event(
        &self,
        #[indexed] assoc_id: u64,
        #[indexed] wallet: &ManagedAddress,
    );

    #[event("memberRemoved")]
    fn member_removed_event(
        &self,
        #[indexed] assoc_id: u64,
        #[indexed] wallet: &ManagedAddress,
    );

    #[event("sessionCreated")]
    fn session_created_event(
        &self,
        #[indexed] assoc_id: u64,
        #[indexed] session_id: u64,
        #[indexed] deadline: u64,
        #[indexed] quorum: u64,
        title: &ManagedBuffer,
    );

    #[event("voteCast")]
    fn vote_cast_event(
        &self,
        #[indexed] assoc_id: u64,
        #[indexed] session_id: u64,
        #[indexed] voter: &ManagedAddress,
        #[indexed] candidate: &ManagedAddress,
    );

    #[event("sessionStopped")]
    fn session_stopped_event(
        &self,
        #[indexed] assoc_id: u64,
        #[indexed] session_id: u64,
    );

    #[event("sessionFinalized")]
    fn session_finalized_event(
        &self,
        #[indexed] assoc_id: u64,
        #[indexed] session_id: u64,
        #[indexed] winner: &ManagedAddress,
        #[indexed] total_votes: u64,
        #[indexed] quorum_reached: bool,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers (private)
    // ─────────────────────────────────────────────────────────────────────────

    fn require_assoc_exists(&self, assoc_id: u64) {
        require!(
            assoc_id >= 1 && assoc_id <= self.assoc_count().get(),
            "Association does not exist"
        );
    }

    fn require_session_exists(&self, assoc_id: u64, session_id: u64) {
        self.require_assoc_exists(assoc_id);
        require!(
            session_id >= 1 && session_id <= self.session_count(assoc_id).get(),
            "Session does not exist"
        );
    }

    fn require_admin(&self, assoc_id: u64) {
        require!(
            self.blockchain().get_caller() == self.assoc_admin(assoc_id).get(),
            "Caller is not the association admin"
        );
    }
}
