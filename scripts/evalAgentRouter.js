/**
 * Evaluate the executive bot's intent routing against data/agent_eval_cases.json (real questions from the logs).
 *
 *   node scripts/evalAgentRouter.js            -> runs the current LLM router (needs Ollama), read-only
 *   node scripts/evalAgentRouter.js --baseline -> scores what the OLD keyword router actually did (from telegram_chat_logs)
 *
 * A case passes when every expected field matches: tool (one of), period type, categories, group_by,
 * metric, category, chat_ids, unsupported topics and reply mode.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';
import { routeQuery } from '../src/execAgent/router.js';
import { loadCategoryContext } from '../src/execAgent/tools.js';
dotenv.config();

const cases = JSON.parse(fs.readFileSync(path.resolve('data/agent_eval_cases.json'), 'utf8'));
const companyId = process.env.DEFAULT_COMPANY_ID;
const baseline = process.argv.includes('--baseline');
const verbose = process.argv.includes('--verbose');

const sameSet = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x));
const keyOf = id => String(id || '').split(':').pop();

/** Compare a plan against the expectation; returns the list of mismatching fields */
function check(plan, expect) {
  const misses = [];
  const first = plan.calls[0];
  if (expect.mode && plan.reply_mode !== expect.mode) misses.push(`mode=${plan.reply_mode}`);
  if (expect.unsupported && !expect.unsupported.every(t => plan.unsupported_topics.includes(t))) misses.push(`unsupported=${plan.unsupported_topics.join(',') || '-'}`);
  if (!expect.tool && expect.unsupported && plan.calls.length > 0 && !baseline) misses.push(`unexpected call ${first.tool}`);
  if (expect.tool) {
    const allowed = [].concat(expect.tool);
    // Baseline: an old tool may map to several new tools, so any of them counts
    const ok = baseline ? plan.calls.some(c => allowed.includes(c.tool)) : first && allowed.includes(first.tool);
    if (!ok) misses.push(`tool=${plan.calls.map(c => c.tool).join('/') || '-'}`);
  }
  if (baseline) return misses; // the old router logged only the tool, not its arguments
  const call = first || { args: {} };
  if (expect.period && call.args.period?.type !== expect.period) misses.push(`period=${call.args.period?.type}`);
  if (expect.categories && !sameSet(expect.categories, (call.args.categories || []).map(keyOf))) misses.push(`categories=${(call.args.categories || []).join(',') || '-'}`);
  if (expect.group_by && call.args.group_by !== expect.group_by) misses.push(`group_by=${call.args.group_by}`);
  if (expect.metric && call.args.metric !== expect.metric) misses.push(`metric=${call.args.metric}`);
  if (expect.category && keyOf(call.args.category) !== expect.category) misses.push(`category=${call.args.category}`);
  if (expect.chat_ids && !sameSet(expect.chat_ids, call.args.chat_ids || [])) misses.push(`chat_ids=${(call.args.chat_ids || []).join(',') || '-'}`);
  return misses;
}

// Old keyword-router tool names -> the plan they correspond to in the new design
const OLD_TOOL_MAP = {
  // query_chat_analytics served both summaries and chat lists in the old bot
  query_chat_analytics: { calls: ['get_issue_stats', 'list_chats'] },
  autonomous_sql_recovery: { calls: ['get_issue_stats', 'list_chats'] },
  query_priority_drilldown: { calls: ['list_chats'] },
  query_urgent_action_required: { calls: ['list_chats'] },
  query_hourly_peak: { calls: ['get_issue_stats'] },
  query_daily_peak: { calls: ['get_issue_stats'] },
  query_comparison: { calls: ['compare_periods'] },
  query_month_comparison: { calls: ['compare_periods'] },
  query_customer_analytics: { calls: ['get_customer_stats'] },
  query_existing_customer_ratio: { calls: ['get_customer_stats'] },
  query_repeat_customer_issues: { calls: ['get_customer_stats'] },
  query_customer_drop_diagnostics: { calls: ['get_issue_stats'] },
  query_birthday_bonus: { calls: ['search_chats'] },
  query_freeze_complaint: { calls: ['search_chats'] },
  query_custom_topic_scan: { calls: ['search_chats'] },
  query_customer_praise: { calls: ['get_sentiment'] },
  query_vip_customer_analytics: { calls: ['search_chats'] },
  query_customer_sentiment: { calls: ['get_sentiment'] },
  query_knowledge_base: { calls: ['get_resolution_advice'] },
  query_admin_response_time: { unsupported: ['admin_response_time'] },
  unsupported_slip_guardrail: { unsupported: ['slips'] },
  security_guardrail_block: { unsupported: ['personal_data'] },
  query_financial_balance: { calls: ['get_issue_stats'] }, // answered with (empty) data instead of refusing
  query_marketing_stats: { calls: ['get_issue_stats'] },
  general_chat: { mode: 'chitchat' },
  unrelated_query: { mode: 'chitchat' }
};

async function baselinePlan(q) {
  const { data } = await supabase
    .from('telegram_chat_logs')
    .select('tool_used, created_at')
    .eq('user_query', q)
    .order('created_at', { ascending: false })
    .limit(1);
  const old = data?.[0]?.tool_used;
  if (!old) return null;
  const mapped = OLD_TOOL_MAP[old] || {};
  return {
    old,
    reply_mode: mapped.mode || 'data',
    calls: (mapped.calls || []).map(tool => ({ tool, args: {} })),
    unsupported_topics: mapped.unsupported || []
  };
}

async function main() {
  const categories = await loadCategoryContext(companyId);

  // The eval questions must not also be stored as router examples, or the test only measures recall
  if (!baseline) {
    const { data: examples } = await supabase
      .from('training_examples')
      .select('input_text')
      .eq('company_id', companyId)
      .eq('task_type', 'agent_router');
    const stored = new Set((examples || []).map(e => e.input_text.trim()));
    const leaked = cases.filter(c => stored.has(c.q.trim()));
    if (leaked.length) console.warn(`⚠️ ${leaked.length} eval question(s) are also stored as router examples; their result is not a fair test:\n${leaked.map(c => `   - ${c.q}`).join('\n')}`);
  }
  let passed = 0;
  let evaluated = 0;
  const failures = [];

  for (const c of cases) {
    let plan;
    const started = Date.now();
    try {
      plan = baseline ? await baselinePlan(c.q) : await routeQuery({ query: c.q, companyId, categories, history: c.history || [] });
    } catch (err) {
      failures.push({ q: c.q, misses: [`error: ${err.message}`] });
      evaluated++;
      continue;
    }
    if (!plan) continue; // question not present in the logs (baseline only)
    evaluated++;
    const misses = check(plan, c.expect);
    if (misses.length === 0) passed++;
    else failures.push({ q: c.q, misses, old: plan.old });
    if (verbose) console.log(`${misses.length ? '❌' : '✅'} ${c.q} (${Date.now() - started} ms) ${misses.join(' | ')} ${baseline ? `[old: ${plan.old}]` : JSON.stringify(plan.calls)}`);
  }

  console.log(`\n${baseline ? 'OLD keyword router (from logs)' : 'NEW LLM router'}: ${passed}/${evaluated} cases passed (${evaluated ? Math.round((passed / evaluated) * 100) : 0}%)`);
  if (baseline) console.log('Note: baseline checks only tool / refusal / chitchat (arguments were not logged), so it is an upper bound.');
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`- ${f.q}\n    ${f.misses.join(' | ')}${f.old ? ` [old tool: ${f.old}]` : ''}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
