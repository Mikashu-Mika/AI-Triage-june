-- ==============================================================================
-- SQL Migration (P1): Unify category IDs, enforce chat_issues FK, backfill customer company,
--                     and add a test-data flag on chats
-- Run the whole file at once in Supabase SQL Editor (it is a single transaction).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Unify category IDs to the "<company_id>:<key>" format
--    (Mika Co. still uses legacy un-prefixed IDs such as 'login_issue')
-- ------------------------------------------------------------------------------

-- 1.1 Create the prefixed copy of every legacy category
INSERT INTO categories (id, name, description, embedding, company_id, name_en)
SELECT company_id || ':' || id, name, description, embedding, company_id, name_en
FROM categories
WHERE id NOT LIKE '%:%' AND company_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- 1.2 Re-point chats: legacy key -> "<chat company (or category owner)>:<key>"
UPDATE chats c
SET category_id = COALESCE(c.company_id, cat.company_id) || ':' || c.category_id
FROM categories cat
WHERE cat.id = c.category_id
  AND c.category_id NOT LIKE '%:%';

-- 1.3 Re-point chat_issues the same way (company taken from the parent chat)
UPDATE chat_issues i
SET category_id = COALESCE(c.company_id, cat.company_id) || ':' || i.category_id
FROM chats c, categories cat
WHERE c.id = i.chat_id
  AND cat.id = i.category_id
  AND i.category_id NOT LIKE '%:%';

-- 1.4 Fix issues/chats that point at ANOTHER company's category (same key, own company)
UPDATE chat_issues i
SET category_id = c.company_id || ':' || split_part(i.category_id, ':', 2)
FROM chats c
WHERE c.id = i.chat_id
  AND c.company_id IS NOT NULL
  AND i.category_id LIKE '%:%'
  AND split_part(i.category_id, ':', 1) <> c.company_id::text;

UPDATE chats c
SET category_id = c.company_id || ':' || split_part(c.category_id, ':', 2)
WHERE c.company_id IS NOT NULL
  AND c.category_id LIKE '%:%'
  AND split_part(c.category_id, ':', 1) <> c.company_id::text;

-- 1.5 Re-point human audit results (currently empty, kept for safety)
UPDATE audit_results r
SET category_id = COALESCE(c.company_id, cat.company_id) || ':' || r.category_id
FROM chats c, categories cat
WHERE c.id = r.chat_id
  AND cat.id = r.category_id
  AND r.category_id NOT LIKE '%:%';

-- 1.6 Remove the legacy un-prefixed categories (nothing references them anymore)
DELETE FROM categories WHERE id NOT LIKE '%:%';

-- ------------------------------------------------------------------------------
-- 2. chat_issues.category_id must reference an existing category
-- ------------------------------------------------------------------------------
ALTER TABLE chat_issues
  ADD CONSTRAINT chat_issues_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- 3. Backfill customers.company_id for legacy customers that chatted with exactly ONE company
--    (customers shared by several companies stay NULL: customers.id is global, see P1 report)
-- ------------------------------------------------------------------------------
UPDATE customers cu
SET company_id = x.company_id
FROM (
  SELECT customer_id, MIN(company_id::text)::uuid AS company_id
  FROM chats
  WHERE customer_id IS NOT NULL AND company_id IS NOT NULL
  GROUP BY customer_id
  HAVING COUNT(DISTINCT company_id) = 1
) x
WHERE cu.id = x.customer_id
  AND cu.company_id IS NULL;

-- ------------------------------------------------------------------------------
-- 4. Test-data flag (rows are kept; analytics exclude is_test = true)
--    Which chats to mark is decided separately — see the UPDATE template at the bottom.
-- ------------------------------------------------------------------------------
ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_chats_company_created_live ON chats(company_id, created_at) WHERE is_test = false;

COMMIT;

-- ------------------------------------------------------------------------------
-- Verification (expected: 0, 0, 0)
-- ------------------------------------------------------------------------------
-- SELECT count(*) FROM categories WHERE id NOT LIKE '%:%';
-- SELECT count(*) FROM chats WHERE category_id IS NOT NULL AND category_id NOT LIKE '%:%';
-- SELECT count(*) FROM chat_issues i LEFT JOIN categories c ON c.id = i.category_id WHERE c.id IS NULL;
