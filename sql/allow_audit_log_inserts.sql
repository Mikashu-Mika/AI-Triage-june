-- ==============================================================================
-- Let the bot write its audit logs (run once in the Supabase SQL Editor)
-- ==============================================================================
-- Why: create_audit_log_tables.sql turned on RLS for both audit tables with no
-- policy, expecting the bot to use the service role key. The bot's key is the
-- anon key, so every insert failed with "new row violates row-level security
-- policy" and both tables stayed empty.
--
-- This policy allows INSERT only. With the anon key, no one can read, change or
-- delete rows, so the logged conversations are not exposed. Read the logs in the
-- Supabase Table Editor or SQL Editor, which are not limited by RLS.
--
-- To undo: DROP POLICY "Bot inserts classification audit logs" ON classification_audit_logs;
--          DROP POLICY "Bot inserts agent audit logs" ON agent_audit_logs;
-- ==============================================================================

DROP POLICY IF EXISTS "Bot inserts classification audit logs" ON classification_audit_logs;
CREATE POLICY "Bot inserts classification audit logs"
ON classification_audit_logs FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Bot inserts agent audit logs" ON agent_audit_logs;
CREATE POLICY "Bot inserts agent audit logs"
ON agent_audit_logs FOR INSERT
TO anon, authenticated
WITH CHECK (true);
