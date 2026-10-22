-- ==============================================================================
-- SQL Migration: Multi-Tenant Telegram Group Mapping & Member Role Management
-- Tables: telegram_groups, telegram_group_members
-- ==============================================================================

-- 1. Create telegram_groups table
CREATE TABLE IF NOT EXISTS telegram_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id VARCHAR(64) UNIQUE NOT NULL,
    group_name VARCHAR(255) NOT NULL DEFAULT 'Telegram Group',
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on chat_id and company_id for high-speed lookups
CREATE INDEX IF NOT EXISTS idx_telegram_groups_chat_id ON telegram_groups(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_groups_company_id ON telegram_groups(company_id);

-- 2. Create telegram_group_members table
CREATE TABLE IF NOT EXISTS telegram_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id VARCHAR(64) NOT NULL, -- references telegram_groups(chat_id)
    telegram_user_id VARCHAR(64) NOT NULL, -- contact_id in Telegram
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    username VARCHAR(255),
    role VARCHAR(32) NOT NULL DEFAULT 'member', -- 'executive', 'member', 'admin', 'blocked'
    is_active BOOLEAN NOT NULL DEFAULT true,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_telegram_group_member UNIQUE (group_id, telegram_user_id),
    CONSTRAINT chk_telegram_member_role CHECK (role IN ('executive', 'member', 'admin', 'blocked'))
);

-- Indexes for telegram_group_members
CREATE INDEX IF NOT EXISTS idx_tg_members_group_id ON telegram_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_tg_members_user_id ON telegram_group_members(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_tg_members_lookup ON telegram_group_members(group_id, telegram_user_id);

-- 3. Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tg_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_telegram_groups_updated_at ON telegram_groups;
CREATE TRIGGER trg_telegram_groups_updated_at
BEFORE UPDATE ON telegram_groups
FOR EACH ROW
EXECUTE FUNCTION update_tg_timestamp();

DROP TRIGGER IF EXISTS trg_telegram_members_updated_at ON telegram_group_members;
CREATE TRIGGER trg_telegram_members_updated_at
BEFORE UPDATE ON telegram_group_members
FOR EACH ROW
EXECUTE FUNCTION update_tg_timestamp();

-- 4. Enable Row Level Security (RLS) & Grant access for Frontend & Backend
ALTER TABLE telegram_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Full access to telegram_groups" ON telegram_groups;
CREATE POLICY "Full access to telegram_groups" 
ON telegram_groups FOR ALL 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "Full access to telegram_group_members" ON telegram_group_members;
CREATE POLICY "Full access to telegram_group_members" 
ON telegram_group_members FOR ALL 
USING (true) 
WITH CHECK (true);

GRANT ALL ON TABLE telegram_groups TO anon, authenticated, service_role;
GRANT ALL ON TABLE telegram_group_members TO anon, authenticated, service_role;

-- 5. Seed Initial Data for Existing Live Group & Executives
-- Seed Mika Co. Group (-5495142610)
INSERT INTO telegram_groups (chat_id, group_name, company_id, is_active)
VALUES (
    '-5495142610',
    'Test_SIFT_AI',
    '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2',
    true
)
ON CONFLICT (chat_id) 
DO UPDATE SET 
    group_name = EXCLUDED.group_name,
    company_id = EXCLUDED.company_id,
    is_active = true,
    updated_at = now();

-- Seed Executives for Mika Co. Group
INSERT INTO telegram_group_members (group_id, telegram_user_id, first_name, last_name, username, role, is_active)
VALUES
    ('-5495142610', '834472739', 'JUNE 🐰', '', 'june_rabbit', 'executive', true),
    ('-5495142610', '6266062853', 'P Del', '', '', 'executive', true),
    ('-5495142610', '8167753903', 'Fr€nzy', '', '', 'executive', true),
    ('-5495142610', '1848586712', 'Core Admin', '', '', 'executive', true)
ON CONFLICT (group_id, telegram_user_id)
DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    last_seen_at = now(),
    updated_at = now();

-- 6. Verification Queries
SELECT g.chat_id, g.group_name, c.name AS company_name, g.is_active, g.created_at
FROM telegram_groups g
LEFT JOIN companies c ON g.company_id = c.id;

SELECT m.group_id, m.telegram_user_id, m.first_name, m.last_name, m.username, m.role, m.last_seen_at
FROM telegram_group_members m;
