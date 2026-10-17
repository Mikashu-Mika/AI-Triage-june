import { supabase } from './supabase.js';

/**
 * Subscription Package Definitions
 * Based on Sift AI Pricing:
 * - Partner (Black Theme / สีดำ)
 * - Standard / ลูกค้าทั่วไป (White Theme / สีขาว)
 */
export const PACKAGE_CONFIG = {
  partner: {
    theme: 'black',
    themeName: 'Partner (สีดำ)',
    starter: {
      name: 'Starter',
      priceThb: 8000,
      chatLimit: 20000,
      telegramGroupLimit: 0,
      hasSoundAlert: false,
      hasRealtimeDashboard: true,
      description: 'ทีมขนาดเล็ก'
    },
    pro: {
      name: 'Pro',
      priceThb: 15000,
      chatLimit: 50000,
      telegramGroupLimit: 1,
      hasSoundAlert: true,
      hasRealtimeDashboard: true,
      description: 'ธุรกิจขนาดกลาง (ยอดนิยม)'
    },
    enterprise: {
      name: 'Enterprise',
      priceThb: 28000,
      chatLimit: 120000,
      telegramGroupLimit: 3,
      hasSoundAlert: true,
      hasRealtimeDashboard: true,
      description: 'องค์กรใหญ่'
    },
    custom: {
      name: 'Custom',
      priceThb: null,
      chatLimit: null, // Unlimited
      telegramGroupLimit: null, // Unlimited / Bespoke
      hasSoundAlert: true,
      hasRealtimeDashboard: true,
      description: 'ติดต่อฝ่ายขาย (ออกแบบเฉพาะ / On-Premise)'
    }
  },
  standard: {
    theme: 'white',
    themeName: 'ลูกค้าทั่วไป (สีขาว)',
    starter: {
      name: 'Starter',
      priceThb: 9600,
      chatLimit: 20000,
      telegramGroupLimit: 0,
      hasSoundAlert: false,
      hasRealtimeDashboard: true,
      description: 'ทีมขนาดเล็ก'
    },
    pro: {
      name: 'Pro',
      priceThb: 18000,
      chatLimit: 50000,
      telegramGroupLimit: 1,
      hasSoundAlert: true,
      hasRealtimeDashboard: true,
      description: 'ธุรกิจขนาดกลาง (ยอดนิยม)'
    },
    enterprise: {
      name: 'Enterprise',
      priceThb: 33600,
      chatLimit: 120000,
      telegramGroupLimit: 3,
      hasSoundAlert: true,
      hasRealtimeDashboard: true,
      description: 'องค์กรใหญ่'
    },
    custom: {
      name: 'Custom',
      priceThb: null,
      chatLimit: null, // Unlimited
      telegramGroupLimit: null, // Unlimited / Bespoke
      hasSoundAlert: true,
      hasRealtimeDashboard: true,
      description: 'ติดต่อฝ่ายขาย (ออกแบบเฉพาะ / On-Premise)'
    }
  }
};

/**
 * Calculate the current billing cycle range (start and end Date).
 * Default: Calendar Month (1st day 00:00:00 to last day 23:59:59).
 * If anchorDay > 1, calculates from anchorDay of current cycle to next cycle.
 * 
 * @param {number} anchorDay Day of month (1-31)
 * @param {Date} [refDate] Reference date (default: now)
 * @returns {{ startDate: string, endDate: string, resetDate: string }}
 */
export function getBillingCycleRange(anchorDay = 1, refDate = new Date()) {
  const year = refDate.getFullYear();
  const month = refDate.getMonth(); // 0-indexed

  if (!anchorDay || anchorDay <= 1) {
    // Standard Calendar Month
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    const end = new Date(nextMonthStart.getTime() - 1);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      resetDate: nextMonthStart.toISOString()
    };
  }

  // Custom Anchor Day (e.g. 15th of each month)
  let startMonth = month;
  let startYear = year;
  if (refDate.getDate() < anchorDay) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  const start = new Date(Date.UTC(startYear, startMonth, anchorDay, 0, 0, 0, 0));
  let endMonth = startMonth + 1;
  let endYear = startYear;
  if (endMonth > 11) {
    endMonth = 0;
    endYear += 1;
  }
  const nextCycleStart = new Date(Date.UTC(endYear, endMonth, anchorDay, 0, 0, 0, 0));
  const end = new Date(nextCycleStart.getTime() - 1);

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    resetDate: nextCycleStart.toISOString()
  };
}

/**
 * Fetch company's subscription package configuration from Supabase.
 * Gracefully handles cases where schema migration columns might be null or not yet applied.
 * 
 * @param {string} companyId 
 * @returns {Promise<any>}
 */
export async function getCompanyPackage(companyId) {
  if (!companyId) return null;

  try {
    const { data: company, error } = await supabase
      .from('companies')
      .select('id, name, domain, customer_type, package_tier, custom_quota, package_status, billing_cycle_anchor, telegram_group_limit')
      .eq('id', companyId)
      .maybeSingle();

    if (error) {
      // If columns do not exist yet in DB schema, fallback to default package
      console.warn(`[QuotaService] Note: Querying full package columns failed (${error.message}). Using safe defaults.`);
      const { data: basicCompany } = await supabase
        .from('companies')
        .select('id, name, domain')
        .eq('id', companyId)
        .maybeSingle();

      if (!basicCompany) return null;

      // Safe defaults: Partner Pro for Mika Co., Standard Starter for others
      const isMika = (basicCompany.name || '').toLowerCase().includes('mika') || (basicCompany.domain || '').includes('mika');
      return {
        id: basicCompany.id,
        name: basicCompany.name,
        domain: basicCompany.domain,
        customer_type: isMika ? 'partner' : 'standard',
        package_tier: isMika ? 'enterprise' : 'pro',
        custom_quota: null,
        package_status: 'active',
        billing_cycle_anchor: 1,
        telegram_group_limit: isMika ? 3 : 1
      };
    }

    if (!company) return null;

    // Apply defaults if fields are empty
    return {
      ...company,
      customer_type: company.customer_type || 'standard',
      package_tier: company.package_tier || 'starter',
      package_status: company.package_status || 'active',
      billing_cycle_anchor: company.billing_cycle_anchor || 1
    };
  } catch (err) {
    console.error(`[QuotaService] Error in getCompanyPackage for ${companyId}:`, err.message);
    return null;
  }
}

/**
 * Count the number of chats ingested/processed by a company in the specified date range.
 * Does not count chats marked as 'quota_exceeded'.
 * 
 * @param {string} companyId 
 * @param {string} startDate ISO String
 * @param {string} endDate ISO String
 * @returns {Promise<number>}
 */
export async function getCompanyMonthlyUsage(companyId, startDate, endDate) {
  if (!companyId) return 0;

  try {
    let query = supabase
      .from('chats')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .neq('status', 'quota_exceeded');

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { count, error } = await query;
    if (error) {
      console.error(`[QuotaService] Error counting monthly usage for ${companyId}:`, error.message);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error(`[QuotaService] Error in getCompanyMonthlyUsage:`, err.message);
    return 0;
  }
}

/**
 * Check company's quota status for the current billing month.
 * 
 * @param {string} companyId 
 * @returns {Promise<{
 *   companyId: string,
 *   companyName: string,
 *   customerType: 'partner' | 'standard',
 *   themeName: string,
 *   packageTier: string,
 *   packageName: string,
 *   monthlyLimit: number | null,
 *   currentUsage: number,
 *   remaining: number | null,
 *   usagePercent: number,
 *   isExceeded: boolean,
 *   packageStatus: string,
 *   telegramGroupLimit: number | null,
 *   hasSoundAlert: boolean,
 *   billingCycle: { startDate: string, endDate: string, resetDate: string }
 * }>}
 */
export async function checkCompanyQuota(companyId) {
  if (!companyId) {
    return {
      companyId: null,
      companyName: 'Unknown',
      customerType: 'standard',
      themeName: 'ลูกค้าทั่วไป (สีขาว)',
      packageTier: 'starter',
      packageName: 'Starter',
      monthlyLimit: 20000,
      currentUsage: 0,
      remaining: 20000,
      usagePercent: 0,
      isExceeded: false,
      packageStatus: 'active',
      telegramGroupLimit: 0,
      hasSoundAlert: false,
      billingCycle: getBillingCycleRange(1)
    };
  }

  const company = await getCompanyPackage(companyId);
  if (!company) {
    throw new Error(`Company with ID "${companyId}" not found`);
  }

  const customerType = company.customer_type === 'partner' ? 'partner' : 'standard';
  const tier = (company.package_tier || 'starter').toLowerCase();
  const typeConfig = PACKAGE_CONFIG[customerType] || PACKAGE_CONFIG.standard;
  const tierConfig = typeConfig[tier] || typeConfig.starter;

  const billingCycle = getBillingCycleRange(company.billing_cycle_anchor || 1);
  const currentUsage = await getCompanyMonthlyUsage(companyId, billingCycle.startDate, billingCycle.endDate);

  // If company has custom_quota override, use it; otherwise use tier chatLimit
  let monthlyLimit = null;
  if (company.custom_quota !== null && company.custom_quota !== undefined) {
    monthlyLimit = Number(company.custom_quota);
  } else {
    monthlyLimit = tierConfig.chatLimit; // null means unlimited (Custom tier)
  }

  let remaining = null;
  let isExceeded = false;
  let usagePercent = 0;

  if (company.package_status === 'suspended' || company.package_status === 'cancelled') {
    isExceeded = true;
    remaining = 0;
    usagePercent = 100;
  } else if (monthlyLimit !== null && monthlyLimit > 0) {
    remaining = Math.max(0, monthlyLimit - currentUsage);
    isExceeded = currentUsage >= monthlyLimit;
    usagePercent = Number(((currentUsage / monthlyLimit) * 100).toFixed(2));
  } else {
    // Unlimited (e.g. Custom tier)
    remaining = null;
    isExceeded = false;
    usagePercent = 0;
  }

  const telegramGroupLimit = company.telegram_group_limit !== null && company.telegram_group_limit !== undefined
    ? company.telegram_group_limit
    : tierConfig.telegramGroupLimit;

  return {
    companyId: company.id,
    companyName: company.name,
    customerType,
    themeName: typeConfig.themeName,
    packageTier: tier,
    packageName: tierConfig.name,
    monthlyLimit,
    currentUsage,
    remaining,
    usagePercent,
    isExceeded,
    packageStatus: company.package_status || 'active',
    telegramGroupLimit,
    hasSoundAlert: tierConfig.hasSoundAlert,
    billingCycle
  };
}

/**
 * Express Middleware to block requests if company has exceeded its monthly quota.
 */
export async function enforceCompanyQuota(req, res, next) {
  const companyId = req.company?.id || req.body?.company_id || req.query?.company_id;

  if (!companyId) {
    // If not authenticated, proceed (other auth middlewares will handle)
    return next();
  }

  try {
    const quota = await checkCompanyQuota(companyId);

    if (quota.isExceeded) {
      console.warn(`⛔ [Quota Block] Company ${quota.companyName} (${companyId}) exceeded quota (${quota.currentUsage}/${quota.monthlyLimit}). Request blocked.`);
      return res.status(429).json({
        error: 'โควต้าการใช้งานต่อเดือนครบแล้ว (Monthly Chat Quota Exceeded)',
        message: `บริษัท ${quota.companyName} ใช้โควต้าแชตครบกำหนดของแพ็กเกจ ${quota.packageName} (${quota.themeName}) แล้วในรอบเดือนนี้ กรุณาอัปเกรดแพ็กเกจหรือรอรอบบิลถัดไปในวันที่ ${new Date(quota.billingCycle.resetDate).toLocaleDateString('th-TH')}`,
        quota
      });
    }

    // Attach quota status to request object for downstream use
    req.quota = quota;
    next();
  } catch (err) {
    console.error('[QuotaService] Middleware enforcement error:', err.message);
    next();
  }
}
