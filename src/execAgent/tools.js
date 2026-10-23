/**
 * Data tools of the executive Telegram bot.
 * Every tool returns RAW facts (numbers, lists, labels) scoped to one company; wording is done by the composer.
 * Statements classified as the "other" category are context/inquiries, so they are never counted as problems.
 */
import { supabase, getCategories, getCompanyCustomers, findSimilarChats, fetchAllRows } from '../supabase.js';
import { getEmbedding } from '../ollama.js';
import { resolvePeriod, previousPeriod, inPeriod, thaiHour, thaiDay, formatThaiDateTime } from './timeframe.js';

const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };
const PRIORITY_TH = { urgent: 'ฉุกเฉิน', high: 'สูง', medium: 'กลาง', low: 'ต่ำ' };
const LIST_LIMIT_MAX = 20;
const EXPORT_LIMIT = 500;

const keyOf = id => (id || '').split(':').pop().trim().toLowerCase();
const isProblem = issue => keyOf(issue.category_id) !== 'other';

/** Company category context: key -> { key, name, description } */
export async function loadCategoryContext(companyId) {
  const categories = await getCategories(companyId);
  const byKey = new Map();
  for (const c of categories) {
    const key = keyOf(c.id);
    if (!byKey.has(key)) byKey.set(key, { key, name: c.name_th || c.name || key, description: c.description || '' });
  }
  return byKey;
}

/** Map router-provided category keys/names to known keys; unknown ones are reported back */
function resolveCategoryKeys(requested, categoryContext) {
  const keys = [];
  const unknown = [];
  for (const raw of requested || []) {
    const q = String(raw).trim().toLowerCase();
    if (!q) continue;
    const key = keyOf(q);
    if (categoryContext.has(key)) {
      keys.push(key);
      continue;
    }
    const byName = [...categoryContext.values()].find(c => c.name.toLowerCase() === q || c.name.toLowerCase().includes(q));
    if (byName) keys.push(byName.key);
    else unknown.push(raw);
  }
  return { keys: [...new Set(keys)], unknown };
}

const categoryName = (key, ctx) => ctx.get(key)?.name || key;

/** All non-test chats of the company inside the period (with their issues) */
async function fetchChatsInPeriod(companyId, period, select = 'id, created_at, customer_id, category_id, priority, sentiment, summary, conversation, chat_issues(id, category_id, priority, summary)') {
  const { data, error } = await fetchAllRows(() => supabase
    .from('chats')
    .select(select)
    .eq('company_id', companyId)
    .eq('is_test', false)
    .gte('created_at', period.start.toISOString())
    .lt('created_at', period.end.toISOString())
    .order('created_at', { ascending: false })
    .order('id'));
  if (error) throw new Error(`Failed to load chats: ${error.message}`);
  return (data || []).filter(c => inPeriod(c.created_at, period));
}

/** Problem issues of a chat, filtered by category keys / priorities */
function matchingIssues(chat, categoryKeys, priorities) {
  return (chat.chat_issues || []).filter(iss => isProblem(iss) &&
    (categoryKeys.length === 0 || categoryKeys.includes(keyOf(iss.category_id))) &&
    (priorities.length === 0 || priorities.includes((iss.priority || '').toLowerCase())));
}

function periodFacts(period) {
  return { label: period.label, days: period.days, is_partial: period.isPartial };
}

function topChatPriority(issues) {
  return issues.reduce((best, iss) => (PRIORITY_RANK[iss.priority] || 0) > (PRIORITY_RANK[best] || 0) ? iss.priority : best, 'low');
}

function chatItem(chat, issues, categoryContext) {
  const shown = issues.length > 0 ? issues : (chat.chat_issues || []);
  return {
    chat_id: chat.id,
    time: formatThaiDateTime(chat.created_at),
    priority: PRIORITY_TH[topChatPriority(shown)] || '-',
    categories: [...new Set(shown.map(i => categoryName(keyOf(i.category_id), categoryContext)))],
    issues: shown.slice(0, 3).map(i => ({ category: categoryName(keyOf(i.category_id), categoryContext), priority: PRIORITY_TH[i.priority] || i.priority, summary: i.summary })),
    chat_summary: chat.summary
  };
}

function exportRows(chats, issueSelector, categoryContext) {
  const rows = [];
  for (const chat of chats) {
    for (const iss of issueSelector(chat)) {
      rows.push({
        chat_id: chat.id,
        created_at: chat.created_at,
        category_id: keyOf(iss.category_id),
        category_name: categoryName(keyOf(iss.category_id), categoryContext),
        summary: iss.summary,
        priority: iss.priority
      });
      if (rows.length >= EXPORT_LIMIT) return rows;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Issue statistics
// ---------------------------------------------------------------------------
export async function getIssueStats(ctx, args) {
  const period = resolvePeriod(args.period);
  const { keys, unknown } = resolveCategoryKeys(args.categories, ctx.categories);
  const priorities = (args.priorities || []).filter(p => PRIORITY_RANK[p]);
  const groupBy = ['category', 'priority', 'day', 'hour'].includes(args.group_by) ? args.group_by : 'category';
  const chats = await fetchChatsInPeriod(ctx.companyId, period);

  const allProblems = chats.flatMap(c => (c.chat_issues || []).filter(isProblem));
  const groups = new Map();
  let matchedIssues = 0;
  let matchedChats = 0;
  for (const chat of chats) {
    const issues = matchingIssues(chat, keys, priorities);
    if (issues.length === 0) continue;
    matchedChats++;
    matchedIssues += issues.length;
    const chatGroups = new Set();
    for (const iss of issues) {
      const g = groupBy === 'category' ? keyOf(iss.category_id)
        : groupBy === 'priority' ? (iss.priority || 'medium')
        : groupBy === 'day' ? thaiDay(chat.created_at)
        : String(thaiHour(chat.created_at));
      if (!groups.has(g)) groups.set(g, { issues: 0, chats: 0 });
      groups.get(g).issues++;
      chatGroups.add(g);
    }
    chatGroups.forEach(g => groups.get(g).chats++);
  }

  const label = g => groupBy === 'category' ? categoryName(g, ctx.categories)
    : groupBy === 'priority' ? `ระดับ${PRIORITY_TH[g] || g}`
    : groupBy === 'hour' ? `${g.padStart(2, '0')}:00-${g.padStart(2, '0')}:59 น.`
    : g;
  const groupList = [...groups.entries()]
    .map(([g, v]) => ({ group: label(g), issues: v.issues, chats: v.chats, pct_of_matched_issues: matchedIssues ? Math.round((v.issues / matchedIssues) * 1000) / 10 : 0 }))
    .sort((a, b) => b.issues - a.issues);

  return {
    tool: 'get_issue_stats',
    period: periodFacts(period),
    filters: { categories: keys.map(k => categoryName(k, ctx.categories)), priorities: priorities.map(p => PRIORITY_TH[p]), unknown_categories: unknown },
    group_by: groupBy,
    total_chats_in_period: chats.length,
    total_problem_issues_in_period: allProblems.length,
    matched_chats: matchedChats,
    matched_problem_issues: matchedIssues,
    pct_of_all_problems: allProblems.length ? Math.round((matchedIssues / allProblems.length) * 1000) / 10 : 0,
    groups: groupList.slice(0, 15),
    note: 'ข้อความทั่วไป/สอบถามที่ไม่ใช่ปัญหา (หมวดเรื่องอื่นๆ) ไม่นับเป็นปัญหา'
  };
}

// ---------------------------------------------------------------------------
// 2. Chat list (drill-down)
// ---------------------------------------------------------------------------
export async function listChats(ctx, args) {
  const { keys, unknown } = resolveCategoryKeys(args.categories, ctx.categories);
  const priorities = (args.priorities || []).filter(p => PRIORITY_RANK[p]);
  const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, parseInt(args.limit, 10) || 10));
  const text = (args.query || '').trim().toLowerCase();
  let period = resolvePeriod(args.period);
  let chats;

  if (Array.isArray(args.chat_ids) && args.chat_ids.length > 0) {
    const { data, error } = await supabase
      .from('chats')
      .select('id, created_at, category_id, priority, summary, conversation, chat_issues(id, category_id, priority, summary)')
      .eq('company_id', ctx.companyId)
      .in('id', args.chat_ids.slice(0, 100));
    if (error) throw new Error(`Failed to load chats: ${error.message}`);
    chats = data || [];
    period = { ...period, label: 'แชตที่อ้างถึงจากคำตอบก่อนหน้า', isPartial: false };
  } else {
    chats = await fetchChatsInPeriod(ctx.companyId, period);
  }

  const filterActive = keys.length > 0 || priorities.length > 0;
  let matched = chats
    .map(chat => ({ chat, issues: matchingIssues(chat, keys, priorities) }))
    .filter(({ chat, issues }) => !filterActive || issues.length > 0)
    .filter(({ chat, issues }) => !text ||
      (chat.conversation || '').toLowerCase().includes(text) ||
      (chat.summary || '').toLowerCase().includes(text) ||
      (chat.chat_issues || []).some(i => (i.summary || '').toLowerCase().includes(text)));

  const sort = ['newest', 'oldest', 'priority'].includes(args.sort) ? args.sort : 'newest';
  matched.sort((a, b) => {
    if (sort === 'priority') {
      const diff = (PRIORITY_RANK[topChatPriority(b.issues.length ? b.issues : b.chat.chat_issues || [])] || 0) -
        (PRIORITY_RANK[topChatPriority(a.issues.length ? a.issues : a.chat.chat_issues || [])] || 0);
      if (diff !== 0) return diff;
    }
    const t = new Date(b.chat.created_at) - new Date(a.chat.created_at);
    return sort === 'oldest' ? -t : t;
  });

  const items = matched.slice(0, limit).map(({ chat, issues }) => chatItem(chat, filterActive ? issues : (chat.chat_issues || []).filter(isProblem), ctx.categories));
  const result = {
    tool: 'list_chats',
    period: periodFacts(period),
    filters: { categories: keys.map(k => categoryName(k, ctx.categories)), priorities: priorities.map(p => PRIORITY_TH[p]), query: text || null, unknown_categories: unknown },
    sort,
    total_matched_chats: matched.length,
    shown: items.length,
    items
  };
  if (matched.length > limit) {
    result.excel_export = {
      title: keys.length ? keys.map(k => categoryName(k, ctx.categories)).join(' / ') : 'รายการแชต',
      periodLabel: period.label,
      items: exportRows(matched.map(m => m.chat), chat => (filterActive ? matchingIssues(chat, keys, priorities) : (chat.chat_issues || []).filter(isProblem)), ctx.categories)
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Period comparison
// ---------------------------------------------------------------------------
export async function comparePeriods(ctx, args) {
  const metric = ['issues', 'chats', 'new_customers'].includes(args.metric) ? args.metric : 'issues';
  const periodA = resolvePeriod(args.period);
  const periodB = args.period_b ? resolvePeriod(args.period_b) : previousPeriod(periodA);
  const { keys, unknown } = resolveCategoryKeys(args.categories, ctx.categories);

  const measure = async period => {
    if (metric === 'new_customers') {
      const { data, error } = await getCompanyCustomers(ctx.companyId);
      if (error) throw new Error(`Failed to load customers: ${error.message}`);
      return { value: (data || []).filter(c => c.created_at && inPeriod(c.created_at, period)).length, byCategory: {} };
    }
    const chats = await fetchChatsInPeriod(ctx.companyId, period);
    if (metric === 'chats') return { value: chats.length, byCategory: {} };
    const byCategory = {};
    let value = 0;
    for (const chat of chats) {
      for (const iss of matchingIssues(chat, keys, [])) {
        value++;
        const k = keyOf(iss.category_id);
        byCategory[k] = (byCategory[k] || 0) + 1;
      }
    }
    return { value, byCategory };
  };

  const [a, b] = [await measure(periodA), await measure(periodB)];
  const diff = a.value - b.value;
  const changes = [...new Set([...Object.keys(a.byCategory), ...Object.keys(b.byCategory)])]
    .map(k => ({ category: categoryName(k, ctx.categories), current: a.byCategory[k] || 0, previous: b.byCategory[k] || 0, diff: (a.byCategory[k] || 0) - (b.byCategory[k] || 0) }))
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
    .slice(0, 5);

  return {
    tool: 'compare_periods',
    metric,
    metric_th: metric === 'issues' ? 'จำนวนปัญหา' : metric === 'chats' ? 'จำนวนแชต' : 'ลูกค้าใหม่',
    filters: { categories: keys.map(k => categoryName(k, ctx.categories)), unknown_categories: unknown },
    period_a: { ...periodFacts(periodA), value: a.value, per_day: Math.round((a.value / periodA.days) * 10) / 10 },
    period_b: { ...periodFacts(periodB), value: b.value, per_day: Math.round((b.value / periodB.days) * 10) / 10 },
    diff,
    pct_change: b.value ? Math.round((diff / b.value) * 1000) / 10 : null,
    biggest_category_changes: metric === 'issues' ? changes : []
  };
}

// ---------------------------------------------------------------------------
// 4. Customer statistics (no contact data is ever returned)
// ---------------------------------------------------------------------------
export async function getCustomerStats(ctx, args) {
  const period = resolvePeriod(args.period);
  const metric = ['total', 'new', 'new_list', 'returning_ratio', 'new_by_month', 'repeat_customers'].includes(args.metric) ? args.metric : 'new';
  const { data: customers, error } = await getCompanyCustomers(ctx.companyId);
  if (error) throw new Error(`Failed to load customers: ${error.message}`);
  const newCustomers = (customers || []).filter(c => c.created_at && inPeriod(c.created_at, period));

  const result = {
    tool: 'get_customer_stats',
    metric,
    period: periodFacts(period),
    total_customers: (customers || []).length,
    new_customers_in_period: newCustomers.length
  };

  if (metric === 'new_list') {
    result.new_customers = newCustomers.slice(0, LIST_LIMIT_MAX).map(c => ({ customer_id: c.id, name: c.name || '-', registered_at: formatThaiDateTime(c.created_at) }));
    result.shown = result.new_customers.length;
  }
  if (metric === 'new_by_month') {
    const months = {};
    for (const c of newCustomers) {
      const m = thaiDay(c.created_at).slice(0, 7);
      months[m] = (months[m] || 0) + 1;
    }
    result.by_month = Object.entries(months).sort().map(([month, count]) => ({ month, count }));
  }
  if (metric === 'returning_ratio') {
    const chats = await fetchChatsInPeriod(ctx.companyId, period, 'id, created_at, customer_id');
    const createdAt = new Map((customers || []).map(c => [c.id, c.created_at]));
    const returning = chats.filter(c => createdAt.get(c.customer_id) && new Date(createdAt.get(c.customer_id)) < period.start).length;
    result.chats_in_period = chats.length;
    result.chats_from_existing_customers = returning;
    result.chats_from_new_customers = chats.length - returning;
    result.pct_existing = chats.length ? Math.round((returning / chats.length) * 1000) / 10 : 0;
    result.definition = 'ลูกค้าเก่า = ลูกค้าที่ลงทะเบียนก่อนเริ่มช่วงเวลาที่ถาม';
  }
  if (metric === 'repeat_customers') {
    // Customers who contacted more than once in the period, and those who repeated the same problem category
    const chats = await fetchChatsInPeriod(ctx.companyId, period, 'id, created_at, customer_id, chat_issues(category_id)');
    const byCustomer = new Map();
    chats.filter(c => c.customer_id).forEach(c => {
      if (!byCustomer.has(c.customer_id)) byCustomer.set(c.customer_id, []);
      byCustomer.get(c.customer_id).push(c);
    });
    const names = new Map((customers || []).map(c => [c.id, c.name]));
    const repeaters = [...byCustomer.entries()].filter(([, list]) => list.length > 1).map(([customerId, list]) => {
      const catCounts = {};
      list.forEach(chat => new Set((chat.chat_issues || []).filter(isProblem).map(i => keyOf(i.category_id))).forEach(k => { catCounts[k] = (catCounts[k] || 0) + 1; }));
      const repeated = Object.entries(catCounts).filter(([, n]) => n > 1).map(([k]) => categoryName(k, ctx.categories));
      return { customer_id: customerId, name: names.get(customerId) || '-', chats: list.length, repeated_problems: repeated, chat_ids: list.map(c => c.id).slice(0, 5) };
    }).sort((a, b) => b.chats - a.chats);
    result.customers_with_multiple_chats = repeaters.length;
    result.customers_repeating_same_problem = repeaters.filter(r => r.repeated_problems.length > 0).length;
    result.repeat_customers = repeaters.slice(0, LIST_LIMIT_MAX);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 5. Topic search (keyword + semantic) — replaces one-off keyword tools
// ---------------------------------------------------------------------------
export async function searchChats(ctx, args) {
  const period = resolvePeriod(args.period);
  const query = (args.query || '').trim();
  const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, parseInt(args.limit, 10) || 10));
  if (!query) return { tool: 'search_chats', error: 'missing_query' };

  const chats = await fetchChatsInPeriod(ctx.companyId, period);
  const terms = query.toLowerCase().split(/[,\s]+/).filter(t => t.length >= 3);
  const haystack = chat => [chat.conversation, chat.summary, ...(chat.chat_issues || []).map(i => i.summary)].join(' ').toLowerCase();
  const keywordHits = chats.filter(chat => terms.some(t => haystack(chat).includes(t)));

  let semanticHits = [];
  const embedding = await getEmbedding(query);
  if (embedding) {
    const similar = await findSimilarChats(embedding, 0.55, 50, ctx.companyId);
    const inPeriodIds = new Map(chats.map(c => [c.id, c]));
    semanticHits = similar
      .filter(s => inPeriodIds.has(s.id) && !keywordHits.some(k => k.id === s.id))
      .map(s => ({ chat: inPeriodIds.get(s.id), similarity: s.similarity }));
  }

  const items = [
    ...keywordHits.map(chat => ({ ...chatItem(chat, (chat.chat_issues || []).filter(isProblem), ctx.categories), match: 'keyword' })),
    ...semanticHits.map(({ chat, similarity }) => ({ ...chatItem(chat, (chat.chat_issues || []).filter(isProblem), ctx.categories), match: `similar ${Math.round(similarity * 100)}%` }))
  ];

  return {
    tool: 'search_chats',
    period: periodFacts(period),
    query,
    keyword_matches: keywordHits.length,
    semantic_matches: semanticHits.length,
    total_matches: items.length,
    shown: Math.min(limit, items.length),
    items: items.slice(0, limit),
    note: 'keyword = พบคำค้นตรงตัว, similar = เนื้อหาใกล้เคียงคำค้น (อาจไม่ตรง 100% ควรตรวจซ้ำ)'
  };
}

// ---------------------------------------------------------------------------
// 6. Customer sentiment
// ---------------------------------------------------------------------------
export async function getSentiment(ctx, args) {
  const period = resolvePeriod(args.period);
  const chats = await fetchChatsInPeriod(ctx.companyId, period, 'id, created_at, sentiment, summary');
  const counts = {};
  for (const c of chats) counts[c.sentiment || 'ไม่ระบุ'] = (counts[c.sentiment || 'ไม่ระบุ'] || 0) + 1;
  // Stored sentiment is free text from the LLM; bucket it into a polarity for a stable overview
  const polarityOf = s => /ชม|พอใจ(?!ไม่)|ประทับใจ|ขอบคุณ/.test(s || '') && !/ไม่พอใจ/.test(s || '') ? 'บวก'
    : /โกรธ|ไม่พอใจ|หงุดหงิด|รำคาญ|ผิดหวัง|กังวล|ตกใจ|ไม่ประทับใจ/.test(s || '') ? 'ลบ'
    : 'กลาง';
  const polarity = { บวก: 0, กลาง: 0, ลบ: 0 };
  chats.forEach(c => { polarity[polarityOf(c.sentiment)]++; });
  const negative = chats.filter(c => polarityOf(c.sentiment) === 'ลบ');
  const positive = chats.filter(c => polarityOf(c.sentiment) === 'บวก');
  return {
    tool: 'get_sentiment',
    period: periodFacts(period),
    total_chats: chats.length,
    polarity: Object.entries(polarity).map(([group, count]) => ({ group, count, pct: chats.length ? Math.round((count / chats.length) * 1000) / 10 : 0 })),
    distribution: Object.entries(counts).map(([sentiment, count]) => ({ sentiment, count, pct: chats.length ? Math.round((count / chats.length) * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count),
    negative_examples: negative.slice(0, 5).map(c => ({ chat_id: c.id, time: formatThaiDateTime(c.created_at), sentiment: c.sentiment, summary: c.summary })),
    positive_examples: positive.slice(0, 5).map(c => ({ chat_id: c.id, time: formatThaiDateTime(c.created_at), sentiment: c.sentiment, summary: c.summary }))
  };
}

// ---------------------------------------------------------------------------
// 7 + 8. Category knowledge and resolution advice
// ---------------------------------------------------------------------------
async function loadSop(companyId, categoryKey) {
  if (!categoryKey) return null;
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('title, content, status')
    .eq('company_id', companyId)
    .eq('category_key', categoryKey)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) {
    console.warn('⚠️ [Knowledge Base] lookup failed (run sql/p2_p3_verified_issues_and_knowledge_base.sql?):', error.message);
    return null;
  }
  const sop = (data || [])[0];
  return sop ? { title: sop.title, content: sop.content, status: sop.status === 'approved' ? 'อนุมัติแล้ว' : 'ร่าง (ยังไม่ได้ตรวจ)' } : null;
}

export async function getCategoryInfo(ctx, args) {
  const { keys, unknown } = resolveCategoryKeys([args.category].filter(Boolean), ctx.categories);
  if (keys.length === 0) {
    return {
      tool: 'get_category_info',
      unknown_categories: unknown,
      available_categories: [...ctx.categories.values()].map(c => ({ name: c.name, description: c.description }))
    };
  }
  const cat = ctx.categories.get(keys[0]);
  return {
    tool: 'get_category_info',
    category: { name: cat.name, description: cat.description },
    sop: await loadSop(ctx.companyId, keys[0])
  };
}

export async function getResolutionAdvice(ctx, args) {
  const period = resolvePeriod(args.period || { type: 'last_n_days', n: 30 });
  const chats = await fetchChatsInPeriod(ctx.companyId, period);
  let { keys, unknown } = resolveCategoryKeys([args.category].filter(Boolean), ctx.categories);

  // No category given: advise on the most frequent problem of the period
  if (keys.length === 0) {
    const counts = {};
    chats.forEach(c => (c.chat_issues || []).filter(isProblem).forEach(i => { counts[keyOf(i.category_id)] = (counts[keyOf(i.category_id)] || 0) + 1; }));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!top) return { tool: 'get_resolution_advice', period: periodFacts(period), no_problems_found: true, unknown_categories: unknown };
    keys = [top[0]];
  }
  const key = keys[0];
  const matched = chats.map(chat => ({ chat, issues: matchingIssues(chat, [key], []) })).filter(m => m.issues.length > 0);
  const issues = matched.flatMap(m => m.issues);

  const prev = previousPeriod(period);
  const prevChats = await fetchChatsInPeriod(ctx.companyId, prev, 'id, created_at, chat_issues(category_id)');
  const prevCount = prevChats.reduce((s, c) => s + (c.chat_issues || []).filter(i => keyOf(i.category_id) === key).length, 0);

  const hours = {};
  matched.forEach(m => { const h = thaiHour(m.chat.created_at); hours[h] = (hours[h] || 0) + m.issues.length; });
  const priorities = {};
  issues.forEach(i => { const p = PRIORITY_TH[i.priority] || i.priority; priorities[p] = (priorities[p] || 0) + 1; });

  const cat = ctx.categories.get(key);
  return {
    tool: 'get_resolution_advice',
    period: periodFacts(period),
    category: { name: cat?.name || key, description: cat?.description || '' },
    issues_in_period: issues.length,
    chats_in_period: matched.length,
    previous_period: { label: prev.label, issues: prevCount },
    priority_breakdown: priorities,
    peak_hours: Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, n]) => ({ hour: `${String(h).padStart(2, '0')}:00-${String(h).padStart(2, '0')}:59 น.`, issues: n })),
    customer_statements: [...new Set(issues.map(i => i.summary).filter(Boolean))].slice(0, 30),
    example_chats: matched
      .sort((a, b) => (PRIORITY_RANK[topChatPriority(b.issues)] || 0) - (PRIORITY_RANK[topChatPriority(a.issues)] || 0))
      .slice(0, 5)
      .map(m => m.chat.id),
    sop: await loadSop(ctx.companyId, key),
    unknown_categories: unknown
  };
}

export const TOOL_HANDLERS = {
  get_issue_stats: getIssueStats,
  list_chats: listChats,
  compare_periods: comparePeriods,
  get_customer_stats: getCustomerStats,
  search_chats: searchChats,
  get_sentiment: getSentiment,
  get_category_info: getCategoryInfo,
  get_resolution_advice: getResolutionAdvice
};
