// ─── Auth ────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  walletAddress?: string;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
}

// ─── Association ─────────────────────────────────────────────────────
export interface Association {
  id: string;
  name: string;
  description?: string;
  adminUserId: string;
  adminWallet?: string;
  scAssocId?: string;
  createdAt: string;
}

export interface Member {
  id: string;
  associationId: string;
  userId: string;
  walletAddress?: string;
  status: 'active' | 'removed';
  joinedAt: string;
  user?: Pick<User, 'id' | 'email'>;
}

// ─── Vote ────────────────────────────────────────────────────────────
export type SessionStatus = 'draft' | 'open' | 'stopped' | 'finalized';

export interface VoteSession {
  id: string;
  associationId: string;
  title: string;
  description?: string;
  scSessionId?: number;
  status: SessionStatus;
  deadline?: string;
  quorum: number;
  createdBy: string;
  createdAt: string;
  candidates?: Candidate[];
  eligibleVoters?: EligibleVoter[];
}

export interface Candidate {
  id: string;
  sessionId: string;
  name: string;
  wallet: string;
  userId?: string;
  voteCount: number;
}

export interface EligibleVoter {
  id: string;
  sessionId: string;
  wallet: string;
  userId?: string;
  hasVoted: boolean;
}

// ─── Blockchain ──────────────────────────────────────────────────────
export interface UnsignedTransaction {
  nonce: number;
  value: string;
  receiver: string;
  sender: string;
  gasPrice: number;
  gasLimit: number;
  data: string;
  chainID: string;
  version: number;
}
