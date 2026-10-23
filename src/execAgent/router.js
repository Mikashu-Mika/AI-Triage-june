/**
 * LLM intent router: turns an executive's Thai question (+ recent conversation) into a structured plan
 * of tool calls. It never answers by itself and never computes numbers.
 */
import { ollamaChat, parseJsonObject } from './llm.js';
import { PERIOD_TYPES, todayContext } from './timeframe.js';
import { findSimilarExamples, formatExamples } from './examples.js';

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
    // true when the question builds on the previous turn ("ทั้ง 45 ปัญหามีอะไรบ้าง", "แล้วเมื่อวานล่ะ")
    continues_previous: { type: 'boolean' },
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
            },
            // Forcing an explicit period stops the model from silently omitting the time frame
            required: ['period']
          }
        },
        required: ['tool', 'args']
      }
    },
    unsupported_topics: { type: 'array', items: { type: 'string', enum: UNSUPPORTED_TOPICS } },
    focus: { type: 'string' },
    clarify_question: { type: 'string' }
  },
  required: ['reply_mode', 'continues_previous', 'calls', 'unsupported_topics']
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

FOLLOW-UP QUESTIONS
Set "continues_previous": true when the question builds on the previous turn (refers to its results, numbers or items, or only changes one detail); the system then carries over every argument you do not set. Set it to false for a new, self-contained question.
A short question that refers to the previous turn ("แล้ว...ล่ะ", "เทียบกับ...", "อันนั้น", "ข้อ 2", "ขอรายละเอียด") continues the previous plan:
- Keep every argument the user did not change (period, categories, priorities, metric) and change only what the new question mentions.
- Comparing with another period means compare_periods: the newly mentioned period and the previous turn's period are the two periods, with the previous turn's metric/categories.
- Referring to items shown before means list_chats with their chat_ids from the history.

RULES
- reply_mode "data" when at least one tool call or a missing-data topic applies; "chitchat" for greetings, thanks, compliments or complaints about the bot itself, jokes, small talk and anything unrelated to the business (out_of_scope); "clarify" only if the question is impossible to interpret (ask in Thai in clarify_question).
- At most ${MAX_CALLS} calls. A question mixing supported and unsupported data gets both calls and unsupported_topics.
- "focus": short note of what the user wants emphasized (e.g. "ตอบเรื่องเดียว", "เรียงตามวันที่", "เฉพาะเปอร์เซ็นต์"), else "".


SIMILAR SOLVED EXAMPLES are given with each question: verified plans for similar questions. Follow their pattern when they fit, but always obey the rules above.`;
}

function buildHistoryText(history) {
  if (!history || history.length === 0) return '(no previous turns)';
  return history.map((h, i) => {
    if (h.audit_status === 'ERROR') return `Turn ${i + 1}\nQ: ${h.user_query}\n(this question failed and was not answered)`;
    const calls = (h.slots?.calls || []).map(c => `${c.tool}${JSON.stringify(c.args)}`).join('; ') || '-';
    const ids = (h.slots?.result_chat_ids || []).slice(0, 30).join(', ') || '-';
    return `Turn ${i + 1}\nQ: ${h.user_query}\nPlan: ${calls}\nChat ids shown: ${ids}\nAnswer (excerpt): ${(h.reply || '').replace(/\s+/g, ' ').slice(0, 300)}`;
  }).join('\n\n');
}

const TOOLS_WITH_CATEGORY_LIST = ['get_issue_stats', 'list_chats', 'compare_periods'];
const TOOLS_WITH_SINGLE_CATEGORY = ['get_category_info', 'get_resolution_advice'];

/**
 * Keep only well-formed calls and values (the LLM output is untrusted).
 * Missing periods are inherited from the previous turn's plan, never silently defaulted when context exists.
 * @param {object} raw - Parsed LLM output
 * @param {any[]} [previousCalls] - Calls of the previous successful turn
 */
export function sanitizePlan(raw, previousCalls = []) {
  const previousPeriod = previousCalls.find(c => c.args?.period)?.args.period || null;
  const continues = raw?.continues_previous === true && previousCalls.length > 0;
  // Filters of the previous turn that a follow-up keeps unless it sets its own
  const previousFilters = {};
  for (const key of ['categories', 'priorities', 'query']) {
    const found = previousCalls.find(c => c.args?.[key]?.length);
    if (found) previousFilters[key] = found.args[key];
  }
  const previousCategory = previousCalls.find(c => c.args?.category)?.args.category || previousFilters.categories?.[0] || null;
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

      // Single-category tools read "category": accept a one-item "categories" for them.
      // A stray "category" on list tools is dropped, not promoted into a filter the question never asked for.
      if (TOOLS_WITH_SINGLE_CATEGORY.includes(c.tool) && !args.category && args.categories?.length) args.category = args.categories[0];
      if (TOOLS_WITH_CATEGORY_LIST.includes(c.tool)) delete args.category;

      if (continues) {
        if (TOOLS_WITH_CATEGORY_LIST.includes(c.tool)) {
          for (const key of ['categories', 'priorities']) {
            if (!args[key]?.length && previousFilters[key]) args[key] = previousFilters[key];
          }
          if (c.tool === 'list_chats' && !args.query && previousFilters.query) args.query = previousFilters.query;
        }
        if (TOOLS_WITH_SINGLE_CATEGORY.includes(c.tool) && !args.category && previousCategory) args.category = previousCategory;
        args.continues_previous = true;
      }
      if (!args.period && c.tool !== 'get_category_info') {
        args.period = previousPeriod || { type: 'last_n_days', n: 7 };
        args.period_inherited = !!previousPeriod;
      }
      // A comparison that names only one period compares it with the period discussed in the previous turn
      if (c.tool === 'compare_periods' && !args.period_b && previousPeriod &&
          JSON.stringify(previousPeriod) !== JSON.stringify(args.period)) {
        args.period_b = previousPeriod;
      }
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
 * @param {{ query: string, companyId?: string, categories: Map, history: any[] }} input
 * @returns {Promise<{ reply_mode: string, calls: any[], unsupported_topics: string[], focus: string, clarify_question: string }>}
 */
export async function routeQuery({ query, companyId, categories, history }) {
  const today = todayContext();
  // Verified examples from the database, chosen by similarity to this question
  const examples = companyId ? await findSimilarExamples(query, companyId, 5) : [];
  const messages = [
    // The system prompt stays identical between questions, so Ollama can reuse its cached evaluation
    { role: 'system', content: buildSystemPrompt(categories) },
    { role: 'user', content: `TODAY: ${today.thai} (ISO ${today.iso})\n\nSIMILAR SOLVED EXAMPLES:\n${formatExamples(examples)}\n\nRECENT CONVERSATION:\n${buildHistoryText(history)}\n\nQUESTION: ${query}` }
  ];

  // Schema-constrained decoding occasionally makes the model emit only whitespace until the token cap.
  // Retry once with plain JSON mode before giving up.
  const attempts = [
    { format: PLAN_SCHEMA, temperature: 0, maxTokens: 1024 },
    { format: 'json', temperature: 0.1, maxTokens: 1024 }
  ];
  const failures = [];
  for (const [i, options] of attempts.entries()) {
    const { content, promptTokens, outputTokens, durationMs, loadMs, truncated } = await ollamaChat(messages, options);
    console.log(`🧭 [Router] attempt ${i + 1}: ${promptTokens ?? '?'} prompt + ${outputTokens ?? '?'} output tokens, ${durationMs ?? '?'} ms (model load ${loadMs ?? 0} ms)`);
    try {
      const previousCalls = [...(history || [])].reverse().find(h => h.slots?.calls?.length)?.slots.calls || [];
      const plan = sanitizePlan(parseJsonObject(content), previousCalls);
      return {
        ...plan,
        examples_used: examples.map(e => ({ question: e.question, similarity: Math.round(e.similarity * 1000) / 1000 })),
        timing: { prompt_tokens: promptTokens, output_tokens: outputTokens, duration_ms: durationMs, load_ms: loadMs, attempts: i + 1 }
      };
    } catch (err) {
      failures.push(`attempt ${i + 1}: ${err.message} (output ${outputTokens ?? '?'} tokens${truncated ? ', hit token cap' : ''}, starts with ${JSON.stringify((content || '').slice(0, 80))})`);
      console.warn(`⚠️ [Router] ${failures[failures.length - 1]}`);
    }
  }
  const error = new Error(`Router returned no usable plan: ${failures.join(' | ')}`);
  error.code = 'ROUTER_BAD_OUTPUT';
  throw error;
}
