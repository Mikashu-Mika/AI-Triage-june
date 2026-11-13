/**
 * src/morningScheduler.js
 * 
 * โมดูลตั้งเวลาส่งสรุปเช้าอัตโนมัติ (Morning Executive Briefing Scheduler)
 * - ตั้งเวลาส่งเข้ากลุ่มผู้บริหารทุกวันเวลา 11:00 น. ตามเวลาประเทศไทย (ICT / UTC+7)
 * - มี Idempotent Guard กันส่งซ้ำ: ตรวจสอบทั้ง In-Memory Cache และ Supabase `activity_logs`
 *   ป้องกันบอทส่งเบิ้ลหาก Server รีสตาร์ทหรือมีการ Deploy ใหม่ระหว่างวัน
 * - รองรับการยิง Trigger แบบแมนนวลสำหรับทดสอบ (Manual Trigger / On-Demand)
 */

import { supabase, getCompanyByTelegramChatId } from './supabase.js';
import { generateMorningBriefing } from './execAgent/morningBriefing.js';
import { sendTelegramMessage } from './telegramBot.js';

// Cache จำวันที่ส่งไปแล้วในหน่วยความจำ (format: `${dateStr}:${chatId}`)
const sentBriefingsCache = new Set();
let schedulerInterval = null;
let isExecutionLock = false;

/**
 * ดึงวันที่ปัจจุบันตามเวลาประเทศไทย (Asia/Bangkok) ในรูปแบบ 'YYYY-MM-DD'
 */
export function getBangkokDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);
}

/**
 * ดึงชั่วโมง นาที วินาที ปัจจุบันตามเวลาประเทศไทย (ICT)
 */
export function getBangkokTime(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  }).formatToParts(d);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);
  return { hour, minute, second };
}

/**
 * Idempotent Guard: ตรวจสอบว่าวันนี้มีการส่งสรุปเช้าไปยัง chatId นี้แล้วหรือไม่
 * 1. ตรวจสอบใน In-Memory Set
 * 2. ตรวจสอบใน Supabase `activity_logs` เพื่อรองรับกรณี Server รีสตาร์ท
 */
export async function hasBriefingBeenSentToday(targetDateStr, chatId) {
  const cacheKey = `${targetDateStr}:${chatId}`;
  if (sentBriefingsCache.has(cacheKey)) {
    return true;
  }

  // คำนวณช่วงเวลาเริ่มต้นและสิ้นสุดของวันนั้นในเวลา UTC
  // วันที่ในไทย UTC+7 เช่น 2026-11-12 00:00 ICT = 2026-11-11 17:00 UTC
  const [y, m, d] = targetDateStr.split('-').map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d - 1, 17, 0, 0));
  const endUtc = new Date(Date.UTC(y, m - 1, d, 16, 59, 59, 999));

  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, details')
      .eq('action_type', 'MORNING_BRIEFING_AUTO')
      .gte('created_at', startUtc.toISOString())
      .lte('created_at', endUtc.toISOString())
      .limit(10);

    if (error) {
      console.warn('⚠️ [MorningScheduler] Failed to check activity_logs for idempotency:', error.message);
      return false;
    }

    if (data && data.length > 0) {
      const match = data.some(log => {
        const details = typeof log.details === 'object' && log.details !== null ? log.details : {};
        return details.target_date === targetDateStr && String(details.chat_id) === String(chatId);
      });
      if (match) {
        sentBriefingsCache.add(cacheKey);
        return true;
      }
    }
  } catch (err) {
    console.error('⚠️ [MorningScheduler] Error in hasBriefingBeenSentToday:', err.message);
  }

  return false;
}

/**
 * บันทึกสถานะการส่งสรุปเช้าลงใน activity_logs และ telegram_chat_logs
 */
export async function recordBriefingSent({ companyId, chatId, targetDateStr, metrics }) {
  const cacheKey = `${targetDateStr}:${chatId}`;
  sentBriefingsCache.add(cacheKey);

  try {
    // 1. บันทึกลง activity_logs เพื่อเป็นหลักฐาน Idempotent Guard
    const { error: err1 } = await supabase.from('activity_logs').insert([{
      company_id: companyId,
      user_name: 'Morning Scheduler (Auto)',
      action_type: 'MORNING_BRIEFING_AUTO',
      details: {
        target_date: targetDateStr,
        chat_id: chatId,
        channel: 'telegram_group',
        status: 'SENT',
        total_chats: metrics?.totalChats || 0,
        total_issues: metrics?.totalIssues || 0,
        urgent_count: metrics?.urgentCount || 0
      }
    }]);
    if (err1) console.warn('⚠️ [MorningScheduler] activity_logs insert warning:', err1.message);

    // 2. บันทึกลง telegram_chat_logs เพื่อให้ผู้บริหารตรวจสอบย้อนหลังได้
    const { error: err2 } = await supabase.from('telegram_chat_logs').insert([{
      company_id: companyId,
      chat_id: chatId,
      sender_name: 'Morning Scheduler',
      user_query: '[AUTO_SCHEDULE] 11:00 สรุปรายงานเช้าประจำวัน (Morning Executive Briefing)',
      bot_reply: `สรุปเช้าส่งสำเร็จ (สถิติแชตเมื่อวาน: ${metrics?.totalChats || 0} แชต, ${metrics?.totalIssues || 0} ปัญหา)`,
      tool_used: 'morning_briefing'
    }]);
    if (err2) console.warn('⚠️ [MorningScheduler] telegram_chat_logs insert warning:', err2.message);
  } catch (err) {
    console.error('⚠️ [MorningScheduler] Error recording logs:', err.message);
  }
}

/**
 * ฟังก์ชันหลักในการสร้างและส่งสรุปเช้าเข้า Telegram
 * @param {object} options
 * @param {string} [options.chatId] - Telegram Chat/Group ID เป้าหมาย
 * @param {string} [options.companyId] - Company ID
 * @param {boolean} [options.force] - บังคับส่งข้ามระบบกันส่งซ้ำ (สำหรับทดสอบ)
 */
export async function sendMorningBriefing({
  chatId = process.env.TELEGRAM_EXEC_GROUP_ID || '-5495142610',
  companyId = null,
  force = false
} = {}) {
  const targetDateStr = getBangkokDateString();

  // ใช้บริษัทที่ "ผูกกับกลุ่ม Telegram นี้" ใน BO (ตาราง telegram_groups) เท่านั้น
  // ถ้ากลุ่มยังไม่ผูกบริษัทหรือถูกปิดใช้งาน จะไม่ส่ง — กันส่งข้อมูลผิดบริษัทเข้ากลุ่ม
  let resolvedCompanyId = companyId;
  let companyName = null;
  if (!resolvedCompanyId) {
    const group = await getCompanyByTelegramChatId(chatId);
    resolvedCompanyId = group?.companyId || null;
    companyName = group?.companyName || null;
  }
  if (!resolvedCompanyId) {
    console.warn(`⚠️ [MorningScheduler] Telegram group ${chatId} is not linked to an active company in BO (telegram_groups). Briefing NOT sent.`);
    return { skipped: true, reason: 'GROUP_NOT_LINKED_TO_COMPANY', targetDate: targetDateStr, chatId };
  }

  // ตรวจสอบ Idempotent Guard
  if (!force) {
    const alreadySent = await hasBriefingBeenSentToday(targetDateStr, chatId);
    if (alreadySent) {
      console.log(`ℹ️ [MorningScheduler] Briefing for ${targetDateStr} already sent to chat ${chatId}. Skipping.`);
      return { skipped: true, reason: 'ALREADY_SENT_TODAY', targetDate: targetDateStr, chatId };
    }
  }

  console.log(`🌅 [MorningScheduler] Generating Morning Briefing for ${targetDateStr} (Chat: ${chatId})...`);
  const { text, metrics } = await generateMorningBriefing({ companyId: resolvedCompanyId, companyName });

  // ส่งข้อความเข้ากลุ่ม Telegram
  const sendRes = await sendTelegramMessage(chatId, text, 'Markdown');

  // บันทึก Log และ Idempotent State
  await recordBriefingSent({
    companyId: resolvedCompanyId,
    chatId,
    targetDateStr,
    metrics
  });

  console.log(`✅ [MorningScheduler] Morning Briefing successfully delivered to ${chatId} for ${targetDateStr}!`);
  return {
    ok: true,
    sent: true,
    chatId,
    targetDate: targetDateStr,
    metrics,
    telegramResponse: sendRes
  };
}

/**
 * สตาร์ท Cron/Interval ตรวจสอบเวลาทุกๆ 30 วินาที เพื่อส่งสรุปเช้าเวลา 11:00 น.
 */
export function startMorningBriefingScheduler({
  targetHour = parseInt(process.env.BRIEFING_TARGET_HOUR || '11', 10),
  targetMinute = parseInt(process.env.BRIEFING_TARGET_MINUTE || '0', 10),
  checkIntervalMs = 30000
} = {}) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  console.log(`⏰ [MorningScheduler] Initialized. Daily morning briefing target set to ${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')} ICT.`);

  schedulerInterval = setInterval(async () => {
    if (isExecutionLock) return;

    const { hour, minute } = getBangkokTime();

    // เช็คว่าอยู่ในช่วงเวลาเป้าหมาย (เช่น 11:00 - 11:05 น.)
    if (hour === targetHour && minute >= targetMinute && minute <= targetMinute + 5) {
      isExecutionLock = true;
      try {
        const targetChatId = process.env.TELEGRAM_EXEC_GROUP_ID || '-5495142610';
        await sendMorningBriefing({ chatId: targetChatId, force: false });
      } catch (err) {
        console.error('❌ [MorningScheduler] Error during scheduled briefing delivery:', err.message);
      } finally {
        isExecutionLock = false;
      }
    }
  }, checkIntervalMs);
}

/**
 * หยุดการทำงานของ Scheduler
 */
export function stopMorningBriefingScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('🛑 [MorningScheduler] Stopped.');
  }
}

/**
 * ดึงสถานะปัจจุบันของ Morning Briefing Scheduler
 */
export function getMorningSchedulerStatus() {
  const { hour, minute, second } = getBangkokTime();
  const todayDateStr = getBangkokDateString();
  const targetChatId = process.env.TELEGRAM_EXEC_GROUP_ID || '-5495142610';
  const isSentToday = sentBriefingsCache.has(`${todayDateStr}:${targetChatId}`);
  const configuredHour = parseInt(process.env.BRIEFING_TARGET_HOUR || '11', 10);
  const configuredMinute = parseInt(process.env.BRIEFING_TARGET_MINUTE || '0', 10);
  const targetScheduledTime = `${String(configuredHour).padStart(2, '0')}:${String(configuredMinute).padStart(2, '0')} ICT`;

  return {
    isActive: !!schedulerInterval,
    currentTimeBangkok: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
    todayDateBangkok: todayDateStr,
    targetScheduledTime,
    targetChatId,
    isSentToday,
    cachedKeys: Array.from(sentBriefingsCache)
  };
}
