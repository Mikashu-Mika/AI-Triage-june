import { getCategories, supabase } from './supabase.js';

let categoriesCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

let defaultCompanyIdCache = null;

/**
 * Dynamically resolve the default company ID from Supabase
 * @returns {Promise<string>}
 */
export async function getDefaultCompanyId() {
  if (process.env.DEFAULT_COMPANY_ID) {
    return process.env.DEFAULT_COMPANY_ID;
  }
  if (defaultCompanyIdCache) {
    return defaultCompanyIdCache;
  }
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('id')
      .limit(1)
      .maybeSingle();
    if (!error && data && data.id) {
      defaultCompanyIdCache = data.id;
      return defaultCompanyIdCache;
    }
  } catch (err) {
    console.warn('Failed to fetch default company id:', err.message);
  }
  return '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';
}

export const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export const THAI_MONTH_PATTERNS = [
  { idx: 0, full: 'มกราคม', short: 'มกรา', regex: /(?:เดือน)?\s*(?:มกราคม|มกรา|ม\.ค\.)/i },
  { idx: 1, full: 'กุมภาพันธ์', short: 'กุมภา', regex: /(?:เดือน)?\s*(?:กุมภาพันธ์|กุมภา|ก\.พ\.)/i },
  { idx: 2, full: 'มีนาคม', short: 'มีนา', regex: /(?:เดือน)?\s*(?:มีนาคม|มีนา|มี\.ค\.)/i },
  { idx: 3, full: 'เมษายน', short: 'เมษา', regex: /(?:เดือน)?\s*(?:เมษายน|เมษา|เม\.ย\.)/i },
  { idx: 4, full: 'พฤษภาคม', short: 'พฤษภา', regex: /(?:เดือน)?\s*(?:พฤษภาคม|พฤษภา|พ\.ค\.)/i },
  { idx: 5, full: 'มิถุนายน', short: 'มิถุนา', regex: /(?:เดือน)?\s*(?:มิถุนายน|มิถุนา|มิ\.ย\.)/i },
  { idx: 6, full: 'กรกฎาคม', short: 'กรกฎา', regex: /(?:เดือน)?\s*(?:กรกฎาคม|กรกฎา|ก\.ค\.)/i },
  { idx: 7, full: 'สิงหาคม', short: 'สิงหา', regex: /(?:เดือน)?\s*(?:สิงหาคม|สิงหา|ส\.ค\.)/i },
  { idx: 8, full: 'กันยายน', short: 'กันยา', regex: /(?:เดือน)?\s*(?:กันยายน|กันยา|ก\.ย\.)/i },
  { idx: 9, full: 'ตุลาคม', short: 'ตุลา', regex: /(?:เดือน)?\s*(?:ตุลาคม|ตุลา|ต\.ค\.)/i },
  { idx: 10, full: 'พฤศจิกายน', short: 'พฤศจิกา', regex: /(?:เดือน)?\s*(?:พฤศจิกายน|พฤศจิกา|พฤศจิก|พ\.ย\.)/i },
  { idx: 11, full: 'ธันวาคม', short: 'ธันวา', regex: /(?:เดือน)?\s*(?:ธันวาคม|ธันวา|ธ\.ค\.)/i },
];

/**
 * Finds the first Thai month matched in text (supports full, short colloquial, and abbreviated)
 * @param {string} text
 * @returns {{ idx: number, full: string, short: string, matchText: string } | null}
 */
export function findThaiMonthInText(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  let firstMatch = null;
  let firstIndex = Infinity;

  for (const item of THAI_MONTH_PATTERNS) {
    const match = lower.match(item.regex);
    if (match && match.index < firstIndex) {
      firstIndex = match.index;
      firstMatch = { idx: item.idx, full: item.full, short: item.short, matchText: match[0] };
    }
  }
  return firstMatch;
}

/**
 * Finds all Thai months matched in text in order of appearance
 * @param {string} text
 * @returns {Array<{ idx: number, full: string, short: string, index: number }>}
 */
export function findAllThaiMonthsInText(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();
  const matches = [];

  for (const item of THAI_MONTH_PATTERNS) {
    const match = lower.match(item.regex);
    if (match) {
      matches.push({
        idx: item.idx,
        full: item.full,
        short: item.short,
        index: match.index
      });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return matches;
}

/**
 * Get dynamic Thai month metadata based on Bangkok Timezone (UTC+7)
 */
export function getDynamicMonthMeta() {
  const thTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const curMonthIdx = parseInt(thTodayStr.split('-')[1], 10) - 1;
  const curMonthName = THAI_MONTHS[curMonthIdx];
  const lastMonthName = THAI_MONTHS[(curMonthIdx - 1 + 12) % 12];
  return { curMonthName, lastMonthName, curMonthIdx, thaiMonths: THAI_MONTHS };
}

/**
 * Human-readable period string in Thai
 */
export function getPeriodThaiText(period) {
  const { curMonthName, lastMonthName } = getDynamicMonthMeta();
  if (period === 'yesterday') return 'ของเมื่อวาน';
  if (period === 'this_month') return `ของเดือนนี้ (${curMonthName})`;
  if (period === 'last_month') return `ของเดือนที่แล้ว (${lastMonthName})`;
  if (period === 'last_week') return 'ของสัปดาห์ที่แล้ว';
  if (period === 'this_week') return 'ของสัปดาห์นี้';
  if (period === 'monthly_breakdown') return 'แยกตามแต่ละเดือน';
  const matched = findThaiMonthInText(String(period));
  if (matched) return `ของเดือน${matched.full}`;
  return 'ของวันนี้';
}

/**
 * Fetch and cache categories from Supabase
 * @param {string} [companyId]
 * @returns {Promise<any[]>}
 */
export async function getCachedCategories(companyId = null) {
  const now = Date.now();
  if (categoriesCache && (now - lastCacheTime) < CACHE_TTL_MS) {
    if (companyId) {
      return categoriesCache.filter(c => c.company_id === companyId || !c.company_id);
    }
    return categoriesCache;
  }

  try {
    const fetched = await getCategories(companyId);
    if (!companyId) {
      categoriesCache = fetched;
      lastCacheTime = now;
    }
    return fetched;
  } catch (err) {
    console.warn('Failed to refresh categories cache:', err.message);
    return categoriesCache || [];
  }
}

export { CATEGORY_BILINGUAL_MAP } from './categoryConstants.js';
import { CATEGORY_BILINGUAL_MAP } from './categoryConstants.js';


/**
 * Get human-readable display name for a category ID or key
 * @param {string} catKeyOrId 
 * @param {any[]} [categories] 
 * @param {'th'|'en'} [lang='th'] - Language preference ('th' for Thai, 'en' for English)
 * @returns {string}
 */
export function getCategoryDisplayName(catKeyOrId, categories = null, lang = 'th') {
  if (!catKeyOrId) return lang === 'en' ? 'Other Inquiries' : 'เรื่องอื่นๆ';

  const cleanKey = catKeyOrId.includes(':') ? catKeyOrId.split(':')[1] : catKeyOrId;
  const isEn = lang === 'en';

  if (categories && Array.isArray(categories)) {
    const matched = categories.find(c => c.id === catKeyOrId || c.id === cleanKey || c.id.endsWith(':' + cleanKey));
    if (matched) {
      if (isEn && matched.name_en) return matched.name_en;
      if (isEn && CATEGORY_BILINGUAL_MAP[cleanKey]?.name_en) return CATEGORY_BILINGUAL_MAP[cleanKey].name_en;
      if (matched.name_th) return matched.name_th;
      if (matched.name) {
        // Strip any residual parentheses if present
        return matched.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
      }
    }
  }

  // Fallback map if categories list is not immediately passed or still loading
  const target = CATEGORY_BILINGUAL_MAP[cleanKey];
  if (target) {
    return isEn ? target.name_en : target.name_th;
  }

  return cleanKey;
}

/**
 * Match a category name or search term back to category ID keys dynamically (supports both TH & EN)
 * @param {string} targetName 
 * @param {any[]} [categories] 
 * @returns {string[]}
 */
export function findCategoryKeysByName(targetName, categories = []) {
  if (!targetName) return [];
  const lowerTarget = targetName.toLowerCase().trim();
  const matchedKeys = new Set();

  if (Array.isArray(categories) && categories.length > 0) {
    for (const c of categories) {
      const cName = (c.name || '').toLowerCase();
      const cNameTh = (c.name_th || '').toLowerCase();
      const cNameEn = (c.name_en || '').toLowerCase();
      const cId = c.id || '';
      const cleanKey = cId.includes(':') ? cId.split(':')[1] : cId;

      // Match exact or contains against Thai or English
      if (
        (cName && (cName.includes(lowerTarget) || lowerTarget.includes(cName))) ||
        (cNameTh && (cNameTh.includes(lowerTarget) || lowerTarget.includes(cNameTh))) ||
        (cNameEn && (cNameEn.includes(lowerTarget) || lowerTarget.includes(cNameEn))) ||
        (cleanKey && cleanKey.toLowerCase() === lowerTarget)
      ) {
        matchedKeys.add(cleanKey);
      }
    }
  }

  // Check static bilingual mapping
  for (const [key, val] of Object.entries(CATEGORY_BILINGUAL_MAP)) {
    if (val.name_th.toLowerCase().includes(lowerTarget) || lowerTarget.includes(val.name_th.toLowerCase()) ||
        val.name_en.toLowerCase().includes(lowerTarget) || lowerTarget.includes(val.name_en.toLowerCase())) {
      matchedKeys.add(key);
    }
  }

  // Common synonym / natural language mapping for robust dynamic resolution
  if (lowerTarget.includes('การเงิน') || lowerTarget.includes('ชำระเงิน') || lowerTarget.includes('ฝาก') || lowerTarget.includes('ถอน') || lowerTarget.includes('โอน')) {
    matchedKeys.add('deposit_withdrawal');
  }
  if (lowerTarget.includes('เข้าสู่ระบบ') || lowerTarget.includes('ล็อกอิน') || lowerTarget.includes('login') || lowerTarget.includes('รหัสผ่าน')) {
    matchedKeys.add('login_issue');
  }
  if (lowerTarget.includes('โปรโมชั่น') || lowerTarget.includes('โบนัส') || lowerTarget.includes('แต้ม') || lowerTarget.includes('สิทธิ์')) {
    matchedKeys.add('promo_bonus');
  }
  if (lowerTarget.includes('ค้าง') || lowerTarget.includes('โหลดช้า') || lowerTarget.includes('หน้าเว็บ')) {
    matchedKeys.add('page_load_freeze');
  }
  if (lowerTarget.includes('แสดงผล') || lowerTarget.includes('เพี้ยน') || lowerTarget.includes('รูปไม่ขึ้น') || lowerTarget.includes('จอดำ') || lowerTarget.includes('จอมืด')) {
    matchedKeys.add('ui_rendering_issue');
  }
  if (lowerTarget.includes('ตอบสนอง') || lowerTarget.includes('กดไม่ได้') || lowerTarget.includes('ปุ่ม')) {
    matchedKeys.add('interaction_lag');
  }
  if (lowerTarget.includes('แจ้งเตือน') || lowerTarget.includes('otp') || lowerTarget.includes('sms')) {
    matchedKeys.add('notification_issue');
  }
  if (lowerTarget.includes('ปลอดภัย') || lowerTarget.includes('แฮก') || lowerTarget.includes('เปลี่ยนเบอร์')) {
    matchedKeys.add('account_security');
  }
  if (lowerTarget.includes('สมัคร') || lowerTarget.includes('register')) {
    matchedKeys.add('registration');
  }
  if (lowerTarget.includes('ลิงก์เสีย') || lowerTarget.includes('เข้าเว็บไม่ได้') || lowerTarget.includes('ระงับ')) {
    matchedKeys.add('access_blocked');
  }
  if (lowerTarget.includes('ร้องเรียน') || lowerTarget.includes('ข้อเสนอแนะ') || lowerTarget.includes('บริการ')) {
    matchedKeys.add('feedback_complaint');
  }

  return Array.from(matchedKeys);
}
