-- ==============================================================================
-- SQL Migration: Sift AI audit log tables (replaces the old log file)
-- Tables: classification_audit_logs (chat classification decision trace), agent_audit_logs (Telegram AI agent audit trail)
-- ==============================================================================

-- 1. Decision trace of each chat classification (written by triageLogger.logTriageAudit)
CREATE TABLE IF NOT EXISTS classification_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id TEXT NOT NULL,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    conversation TEXT,
    llm_response JSONB,                              -- raw parsed JSON returned by the LLM
    llm_detected_issues JSONB NOT NULL DEFAULT '[]', -- issues as the LLM proposed them
    sentence_breakdown JSONB NOT NULL DEFAULT '[]',  -- final issues saved to chat_issues, with decision source
    primary_decision JSONB,                          -- final values saved to chats
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classification_audit_logs_chat_created ON classification_audit_logs(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classification_audit_logs_company_created ON classification_audit_logs(company_id, created_at DESC);

-- 2. Per-query audit trail of the Telegram AI agent (written by agentService.processAgentQueryDirect)
CREATE TABLE IF NOT EXISTS agent_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    chat_id TEXT,                                    -- Telegram chat id
    user_query TEXT NOT NULL,
    tool_used TEXT,
    confidence_score NUMERIC,
    audit_status TEXT,                               -- 'PASSED' | 'RECOVERED'
    slots JSONB,                                     -- resolved timeframe / category slots
    rag_matches JSONB NOT NULL DEFAULT '[]',         -- matched training_examples
    fetched_data JSONB,                              -- data payload returned by the tool
    reply TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_company_created ON agent_audit_logs(company_id, created_at DESC);

-- Server accesses these tables with the service role key; block direct anon/authenticated access
ALTER TABLE classification_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_audit_logs ENABLE ROW LEVEL SECURITY;
