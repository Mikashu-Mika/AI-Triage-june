/**
 * src/weeklyScheduler.js
 *
 * Sends the weekly executive summary (last Monday-Sunday) to the executive group every Monday.
 * - Default time 11:15 ICT, after the 11:00 morning briefing so the two arrive as separate messages.
 *   Change with WEEKLY_SUMMARY_HOUR / WEEKLY_SUMMARY_MINUTE; turn off with WEEKLY_SUMMARY_ENABLED=false.
 * - Its own duplicate guard (action WEEKLY_SUMMARY_AUTO, keyed by the week's Monday), so it never
 *   blocks or is blocked by the morning briefing's MORNING_BRIEFING_AUTO guard.
 */

import { supabase, getCompanyByTelegramChatId } from './supabase.js';
import { generateWeeklySummary, resolveWeekPeriod } from './execAgent/weeklySummary.js';
import { sendTelegramMessage } from './telegramBot.js';
import { getBangkokDateString, getBangkokTime } from './morningScheduler.js';

const ACTION_TYPE = 'WEEKLY_SUMMARY_AUTO';
const sentCache = new Set(); // `${weekStart}:${chatId}`
let schedulerInterval = null;
let isExecutionLock = false;

const defaultChatId = () => process.env.TELEGRAM_EXEC_GROUP_ID || '-5495142610';
const targetHour = () => parseInt(process.env.WEEKLY_SUMMARY_HOUR || '11', 10);
const targetMinute = () => parseInt(process.env.WEEKLY_SUMMARY_MINUTE || '15', 10);

/** Weekday in Thailand time: 0 = Sunday ... 1 = Monday */
export function getBangkokWeekday(d = new Date()) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
}

/** Whether the summary for the week starting `weekStart` (YYYY-MM-DD) already went to this chat */
export async function hasWeeklySummaryBeenSent(weekStart, chatId) {
  const cacheKey = `${weekStart}:${chatId}`;
  if (sentCache.has(cacheKey)) return true;

  try {
    // A week's summary is sent during the following week, so 14 days back covers it
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from('activity_logs')
      .select('details')
      .eq('action_type', ACTION_TYPE)
      .gte('created_at', since.toISOString())
      .limit(50);
    if (error) {
      console.warn('⚠️ [WeeklyScheduler] Could not check activity_logs for duplicates:', error.message);
      return false;
    }
    const match = (data || []).some(log => {
      const d = log.details && typeof log.details === 'object' ? log.details : {};
      return d.week_start === weekStart && String(d.chat_id) === String(chatId);
    });
    if (match) sentCache.add(cacheKey);
    return match;
  } catch (err) {
    console.error('⚠️ [WeeklyScheduler] Error checking duplicates:', err.message);
    return false;
  }
}

async function recordWeeklySummarySent({ companyId, chatId, weekStart, metrics }) {
  sentCache.add(`${weekStart}:${chatId}`);
  const { current, emerging } = metrics;
  const { error } = await supabase.from('activity_logs').insert([{
    company_id: companyId,
    user_name: 'Weekly Scheduler (Auto)',
    action_type: ACTION_TYPE,
    details: {
      week_start: weekStart,
      chat_id: chatId,
      channel: 'telegram_group',
      status: 'SENT',
      total_chats: current.totalChats,
      total_issues: current.totalIssues,
      urgent_count: current.urgentCount,
      emerging_count: emerging.emerging.length
    }
  }]);
  // If this insert fails (e.g. RLS with an anon key) the in-memory cache still stops a resend until restart
  if (error) console.warn('⚠️ [WeeklyScheduler] activity_logs insert warning:', error.message);
}

/**
 * Build and send the weekly summary.
 * @param {object} [options]
 * @param {string} [options.chatId] target Telegram group
 * @param {string} [options.companyId] company; defaults to the one linked to the group in BO
 * @param {string} [options.startDate] 'YYYY-MM-DD' to summarize a chosen week instead of last week
 * @param {string} [options.endDate]
 * @param {boolean} [options.force] skip the duplicate guard (testing)
 * @param {boolean} [options.dryRun] build the text and return it without sending or logging
 */
export async function sendWeeklySummary({
  chatId = defaultChatId(),
  companyId = null,
  startDate,
  endDate,
  force = false,
  dryRun = false
} = {}) {
  // Same rule as the morning briefing: only the company linked to this group in BO
  let resolvedCompanyId = companyId;
  let companyName = null;
  if (!resolvedCompanyId) {
    const group = await getCompanyByTelegramChatId(chatId);
    resolvedCompanyId = group?.companyId || null;
    companyName = group?.companyName || null;
  }
  if (!resolvedCompanyId) {
    console.warn(`⚠️ [WeeklyScheduler] Telegram group ${chatId} is not linked to an active company in BO. Weekly summary NOT sent.`);
    return { skipped: true, reason: 'GROUP_NOT_LINKED_TO_COMPANY', chatId };
  }

  const weekStart = getBangkokDateString(resolveWeekPeriod({ startDate, endDate }).start);
  if (!force && !dryRun && await hasWeeklySummaryBeenSent(weekStart, chatId)) {
    console.log(`ℹ️ [WeeklyScheduler] Week ${weekStart} already sent to ${chatId}. Skipping.`);
    return { skipped: true, reason: 'ALREADY_SENT', weekStart, chatId };
  }

  const { text, metrics } = await generateWeeklySummary({ companyId: resolvedCompanyId, companyName, startDate, endDate });
  if (dryRun) return { dryRun: true, weekStart, chatId, text };

  const telegramResponse = await sendTelegramMessage(chatId, text, 'Markdown');
  await recordWeeklySummarySent({ companyId: resolvedCompanyId, chatId, weekStart, metrics });
  console.log(`✅ [WeeklyScheduler] Weekly summary for week ${weekStart} sent to ${chatId}`);
  return { ok: true, sent: true, weekStart, chatId, telegramResponse };
}

const RETRY_AFTER_MS = 10 * 60 * 1000;
let lastAttemptAt = 0;

/**
 * Check every 30 s. On Monday from the target time until midnight, send last week's summary once.
 * Sending any time after the target (not only in a 5-minute window) means a bot restarted late on
 * Monday still sends; the duplicate guard keeps it to one message. Failed or skipped attempts wait
 * 10 minutes before trying again.
 */
export function startWeeklySummaryScheduler({ checkIntervalMs = 30000 } = {}) {
  if (process.env.WEEKLY_SUMMARY_ENABLED === 'false') {
    console.log('⏸️ [WeeklyScheduler] Disabled (WEEKLY_SUMMARY_ENABLED=false).');
    return;
  }
  if (schedulerInterval) clearInterval(schedulerInterval);
  const hour = targetHour();
  const minute = targetMinute();
  console.log(`⏰ [WeeklyScheduler] Initialized. Weekly summary every Monday ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ICT.`);

  schedulerInterval = setInterval(async () => {
    if (isExecutionLock || getBangkokWeekday() !== 1) return;
    const now = getBangkokTime();
    if (now.hour * 60 + now.minute < hour * 60 + minute) return;
    const weekStart = getBangkokDateString(resolveWeekPeriod().start);
    if (sentCache.has(`${weekStart}:${defaultChatId()}`)) return;
    if (Date.now() - lastAttemptAt < RETRY_AFTER_MS) return;
    isExecutionLock = true;
    lastAttemptAt = Date.now();
    try {
      // A summary already sent before a restart is found in activity_logs and cached by the guard
      await sendWeeklySummary({ chatId: defaultChatId() });
    } catch (err) {
      console.error('❌ [WeeklyScheduler] Error sending weekly summary:', err.message);
    } finally {
      isExecutionLock = false;
    }
  }, checkIntervalMs);
}

export function stopWeeklySummaryScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

export function getWeeklySchedulerStatus() {
  const weekStart = getBangkokDateString(resolveWeekPeriod().start);
  return {
    isActive: !!schedulerInterval,
    schedule: `Monday ${String(targetHour()).padStart(2, '0')}:${String(targetMinute()).padStart(2, '0')} ICT`,
    lastWeekStart: weekStart,
    targetChatId: defaultChatId(),
    isLastWeekSent: sentCache.has(`${weekStart}:${defaultChatId()}`)
  };
}
