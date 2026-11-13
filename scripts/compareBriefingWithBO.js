/**
 * scripts/compareBriefingWithBO.js   (READ-ONLY — never writes to the database)
 *
 * Task 2.3: compare the numbers in the morning briefing with the numbers the
 * Back Office (BO) dashboard shows for the same day, and explain every difference.
 *
 * Usage:
 *   node scripts/compareBriefingWithBO.js                 (yesterday, Thai time)
 *   node scripts/compareBriefingWithBO.js --date 2026-11-12
 *
 * Output: printed to the console AND saved to data/compare_briefing_<date>.txt
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { supabase, fetchAllRows, getCompanyByTelegramChatId } from '../src/supabase.js';
import { getYesterdayMetrics, formatMorningBriefing } from '../src/execAgent/morningBriefing.js';
import { loadCategoryContext } from '../src/execAgent/tools.js';
import { getDefaultCompanyId } from '../src/categoryHelper.js';
import { resolvePeriod } from '../src/execAgent/timeframe.js';

dotenv.config();

// ---------- args ----------
const args = process.argv.slice(2);
const dateArgIdx = args.indexOf('--date');
let targetDate = dateArgIdx >= 0 ? args[dateArgIdx + 1] : null;
if (!targetDate) {
  const todayTh = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const d = new Date(`${todayTh}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  targetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error('Invalid --date, expected YYYY-MM-DD');
  process.exit(1);
}

// "yesterday" relative to noon of the next day == targetDate, in Thai time
const nextDayNoon = new Date(`${targetDate}T12:00:00+07:00`);
nextDayNoon.setUTCDate(nextDayNoon.getUTCDate() + 1);
const period = resolvePeriod({ type: 'yesterday' }, nextDayNoon);

const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };
const baseKey = (id) => String(id || 'other').split(':').pop().toLowerCase();

// BO rules (copied from siftai-bo src/lib/dashboardMetrics.ts)
const boIsUrgent = (c) => {
  const p = (c.priority || '').toLowerCase();
  const u = (c.urgency || '').toLowerCase();
  return p === 'urgent' || p === 'critical' || u === 'urgent';
};
const boIsHigh = (c) => {
  const p = (c.priority || '').toLowerCase();
  const u = (c.urgency || '').toLowerCase();
  return (p === 'high' || u === 'high') && p !== 'urgent' && u !== 'urgent';
};
const boPriorityBucket = (c) => {
  const p = (c.priority || 'low').toLowerCase();
  if (p === 'urgent' || p === 'critical') return 'Urgent';
  if (p === 'high') return 'High';
  if (p === 'medium') return 'Medium';
  return 'Low';
};

function boMetrics(chats, nameOf) {
  // Same as siftai-bo dashboardMetrics.ts: count every issue's category;
  // chats without issues fall back to their main category.
  const cats = new Map();
  let other = 0;
  const add = (rawId) => {
    const k = baseKey(rawId);
    if (k === 'other') { other++; return; }
    const n = nameOf(k);
    cats.set(n, (cats.get(n) || 0) + 1);
  };
  for (const c of chats) {
    const issues = c.chat_issues || [];
    if (issues.length > 0) issues.forEach((iss) => add(iss.category_id || c.category_id));
    else add(c.category_id);
  }
  const prio = { Urgent: 0, High: 0, Medium: 0, Low: 0 };
  chats.forEach((c) => { prio[boPriorityBucket(c)]++; });
  return {
    total: chats.length,
    urgent: chats.filter(boIsUrgent).length,
    high: chats.filter(boIsHigh).length,
    pending: chats.filter((c) => (c.status || 'pending') === 'pending').length,
    prio,
    other,
    topCategories: [...cats.entries()].sort((a, b) => b[1] - a[1]),
  };
}

async function main() {
  // Same company the scheduler will use: the one linked to the briefing Telegram group in BO
  const groupChatId = process.env.TELEGRAM_EXEC_GROUP_ID || '-5495142610';
  const group = await getCompanyByTelegramChatId(groupChatId);
  const companyId = group?.companyId || process.env.DEFAULT_COMPANY_ID || (await getDefaultCompanyId().catch(() => null));
  const ctx = await loadCategoryContext(companyId);
  const nameOf = (k) => ctx.get(k)?.name || k;

  out(`================================================================`);
  out(` เทียบตัวเลข: สรุปเช้า (บอท) vs หน้า BO   วันที่ ${targetDate}`);
  out(` ช่วงเวลา: ${period.start.toISOString()} → ${period.end.toISOString()}  (${period.label})`);
  out(` กลุ่ม Telegram สรุปเช้า: ${groupChatId}`);
  out(group
    ? ` ✅ กลุ่มนี้ผูกกับบริษัท: ${group.companyName || '-'} (${group.companyId})`
    : ` ⚠️ กลุ่มนี้ยังไม่ผูกบริษัท/ถูกปิดใช้งานใน BO → ตัวตั้งเวลาจะ "ไม่ส่ง" สรุปเช้า (ผูกได้ที่ BO > จัดการกลุ่ม Telegram)`);
  out(` บริษัทที่ใช้เทียบ: ${companyId || '(ไม่ได้ตั้ง — ทุกบริษัท)'}`);
  out(`================================================================`);

  // 1) What the bot actually reports
  const bot = await getYesterdayMetrics(companyId, period);

  // 2) Raw rows for the same window, ALL companies, including test chats
  const { data: raw, error } = await fetchAllRows(() =>
    supabase
      .from('chats')
      .select('id, company_id, is_test, category_id, priority, urgency, status, sentiment, chat_issues(id, category_id)')
      .gte('created_at', period.start.toISOString())
      .lt('created_at', period.end.toISOString())
  );
  if (error) throw new Error(error.message);
  const all = raw || [];

  // What the BO shows with "ทุกบริษัท" (it does NOT exclude is_test)
  const boAll = boMetrics(all, nameOf);
  // BO numbers restricted the same way the bot restricts (one company, no test chats)
  const sameScope = all.filter((c) => (!companyId || c.company_id === companyId) && c.is_test !== true);
  const boSame = boMetrics(sameScope, nameOf);

  const row = (label, botVal, boAllVal, boSameVal) =>
    out(`${label.padEnd(30)} | บอท: ${String(botVal).padStart(5)} | BO(ทุกบริษัท): ${String(boAllVal).padStart(5)} | BO(ขอบเขตเดียวกับบอท): ${String(boSameVal).padStart(5)}`);

  out('');
  out('--- ตัวเลขหลัก ---');
  row('แชตทั้งหมด', bot.totalChats, boAll.total, boSame.total);
  row('ด่วนวิกฤต (Urgent)', bot.urgentCount, boAll.urgent, boSame.urgent);
  row('ความด่วนสูง (High)', bot.highCount, boAll.high, boSame.high);
  row('รอคัดแยก (pending)', '-', boAll.pending, boSame.pending);
  out(`${'ปัญหาที่บันทึก (chat_issues)'.padEnd(30)} | บอท: ${String(bot.totalIssues).padStart(5)} | BO ไม่แสดงตัวเลขนี้`);
  out(`${'ลูกค้าไม่พอใจ/โกรธ'.padEnd(30)} | บอท: ${String(bot.negativeCount).padStart(5)} | BO ไม่แสดงตัวเลขนี้`);

  out('');
  out('--- ระดับความด่วน (แบบกราฟใน BO) ---');
  for (const k of ['Urgent', 'High', 'Medium', 'Low']) {
    out(`${k.padEnd(10)} BO(ทุกบริษัท): ${boAll.prio[k]}   BO(ขอบเขตบอท): ${boSame.prio[k]}`);
  }

  out('');
  out('--- 3 อันดับหมวด ---');
  out('บอท (สรุปเช้า):');
  bot.topCategories.slice(0, 5).forEach((c, i) => out(`  ${i + 1}. ${c.name} — ${c.count} เรื่อง (${c.pct}%)`));
  out('BO ทุกบริษัท (หลังแก้: นับทุกประเด็นปัญหา):');
  boAll.topCategories.slice(0, 5).forEach(([n, v], i) => out(`  ${i + 1}. ${n} — ${v} เรื่อง`));
  out('BO ขอบเขตเดียวกับบอท:');
  boSame.topCategories.slice(0, 5).forEach(([n, v], i) => out(`  ${i + 1}. ${n} — ${v} เรื่อง`));

  out('');
  out('--- สาเหตุที่อาจทำให้ตัวเลขต่างกัน ---');
  const testCount = all.filter((c) => c.is_test === true).length;
  const byCompany = new Map();
  all.forEach((c) => byCompany.set(c.company_id || '(none)', (byCompany.get(c.company_id || '(none)') || 0) + 1));
  out(`• แชตทดสอบ (is_test=true) ในวันนั้น: ${testCount}  ← บอทตัดออก แต่ BO นับรวม`);
  out(`• แชตแยกตามบริษัท: ${[...byCompany.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  const critOrUrgency = sameScope.filter((c) => boIsUrgent(c) && (c.priority || '').toLowerCase() !== 'urgent').length;
  out(`• เคสที่ BO นับเป็นด่วนวิกฤต แต่บอทไม่นับ (priority=critical หรือ urgency=urgent): ${critOrUrgency}`);
  const multiIssue = sameScope.filter((c) => (c.chat_issues || []).length > 1).length;
  out(`• แชตที่มีมากกว่า 1 ปัญหา: ${multiIssue}  ← ทำให้ "เรื่อง" ของบอทมากกว่า "แชต" ของ BO`);
  const noIssues = sameScope.filter((c) => (c.chat_issues || []).length === 0).length;
  out(`• แชตที่ไม่มี chat_issues เลย: ${noIssues}  ← บอทไม่นับหมวดของแชตพวกนี้ แต่ BO นับจาก category_id`);

  out('');
  out('================ ตัวอย่างข้อความที่จะส่ง (ยังไม่ได้ส่งจริง) ================');
  out(formatMorningBriefing(bot, { now: nextDayNoon, companyName: group?.companyName || null }));
  out('==========================================================================');

  const dir = path.resolve('data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `compare_briefing_${targetDate}.txt`);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`\nบันทึกผลไว้ที่ ${file}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
