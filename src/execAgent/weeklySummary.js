/**
 * src/execAgent/weeklySummary.js
 *
 * Weekly executive summary, sent on Mondays.
 * Compares last week (Mon-Sun) with the week before and lists rising problems from
 * detect_emerging_issues. The text is a fixed template (no AI), so numbers come out
 * exactly as counted and match the BO dashboard for the same date range.
 */

import { getYesterdayMetrics } from './morningBriefing.js';
import { detectEmergingIssues, loadCategoryContext } from './tools.js';
import { resolvePeriod, previousPeriod, formatThaiDate } from './timeframe.js';
import { getDefaultCompanyId } from '../categoryHelper.js';

const TOP_CATEGORIES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "9 พ.ย. 2569 - 15 พ.ย. 2569" for a period whose end is exclusive */
function rangeLabel(period) {
  return `${formatThaiDate(period.start)} - ${formatThaiDate(new Date(period.end.getTime() - DAY_MS))}`;
}

/** "▲ +4 (+25%)", "▼ -2 (-10%)", "เท่าเดิม", or "ใหม่" when last week had none */
export function trendText(current, previous) {
  const diff = current - previous;
  if (diff === 0) return 'เท่าเดิม';
  if (previous === 0) return `▲ +${diff} (ใหม่)`;
  const pct = Math.round((diff / previous) * 100);
  return diff > 0 ? `▲ +${diff} (+${pct}%)` : `▼ ${diff} (${pct}%)`;
}

/**
 * Period for the summary: the given dates, or the last full Monday-Sunday week.
 * @param {{ startDate?: string, endDate?: string, now?: Date }} [opts] dates as 'YYYY-MM-DD' (Thai time)
 */
export function resolveWeekPeriod({ startDate, endDate, now = new Date() } = {}) {
  if (startDate) {
    return resolvePeriod({ type: 'date_range', start_date: startDate, end_date: endDate || startDate }, now);
  }
  return resolvePeriod({ type: 'last_week' }, now);
}

/** Collect last week's and the previous week's numbers plus rising problems */
export async function getWeeklyMetrics(companyId, period, now = new Date()) {
  const resolvedCompanyId = companyId || process.env.DEFAULT_COMPANY_ID || (await getDefaultCompanyId().catch(() => null));
  const prevPeriod = previousPeriod(period);

  const [current, previous, categories] = await Promise.all([
    getYesterdayMetrics(resolvedCompanyId, period),
    getYesterdayMetrics(resolvedCompanyId, prevPeriod),
    loadCategoryContext(resolvedCompanyId)
  ]);

  // Rising problems use the same period spec so the baseline is the 4 weeks before it
  const periodSpec = period.type === 'last_week'
    ? { type: 'last_week' }
    : {
      type: 'date_range',
      start_date: new Date(period.start.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
      end_date: new Date(period.end.getTime() - DAY_MS + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    };
  const emerging = await detectEmergingIssues({ companyId: resolvedCompanyId, categories }, { period: periodSpec }, now);

  return { companyId: resolvedCompanyId, period, prevPeriod, current, previous, emerging };
}

/** Telegram Markdown text for the weekly summary */
export function formatWeeklySummary(metrics, options = {}) {
  const { period, prevPeriod, current, previous, emerging } = metrics;
  const companyLine = options.companyName ? `🏢 บริษัท: ${options.companyName}\n` : '';

  let msg = `📅 *สรุปประจำสัปดาห์ (Weekly Summary)*\n`;
  msg += `🗓️ ข้อมูลสัปดาห์ ${rangeLabel(period)}\n`;
  msg += companyLine + `\n`;

  // 1. Totals compared with the week before. With no chats that week every row would read
  // "new", so say it once and leave the trend out.
  const canCompare = previous.totalChats > 0;
  const trend = (now, before) => (canCompare ? ` — ${trendText(now, before)}` : '');
  if (canCompare) {
    msg += `📊 *ภาพรวม เทียบกับสัปดาห์ก่อน (${rangeLabel(prevPeriod)}):*\n`;
  } else {
    msg += `📊 *ภาพรวม:*\n_สัปดาห์ก่อน (${rangeLabel(prevPeriod)}) ไม่มีแชตเข้ามา จึงยังเทียบไม่ได้_\n`;
  }
  const rows = [
    ['แชตทั้งหมด', current.totalChats, previous.totalChats, 'แชต'],
    ['ปัญหาที่บันทึก', current.totalIssues, previous.totalIssues, 'เรื่อง'],
    ['เคสฉุกเฉิน (Urgent) 🚨', current.urgentCount, previous.urgentCount, 'เคส'],
    ['ความด่วนสูง (High) 🔥', current.highCount, previous.highCount, 'เคส'],
    ['ลูกค้าไม่พอใจ/โกรธ 😡', current.negativeCount, previous.negativeCount, 'เคส']
  ];
  for (const [label, now, before, unit] of rows) {
    msg += `• ${label}: *${now}* ${unit}${trend(now, before)}\n`;
  }
  msg += `\n`;

  if (current.totalChats === 0) {
    msg += `✨ สัปดาห์ที่แล้วไม่พบรายการแจ้งปัญหาจากลูกค้าเข้ามาค่ะ`;
    return msg.trim();
  }

  // 2. Top categories, each with its change from the week before
  if (current.topCategories.length > 0) {
    const prevCounts = new Map(previous.topCategories.map(c => [c.name, c.count]));
    msg += `🏷️ *${Math.min(TOP_CATEGORIES, current.topCategories.length)} อันดับปัญหาที่พบมากที่สุด:*\n`;
    current.topCategories.slice(0, TOP_CATEGORIES).forEach((cat, idx) => {
      msg += `${idx + 1}. *${cat.name}* — ${cat.count} เรื่อง (${cat.pct}%)${trend(cat.count, prevCounts.get(cat.name) || 0)}\n`;
    });
    msg += `\n`;
  }

  // 3. Rising problems against the average of the 4 weeks before (counted in chats, not issues)
  msg += `📈 *ปัญหาที่กำลังมาแรง* _(เทียบ${emerging.baseline.label} นับเป็นแชต)_\n`;
  if (emerging.emerging.length > 0) {
    for (const e of emerging.emerging) {
      const change = e.is_new ? 'หมวดใหม่' : `+${e.pct_change}%`;
      msg += `• *${e.category}* — ${e.current_chats} แชต (เฉลี่ย ${e.baseline_avg}, ${change})\n`;
    }
    if (emerging.more_emerging) {
      const { categories: moreCount, names } = emerging.more_emerging;
      msg += `• และอีก ${moreCount} หมวด เช่น ${names.slice(0, 3).join(', ')}${moreCount > 3 ? ' ฯลฯ' : ''}\n`;
    }
  } else {
    msg += `✅ ไม่มีหมวดไหนเพิ่มขึ้นผิดปกติ\n`;
    if (emerging.watch_list.length > 0) {
      const names = emerging.watch_list.map(w => `${w.category} (${w.current_chats} แชต, เฉลี่ย ${w.baseline_avg})`);
      msg += `👀 น่าจับตา: ${names.join(', ')}\n`;
    }
  }
  msg += `\n`;

  // 4. One action line, picked from the numbers above
  msg += `💡 *สิ่งที่ควรติดตามสัปดาห์นี้:*\n`;
  if (emerging.emerging.length > 0) {
    msg += `• ตรวจสาเหตุของหมวด *${emerging.emerging[0].category}* ที่เพิ่มขึ้นมากที่สุด\n`;
  }
  if (canCompare && current.urgentCount > previous.urgentCount) {
    msg += `• เคสฉุกเฉินเพิ่มขึ้นจากสัปดาห์ก่อน ควรทบทวนการรับมือเคสด่วน\n`;
  }
  if (current.topCategories.length > 0) {
    msg += `• หมวด *${current.topCategories[0].name}* ยังเป็นปัญหาอันดับ 1 (${current.topCategories[0].pct}%)\n`;
  }

  return msg.trim();
}

/** Fetch + format in one call */
export async function generateWeeklySummary({ companyId, companyName = null, startDate, endDate, now = new Date() } = {}) {
  const period = resolveWeekPeriod({ startDate, endDate, now });
  const metrics = await getWeeklyMetrics(companyId, period, now);
  return { text: formatWeeklySummary(metrics, { companyName }), metrics };
}
