/**
 * Offline evaluation of chat classification (read-only: nothing is written to the database).
 *
 * Re-classifies a sample of existing chats with the current code and compares the result with what is stored:
 *  - against human-verified issues (corrected in BO)  -> real accuracy
 *  - against the stored AI result                      -> how much the new code changes decisions
 * Also reports prompt size vs OLLAMA_NUM_CTX (silent truncation), issues per chat and "other" ratio.
 *
 * Usage:
 *   node scripts/evalTriage.js [--company <uuid>] [--limit 20] [--chat <id> ...] [--json]
 */
import dotenv from 'dotenv';
import { supabase, getCategories, getTrainingExamples } from '../src/supabase.js';
import { classifyChat } from '../src/triageService.js';
dotenv.config();

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};
const chatIds = args.flatMap((a, i) => (a === '--chat' && args[i + 1] ? [args[i + 1]] : []));
const companyId = argValue('--company', process.env.DEFAULT_COMPANY_ID);
const limit = parseInt(argValue('--limit', '20'), 10);
const asJson = args.includes('--json');

const keyOf = id => (id || '').split(':').pop();
const isOther = id => keyOf(id) === 'other';

async function loadChats() {
  let query = supabase
    .from('chats')
    .select('id, company_id, conversation, category_id, chat_issues(category_id, is_human_verified)')
    .order('created_at', { ascending: false });
  if (chatIds.length > 0) {
    query = query.in('id', chatIds);
  } else {
    query = query.eq('company_id', companyId).eq('status', 'completed').limit(limit);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load chats: ${error.message}`);
  return data || [];
}

async function main() {
  const chats = await loadChats();
  if (chats.length === 0) {
    console.log('No chats to evaluate.');
    return;
  }

  // Context per company is loaded once (same as production per-chat lookups)
  const contextByCompany = new Map();
  const results = [];

  for (const chat of chats) {
    if (!contextByCompany.has(chat.company_id)) {
      contextByCompany.set(chat.company_id, {
        categories: await getCategories(chat.company_id),
        trainingExamples: await getTrainingExamples(chat.company_id)
      });
    }
    const started = Date.now();
    try {
      const { triage, issues, primary } = await classifyChat(chat, contextByCompany.get(chat.company_id));
      const stored = chat.chat_issues || [];
      const verified = stored.filter(i => i.is_human_verified);
      const newCats = new Set(issues.filter(i => !isOther(i.category_id)).map(i => keyOf(i.category_id)));
      const storedCats = new Set(stored.filter(i => !isOther(i.category_id)).map(i => keyOf(i.category_id)));
      const verifiedCats = new Set(verified.filter(i => !isOther(i.category_id)).map(i => keyOf(i.category_id)));
      const jaccard = (a, b) => {
        const union = new Set([...a, ...b]);
        if (union.size === 0) return 1;
        return [...a].filter(x => b.has(x)).length / union.size;
      };

      results.push({
        chat_id: chat.id,
        ms: Date.now() - started,
        prompt_tokens: triage._meta?.prompt_tokens ?? null,
        context_overflow: !!triage._meta?.context_overflow,
        issues: issues.length,
        other_issues: issues.filter(i => isOther(i.category_id)).length,
        primary_new: keyOf(primary.category_id),
        primary_stored: keyOf(chat.category_id),
        categories_new: [...newCats],
        categories_stored: [...storedCats],
        overlap_with_stored: jaccard(newCats, storedCats),
        overlap_with_verified: verified.length > 0 ? jaccard(newCats, verifiedCats) : null
      });
      if (!asJson) {
        const r = results[results.length - 1];
        console.log(`${chat.id}: primary ${r.primary_stored} -> ${r.primary_new} | ${r.issues} issues (${r.other_issues} other) | ${r.prompt_tokens ?? '?'} prompt tokens${r.context_overflow ? ' ⚠️ OVERFLOW' : ''} | ${r.ms} ms`);
      }
    } catch (err) {
      results.push({ chat_id: chat.id, error: err.message, ms: Date.now() - started });
      if (!asJson) console.log(`${chat.id}: ❌ ${err.message}`);
    }
  }

  const ok = results.filter(r => !r.error);
  const avg = (list, f) => (list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0);
  const withVerified = ok.filter(r => r.overlap_with_verified !== null);
  const summary = {
    evaluated: results.length,
    failures: results.length - ok.length,
    avg_ms: Math.round(avg(ok, r => r.ms)),
    max_prompt_tokens: Math.max(0, ...ok.map(r => r.prompt_tokens || 0)),
    context_overflows: ok.filter(r => r.context_overflow).length,
    avg_issues_per_chat: +avg(ok, r => r.issues).toFixed(2),
    other_issue_ratio: +(ok.reduce((s, r) => s + r.other_issues, 0) / Math.max(1, ok.reduce((s, r) => s + r.issues, 0))).toFixed(3),
    primary_same_as_stored: +(ok.filter(r => r.primary_new === r.primary_stored).length / Math.max(1, ok.length)).toFixed(3),
    avg_category_overlap_with_stored: +avg(ok, r => r.overlap_with_stored).toFixed(3),
    chats_with_human_verified: withVerified.length,
    avg_category_overlap_with_verified: withVerified.length ? +avg(withVerified, r => r.overlap_with_verified).toFixed(3) : null
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log('\n=== Summary ===');
    console.table(summary);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
