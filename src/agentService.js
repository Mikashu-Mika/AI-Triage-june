import { supabase } from './supabase.js';
import { getDefaultCompanyId } from './categoryHelper.js';
import { runExecAgent } from './execAgent/index.js';
import dotenv from 'dotenv';
import { registerInteractiveStart, registerInteractiveEnd } from './aiScheduler.js';
dotenv.config();

// In-Memory FIFO Queue Management Engine (one LLM-backed question at a time)
const queryQueue = [];
let isProcessingQueue = false;

/**
 * Log AI Agent activity to Supabase `activity_logs` and `telegram_chat_logs` tables
 */
export async function logAgentActivity({ query, reply, toolUsed, durationMs, senderName, senderId, channel, companyId, chatId }) {
  try {
    const resolvedCompanyId = companyId || await getDefaultCompanyId();

    // 1. Log to system-wide activity_logs table
    const { error: err1 } = await supabase.from('activity_logs').insert([{
      company_id: resolvedCompanyId,
      user_name: senderName || 'AI Agent User',
      action_type: 'AI_AGENT_QUERY',
      details: {
        query: query,
        tool_used: toolUsed,
        reply: reply,
        duration_ms: durationMs,
        channel: channel || 'telegram',
        chat_id: chatId || null,
        sender_id: senderId || null
      }
    }]);
    if (err1) console.error('⚠️ [Supabase activity_logs Error]:', err1.message);

    // 2. Log to dedicated telegram_chat_logs table for Telegram queries
    if (channel && channel.startsWith('telegram')) {
      const { error: err2 } = await supabase.from('telegram_chat_logs').insert([{
        company_id: resolvedCompanyId,
        chat_id: chatId || null,
        sender_name: senderName || 'Telegram User',
        sender_id: senderId || null,
        user_query: query,
        bot_reply: reply,
        tool_used: toolUsed
      }]);
      if (err2) console.error('⚠️ [Supabase telegram_chat_logs Error]:', err2.message);
    }

    console.log(`📝 [Supabase Dual Log Saved] Query: "${query}" (${durationMs}ms) by User ${senderName} (ID: ${senderId || 'N/A'})`);
  } catch (err) {
    console.error('⚠️ [Supabase Activity Log Exception]:', err.message);
  }
}

/**
 * Enqueue AI Agent Query Task (Queue Management Engine)
 */
export function enqueueAgentQuery(task) {
  registerInteractiveStart(task.channel || 'Telegram', task.isExecutive, task.senderName);
  return new Promise((resolve, reject) => {
    queryQueue.push({ task, resolve, reject });
    processQueue();
  });
}

/**
 * Detect adversarial prompt injection attempts (Jailbreak, System Prompt Leak, Prompt Override).
 * @param {string} text - User input string
 * @returns {{ isMalicious: boolean, matchedPattern: string|null }}
 */
export function detectPromptInjection(text = '') {
  if (!text || typeof text !== 'string') return { isMalicious: false, matchedPattern: null };

  const lower = text.toLowerCase();
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above|safety|security)?\s*(instructions|directives|prompts|rules)/i,
    /disregard\s+(all\s+)?(previous|prior|above|safety|security)?\s*(instructions|directives|prompts|rules)/i,
    /forget\s+(all\s+)?(previous|prior|above|safety|security|system)?\s*(instructions|rules|protocols|prompts)/i,
    /override\s+(all\s+)?(system|safety|security)\s+(rules|prompts|protocols)/i,
    /you\s+are\s+now\s+(in\s+developer\s+mode|dan|jailbreak|an\s+unrestricted\s+ai)/i,
    /reveal\s+(your\s+)?(system\s+prompt|instructions|initial\s+prompt|hidden\s+rules|database|secret|password)/i,
    /show\s+me\s+(your\s+)?(system\s+prompt|secret\s+key|database\s+password|client_secret)/i,
    /dump\s+(all\s+)?(passwords|secrets|database|env|credentials)/i,
    /ลืมคำสั่ง(ก่อนหน้า|ทั้งหมด|เดิม|ความปลอดภัย)/i,
    /ยกเลิกกฎ(ความปลอดภัย|ทั้งหมด|ของระบบ)/i,
    /แสดง\s*(system\s*prompt|รหัสผ่าน|ความลับของระบบ|client_secret)/i
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(lower)) {
      return { isMalicious: true, matchedPattern: pattern.toString() };
    }
  }

  return { isMalicious: false, matchedPattern: null };
}

async function processQueue() {
  if (isProcessingQueue || queryQueue.length === 0) return;
  isProcessingQueue = true;

  try {
    while (queryQueue.length > 0) {
      const { task, resolve, reject } = queryQueue.shift();
      const startTime = Date.now();
      try {
        // Step 0: Prompt Injection & Adversarial Attack Detection Guard
        const injectionCheck = detectPromptInjection(task.userQuery);
        if (injectionCheck.isMalicious) {
          console.warn(`🛡️ [Security Guard] Blocked Prompt Injection attempt: "${task.userQuery}" (Pattern: ${injectionCheck.matchedPattern})`);
          const blockedResult = {
            reply: '🛡️ **แจ้งเตือนความปลอดภัย (Security Guard)**: ตรวจพบรูปแบบข้อความที่ไม่ปลอดภัยหรือพยายามแทรกแซงคำสั่งของระบบ จึงขอปฏิเสธการประมวลผลคำสั่งนี้ค่ะ ✨',
            toolUsed: 'prompt_injection_blocked'
          };
          await logAgentActivity({
            query: task.userQuery,
            reply: blockedResult.reply,
            toolUsed: blockedResult.toolUsed,
            durationMs: Date.now() - startTime,
            senderName: task.senderName,
            senderId: task.senderId,
            channel: task.channel,
            companyId: task.companyId,
            chatId: task.chatId
          });
          resolve(blockedResult);
          continue;
        }

        const result = await processAgentQueryDirect(task.userQuery, task.companyId, task);
        const durationMs = Date.now() - startTime;

        // Log activity to Supabase activity_logs and telegram_chat_logs
        await logAgentActivity({
          query: task.userQuery,
          reply: result.reply,
          toolUsed: result.toolUsed,
          durationMs,
          senderName: task.senderName,
          senderId: task.senderId,
          channel: task.channel,
          companyId: task.companyId,
          chatId: task.chatId
        });

        resolve(result);
      } catch (err) {
        console.error('⚠️ [Queue Task Error]:', err.message);
        resolve({
          reply: '⚠️ ขออภัยค่ะ เกิดข้อผิดพลาดในการประมวลผลคำสั่ง กรุณาลองใหม่อีกครั้งนะคะ',
          toolUsed: 'queue_error'
        });
      } finally {
        registerInteractiveEnd(task.channel || 'Telegram', task.isExecutive);
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Answer one executive question with the Sift AI executive agent and save its audit trail.
 * @param {string} userQuery
 * @param {string} companyId
 * @param {{ chatId?: string }} [taskOptions]
 */
async function processAgentQueryDirect(userQuery, companyId, taskOptions = {}) {
  console.log(`🤖 AI Agent processing query: "${userQuery}" (Company: ${companyId || 'Global'})`);
  const resolvedCompanyId = companyId || await getDefaultCompanyId();

  const result = await runExecAgent({ query: userQuery, companyId: resolvedCompanyId, chatId: taskOptions.chatId });

  console.log(`🤖 [Agent Audit] "${userQuery}" -> ${result.toolUsed} (${result.auditStatus})`);
  try {
    const { error: auditErr } = await supabase.from('agent_audit_logs').insert([{
      company_id: resolvedCompanyId,
      chat_id: taskOptions.chatId ? String(taskOptions.chatId) : null,
      user_query: userQuery,
      tool_used: result.toolUsed,
      confidence_score: null,
      audit_status: result.auditStatus,
      slots: result.slots,
      rag_matches: [],
      fetched_data: result.rawData ?? null,
      reply: result.reply
    }]);
    if (auditErr) console.error('⚠️ [Supabase agent_audit_logs Error]:', auditErr.message);
  } catch (e) {
    console.error('⚠️ [Supabase agent_audit_logs Exception]:', e.message);
  }

  return {
    reply: result.reply,
    toolUsed: result.toolUsed,
    rawData: result.rawData,
    buttons: null,
    excelExport: result.excelExport
  };
}

export async function processAgentQuery(userQuery, companyId, options = {}) {
  return enqueueAgentQuery({
    userQuery,
    companyId,
    senderName: options.senderName || 'API User',
    senderId: options.senderId || null,
    channel: options.channel || 'api',
    chatId: options.chatId || null,
    isExecutive: !!options.isExecutive
  });
}

export { processAgentQueryDirect };
