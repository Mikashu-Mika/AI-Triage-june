-- ==============================================================================
-- SQL Migration (P2 + P3)
--  1. chat_issues.is_human_verified: issues corrected in BO are never overwritten by AI re-classification
--  2. knowledge_base: one SOP per company per category key,
--     with a review status so AI-drafted SOPs are labeled until the team approves them
-- Run the whole file at once in Supabase SQL Editor.
-- ==============================================================================

BEGIN;

-- 1. Human-verified flag on chat issues
ALTER TABLE chat_issues ADD COLUMN IF NOT EXISTS is_human_verified BOOLEAN NOT NULL DEFAULT false;

-- 2. Knowledge base (SOP) metadata
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS category_key TEXT;            -- e.g. 'login_issue' (NULL = general SOP)
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'; -- 'manual' | 'legacy_code' | 'ai_draft'
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE knowledge_base DROP CONSTRAINT IF EXISTS knowledge_base_status_check;
ALTER TABLE knowledge_base ADD CONSTRAINT knowledge_base_status_check CHECK (status IN ('approved', 'draft', 'archived'));

-- One active SOP per (company or shared, category)
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_base_company_category
  ON knowledge_base (COALESCE(company_id::text, 'shared'), COALESCE(category_key, 'general'))
  WHERE status <> 'archived';

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

COMMIT;
