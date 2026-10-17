-- ==============================================================================
-- SQL Migration: Add Subscription Package & Quota Management to Companies Table
-- Sift AI: Partner (Black Theme) and Standard (White Theme)
-- ==============================================================================

-- 1. Add customer_type column (partner = Black theme, standard = White theme)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) DEFAULT 'standard';

-- 2. Add package_tier column (starter, pro, enterprise, custom)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS package_tier VARCHAR(20) DEFAULT 'starter';

-- 3. Add custom_quota column (Optional override or for custom enterprise contracts)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS custom_quota INTEGER DEFAULT NULL;

-- 4. Add package_status column (active, suspended, cancelled)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS package_status VARCHAR(20) DEFAULT 'active';

-- 5. Add billing_cycle_anchor column (day of month 1-31, default 1 = calendar month)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS billing_cycle_anchor INTEGER DEFAULT 1;

-- 6. Add telegram_group_limit column (starter: 0, pro: 1, enterprise: 3, custom: NULL/unlimited)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS telegram_group_limit INTEGER DEFAULT 0;

-- 7. Add constraints to enforce data integrity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_customer_type'
    ) THEN
        ALTER TABLE companies 
        ADD CONSTRAINT chk_companies_customer_type 
        CHECK (customer_type IN ('partner', 'standard'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_package_tier'
    ) THEN
        ALTER TABLE companies 
        ADD CONSTRAINT chk_companies_package_tier 
        CHECK (package_tier IN ('starter', 'pro', 'enterprise', 'custom'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_package_status'
    ) THEN
        ALTER TABLE companies 
        ADD CONSTRAINT chk_companies_package_status 
        CHECK (package_status IN ('active', 'suspended', 'cancelled'));
    END IF;
END $$;

-- 8. Set initial package data for existing companies
-- Mika Co. is set to Partner Enterprise
UPDATE companies 
SET 
    customer_type = 'partner',
    package_tier = 'enterprise',
    telegram_group_limit = 3,
    package_status = 'active'
WHERE name ILIKE '%Mika%' OR domain ILIKE '%mika%';

-- Set other existing companies to Partner or Standard Pro
UPDATE companies 
SET 
    customer_type = 'partner',
    package_tier = 'pro',
    telegram_group_limit = 1,
    package_status = 'active'
WHERE customer_type IS NULL OR package_tier IS NULL;

-- 9. Check results
SELECT id, name, domain, customer_type, package_tier, custom_quota, package_status, telegram_group_limit
FROM companies
ORDER BY created_at ASC;
