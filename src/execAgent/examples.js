/**
 * Verified router examples ("question -> correct plan"), stored per company in training_examples
 * (task_type = 'agent_router'). The router receives the few most similar ones for each question,
 * so the bot learns from new examples without code or prompt changes.
 *
 * expected_output (JSON text): { "plan": {...}, "previous_question"?: "...", "previous_plan"?: {...} }
 */
import { supabase } from '../supabase.js';
import { getEmbedding } from '../ollama.js';

export const ROUTER_TASK_TYPE = 'agent_router';
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // companyId -> { at, examples }
let backfillRunning = false;

function parseVector(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return null; }
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function loadExamples(companyId) {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.examples;

  const { data, error } = await supabase
    .from('training_examples')
    .select('id, input_text, expected_output, embedding')
    .eq('company_id', companyId)
    .eq('task_type', ROUTER_TASK_TYPE);
  if (error) {
    console.warn('⚠️ [Router Examples] Could not load examples:', error.message);
    return [];
  }

  const examples = [];
  let missing = 0;
  for (const row of data || []) {
    let output;
    try {
      output = JSON.parse(row.expected_output);
    } catch {
      console.warn(`⚠️ [Router Examples] Skipping example ${row.id}: expected_output is not valid JSON`);
      continue;
    }
    const embedding = parseVector(row.embedding);
    if (!embedding) missing++;
    examples.push({ question: row.input_text, output, embedding });
  }
  if (missing > 0) backfillEmbeddings().catch(() => {});

  cache.set(companyId, { at: Date.now(), examples });
  return examples;
}

/**
 * The k verified examples most similar to the question (empty when embeddings are unavailable).
 * @param {string} query
 * @param {string} companyId
 * @param {number} [k]
 */
export async function findSimilarExamples(query, companyId, k = 5) {
  const examples = (await loadExamples(companyId)).filter(e => e.embedding);
  if (examples.length === 0) return [];
  const queryVector = await getEmbedding(query);
  if (!queryVector) return [];
  return examples
    .map(e => ({ ...e, similarity: cosine(queryVector, e.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

/** Text block for the router prompt */
export function formatExamples(examples) {
  if (!examples.length) return '(no similar verified examples)';
  return examples.map(e => {
    const prev = e.output.previous_question
      ? `Previous turn: "${e.output.previous_question}" -> ${JSON.stringify(e.output.previous_plan || {})}\n`
      : '';
    return `${prev}Q: ${e.question}\nPlan: ${JSON.stringify(e.output.plan)}`;
  }).join('\n\n');
}

/**
 * Compute embeddings for router examples that do not have one yet (e.g. rows inserted by SQL).
 * Runs on server start and whenever examples without embeddings are loaded.
 */
export async function backfillEmbeddings() {
  if (backfillRunning) return;
  backfillRunning = true;
  try {
    const { data, error } = await supabase
      .from('training_examples')
      .select('id, input_text')
      .eq('task_type', ROUTER_TASK_TYPE)
      .is('embedding', null)
      .limit(500);
    if (error) throw error;
    if (!data?.length) return;

    // The same question appears once per company: embed each distinct text only once
    const byText = new Map();
    data.forEach(row => {
      if (!byText.has(row.input_text)) byText.set(row.input_text, []);
      byText.get(row.input_text).push(row.id);
    });
    let done = 0;
    for (const [text, ids] of byText) {
      const embedding = await getEmbedding(text);
      if (!embedding) continue;
      const { error: updErr } = await supabase.from('training_examples').update({ embedding }).in('id', ids);
      if (updErr) console.warn('⚠️ [Router Examples] Embedding update failed:', updErr.message);
      else done += ids.length;
    }
    cache.clear();
    console.log(`🧩 [Router Examples] Embedded ${done}/${data.length} examples.`);
  } catch (err) {
    console.warn('⚠️ [Router Examples] Embedding backfill failed:', err.message);
  } finally {
    backfillRunning = false;
  }
}
