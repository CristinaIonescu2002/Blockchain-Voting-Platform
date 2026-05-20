-- Voting Platform - Database Init
-- All schemas created here so services can use them from the same DB

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS association;
CREATE SCHEMA IF NOT EXISTS vote;

-- ─── AUTH schema ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  wallet_address VARCHAR(62),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ASSOCIATION schema ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS association.associations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  admin_user_id  UUID NOT NULL REFERENCES auth.users(id),
  admin_wallet   VARCHAR(62),
  paymaster_wallet VARCHAR(62),
  paymaster_pem TEXT,
  sc_assoc_id    VARCHAR(64),   -- on-chain association ID (hex)
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE association.associations
  ADD COLUMN IF NOT EXISTS paymaster_wallet VARCHAR(62),
  ADD COLUMN IF NOT EXISTS paymaster_pem TEXT;

CREATE TABLE IF NOT EXISTS association.members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id UUID NOT NULL REFERENCES association.associations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id),
  wallet_address VARCHAR(62),
  status         VARCHAR(20) DEFAULT 'active',   -- active | removed
  joined_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(association_id, user_id)
);

-- ─── VOTE schema ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vote.sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id  UUID NOT NULL REFERENCES association.associations(id),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  sc_session_id   BIGINT,          -- on-chain session ID
  status          VARCHAR(20) DEFAULT 'draft',  -- draft | open | stopped | finalized
  deadline        TIMESTAMPTZ,
  quorum          INT DEFAULT 1,
  max_choices     INT DEFAULT 1,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vote.candidates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES vote.sessions(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id),
  name        VARCHAR(255) NOT NULL,
  wallet      VARCHAR(62) NOT NULL,
  vote_count  INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vote.eligible_voters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES vote.sessions(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id),
  wallet      VARCHAR(62) NOT NULL,
  has_voted   BOOLEAN DEFAULT FALSE,
  UNIQUE(session_id, wallet)
);
