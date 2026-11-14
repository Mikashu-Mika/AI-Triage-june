// Re-asks the questions that failed or partly passed, each after its previous question(s) so the
// follow-up context matches the original run. Uses AI Jaika only.
// Usage: node scripts/historyRegression/retest.mjs <dir> <results.jsonl> <out.jsonl> [concurrency]
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
process.chdir('D:/AI-Triage-june');
Object.assign(process.env, { JAIKA_ONLY: '1', OLLAMA_URL: 'http://127.0.0.1:9', CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' });
for (const [k, v] of Object.entries({ JAIKA_MAX_RPM: '20', JAIKA_MAX_CONCURRENT: '2', JAIKA_MAX_TPM: '50000', JAIKA_QUEUE_WAIT_MS: '120000', JAIKA_ONLY_MAX_WAIT_MS: '60000' })) process.env[k] ??= v;
const { default: dotenv } = await import('dotenv');
dotenv.config();
const { runExecAgent } = await import('../../src/execAgent/index.js');
const { loadCategoryContext } = await import('../../src/execAgent/tools.js');
const { isJaikaOpenNow } = await import('../../src/jaika.js');

const [, , dir, resultsFile, outFile, concArg] = process.argv;
const companyId = process.env.DEFAULT_COMPANY_ID || '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';
const rows = fs.readFileSync(resultsFile, 'utf8').trim().split('\n').map(JSON.parse);
const grades = {};
for (const f of fs.readdirSync(dir).filter(f => /^grades_part\d+\.json$/.test(f))) Object.assign(grades, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const targets = rows.filter(r => grades[r.id] && grades[r.id][1] !== 'P');
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);

const als = new AsyncLocalStorage();
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const ctx = als.getStore();
    if (ctx) ctx.logs.push(`[${level}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`.slice(0, 400));
    else orig(...args);
  };
}
await loadCategoryContext(companyId).catch(() => {});
const JAIKA_DOWN = /temporarily unavailable|model_unavailable|Connection error|local rate limit|timed? ?out|Bad gateway|origin_bad_gateway|\b50[234]\b/i;

async function ask(query, history, chatId) {
  for (;;) {
    const ctx = { logs: [] };
    let r;
    try { r = await als.run(ctx, () => runExecAgent({ query, companyId, chatId, history })); } catch (e) { r = { error: e.message }; }
    const down = (r.error && JAIKA_DOWN.test(r.error)) || ctx.logs.some(l => JAIKA_DOWN.test(l) && !l.includes('[AI Jaika only]'));
    if (!down) return { r, logs: ctx.logs };
    if (!isJaikaOpenNow()) return null;
    process.stdout.write(`⏸  Jaika unavailable, waiting 60 s: ${query.slice(0, 40)}\n`);
    await new Promise(res => setTimeout(res, 60000));
  }
}

let n = done.size;
const queue = targets.filter(t => !done.has(t.id));
await Promise.all(Array.from({ length: parseInt(concArg || '2', 10) }, async () => {
  while (queue.length) {
    const t = queue.shift();
    if (!isJaikaOpenNow()) return;
    const chatId = `retest-${t.id}`;
    const history = [];
    // Rebuild the context: re-ask the question asked just before this one
    for (const q of t.historyQs.slice(-1)) {
      const prev = await ask(q, history.slice(), chatId);
      if (!prev) return;
      history.push({ user_query: q, slots: prev.r.slots || {}, reply: prev.r.reply || '', audit_status: prev.r.auditStatus, created_at: new Date().toISOString() });
    }
    const t0 = Date.now();
    const res = await ask(t.q, history, chatId);
    if (!res) return;
    const { r, logs } = res;
    const rec = {
      id: t.id, q: t.q, historyQs: t.historyQs.slice(-1), before: { verdict: grades[t.id][1], reason: grades[t.id][2], reply: t.reply },
      tool: r.toolUsed ?? null, calls: r.slots?.calls ?? null, unsupported: r.slots?.unsupported_topics ?? null, status: r.auditStatus ?? 'ERROR',
      sec: +((Date.now() - t0) / 1000).toFixed(1), reply: r.reply ?? r.error ?? null,
      logs: logs.filter(l => /warn|error|Composer/i.test(l)).slice(0, 8),
    };
    fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
    process.stdout.write(`[${++n}/${targets.length}] ${rec.sec}s ${rec.status} ${rec.tool} | ${t.q.slice(0, 50)}\n`);
  }
}));
process.stdout.write(`DONE ${n}/${targets.length}\n`);
process.exit(0);
