/**
 * LLM intent router: turns an executive's Thai question (+ recent conversation) into a structured plan
 * of tool calls. It never answers by itself and never computes numbers.
 */
import { ollamaChat, parseJsonObject } from './llm.js';
import { PERIOD_TYPES, todayContext } from './timeframe.js';

export const TOOL_NAMES = [
  'get_issue_stats', 'list_chats', 'compare_periods', 'get_customer_stats',
  'search_chats', 'get_sentiment', 'get_category_info', 'get_resolution_advice'
];
export const UNSUPPORTED_TOPICS = ['money_amounts', 'slips', 'campaigns', 'admin_response_time', 'personal_data', 'out_of_scope'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const GROUP_BY = ['category', 'priority', 'day', 'hour'];
const METRICS = ['issues', 'chats', 'new_customers', 'total', 'new', 'new_list', 'returning_ratio', 'new_by_month', 'repeat_customers'];
const SORTS = ['newest', 'oldest', 'priority'];
const MAX_CALLS = 3;

const periodSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: PERIOD_TYPES },
    n: { type: 'integer' },
    month: { type: 'integer' },
    year: { type: 'integer' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    start_hour: { type: 'integer' },
    end_hour: { type: 'integer' }
  },
  required: ['type']
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reply_mode: { type: 'string', enum: ['data', 'chitchat', 'clarify'] },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: TOOL_NAMES },
          args: {
            type: 'object',
            properties: {
              period: periodSchema,
              period_b: periodSchema,
              categories: { type: 'array', items: { type: 'string' } },
              priorities: { type: 'array', items: { type: 'string', enum: PRIORITIES } },
              group_by: { type: 'string', enum: GROUP_BY },
              metric: { type: 'string', enum: METRICS },
              query: { type: 'string' },
              chat_ids: { type: 'array', items: { type: 'string' } },
              sort: { type: 'string', enum: SORTS },
              limit: { type: 'integer' },
              category: { type: 'string' }
            }
          }
        },
        required: ['tool', 'args']
      }
    },
    unsupported_topics: { type: 'array', items: { type: 'string', enum: UNSUPPORTED_TOPICS } },
    focus: { type: 'string' },
    clarify_question: { type: 'string' }
  },
  required: ['reply_mode', 'calls', 'unsupported_topics']
};

function buildSystemPrompt(categories) {
  const categoryLines = [...categories.values()].map(c => `- ${c.key}: ${c.name}`).join('\n');
  return `You are the intent router of "Sift AI", a Thai executive assistant over customer-chat analytics.
Read the executive's question (Thai) and the recent conversation, then output ONE JSON plan. Do not answer the question.
Today's date is given with each question (Thailand time). Weeks start on Monday.

DATA THAT EXISTS: customer chats, AI-classified problem issues per chat (category + priority), chat sentiment, customer registrations (count/name/registration time only), knowledge-base SOPs per category.
DATA THAT DOES NOT EXIST (put in unsupported_topics, never route to a tool for it):
- money_amounts: deposit/withdrawal amounts, balances, "ยอดฝาก", "ยอดถอน", "ยอดเงิน", "ฝากแรก" counts, transactions
- slips: bank transfer slips
- campaigns: marketing campaigns, promotions performance, traffic channels
- admin_response_time: how fast admins reply, SLA, response minutes
- personal_data: phone numbers, emails, passwords of customers (policy: never disclosed)
- out_of_scope: anything unrelated to the business (weather, food, ...)
Note: PROBLEMS reported in chats about deposits/withdrawals ARE supported (category deposit_withdrawal); only money AMOUNTS are not.

TOOLS (args in parentheses; every tool also takes "period"):
- get_issue_stats(categories?, priorities?, group_by=category|priority|day|hour): counts/percentages of problems; top problems; busiest hour/day; how many urgent cases.
- list_chats(categories?, priorities?, query?, chat_ids?, sort=newest|oldest|priority, limit<=20): which chats / details / examples. Use chat_ids from the conversation history when the user refers to items shown before ("เคสนั้น", "13 รายการนี่", "ข้อ 2").
- compare_periods(metric=issues|chats|new_customers, period, period_b, categories?): compare two periods. If only one period is named, set period_b to the previous comparable period.
- get_customer_stats(metric=total|new|new_list|returning_ratio|new_by_month|repeat_customers): customer counts, who registered, share of chats from existing customers, customers who contacted again / repeated the same problem ("ทักซ้ำ", "แจ้งเรื่องเดิม").
- search_chats(query): chats about a specific topic that is not a category (e.g. วันเกิด, อายัด, หวย, เปลี่ยนข้อมูล, VIP). query = 1-3 specific Thai keywords (at least 3 letters each); never generic words such as แอดมิน, ลูกค้า, เว็บ, ปัญหา.
- get_sentiment(): customer mood / satisfaction, and chats where customers praised or thanked the service (positive_examples).
- get_category_info(category): what a category means.
- get_resolution_advice(category?): how to fix / root cause / what to do about a problem (omit category to use the top problem).

CATEGORIES (use the key in "categories"/"category"):
${categoryLines}

PERIOD: {"type": one of ${PERIOD_TYPES.join('|')}, "n" for last_n_days, "month"(1-12) and optional "year" for month, "start_date"/"end_date" (YYYY-MM-DD) for date_range, optional "start_hour"/"end_hour" (0-24) for a time-of-day window like "12.00-18.00"}.
If the question gives no time, reuse the period of the previous turn when it is a follow-up; otherwise use {"type":"last_n_days","n":7}. "ช่วงนี้" = last_n_days 7. "1 สัปดาห์" = last_n_days 7.

RULES
- reply_mode "data" when at least one tool call or a missing-data topic applies; "chitchat" for greetings, thanks, compliments or complaints about the bot itself, jokes, small talk and anything unrelated to the business (out_of_scope); "clarify" only if the question is impossible to interpret (ask in Thai in clarify_question).
- At most ${MAX_CALLS} calls. A question mixing supported and unsupported data gets both calls and unsupported_topics.
- "focus": short note of what the user wants emphasized (e.g. "ตอบเรื่องเดียว", "เรียงตามวันที่", "เฉพาะเปอร์เซ็นต์"), else "".

EXAMPLES
Q: วันนี้มีปัญหาอะไรบ้าง -> {"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"today"}}}],"unsupported_topics":[],"focus":""}
Q: เมื่อวานตอน 12.00-18.00 มีกี่ปัญหา -> {"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"yesterday","start_hour":12,"end_hour":18}}}],"unsupported_topics":[],"focus":""}
Q: วันนี้มีลูกค้าสมัครใหม่กี่คน -> {"reply_mode":"data","calls":[{"tool":"get_customer_stats","args":{"metric":"new","period":{"type":"today"}}}],"unsupported_topics":[],"focus":""}
Q: เดือนที่แล้ว มีปัญหาเกี่ยวกับการสมัครไม่ได้ไหม -> {"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"last_month"},"categories":["registration"]}}],"unsupported_topics":[],"focus":""}
Q: เปรียบเทียบสมาชิกใหม่เดือนนี้กับเดือนที่แล้ว -> {"reply_mode":"data","calls":[{"tool":"compare_periods","args":{"metric":"new_customers","period":{"type":"this_month"},"period_b":{"type":"last_month"}}}],"unsupported_topics":[],"focus":""}
Q: ปัญหาฝากถอนส่วนมากแจ้งมาช่วงเวลาไหน ในเดือนที่แล้ว -> {"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"last_month"},"categories":["deposit_withdrawal"],"group_by":"hour"}}],"unsupported_topics":[],"focus":""}
Q: เคสด่วนเดือนนี้มีเคสไหนบ้าง -> {"reply_mode":"data","calls":[{"tool":"list_chats","args":{"period":{"type":"this_month"},"priorities":["urgent","high"],"sort":"priority"}}],"unsupported_topics":[],"focus":""}
Q: มีแชทที่ลูกค้าชมแอดมินไหมเดือนนี้ -> {"reply_mode":"data","calls":[{"tool":"get_sentiment","args":{"period":{"type":"this_month"}}}],"unsupported_topics":[],"focus":"เฉพาะแชตที่ลูกค้าชม"}
Q: มีลูกค้าที่แจ้งเรื่องเดิมเมื่อวานแล้ววันนี้ทักซ้ำไหม -> {"reply_mode":"data","calls":[{"tool":"get_customer_stats","args":{"metric":"repeat_customers","period":{"type":"last_n_days","n":2}}}],"unsupported_topics":[],"focus":""}
Q: หน้าเว็บค้างควรแก้ยังไง -> {"reply_mode":"data","calls":[{"tool":"get_resolution_advice","args":{"category":"page_load_freeze","period":{"type":"last_n_days","n":30}}}],"unsupported_topics":[],"focus":""}
Q: สรุปยอดเงินและปัญหาของเดือนนี้ -> {"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"this_month"}}}],"unsupported_topics":["money_amounts"],"focus":""}
Q: สัปดาห์นี้แอดมินตอบแชทช้าสุดกี่นาที -> {"reply_mode":"data","calls":[],"unsupported_topics":["admin_response_time"],"focus":""}
Q: ขอเบอร์โทรลูกค้าใหม่หน่อย -> {"reply_mode":"data","calls":[],"unsupported_topics":["personal_data"],"focus":""}
Q: วันนี้ลูกค้า complain เรื่องอะไรมากสุด ขอเรื่องเดียว -> {"reply_mode":"data","calls":[{"tool":"get_issue_stats","args":{"period":{"type":"today"},"categories":["feedback_complaint"]}},{"tool":"list_chats","args":{"period":{"type":"today"},"categories":["feedback_complaint"],"limit":5}}],"unsupported_topics":[],"focus":"ตอบเรื่องเดียวที่ลูกค้าร้องเรียนมากที่สุด"}
Q: สวัสดี -> {"reply_mode":"chitchat","calls":[],"unsupported_topics":[],"focus":""}
Q: ทำไมเก่งจัง -> {"reply_mode":"chitchat","calls":[],"unsupported_topics":[],"focus":""}
Q: วันนี้กินอะไรดี -> {"reply_mode":"chitchat","calls":[],"unsupported_topics":["out_of_scope"],"focus":""}
Q: จะตอบมั่วทำไมเนี้ย -> {"reply_mode":"chitchat","calls":[],"unsupported_topics":[],"focus":""}`;
}

function buildHistoryText(history) {
  if (!history || history.length === 0) return '(no previous turns)';
  return history.map((h, i) => {
    const calls = (h.slots?.calls || []).map(c => `${c.tool}${JSON.stringify(c.args)}`).join('; ') || '-';
    const ids = (h.slots?.result_chat_ids || []).slice(0, 30).join(', ') || '-';
    return `Turn ${i + 1}\nQ: ${h.user_query}\nPlan: ${calls}\nChat ids shown: ${ids}\nAnswer (excerpt): ${(h.reply || '').replace(/\s+/g, ' ').slice(0, 300)}`;
  }).join('\n\n');
}

/** Keep only well-formed calls and values (the LLM output is untrusted) */
function sanitizePlan(raw) {
  const mode = ['data', 'chitchat', 'clarify'].includes(raw?.reply_mode) ? raw.reply_mode : 'data';
  const calls = (Array.isArray(raw?.calls) ? raw.calls : [])
    .filter(c => c && TOOL_NAMES.includes(c.tool))
    .slice(0, MAX_CALLS)
    .map(c => {
      const a = c.args && typeof c.args === 'object' ? c.args : {};
      const args = {};
      if (a.period?.type) args.period = a.period;
      if (a.period_b?.type) args.period_b = a.period_b;
      if (Array.isArray(a.categories)) args.categories = a.categories.map(String).slice(0, 5);
      if (Array.isArray(a.priorities)) args.priorities = a.priorities.filter(p => PRIORITIES.includes(p));
      if (GROUP_BY.includes(a.group_by)) args.group_by = a.group_by;
      if (METRICS.includes(a.metric)) args.metric = a.metric;
      if (typeof a.query === 'string' && a.query.trim()) args.query = a.query.trim().slice(0, 100);
      if (Array.isArray(a.chat_ids)) args.chat_ids = a.chat_ids.map(String).slice(0, 100);
      if (SORTS.includes(a.sort)) args.sort = a.sort;
      if (Number.isInteger(a.limit)) args.limit = a.limit;
      if (typeof a.category === 'string' && a.category.trim()) args.category = a.category.trim();
      if (!args.period && c.tool !== 'get_category_info') args.period = { type: 'last_n_days', n: 7 };
      return { tool: c.tool, args };
    });
  const unsupported = (Array.isArray(raw?.unsupported_topics) ? raw.unsupported_topics : []).filter(t => UNSUPPORTED_TOPICS.includes(t));
  // Nothing to fetch and nothing to refuse except "out of scope" = small talk, answered conversationally
  const onlySmallTalk = calls.length === 0 && unsupported.every(t => t === 'out_of_scope');
  return {
    reply_mode: mode === 'data' && onlySmallTalk ? 'chitchat' : mode,
    calls,
    unsupported_topics: [...new Set(unsupported)],
    focus: typeof raw?.focus === 'string' ? raw.focus.slice(0, 200) : '',
    clarify_question: typeof raw?.clarify_question === 'string' ? raw.clarify_question.slice(0, 300) : ''
  };
}

/**
 * Plan how to answer the question.
 * @param {{ query: string, categories: Map, history: any[] }} input
 * @returns {Promise<{ reply_mode: string, calls: any[], unsupported_topics: string[], focus: string, clarify_question: string }>}
 */
export async function routeQuery({ query, categories, history }) {
  const today = todayContext();
  const { content, promptTokens, durationMs, loadMs } = await ollamaChat([
    // The system prompt stays identical between questions, so Ollama can reuse its cached evaluation
    { role: 'system', content: buildSystemPrompt(categories) },
    { role: 'user', content: `TODAY: ${today.thai} (ISO ${today.iso})\n\nRECENT CONVERSATION:\n${buildHistoryText(history)}\n\nQUESTION: ${query}` }
  ], { format: PLAN_SCHEMA, temperature: 0, maxTokens: 500 });
  console.log(`🧭 [Router] ${promptTokens ?? '?'} prompt tokens, ${durationMs ?? '?'} ms (model load ${loadMs ?? 0} ms)`);
  return { ...sanitizePlan(parseJsonObject(content)), timing: { prompt_tokens: promptTokens, duration_ms: durationMs, load_ms: loadMs } };
}
