/**
 * src/execAgent/morningBriefing.js
 * 
 * โมดูลสรุปรายงานยามเช้า (Morning Executive Briefing)
 * ทำหน้าที่ Query ข้อมูลแชตของเมื่อวาน สรุปภาพรวม คัดเคสเร่งด่วนและอารมณ์ลบ
 * แล้วจัดรูปแบบข้อความให้อ่านง่าย สบายตาบนหน้าจอมือถือใน Telegram
 */

import { supabase, fetchAllRows } from '../supabase.js';
import { loadCategoryContext } from './tools.js';
import { getDefaultCompanyId } from '../categoryHelper.js';
import { resolvePeriod, formatThaiDate, formatThaiDateTime, thaiHour } from './timeframe.js';

const PRIORITY_ORDER = { critical: 4, urgent: 4, high: 3, medium: 2, low: 1 };
const PRIORITY_BADGE = {
  critical: '🚨 ฉุกเฉิน',
  urgent: '🚨 ฉุกเฉิน',
  high: '🔥 ความด่วนสูง',
  medium: '⚡ ปานกลาง',
  low: '🟢 ปกติ'
};

const SENTIMENT_BADGE = {
  'โกรธ': '😡 โกรธ',
  'ไม่พอใจ': '😠 ไม่พอใจ',
  'กังวล': '😰 กังวล',
  'ผิดหวัง': '😞 ผิดหวัง',
  'ทั่วไป': '😐 ทั่วไป',
  'พอใจ': '😊 พอใจ',
  'ชม': '🌟 ชื่นชม'
};

/**
 * ดึงข้อมูลแชตและประเด็นปัญหาทั้งหมดของเมื่อวาน
 */
export async function getYesterdayMetrics(companyId, targetPeriod = null) {
  const resolvedCompanyId = companyId || process.env.DEFAULT_COMPANY_ID || (await getDefaultCompanyId().catch(() => null));
  const period = targetPeriod || resolvePeriod({ type: 'yesterday' });
  const categoryContext = await loadCategoryContext(resolvedCompanyId);

  // ดึงแชตทั้งหมดในช่วงเวลาเมื่อวาน
  const { data: chats, error } = await fetchAllRows(() => {
    let q = supabase
      .from('chats')
      .select('id, created_at, customer_id, customer_name, category_id, priority, urgency, sentiment, summary, chat_issues(id, category_id, priority, summary)')
      .eq('is_test', false)
      .gte('created_at', period.start.toISOString())
      .lt('created_at', period.end.toISOString())
      .order('created_at', { ascending: false });
    if (resolvedCompanyId) {
      q = q.eq('company_id', resolvedCompanyId);
    }
    return q;
  });

  if (error) {
    throw new Error(`Failed to fetch yesterday chats: ${error.message}`);
  }

  const allChats = chats || [];
  const totalChats = allChats.length;

  // รวบรวมสถิติ — ใช้กติกาเดียวกับหน้า BO (siftai-bo src/lib/dashboardMetrics.ts)
  // เพื่อให้ผู้บริหารเปิด BO เทียบแล้วตัวเลขตรงกัน
  //  • ด่วนวิกฤต = priority urgent/critical หรือ urgency urgent
  //  • ความด่วนสูง = priority/urgency high (ที่ไม่ใช่ urgent)
  //  • อันดับหมวด = นับจาก "ทุกประเด็นปัญหา" ในแชต (1 แชตมีได้หลายประเด็น หลายหมวด)
  //    เหมือนกราฟ "จำนวนเคสแยกตามประเภทปัญหา" ใน BO (นับจาก chat_issues)
  const categoryCounts = new Map();
  let totalIssues = 0;
  let urgentCount = 0;
  let highCount = 0;
  let negativeCount = 0;

  for (const c of allChats) {
    const p = (c.priority || '').toLowerCase();
    const u = (c.urgency || '').toLowerCase();
    const isUrgent = p === 'urgent' || p === 'critical' || u === 'urgent';
    if (isUrgent) urgentCount++;
    else if (p === 'high' || u === 'high') highCount++;

    const s = c.sentiment || '';
    if (/โกรธ|ไม่พอใจ|หงุดหงิด|รำคาญ|กังวล|ผิดหวัง/i.test(s)) {
      negativeCount++;
    }

    const rawIssues = c.chat_issues || [];
    const issues = rawIssues.filter(iss => {
      const key = (iss.category_id || '').split(':').pop().toLowerCase();
      return key !== 'other';
    });

    if (rawIssues.length > 0) {
      for (const iss of issues) {
        totalIssues++;
        const catKey = (iss.category_id || '').split(':').pop().toLowerCase();
        const catName = categoryContext.get(catKey)?.name || catKey;
        categoryCounts.set(catName, (categoryCounts.get(catName) || 0) + 1);
      }
    } else {
      // แชตที่ยังไม่มีประเด็นย่อย: ใช้หมวดหลักของแชต (กติกาเดียวกับ BO)
      const mainKey = (c.category_id || 'other').split(':').pop().toLowerCase();
      if (mainKey !== 'other') {
        totalIssues++;
        const mainName = categoryContext.get(mainKey)?.name || mainKey;
        categoryCounts.set(mainName, (categoryCounts.get(mainName) || 0) + 1);
      }
    }
  }

  // จัดอันดับ Top Categories (เปอร์เซ็นต์คิดจากจำนวนปัญหาทั้งหมด เหมือน BO)
  const topCategories = [...categoryCounts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      pct: totalIssues > 0 ? Math.round((count / totalIssues) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.count - a.count);

  // คัดเลือกเคสสำคัญ 3-5 เคส (เน้น Urgent ก่อน ตามด้วย High + อารมณ์ลบ)
  const candidateChats = [...allChats].sort((a, b) => {
    // 1. เรียงตามความด่วน
    const pA = PRIORITY_ORDER[(a.priority || '').toLowerCase()] || 0;
    const pB = PRIORITY_ORDER[(b.priority || '').toLowerCase()] || 0;
    if (pA !== pB) return pB - pA;

    // 2. เรียงตามอารมณ์ลบ (โกรธ > ไม่พอใจ > อื่นๆ)
    const isAngryA = /โกรธ/i.test(a.sentiment || '') ? 2 : (/ไม่พอใจ/i.test(a.sentiment || '') ? 1 : 0);
    const isAngryB = /โกรธ/i.test(b.sentiment || '') ? 2 : (/ไม่พอใจ/i.test(b.sentiment || '') ? 1 : 0);
    if (isAngryA !== isAngryB) return isAngryB - isAngryA;

    // 3. เรียงตามเวลาใหม่สุด
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const highlights = candidateChats.slice(0, 5).map(c => {
    const rawTime = new Date(c.created_at);
    const timeStr = rawTime.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';
    const issues = (c.chat_issues || []).map(i => {
      const k = (i.category_id || '').split(':').pop().toLowerCase();
      return categoryContext.get(k)?.name || k;
    });

    const uniqueCats = [...new Set(issues)].filter(x => x !== 'other');
    const displayCats = uniqueCats.length > 3
      ? `${uniqueCats.slice(0, 3).join(', ')} (และอีก ${uniqueCats.length - 3} หมวด)`
      : (uniqueCats.length > 0 ? uniqueCats.join(', ') : 'ทั่วไป');
    const cleanSummary = (c.summary || 'ไม่มีรายละเอียดสรุป').replace(/\s+/g, ' ').trim();

    return {
      chatId: c.id,
      customerName: c.customer_name || `ลูกค้า #${c.customer_id || c.id.substring(0, 8)}`,
      priority: (c.priority || 'medium').toLowerCase(),
      priorityBadge: PRIORITY_BADGE[(c.priority || 'medium').toLowerCase()] || c.priority,
      sentiment: c.sentiment || 'ทั่วไป',
      sentimentBadge: SENTIMENT_BADGE[c.sentiment] || c.sentiment || 'ทั่วไป',
      time: timeStr,
      categories: displayCats,
      summary: cleanSummary
    };
  });

  return {
    period,
    totalChats,
    totalIssues,
    urgentCount,
    highCount,
    negativeCount,
    topCategories,
    highlights
  };
}

/**
 * สร้างข้อความสรุปเช้า (Mobile-Friendly Telegram Markdown Message)
 */
export function formatMorningBriefing(metrics, options = {}) {
  const { period, totalChats, totalIssues, urgentCount, highCount, negativeCount, topCategories, highlights } = metrics;
  const now = options.now || new Date();
  const todayLabel = formatThaiDate(now);
  const yesterdayLabel = period.label;
  const companyLine = options.companyName ? `🏢 บริษัท: ${options.companyName}\n` : '';

  // กรณีเมื่อวานไม่มีแชตเลย
  if (totalChats === 0) {
    return `🌅 *สรุปรายงานยามเช้า (Morning Briefing)*\n` +
      `📅 ประจำวันที่ ${todayLabel} (${yesterdayLabel})\n` + companyLine + `\n` +
      `✨ เมื่อวานนี้ระบบทำงานราบรื่น ไม่พบรายการแจ้งปัญหาจากลูกค้าเข้ามาค่ะ`;
  }

  // 1. ส่วนหัวและสถิติภาพรวม
  let msg = `🌅 *สรุปรายงานยามเช้า (Morning Briefing)*\n`;
  msg += `📅 ประจำวันที่ ${todayLabel} — ข้อมูลของ${yesterdayLabel}\n`;
  msg += companyLine + `\n`;

  msg += `📊 *ภาพรวมการติดต่อเมื่อวาน:*\n`;
  msg += `• แชตทั้งหมด: *${totalChats}* แชต\n`;
  msg += `• ปัญหาที่บันทึก: *${totalIssues}* เรื่อง\n`;
  if (urgentCount > 0) {
    msg += `• เคสฉุกเฉิน (Urgent): *${urgentCount}* เคส 🚨\n`;
  }
  if (highCount > 0) {
    msg += `• ความด่วนสูง (High): *${highCount}* เคส 🔥\n`;
  }
  if (negativeCount > 0) {
    msg += `• ลูกค้าไม่พอใจ/โกรธ: *${negativeCount}* เคส 😡\n`;
  }
  msg += `\n`;

  // 2. Top 3 หมวดหมู่ปัญหาที่พบบ่อยสุด
  if (topCategories.length > 0) {
    msg += `🔥 *3 อันดับปัญหาที่พบมากที่สุด:*\n`;
    const top3 = topCategories.slice(0, 3);
    top3.forEach((cat, idx) => {
      msg += `${idx + 1}. *${cat.name}* — ${cat.count} เรื่อง (${cat.pct}%)\n`;
    });
    msg += `\n`;
  }

  // 3. เคสสำคัญเร่งด่วนและอารมณ์ลบ (Highlights)
  if (highlights.length > 0) {
    msg += `🚨 *เคสสำคัญที่ต้องติดตาม (${highlights.length} เคส):*\n`;
    highlights.forEach((h, idx) => {
      msg += `*${idx + 1}. [${h.priorityBadge} | ${h.sentimentBadge}]* \`${h.chatId}\` (${h.time})\n`;
      msg += `   👤 *ลูกค้า:* ${h.customerName}\n`;
      msg += `   🏷️ *หมวดหมู่:* ${h.categories}\n`;
      // ตัด summary ไม่ให้ยาวเกินไปสำหรับมือถือ
      const shortSummary = h.summary.length > 120 ? h.summary.substring(0, 117) + '...' : h.summary;
      msg += `   📝 *ประเด็น:* ${shortSummary}\n\n`;
    });
  }

  // 4. คำแนะนำเชิงปฏิบัติการสำหรับทีมงาน
  msg += `💡 *คำแนะนำสำหรับทีมงานวันนี้:*\n`;
  if (urgentCount > 0) {
    msg += `• ตรวจสอบเคสฉุกเฉิน \`${highlights[0]?.chatId || ''}\` และติดต่อดูแลลูกค้าทันทีเพื่อป้องกันการร้องเรียนซ้ำ\n`;
  }
  if (topCategories.length > 0) {
    msg += `• ประสานทีมที่เกี่ยวข้องเพื่อเฝ้าระวังปัญหาหมวด *${topCategories[0].name}* ที่มีสัดส่วนสูงสุดค่ะ\n`;
  }

  return msg.trim();
}

/**
 * เรียกใช้งานครบวงจร (ดึงข้อมูล + ฟอร์แมตข้อความ)
 */
export async function generateMorningBriefing({ companyId, companyName = null, targetPeriod = null, now = new Date() } = {}) {
  const metrics = await getYesterdayMetrics(companyId, targetPeriod);
  const text = formatMorningBriefing(metrics, { now, companyName });
  return {
    text,
    metrics
  };
}
