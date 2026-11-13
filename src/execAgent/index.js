/**
 * Executive assistant pipeline: router (LLM) -> data tools (code) -> composer (LLM + number check).
 */
import { supabase } from '../supabase.js';
import { routeQuery } from './router.js';
import { TOOL_HANDLERS, loadCategoryContext } from './tools.js';
import { composeAnswer, composeChitchat, unsupportedText } from './composer.js';
import { generateMorningBriefing } from './morningBriefing.js';

const HISTORY_TURNS = 3;
const HISTORY_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes threshold for continuous context

// Deterministic backstop for requests of personal contact data (the router also detects these)
const PERSONAL_DATA_PATTERN = /(เบอร์โทร|เบอร์ลูกค้า|ขอเบอร์|เบอร์มือถือ|อีเมลลูกค้า|ขออีเมล|อีเมล์ลูกค้า|รหัสผ่านลูกค้า|password ลูกค้า|ขอรหัสผ่าน)/i;
const MORNING_BRIEFING_PATTERN = /(สรุปเช้า|สรุปรายงานเช้า|รายงานยามเช้า|morning\s*briefing|ขอสรุปเช้า|บรีฟเช้า)/i;

// In-memory conversation history cache (instant & immune to database RLS policies)
const memoryHistory = new Map();

export function saveHistoryTurn(chatId, turn) {
  if (!chatId) return;
  const key = String(chatId);
  const list = memoryHistory.get(key) || [];
  list.push({
    ...turn,
    created_at: turn.created_at || new Date().toISOString()
  });
  memoryHistory.set(key, list.slice(-5));
}

/** Last turns of this Telegram chat, for follow-up questions (within 30 minutes) */
async function loadHistory(chatId) {
  if (!chatId) return [];
  const key = String(chatId);
  const mem = memoryHistory.get(key) || [];
  const freshMem = mem.filter(h => (Date.now() - new Date(h.created_at).getTime()) <= HISTORY_MAX_AGE_MS);
  if (freshMem.length > 0) {
    return freshMem;
  }

  const since = new Date(Date.now() - HISTORY_MAX_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from('agent_audit_logs')
    .select('user_query, slots, reply, audit_status, created_at')
    .eq('chat_id', key)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS);
  if (error) {
    return [];
  }
  return (data || []).reverse();
}

/** Chat ids shown to the user, so a follow-up like "ข้อ 2" can be resolved next turn */
function collectChatIds(results) {
  const ids = [];
  for (const r of results) {
    (r.items || []).forEach(it => it.chat_id && ids.push(it.chat_id));
    (r.example_chats || []).forEach(id => ids.push(id));
    (r.negative_examples || []).forEach(e => e.chat_id && ids.push(e.chat_id));
    (r.positive_examples || []).forEach(e => e.chat_id && ids.push(e.chat_id));
    (r.repeat_customers || []).forEach(rc => (rc.chat_ids || []).forEach(id => ids.push(id)));
    (r.emerging || []).forEach(e => (e.examples || []).forEach(x => x.chat_id && ids.push(x.chat_id)));
  }
  return [...new Set(ids)].slice(0, 50);
}

/**
 * Answer one executive question.
 * @param {{ query: string, companyId: string, chatId?: string }} input
 * @returns {Promise<{ reply: string, toolUsed: string, rawData: any, excelExport: any, slots: object, auditStatus: string }>}
 */
export async function runExecAgent({ query, companyId, chatId, history: explicitHistory }) {
  if (PERSONAL_DATA_PATTERN.test(query)) {
    return {
      reply: unsupportedText(['personal_data']).replace(/^- /, '🔒 '),
      toolUsed: 'personal_data_block',
      rawData: null,
      excelExport: null,
      slots: { calls: [], unsupported_topics: ['personal_data'] },
      auditStatus: 'BLOCKED'
    };
  }

  if (MORNING_BRIEFING_PATTERN.test(query)) {
    const { text, metrics } = await generateMorningBriefing({ companyId });
    return {
      reply: text,
      toolUsed: 'morning_briefing',
      rawData: [metrics],
      excelExport: null,
      slots: { calls: [{ tool: 'morning_briefing', args: { period: 'yesterday' } }], compose_mode: 'deterministic' },
      auditStatus: 'OK'
    };
  }

  const categories = await loadCategoryContext(companyId);
  const rawHistory = explicitHistory || await loadHistory(chatId);
  const history = (rawHistory || []).filter(h => !h.created_at || (Date.now() - new Date(h.created_at).getTime()) <= HISTORY_MAX_AGE_MS);

  let plan;
  try {
    plan = await routeQuery({ query, companyId, categories, history });
  } catch (err) {
    console.error('❌ [Exec Agent] Router failed:', err.message);
    const isTimeout = /timeout/i.test(err.message);
    const reply = isTimeout
      ? '⚠️ ขออภัยค่ะ AI ใช้เวลาวิเคราะห์คำถามนานเกินกำหนด (เครื่องที่รัน AI อาจทำงานหนักหรือเพิ่งเริ่มโหลดโมเดล) กรุณาลองใหม่อีกครั้งนะคะ'
      : err.code === 'ROUTER_BAD_OUTPUT'
        ? '⚠️ ขออภัยค่ะ AI วิเคราะห์คำถามนี้ไม่สำเร็จ ลองพิมพ์ใหม่ให้ระบุช่วงเวลาหรือหัวข้อชัดขึ้น เช่น "เทียบปัญหาเดือนนี้กับเดือนที่แล้ว" นะคะ'
        : '⚠️ ขออภัยค่ะ ระบบวิเคราะห์คำถามไม่สำเร็จในขณะนี้ (เชื่อมต่อ AI ไม่ได้) กรุณาลองใหม่อีกครั้งนะคะ';
    return {
      reply,
      toolUsed: 'router_error',
      rawData: null,
      excelExport: null,
      slots: { error: err.message },
      auditStatus: 'ERROR'
    };
  }

  if (plan.reply_mode === 'clarify' && plan.clarify_question) {
    return { reply: plan.clarify_question, toolUsed: 'clarify', rawData: null, excelExport: null, slots: plan, auditStatus: 'CLARIFY' };
  }
  if (plan.reply_mode === 'chitchat') {
    const reply = await composeChitchat(query, history);
    return { reply, toolUsed: 'chitchat', rawData: null, excelExport: null, slots: plan, auditStatus: 'CHITCHAT' };
  }

  const ctx = { companyId, categories };
  const results = [];
  for (const call of plan.calls) {
    try {
      results.push(await TOOL_HANDLERS[call.tool](ctx, call.args));
    } catch (err) {
      console.error(`❌ [Exec Agent] Tool ${call.tool} failed:`, err.message);
      results.push({ tool: call.tool, error: 'ดึงข้อมูลไม่สำเร็จ' });
    }
  }

  const { reply, mode } = results.length > 0
    ? await composeAnswer({ query, focus: plan.focus, results, unsupportedTopics: plan.unsupported_topics })
    : { reply: unsupportedText(plan.unsupported_topics), mode: 'deterministic' };

  const excel = results.find(r => r.excel_export)?.excel_export || null;
  const output = {
    reply,
    toolUsed: plan.calls.map(c => c.tool).join('+') || (plan.unsupported_topics.length ? 'unsupported_data' : 'none'),
    rawData: results,
    excelExport: excel,
    slots: { ...plan, result_chat_ids: collectChatIds(results), compose_mode: mode },
    auditStatus: results.some(r => r.error) ? 'PARTIAL' : mode === 'llm' ? 'OK' : 'DETERMINISTIC'
  };

  if (chatId) {
    saveHistoryTurn(chatId, {
      user_query: query,
      slots: output.slots,
      reply: output.reply,
      audit_status: output.auditStatus,
      created_at: new Date().toISOString()
    });
  }

  return output;
}
