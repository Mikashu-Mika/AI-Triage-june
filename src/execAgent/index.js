/**
 * Executive assistant pipeline: router (LLM) -> data tools (code) -> composer (LLM + number check).
 */
import { supabase } from '../supabase.js';
import { routeQuery } from './router.js';
import { TOOL_HANDLERS, loadCategoryContext } from './tools.js';
import { composeAnswer, composeChitchat, unsupportedText } from './composer.js';

const HISTORY_TURNS = 3;

// Deterministic backstop for requests of personal contact data (the router also detects these)
const PERSONAL_DATA_PATTERN = /(เบอร์โทร|เบอร์ลูกค้า|ขอเบอร์|เบอร์มือถือ|อีเมลลูกค้า|ขออีเมล|อีเมล์ลูกค้า|รหัสผ่านลูกค้า|password ลูกค้า|ขอรหัสผ่าน)/i;

/** Last turns of this Telegram chat, for follow-up questions */
async function loadHistory(chatId) {
  if (!chatId) return [];
  const { data, error } = await supabase
    .from('agent_audit_logs')
    .select('user_query, slots, reply, created_at')
    .eq('chat_id', String(chatId))
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS);
  if (error) {
    console.warn('⚠️ [Exec Agent] Could not load conversation history:', error.message);
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
  }
  return [...new Set(ids)].slice(0, 50);
}

/**
 * Answer one executive question.
 * @param {{ query: string, companyId: string, chatId?: string }} input
 * @returns {Promise<{ reply: string, toolUsed: string, rawData: any, excelExport: any, slots: object, auditStatus: string }>}
 */
export async function runExecAgent({ query, companyId, chatId }) {
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

  const categories = await loadCategoryContext(companyId);
  const history = await loadHistory(chatId);

  let plan;
  try {
    plan = await routeQuery({ query, categories, history });
  } catch (err) {
    console.error('❌ [Exec Agent] Router failed:', err.message);
    return {
      reply: '⚠️ ขออภัยค่ะ ระบบวิเคราะห์คำถามไม่สำเร็จในขณะนี้ (AI ไม่ตอบสนอง) กรุณาลองใหม่อีกครั้งนะคะ',
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
  return {
    reply,
    toolUsed: plan.calls.map(c => c.tool).join('+') || (plan.unsupported_topics.length ? 'unsupported_data' : 'none'),
    rawData: results,
    excelExport: excel,
    slots: { ...plan, result_chat_ids: collectChatIds(results), compose_mode: mode },
    auditStatus: results.some(r => r.error) ? 'PARTIAL' : mode === 'llm' ? 'OK' : 'DETERMINISTIC'
  };
}
