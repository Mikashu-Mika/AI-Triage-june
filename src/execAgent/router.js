/**
 * LLM intent router: turns an executive's Thai question (+ recent conversation) into a structured plan
 * of tool calls. It never answers by itself and never computes numbers.
 */
import { ollamaChat, parseJsonObject } from './llm.js';
import { PERIOD_TYPES, todayContext } from './timeframe.js';
import { findSimilarExamples, formatExamples } from './examples.js';

export const TOOL_NAMES = [
  'get_issue_stats', 'list_chats', 'compare_periods', 'get_customer_stats',
  'search_chats', 'get_sentiment', 'get_category_info', 'get_resolution_advice', 'detect_emerging_issues'
];
export const UNSUPPORTED_TOPICS = ['money_amounts', 'slips', 'campaigns', 'admin_response_time', 'personal_data', 'customer_tier', 'holidays', 'out_of_scope'];

// Deterministic backstops for data the system does not have (the LLM sometimes routes them to a tool anyway)
const UNSUPPORTED_PATTERNS = [
  ['money_amounts', /(ฝากแรก|ยอดฝาก|ยอดถอน|ยอดเงิน|ยอดโอน)/],
  ['customer_tier', /ลูกค้า\s*(ระดับ\s*)?vip/i],
  ['holidays', /(เทศกาล|วันหยุด|วันหวยออก)/]
];
// Period types the router may only use when the question names a time; otherwise the period is inherited or 7 days
const NAMED_PERIOD_TYPES = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'month'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const GROUP_BY = ['category', 'priority', 'day', 'hour'];
const METRICS = ['issues', 'chats', 'new_customers', 'total', 'new', 'new_list', 'returning_ratio', 'new_by_month', 'repeat_customers'];
const SORTS = ['newest', 'oldest', 'priority'];
const MAX_CALLS = 3;
const EXPLICIT_TIME_PATTERN = /(วันนี้|เมื่อวาน|เดือนนี้|เดือนหน้า|สัปดาห์นี้|สัปดาห์ที่แล้ว|อาทิตย์นี้|อาทิตย์ที่แล้ว|เดือนที่แล้ว|เดือนก่อน|ช่วงนี้|ล่าสุด|ย้อนหลัง|วันที่|ตุลา|กันยา|สิงหา|กรกฎา|พฤศจิ|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|\d{1,2}\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)|\d{4}|\d{2}\/\d{2})/i;

// "Which problems are rising / spiking lately" (task 2.4)
export const EMERGING_PATTERN = /(เพิ่มขึ้น|เพิ่มผิดปกติ|พุ่ง|มาแรง|ผิดปกติ|ขึ้นเยอะ|เยอะขึ้น|มากขึ้น|น่าจับตา|น่ากังวล|ระบาด|trending|emerging|spike)/i;
const NOT_EMERGING_PATTERN = /(ลูกค้าใหม่|สมัคร|จำนวนแชต|แชตทั้งหมด|อารมณ์|พอใจ)/i;
const TWO_PERIOD_PATTERN = /(เทียบ|เปรียบเทียบ|กับเดือน|กับสัปดาห์|กับเมื่อวาน|vs\.?)/i;

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
- customer_tier: which customers are VIP / their membership level ("ลูกค้า VIP กี่คน"). Problems ABOUT VIP benefits are a normal category.
- holidays: festival / public-holiday calendars ("ช่วงเทศกาล", "วันหยุด", "วันหวยออก")
- out_of_scope: anything unrelated to the business (weather, food, ...)
Note: PROBLEMS reported in chats about deposits/withdrawals ARE supported (category deposit_withdrawal); only money AMOUNTS are not.

TOOLS (args in parentheses; every tool also takes "period"):
- get_issue_stats(categories?, priorities?, group_by=category|priority|day|hour): counts/percentages of problems; top problems; busiest hour/day; how many urgent cases.
- list_chats(categories?, priorities?, query?, chat_ids?, sort=newest|oldest|priority, limit<=20): which chats / details / examples. Use chat_ids from the conversation history when the user refers to items shown before ("เคสนั้น", "13 รายการนี่", "ข้อ 2").
- compare_periods(metric=issues|chats|new_customers, period, period_b, categories?): compare two periods. If only one period is named, set period_b to the previous comparable period.
- get_customer_stats(metric=total|new|new_list|returning_ratio|new_by_month|repeat_customers): customer counts, who registered, share of chats from existing customers, customers who contacted again / repeated the same problem ("ทักซ้ำ", "แจ้งเรื่องเดิม"), and the customers with the most problems ("ลูกค้าคนไหนมีปัญหามากที่สุด" = repeat_customers). "ลูกค้าทั้งหมดในเดือน X" = metric total with that month as period (the tool returns the total at the end of that month).
- search_chats(query): chats about a specific topic that is not a category (e.g. วันเกิด, อายัด, หวย, เปลี่ยนข้อมูล, VIP). query = 1-3 specific Thai keywords (at least 3 letters each); never generic words such as แอดมิน, ลูกค้า, เว็บ, ปัญหา.
- get_sentiment(): customer mood / satisfaction, counts of angry/unhappy chats (key_moods), chats where customers actually praised or thanked the service (praise_examples) and negative examples. DO NOT pair with list_chats unless the user explicitly asks for full chat listings ("ขอดูแชต", "ขอรายการแชต").
- get_category_info(category): what a category means.
- get_resolution_advice(category?): how to fix / root cause / what to do about a problem (omit category to use the top problem).
- detect_emerging_issues(): which problems are RISING / spiking / unusual lately ("ช่วงนี้มีปัญหาอะไรเพิ่มขึ้น", "ปัญหาไหนพุ่ง", "มีอะไรผิดปกติไหม", "ปัญหามาแรง", "เรื่องไหนน่าจับตา"). It compares the period with the average of the 4 previous periods by itself, so give only "period" (default last_n_days 7) and never use compare_periods for these questions. Use compare_periods only when the user names two periods or asks for an overall total comparison.

CATEGORIES (use the key in "categories"/"category"):
${categoryLines}

PERIOD: {"type": one of ${PERIOD_TYPES.join('|')}, "n" for last_n_days, "month"(1-12) and optional "year" for month, "start_date"/"end_date" (YYYY-MM-DD) for date_range, optional "start_hour"/"end_hour" (0-24) for a time-of-day window like "12.00-18.00"}.
If the question gives no time, reuse the period of the previous turn when it is a follow-up; otherwise use {"type":"last_n_days","n":7}. "ช่วงนี้" = last_n_days 7. "1 สัปดาห์" = last_n_days 7.

FOLLOW-UP QUESTIONS
Set "continues_previous": true when the question builds on the previous turn (refers to its results, numbers or items, or only changes one detail); the system then carries over every argument you do not set. Set it to false for a new, self-contained question.
A short question that refers to the previous turn ("แล้ว...ล่ะ", "เทียบกับ...", "อันนั้น", "ข้อ 2", "ขอรายละเอียด") continues the previous plan:
- Keep every argument the user did not change (period, categories, priorities, metric) and change only what the new question mentions.
- Comparing with another period means compare_periods: period A is the previous turn's period, period B is the newly mentioned period (or previous comparable period). For example, if the previous turn asked about October, and now asks "เทียบกับเดือนก่อนหน้า (กันยายน) แย่ลงไหม", period A is October, period B is September. NEVER default period A to the current real-time month.
- Referring to items shown before means list_chats with their chat_ids from the history.

RULES
- reply_mode "data" when at least one tool call or a missing-data topic applies; "chitchat" for greetings, thanks (also "แต้งกิ้ว", "ขอบคุณคับ"), test messages ("เทส", "test"), compliments or complaints about the bot itself, instructions to the bot that are not questions ("ต่อไปรอบคอบหน่อย", "งั้นถามใหม่", "..."), questions about the bot's own previous answer ("ทำไมตอบผิด", "ทำไมเป็น 100%", "คำว่า X หมายความว่าอะไร", "ช่วงเวลานี้ยังไม่จบ คืออะไร"), jokes, small talk, the current date ("วันนี้วันอะไร") and anything unrelated to the business (out_of_scope); "clarify" only if the question is impossible to interpret (ask in Thai in clarify_question).
- When the user asks WHAT the problems are inside one category ("ร้องเรียนเรื่องอะไร", "สมัครสมาชิกมีปัญหาอะไร"), call get_issue_stats for the count AND list_chats (limit 5) for that category so the answer shows the actual problems.
- "ทำไมปัญหา...ลดลง/เพิ่มขึ้น" (why did problems change): compare_periods between that period and the previous comparable period; the answer explains with the category changes.
- "ปัญหาฉุกเฉิน/เคสด่วน" means priority urgent (and high for เคสด่วน); list them with list_chats sort=priority.
- Ranking questions ("อันดับแรก", "มากที่สุด", "เยอะสุด", "ภาพรวม") use get_issue_stats group_by=category WITHOUT category filters, even after a question about one category.
- At most ${MAX_CALLS} calls. A question mixing supported and unsupported data gets both calls and unsupported_topics.
- "focus": short note of special formatting requested by the user (e.g. "3 อันดับแรก", "เรียงตามวันที่", "เฉพาะเปอร์เซ็นต์"), else "". NEVER put "ตอบเรื่องเดียว" unless the user explicitly requested only one item.


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

// Thai month names, full and short ("สิงหา", "ต.ค."), in calendar order
const THAI_MONTHS = [
  /มกรา|ม\.ค\./, /กุมภา|ก\.พ\./, /มีนา|มี\.ค\./, /เมษา|เม\.ย\./, /พฤษภา|พ\.ค\./, /มิถุนา|มิ\.ย\./,
  /กรกฎา|ก\.ค\./, /สิงหา|ส\.ค\./, /กันยา|ก\.ย\./, /ตุลา|ต\.ค\./, /พฤศจิกา|พ\.ย\./, /ธันวา|ธ\.ค\./
];

/** A single month named in the question wins over the LLM's month number ("เดือนสิงหา" was once read as June) */
function fixThaiMonth(period, userQuery) {
  if (period?.type !== 'month') return period;
  const named = THAI_MONTHS.map((re, i) => (re.test(userQuery) ? i + 1 : 0)).filter(Boolean);
  return named.length === 1 && named[0] !== period.month ? { ...period, month: named[0] } : period;
}

const TOOLS_WITH_CATEGORY_LIST = ['get_issue_stats', 'list_chats', 'compare_periods'];
const TOOLS_WITH_SINGLE_CATEGORY = ['get_category_info', 'get_resolution_advice'];

/**
 * Keep only well-formed calls and values (the LLM output is untrusted).
 * Missing periods are inherited from the previous turn's plan, never silently defaulted when context exists.
 * @param {object} raw - Parsed LLM output
 * @param {any[]} [previousCalls] - Calls of the previous successful turn
 */
export function sanitizePlan(raw, previousCalls = [], userQuery = '', knownChatIds = null) {
  const previousPeriod = previousCalls.find(c => c.args?.period)?.args.period || null;
  const previousGroupBy = previousCalls.find(c => c.args?.group_by)?.args.group_by || null;
  // "แล้ว" only marks a follow-up at the start ("แล้วเดือนนี้ล่ะ"); "เดือนที่แล้ว" / "สัปดาห์ที่แล้ว" name a period
  const queryWithoutPastPeriods = userQuery.replace(/(ที่แล้ว|ก่อนหน้านี้)/g, ' ');
  const isFollowUpPattern = /(ที่เหลือ|หมวดที่เหลือ|อีก \d+ (หมวด|ปัญหา|ช่วงเวลา)|อันดับที่เหลือ|^\s*(แล้ว|และ)|(ล่ะ|ละ)\s*(คะ|ค่ะ)?\s*[?？]?\s*$|ข้อ \d+|เคสนั้น|รายการนี้|แชตไหนบ้าง|เทียบกับ)/i.test(queryWithoutPastPeriods);
  const continues = (raw?.continues_previous === true || isFollowUpPattern) && previousCalls.length > 0;
  const hasExplicitTime = EXPLICIT_TIME_PATTERN.test(userQuery);
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
      if (a.period?.type) args.period = fixThaiMonth(a.period, userQuery);
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

      // Chat ids must come from earlier answers; the LLM sometimes writes placeholders ("chat-id-from-...")
      if (args.chat_ids) {
        args.chat_ids = args.chat_ids.filter(id => (knownChatIds ? knownChatIds.has(id) : !/(from|placeholder|chat-id-|<|>)/i.test(id)));
        if (!args.chat_ids.length) {
          delete args.chat_ids;
          // "ขอประวัติแชตของลูกค้าอันดับ 1": the customer ranking already carries each customer's chat ids
          if (c.tool === 'list_chats' && /ลูกค้า/.test(userQuery) && !args.categories?.length && !args.query) {
            c.tool = 'get_customer_stats';
            args.metric = 'repeat_customers';
          }
        }
      }

      if (continues) {
        if (TOOLS_WITH_CATEGORY_LIST.includes(c.tool)) {
          // A follow-up that sets its own topic (category or search words) starts a fresh filter set;
          // a ranking over categories never inherits a category filter.
          const setsOwnTopic = args.categories?.length || args.query;
          const isCategoryRanking = c.tool === 'get_issue_stats' && (args.group_by || 'category') === 'category' && !args.categories?.length &&
            /(อันดับ|มากที่สุด|เยอะที่สุด|เยอะสุด|มากสุด|ภาพรวม|ทั้งหมด)/.test(userQuery);
          if (!setsOwnTopic && !isCategoryRanking) {
            for (const key of ['categories', 'priorities']) {
              if (!args[key]?.length && previousFilters[key]) args[key] = previousFilters[key];
            }
            if (c.tool === 'list_chats' && !args.query && previousFilters.query) args.query = previousFilters.query;
          }
        }
        if (TOOLS_WITH_SINGLE_CATEGORY.includes(c.tool) && !args.category && previousCategory) args.category = previousCategory;
        args.continues_previous = true;
      }
      // No time in the question: keep the conversation's period, else the last 7 days.
      // The LLM may not invent "today"/"this month" for a question that never said so.
      if (!hasExplicitTime && c.tool !== 'get_category_info') {
        const invented = !args.period || args.period.type === 'last_n_days' || NAMED_PERIOD_TYPES.includes(args.period.type);
        if (invented) {
          if (previousPeriod) {
            args.period = previousPeriod;
            args.period_inherited = true;
          } else {
            args.period = { type: 'last_n_days', n: 7 };
          }
        }
      } else if (!args.period && c.tool !== 'get_category_info') {
        args.period = { type: 'last_n_days', n: 7 };
      }
      const isRemainingQuery = /(ที่เหลือ|หมวดที่เหลือ|อีก \d+ (หมวด|ช่วงเวลา|ระดับ)|อันดับที่เหลือ)/i.test(userQuery);
      if (isRemainingQuery && previousCalls.length) {
        if (previousPeriod && !hasExplicitTime) args.period = previousPeriod;
        c.tool = 'get_issue_stats';
        delete args.categories;
        // "the remaining 3" of an hour ranking are hours, not categories
        args.group_by = previousGroupBy || args.group_by || 'category';
        args.limit = 30;
        args.remaining = true;
      }
      // Fix follow-up comparison: If comparing with a prior period and previousPeriod exists from previous turn,
      // the baseline period A should be the previousPeriod (e.g. October), not defaulted to current month!
      if (c.tool === 'compare_periods') {
        if (previousPeriod) {
          const curMonth = (new Date().getMonth() + 1);
          if (args.period?.type === 'month' && args.period.month === curMonth && args.period_b && previousPeriod.month !== curMonth) {
            args.period = previousPeriod;
          } else if (!args.period_b && JSON.stringify(previousPeriod) !== JSON.stringify(args.period)) {
            args.period_b = previousPeriod;
          }
        }
      }
      return { tool: c.tool, args };
    });
  // Deduplicate and filter redundant calls
  let cleanedCalls = calls;
  if (cleanedCalls.some(c => c.tool === 'get_sentiment') && cleanedCalls.some(c => c.tool === 'list_chats')) {
    const userWantsList = /(ขอดูแชต|ขอรายการ|ขอลิสต์|ดูแชตทั้งหมด)/i.test(raw?.focus || '') || /(ขอดูแชต|ขอรายการ|ขอลิสต์|ดูแชตทั้งหมด)/i.test(raw?.query || '');
    if (!userWantsList) {
      cleanedCalls = cleanedCalls.filter(c => c.tool !== 'list_chats');
    }
  }
  if (cleanedCalls.filter(c => c.tool === 'compare_periods').length > 1) {
    const generic = cleanedCalls.find(c => c.tool === 'compare_periods' && (!c.args.categories || c.args.categories.length === 0));
    if (generic) {
      cleanedCalls = cleanedCalls.filter(c => c.tool !== 'compare_periods' || c === generic);
    }
  }

  // Backstop: "what is rising lately" questions always go to detect_emerging_issues, unless the user named two periods to compare
  // Only problem-count plans are replaced: customer counts, total chats, sentiment etc. keep their own tool.
  const isProblemCountCall = c => c.tool === 'get_issue_stats' || (c.tool === 'compare_periods' && (!c.args.metric || c.args.metric === 'issues'));
  if (EMERGING_PATTERN.test(userQuery) && !TWO_PERIOD_PATTERN.test(userQuery) && !NOT_EMERGING_PATTERN.test(userQuery) &&
      !continues && mode === 'data' && cleanedCalls.every(isProblemCountCall)) {
    const period = cleanedCalls.find(c => c.args?.period && c.args.period.type !== 'all_time')?.args.period
      || { type: 'last_n_days', n: 7 };
    cleanedCalls = [{ tool: 'detect_emerging_issues', args: { period } }];
  }

  const unsupported = (Array.isArray(raw?.unsupported_topics) ? raw.unsupported_topics : []).filter(t => UNSUPPORTED_TOPICS.includes(t));
  for (const [topic, pattern] of UNSUPPORTED_PATTERNS) {
    if (pattern.test(userQuery) && !unsupported.includes(topic)) unsupported.push(topic);
  }
  // Data we do not have must not be answered with a look-alike: "ลูกค้า VIP" is not a text search for "VIP",
  // "ลูกค้าฝากแรก" is not the new-customer count, a holiday is not a guessed date range.
  if (unsupported.includes('customer_tier')) cleanedCalls = cleanedCalls.filter(c => !(c.args.query || '').match(/vip/i) && c.tool !== 'get_customer_stats');
  if (unsupported.includes('money_amounts')) cleanedCalls = cleanedCalls.filter(c => c.tool !== 'get_customer_stats');
  if (unsupported.includes('holidays')) cleanedCalls = cleanedCalls.filter(c => c.args.period?.type !== 'date_range' && c.args.period_b?.type !== 'date_range' && c.tool !== 'compare_periods');

  // A message without any letters ("...", "55555", "12345") is not a question
  const noWords = !/[ก-๙a-z]/i.test(userQuery.replace(/[๐-๙]/g, ''));
  // Nothing to fetch and nothing to refuse except "out of scope" = small talk, answered conversationally
  const onlySmallTalk = cleanedCalls.length === 0 && unsupported.every(t => t === 'out_of_scope');
  if (noWords) {
    return { reply_mode: 'chitchat', calls: [], unsupported_topics: [], focus: '', clarify_question: '' };
  }
  return {
    reply_mode: mode === 'data' && onlySmallTalk ? 'chitchat' : mode,
    calls: cleanedCalls,
    unsupported_topics: [...new Set(unsupported)],
    focus: (typeof raw?.focus === 'string' && raw.focus !== 'ตอบเรื่องเดียว' ? raw.focus.slice(0, 200) : ''),
    clarify_question: typeof raw?.clarify_question === 'string' ? raw.clarify_question.slice(0, 300) : ''
  };
}

/** Fixed plan for "which problems are rising" questions, or null when the question is not one of them */
export function emergingFallbackPlan(query) {
  if (!EMERGING_PATTERN.test(query) || TWO_PERIOD_PATTERN.test(query) || NOT_EMERGING_PATTERN.test(query)) return null;
  const period = /สัปดาห์นี้/.test(query) ? { type: 'this_week' }
    : /เดือนนี้/.test(query) ? { type: 'this_month' }
      : /วันนี้/.test(query) ? { type: 'today' }
        : { type: 'last_n_days', n: 7 };
  return { reply_mode: 'data', calls: [{ tool: 'detect_emerging_issues', args: { period } }], unsupported_topics: [], focus: '', clarify_question: '' };
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
      const shownIds = (history || []).flatMap(h => h.slots?.result_chat_ids || []);
      const plan = sanitizePlan(parseJsonObject(content), previousCalls, query, shownIds.length ? new Set(shownIds) : null);
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
  // The LLM gave no usable plan, but "what is rising lately" questions have only one sensible plan
  const fallback = emergingFallbackPlan(query);
  if (fallback) {
    console.warn(`⚠️ [Router] LLM failed (${failures.join(' | ')}); using the detect_emerging_issues fallback plan.`);
    return { ...fallback, examples_used: [], timing: { attempts: attempts.length, fallback: 'emerging_pattern' } };
  }
  const error = new Error(`Router returned no usable plan: ${failures.join(' | ')}`);
  error.code = 'ROUTER_BAD_OUTPUT';
  throw error;
}
