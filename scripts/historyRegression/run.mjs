// Replays every question people asked the bot in the Telegram test group and records the new answers.
// Usage: node scripts/historyRegression/run.mjs <questions_all.json> <results.jsonl> [concurrency]
// Messages less than 30 minutes apart form one conversation chain; chains run in parallel,
// questions inside a chain run in order with the new answers as history (like the live bot).
import fs from 'fs';
import { AsyncLocalStorage } from 'async_hooks';
process.chdir('D:/AI-Triage-june');
// Share the Jaika key politely with the live bot: well under the platform's 60 req/min, 4 concurrent.
// Jaika only: no Cloudflare and no local Ollama. dotenv never overrides variables already set, so these win.
Object.assign(process.env, { JAIKA_ONLY: '1', OLLAMA_URL: 'http://127.0.0.1:9', CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' });
for (const [k, v] of Object.entries({ JAIKA_MAX_RPM: '20', JAIKA_MAX_CONCURRENT: '2', JAIKA_MAX_TPM: '50000', JAIKA_QUEUE_WAIT_MS: '120000', JAIKA_BACKOFF_MS: '60000', JAIKA_ONLY_MAX_WAIT_MS: '60000' })) process.env[k] ??= v;
const { default: dotenv } = await import('dotenv');
dotenv.config();
const { runExecAgent } = await import('../../src/execAgent/index.js');
const { loadCategoryContext } = await import('../../src/execAgent/tools.js');
const { isJaikaOpenNow, isJaikaConfigured } = await import('../../src/jaika.js');
if (!isJaikaConfigured()) { console.error('AI Jaika is not configured; aborting.'); process.exit(1); }

const [, , inFile, outFile, concArg] = process.argv;
const CONCURRENCY = parseInt(concArg || '3', 10);
const CHAIN_GAP_MS = 30 * 60 * 1000;
const companyId = process.env.DEFAULT_COMPANY_ID || '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';

// Attribute console output to the question that produced it.
const als = new AsyncLocalStorage();
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const ctx = als.getStore();
    if (ctx) ctx.logs.push(`[${level}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`.slice(0, 500));
    else orig(...args);
  };
}

const msgs = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const norm = (s) => s.toLowerCase().replace(/[\s?!.,ๆ]/g, '');
const chains = [];
let prev = null;
for (const m of msgs) {
  const t = new Date(m.date).getTime();
  if (!prev || t - prev > CHAIN_GAP_MS) chains.push([]);
  chains.at(-1).push(m);
  prev = t;
}

const done = new Map();
if (fs.existsSync(outFile)) {
  for (const line of fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    done.set(norm(r.q), r);
  }
}
const inFlight = new Map();
const total = new Set(msgs.map(m => norm(m.q))).size;
let finished = done.size;
await loadCategoryContext(companyId).catch(() => {});

async function runOne(m, history, chainNo) {
  const ctx = { logs: [] };
  const t = Date.now();
  let r;
  try {
    r = await als.run(ctx, () => runExecAgent({ query: m.q, companyId, chatId: `history-regression-${chainNo}`, history }));
  } catch (e) {
    r = { error: e.message };
  }
  const logs = ctx.logs;
  // Jaika was down for this question (retries inside the call gave up): do not record an answer,
  // the chain waits and asks the same question again.
  const JAIKA_DOWN = /temporarily unavailable|model_unavailable|Connection error|local rate limit|timed? ?out|Bad gateway|origin_bad_gateway|\b50[234]\b/i;
  if ((r.error && JAIKA_DOWN.test(r.error)) || logs.some(l => JAIKA_DOWN.test(l) && !l.includes('[AI Jaika only]'))) {
    return { jaikaDown: true, reason: (r.error || logs.find(l => JAIKA_DOWN.test(l) && !l.includes('[AI Jaika only]'))).slice(0, 120) };
  }
  const rec = {
    id: m.id, date: m.date, from: m.from, chain: chainNo, q: m.q,
    historyQs: history.map(h => h.user_query),
    origReply: m.origReply,
    tool: r.toolUsed ?? null, calls: r.slots?.calls ?? null, unsupported: r.slots?.unsupported_topics ?? null,
    composeMode: r.slots?.compose_mode ?? null, status: r.auditStatus ?? (r.error ? 'ERROR' : null),
    sec: +((Date.now() - t) / 1000).toFixed(1),
    reply: r.reply ?? null, error: r.error ?? null,
    hasExcel: !!r.excelExport,
    backend: logs.some(l => l.includes('🟢 [AI Jaika]')) ? 'jaika' : 'no-llm-call',
    jaikaErrors: logs.filter(l => l.includes('[AI Jaika]') && l.includes('Error')).length,
    logs: logs.filter(l => /warn|error|Router|Composer|Jaika/i.test(l)).slice(0, 15),
  };
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
  finished++;
  process.stdout.write(`[${finished}/${total}] ${rec.sec}s ${rec.status} ${rec.tool} ${rec.backend} | ${m.q.slice(0, 50)}\n`);
  return rec;
}

async function runChain(chain, chainNo) {
  const history = [];
  for (const m of chain) {
    if (!isJaikaOpenNow()) { stopped = true; return; } // Jaika closes at 18:00; resume tomorrow
    const key = norm(m.q);
    let rec = done.get(key);
    if (!rec && inFlight.has(key)) rec = await inFlight.get(key);
    if (!rec) {
      const p = (async () => {
        for (;;) {
          const res = await runOne(m, history.slice(-3), chainNo);
          if (!res.jaikaDown) return res;
          process.stdout.write(`⏸  Jaika unavailable (${res.reason}); waiting 60 s before asking again: ${m.q.slice(0, 40)}\n`);
          await new Promise(r => setTimeout(r, 60000));
          if (!isJaikaOpenNow()) return null;
        }
      })();
      inFlight.set(key, p);
      rec = await p;
      if (!rec) { stopped = true; return; }
      done.set(key, rec);
    }
    history.push({ user_query: m.q, slots: { calls: rec.calls || [] }, reply: rec.reply || '', audit_status: rec.status, created_at: new Date().toISOString() });
  }
}

let stopped = false;
let next = 0;
const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < chains.length && !stopped) {
    const i = next++;
    await runChain(chains[i], i + 1);
  }
}));
process.stdout.write(`${stopped ? 'STOPPED (Jaika closed)' : 'DONE'} ${finished}/${total} in ${((Date.now() - started) / 60000).toFixed(1)} min\n`);
process.exit(0);
